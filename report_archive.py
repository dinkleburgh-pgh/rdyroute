"""
End-of-shift report archive.

The Run Report page (frontend/src/pages/LiveReport.tsx) computes any date from
the database as it is NOW. That is right while the shift is running and wrong
afterwards: the next morning's day-init closes the day out (with
force_unloaded_on_new_day it flips every open truck to unloaded), trucks leave
the fleet, and settings and the tracked-item catalog change — so a past day's
report quietly changes with them.

So just before the day rolls over, this task stores the report's INPUTS for the
day in report_snapshots: the exact payloads the page fetches, each serialised
through its own endpoint's response model. The page renders an archived day
from that snapshot through the same code as a live one, so the two cannot
drift, and Kiosk / Images / PDF keep working on a saved day.

Timing: the operational day rolls over at 06:00 local (trends_common.
operational_today, the weekend folding onto Friday). Day D is captured at
05:58 on the next calendar day, two minutes before that rollover — Friday
therefore at Saturday 05:58, the end of its 3rd shift. The loop re-checks every
ARCHIVE_CHECK_SECONDS; a day whose moment passed while the backend was down is
captured on the next check and marked 'catch-up'.

No backfill: the first check records when archiving began (app_settings
report_archive_since), and a day whose end of shift came before that is never
snapshotted — it keeps rendering live, as every day did before. Catch-up only
covers outages after that moment.

REPORT_ARCHIVE_ENABLED=0 turns the loop off: the off-site standby runs this
same image, and its every-5-minutes restore of prod's dump already carries
prod's snapshots — it must not write its own between restores.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import TypeAdapter
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import SessionLocal, settings
from models import (
    AppSetting,
    AuditEntry,
    Batch,
    LoadDuration,
    ReportSnapshot,
    Shortage,
    TruckState,
    TruckStateSource,
)
from routers.audit import list_audit_entries
from routers.batches import get_batch_summary
from routers.load_durations import pace_average_as_of
from routers.route_swaps import get_swap_log, list_swaps
from routers.shorts import list_shortages
from routers.spares import list_assignments
from routers.trends_common import operational_today
from routers.trucks import build_board, get_prev_operating_day
from schemas import (
    AuditEntryOut,
    BatchSummary,
    RouteSwapLogOut,
    RouteSwapOut,
    ShortageOut,
    SpareAssignOut,
    TruckWithState,
)
from ws_manager import manager

log = logging.getLogger("readyroutev2.report_archive")

ARCHIVE_CHECK_SECONDS = 30
# How far back the loop looks for days it still owes a snapshot. Two weeks
# covers any outage worth catching up on; older days keep rendering live, as
# every day did before the archive existed.
ARCHIVE_LOOKBACK_DAYS = 14

# 05:58 — two minutes before the 06:00 rollover, after which the first board
# poll of the new day closes this one out.
_END_OF_SHIFT = time(5, 58)
# 05:58 + 2 min = 06:00, the rollover. Only a capture that starts before it is
# on time ('auto'); from 06:00 the next day's first board poll may already have
# closed this day out, so a later capture is 'catch-up'.
_ON_TIME_GRACE = timedelta(minutes=2)

# app_settings key: when this database's archive began (ISO instant, written by
# the loop's first check). Local to the database — a backup restore skips it.
ARCHIVE_SINCE_KEY = "report_archive_since"

# The windows the report page asks for: usePaceAverage(30) for the pace
# colouring and useRouteSwapLog(14) for previous-day coverage.
_PACE_LOOKBACK_DAYS = 30
_SWAP_LOG_DAYS = 14

# Every app_settings key the report page reads. Global keys: the caps and flags
# it picks out of useSettings() (wearer_cap, batch_no_cap, batching_disabled,
# recurring_route_swaps, load_timer_visible) and the tracked-item catalog and
# category colours behind useTrackedItems / useTrackedItemCategories.
_REPORT_SETTING_KEYS = (
    "wearer_cap",
    "batch_no_cap",
    "batching_disabled",
    "recurring_route_swaps",
    "load_timer_visible",
    "tracked_items_map",
    "tracked_item_categories",
)
# Per-run-date keys, suffixed with the date: useLoadDayOverride,
# useUnloadsDayOverride and useHolidayUnload.
_REPORT_DATED_SETTING_PREFIXES = (
    "load_day_override_",
    "unloads_day_override_",
    "holiday_unload_",
)

# Last error logged per key (a run date, or "check" for the loop itself), so a
# day that keeps failing logs once per distinct error, not every 30 seconds.
_last_error: dict[object, str] = {}

# What the loop last did, for the admin /health/detail — the archive has no
# other status signal, and a day that keeps failing silently ages out of the
# lookback window for good.
_status: dict[str, object] = {
    "enabled": None,
    "since": None,
    "last_check_at": None,
    "last_capture": None,
}


def get_archive_status() -> dict:
    """The loop's state for /health/detail: whether it runs, when archiving
    began, its last check and capture, and the days currently failing."""
    return {
        **_status,
        "failing": {str(k): v for k, v in _last_error.items()},
    }


# ---------------------------------------------------------------------------
# Schedule — pure, so it can be tested against any clock
# ---------------------------------------------------------------------------

def end_of_shift(run_date: date) -> datetime:
    """The moment run day *run_date* is archived: 05:58 local on the next
    calendar day, just before the 06:00 rollover closes it out."""
    return datetime.combine(
        run_date + timedelta(days=1), _END_OF_SHIFT, tzinfo=ZoneInfo(settings.timezone)
    )


def archive_window_start(now: datetime) -> date:
    """The oldest run date the loop still considers at *now*."""
    return now.astimezone(ZoneInfo(settings.timezone)).date() - timedelta(days=ARCHIVE_LOOKBACK_DAYS)


def due_run_dates(
    run_dates: Iterable[date],
    archived: Iterable[date],
    now: datetime,
    since: datetime | None = None,
) -> list[date]:
    """The run days owed a snapshot at *now*, oldest first.

    *run_dates* are the days the shift actually worked (worked_run_dates). Of
    those, a day is due once its end of shift has passed, while it is inside
    the lookback window, until it has a snapshot — and, given *since* (when
    archiving began), only if its end of shift came at or after that: an older
    day was never captured and has no honest snapshot to reconstruct."""
    done = set(archived)
    earliest = archive_window_start(now)
    return sorted(
        d for d in set(run_dates)
        if d >= earliest
        and d not in done
        and end_of_shift(d) <= now
        and (since is None or end_of_shift(d) >= since)
    )


def capture_source(run_date: date, now: datetime) -> str:
    """'auto' when the capture starts before the 06:00 rollover, 'catch-up'
    when the backend was down at the moment and the day is captured late."""
    return "auto" if now < end_of_shift(run_date) + _ON_TIME_GRACE else "catch-up"


def worked_run_dates(db: Session, start: date, end: date | None = None) -> set[date]:
    """The days in [start, end] the shift actually worked.

    Rows alone don't prove it: reading the board for a past date that was never
    set up (the Run Report's live view of a Sunday or a holiday) seeds a whole
    day of state_source='auto' rows. So the evidence is apply_day_gap's
    "touched" test — a row a person or workflow wrote, or one a driver stamped
    (the next day's close-out only stamps a day that was already touched) —
    plus what only the crew ever writes: load times, batches, load durations,
    shortages and audit entries. The last few matter for rows from before
    state_source existed, which are all 'auto'. Route swaps are no evidence:
    day-init seeds the recurring ones. A day needs its truck states (else there
    is no report to save), and one flagged plant_closed never counts."""
    def in_range(col):
        return [col >= start, *([col <= end] if end is not None else [])]

    touched = set(db.scalars(
        select(TruckState.run_date).where(
            *in_range(TruckState.run_date),
            or_(
                TruckState.state_source != TruckStateSource.auto.value,
                TruckState.arrived_at.is_not(None),
                TruckState.driver_claimed_route.is_not(None),
                TruckState.needs_checked == True,  # noqa: E712
                TruckState.load_start_time.is_not(None),
                TruckState.load_finish_time.is_not(None),
            ),
        ).distinct()
    ).all())
    has_rows = set(db.scalars(
        select(TruckState.run_date).where(*in_range(TruckState.run_date)).distinct()
    ).all())
    for col in (Batch.run_date, LoadDuration.run_date, Shortage.run_date, AuditEntry.run_date):
        touched |= has_rows & set(db.scalars(select(col).where(*in_range(col)).distinct()).all())
    if not touched:
        return touched
    closed = {
        row.key
        for row in db.scalars(
            select(AppSetting).where(AppSetting.key.in_([f"plant_closed_{d}" for d in touched]))
        ).all()
        if row.value is True
    }
    return {d for d in touched if f"plant_closed_{d}" not in closed}


def archive_since(db: Session, now: datetime) -> datetime:
    """When this database's archive began. The first check records it, so a
    deploy (or a restore, which skips the key) never backfills older days."""
    row = db.get(AppSetting, ARCHIVE_SINCE_KEY)
    if row is None or not row.value:
        if row is None:
            db.add(AppSetting(key=ARCHIVE_SINCE_KEY, value=now.isoformat()))
        else:
            row.value = now.isoformat()
        try:
            db.commit()
        except IntegrityError:
            # Another worker recorded it first — theirs stands.
            db.rollback()
        row = db.get(AppSetting, ARCHIVE_SINCE_KEY)
    try:
        since = datetime.fromisoformat(str(row.value))
    except ValueError:
        # Hand-edited (Management > Advanced) into something that isn't an ISO
        # instant. Fall back to when it was written: every day due before then
        # already had its pass, so nothing owed is skipped and nothing older
        # is backfilled. Logged once per distinct value, shown in /health/detail.
        _log_failure("since", ValueError(
            f"{ARCHIVE_SINCE_KEY}={row.value!r} is not an ISO datetime; using when it was written"))
        since = row.updated_at
        if since.tzinfo is None:  # SQLite hands back naive UTC
            since = since.replace(tzinfo=timezone.utc)
    else:
        _last_error.pop("since", None)
    if since.tzinfo is None:
        # A hand-entered date or wall-clock time means local time.
        since = since.replace(tzinfo=ZoneInfo(settings.timezone))
    return since


# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------

def _dump(model: type, rows: object) -> list:
    """Serialise *rows* exactly as FastAPI sends them for
    ``response_model=list[model]``: validate from attributes, then dump in JSON
    mode — so the frontend's existing types describe the snapshot unchanged."""
    adapter = TypeAdapter(list[model])
    return adapter.dump_python(
        adapter.validate_python(rows, from_attributes=True), mode="json", by_alias=True
    )


def _report_settings(db: Session, run_date: date) -> dict:
    """The raw stored value of every setting the report reads for *run_date*.
    A key that isn't set is left out, exactly as the page would see a 404 or an
    absent row and fall back to its default."""
    keys = [*_REPORT_SETTING_KEYS, *(f"{p}{run_date}" for p in _REPORT_DATED_SETTING_PREFIXES)]
    rows = db.scalars(select(AppSetting).where(AppSetting.key.in_(keys))).all()
    return {row.key: row.value for row in sorted(rows, key=lambda r: r.key)}


def build_inputs(db: Session, run_date: date) -> dict:
    """The report page's inputs for *run_date*, as its endpoints serve them now.

    These are the FastAPI handlers themselves, so every parameter is passed
    explicitly: one left to its Query()/Depends() default receives the marker
    object, which is truthy and not None — list_audit_entries would quietly
    filter to warn_only, list_shortages to a phantom truck. The auth parameters
    are unused inside the handlers. The board goes through build_board, never
    get_board, whose day-init seeds and commits."""
    prev = get_prev_operating_day(run_date=run_date, db=db, _user=None)["prev_run_date"]
    # The swap log is only read for the previous operating day, and its window
    # is anchored on the operational today. On time that is the page's own 14
    # days; a late capture widens it just enough to still reach that day.
    swap_log_days = _SWAP_LOG_DAYS
    if prev is not None:
        reach = (operational_today() - date.fromisoformat(prev)).days + 1
        swap_log_days = min(365, max(_SWAP_LOG_DAYS, reach))
    return {
        "run_date": run_date.isoformat(),
        "board": _dump(TruckWithState, build_board(run_date, db)),
        "batches": _dump(BatchSummary, get_batch_summary(run_date=run_date, db=db, _user=None)),
        "shortages": _dump(
            ShortageOut, list_shortages(run_date=run_date, truck_number=None, _user=None, db=db)
        ),
        "audit_entries": _dump(
            AuditEntryOut,
            list_audit_entries(
                run_date=run_date, truck_number=None, warn_only=False,
                route=None, since=None, before=None, _user=None, db=db,
            ),
        ),
        "spares": _dump(
            SpareAssignOut, list_assignments(run_date=run_date, returned=None, _user=None, db=db)
        ),
        "route_swaps": _dump(RouteSwapOut, list_swaps(run_date=run_date, _user=None, db=db)),
        "route_swap_log": _dump(RouteSwapLogOut, get_swap_log(days=swap_log_days, _user=None, db=db)),
        "prev_operating_day": prev,
        # The 30 days ending on the run date — what the page showed that
        # night — not on the capture's own today, which a late or manual
        # capture would shift.
        "pace_avg_seconds": pace_average_as_of(db, run_date, _PACE_LOOKBACK_DAYS),
        "settings": _report_settings(db, run_date),
    }


def _coverage_card_count(inputs: dict) -> int:
    """How many cards the saved day's "Routes covered" section shows — the
    report's coverageRows (LiveReport.tsx) for a past day, rule for rule: every
    route swap (splits too), every spare/crossload assignment (returned ones
    too — the freight still moved that day), then any crossload still only
    flagged on a route nothing else covered; one card per route→truck pair."""
    seen: set[tuple[int, int | None]] = set()
    seen_routes: set[int] = set()

    def add(route: int, on: int | None) -> None:
        seen.add((route, on))
        seen_routes.add(route)

    for rs in inputs["route_swaps"]:
        add(rs["route_truck"], rs["load_on_truck"])
    for sp in inputs["spares"]:
        add(sp["covering_route_truck"], sp["spare_truck_number"])
    for t in inputs["board"]:
        st = t.get("state") or {}
        if not (st.get("needs_crossload") or st.get("crossload_to_truck") is not None):
            continue
        if t["truck_number"] in seen_routes:
            continue
        add(t["truck_number"], st.get("crossload_to_truck"))
    return len(seen)


def summarize(inputs: dict) -> dict:
    """Headline counts for the archive list, read from the snapshot's own
    inputs with the report page's definitions, so the list and the rendered
    day always agree."""
    states = [t["state"] for t in inputs["board"] if t.get("state")]
    shortages = inputs["shortages"]
    return {
        "qty_short": sum(s["quantity"] for s in shortages),
        "trucks_shorted": len({s["truck_number"] for s in shortages}),
        # The persisted load signal (trends_common.loaded_load_filter): a finish
        # stamp, or marked loaded by hand / in bulk without one.
        "trucks_loaded": sum(
            1 for st in states if st["status"] == "loaded" or st["load_finish_time"] is not None
        ),
        # The report's "Trucks timed": loaded, with a recorded duration.
        "trucks_timed": sum(
            1 for st in states if st["status"] == "loaded" and st["load_duration_seconds"] is not None
        ),
        "routes_covered": _coverage_card_count(inputs),
        # The report's "Items logged".
        "audit_items": len(inputs["audit_entries"]),
        "batches_used": sum(1 for b in inputs["batches"] if b["trucks"]),
    }


def _snapshot_for(db: Session, run_date: date) -> ReportSnapshot | None:
    return db.scalar(select(ReportSnapshot).where(ReportSnapshot.run_date == run_date))


def capture_snapshot(db: Session, run_date: date, source: str, *, replace: bool = True) -> ReportSnapshot:
    """Archive *run_date*'s report inputs (upsert on run_date) and return the row.

    replace=False is the loop's mode: a day archived in the meantime — by an
    admin's manual capture, say — stands and is returned untouched. The manual
    endpoint replaces. Nothing but report_snapshots is written."""
    existing = _snapshot_for(db, run_date)
    if existing is not None and not replace:
        return existing

    inputs = build_inputs(db, run_date)
    fields = {
        "captured_at": datetime.now(timezone.utc),
        "source": source,
        "app_version": (os.environ.get("APP_VERSION") or "")[:64] or None,
        "inputs": inputs,
        "summary": summarize(inputs),
    }
    if existing is None:
        db.add(ReportSnapshot(run_date=run_date, **fields))
    else:
        for name, value in fields.items():
            setattr(existing, name, value)
    try:
        db.commit()
    except IntegrityError:
        # Two captures of the same day raced (the loop and an admin's manual
        # capture) and the unique run_date let only one insert through. The
        # day is archived either way: keep the winner, or overwrite it when
        # this capture is the one meant to replace.
        db.rollback()
        existing = _snapshot_for(db, run_date)
        if existing is None:
            raise
        if replace:
            for name, value in fields.items():
                setattr(existing, name, value)
            db.commit()
    return _snapshot_for(db, run_date)


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

def _log_failure(key: object, exc: BaseException) -> None:
    message = f"{type(exc).__name__}: {exc}"
    if _last_error.get(key) != message:
        _last_error[key] = message
        log.warning("Report archive failed (%s): %s", key, message, exc_info=exc)


def _archive_due_days(now: datetime | None = None) -> list[tuple[date, str]]:
    """One pass: capture every run day that is owed a snapshot. Returns the
    (run_date, source) pairs captured. Blocking — run it in a thread."""
    now = now or datetime.now(ZoneInfo(settings.timezone))
    db = SessionLocal()
    try:
        since = archive_since(db, now)
        _status["since"] = since.isoformat()
        start = archive_window_start(now)
        run_dates = worked_run_dates(db, start)
        archived = db.scalars(
            select(ReportSnapshot.run_date).where(ReportSnapshot.run_date >= start)
        ).all()
        # A day captured elsewhere since it failed here (an admin's manual
        # capture, maybe on another worker) is resolved: stop listing it.
        for key in set(archived) & {k for k in _last_error if isinstance(k, date)}:
            _last_error.pop(key)
        # A day that kept failing until it left the window is never retried —
        # say so once, loudly, unless it was captured in the meantime.
        aged = [k for k in _last_error if isinstance(k, date) and k < start]
        saved = set(db.scalars(
            select(ReportSnapshot.run_date).where(ReportSnapshot.run_date.in_(aged))
        ).all()) if aged else set()
        for key in aged:
            last = _last_error.pop(key)
            if key not in saved:
                log.warning(
                    "Report archive gave up on %s: it left the %d-day window without a snapshot (last error: %s)",
                    key, ARCHIVE_LOOKBACK_DAYS, last,
                )
        captured: list[tuple[date, str]] = []
        for run_date in due_run_dates(run_dates, archived, now, since):
            source = capture_source(run_date, now)
            try:
                capture_snapshot(db, run_date, source, replace=False)
            except Exception as exc:  # noqa: BLE001 - one bad day must not block the rest
                db.rollback()
                _log_failure(run_date, exc)
                continue
            _last_error.pop(run_date, None)
            captured.append((run_date, source))
            _status["last_capture"] = {
                "run_date": run_date.isoformat(),
                "source": source,
                "at": datetime.now(timezone.utc).isoformat(),
            }
        _last_error.pop("check", None)
        _status["last_check_at"] = datetime.now(timezone.utc).isoformat()
        return captured
    finally:
        db.close()


async def report_archive_loop() -> None:
    """
    Long-running background task: every ARCHIVE_CHECK_SECONDS, archive each
    run day whose end of shift has passed and that has no snapshot yet.
    Idempotent (one snapshot per run date) and never dies on an error — a
    failed pass is logged and simply retried on the next check.
    """
    if os.getenv("REPORT_ARCHIVE_ENABLED", "1").strip().lower() in {"0", "false", "no", "off"}:
        _status["enabled"] = False
        log.info("Report archive disabled (REPORT_ARCHIVE_ENABLED=0).")
        return
    _status["enabled"] = True
    log.info(
        "Report archive loop started. check=%ds lookback=%dd capture=%s local",
        ARCHIVE_CHECK_SECONDS, ARCHIVE_LOOKBACK_DAYS, _END_OF_SHIFT.strftime("%H:%M"),
    )
    while True:
        try:
            for run_date, source in await asyncio.to_thread(_archive_due_days):
                log.info("Report archived: %s (%s)", run_date, source)
                # Open Report pages drop "Not archived" and offer the saved day.
                await manager.broadcast({"type": "report_archived", "run_date": str(run_date)})
        except Exception as exc:  # noqa: BLE001
            _log_failure("check", exc)
        await asyncio.sleep(ARCHIVE_CHECK_SECONDS)
