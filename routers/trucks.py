"""
Router: /trucks

Endpoints for reading and mutating per-truck state on a given run-date.

Business logic preserved from V1:
  - Trucks progress through a defined status lifecycle:
      dirty → in_progress → unloaded → loaded
      dirty → shop
      dirty/loaded → off / oos / spare
  - Load start/finish times are stamped as Unix timestamps and the
    duration is recorded for pace calculation.
  - The dashboard endpoint returns every active truck together with its
    current-day state so the React frontend can render the board in a
    single fetch.
"""

import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from activity_log import add_related_truck_context, append_activity_event, append_truck_state_activity
from database import get_db, settings as app_settings
from models import AppSetting, GarmentDayLog, RouteSwap, RouteSwapLog, SpareAssignment, Truck, TruckState, TruckStateSource, TruckStatus, TruckType, User
from notification_service import dispatch_notification, send_web_push, truck_arrived_notification, truck_hold_notification, truck_oos_notification
from routers.auth import get_current_user, require_admin, require_non_guest
from routers.trends_common import (
    MAX_LOAD_SECONDS,
    MIN_LOAD_SECONDS,
    RUNNING_STATUS_EXCLUDE,
    completed_load_filter,
    operational_today,
    window_bounds,
)
from schemas import (
    AnomalyDay,
    CompletionDailyPoint,
    CycleDailyPoint,
    GarmentDayLogOut,
    TruckStateCreate,
    TruckStateOut,
    TruckStateUpdate,
    TruckWithState,
    UnloadDailyPoint,
    WearersDailyPoint,
)
from ws_manager import manager

router = APIRouter(prefix="/trucks", tags=["trucks"])

_PERSISTENT_STATUSES = {"off", "oos", "shop"}


def _ship_day_number(value: date) -> int:
    weekday = value.weekday()  # Mon=0 .. Sun=6
    if 0 <= weekday <= 4:
        return weekday + 1
    return 1


def _load_day_number(run_date: date) -> int:
    return _ship_day_number(run_date + timedelta(days=1))


def _ran_special(note: str | None) -> bool:
    return "ran special" in (note or "").lower()


def _operational_today() -> date:
    """The current OPERATIONAL run date (06:00 rollover + weekend→Friday). The
    canonical implementation now lives in routers.trends_common so every trend
    window shares the same run-day; kept as an alias for the callers here."""
    return operational_today()


def _ensure_day_initialized(run_date: date, db: Session) -> None:
    # NEVER initialize a run day beyond the OPERATIONAL today. Day-init closes
    # out the previous day (force-unloading its open trucks, clearing fresh
    # holds), so initializing early rolls the day over while the shift is
    # still working. Two real incidents: a query for tomorrow's date at 23:59
    # (2026-07-15) auto-unloaded a just-held truck; and a calendar-Saturday
    # date (2026-07-18) would pass a plain calendar-date guard even though the
    # weekend IS Friday's run period until Monday 06:00. Later dates render
    # whatever rows exist, without initializing anything.
    if run_date > _operational_today():
        return
    source_key = f"day_setup_source_{run_date}"
    if db.get(AppSetting, source_key) is not None:
        return

    trucks = db.scalars(
        select(Truck).where(Truck.is_active == True).order_by(Truck.truck_number)
    ).all()
    if not trucks:
        db.add(AppSetting(key=source_key, value="auto"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
        return

    # Check force_unloaded_on_new_day setting — overrides all prior-status logic
    force_setting = db.get(AppSetting, "force_unloaded_on_new_day")
    force_unloaded = force_setting is not None and force_setting.value is True

    load_day_num = _load_day_number(run_date)
    prev_run_date = db.scalar(
        select(func.max(TruckState.run_date)).where(TruckState.run_date < run_date)
    )
    # Load-day number for the previous run date — used to determine whether a
    # truck with prior status "unloaded" was scheduled off that day (and therefore
    # didn't run a route) vs. was active and dispatched (and came back dirty).
    prev_load_day_num = _load_day_number(prev_run_date) if prev_run_date is not None else None
    # Did the previous run day load on a holiday? If so, TWO ship days ran in one
    # shift (prev load day + the next ship day), so a truck only sat out if it was
    # scheduled off BOTH days — everything else ran and comes back dirty today.
    prev_holiday_load = False
    if prev_run_date is not None:
        _hl = db.get(AppSetting, f"holiday_load_{prev_run_date}")
        prev_holiday_load = _hl is not None and _hl.value is True
    prev_second_load_day = (
        (1 if prev_load_day_num == 5 else prev_load_day_num + 1)
        if prev_load_day_num is not None
        else None
    )

    # Carry the run mode forward: a new day inherits the previous run day's
    # holiday Load/Unload mode, so once Setup Day step 1 sets it the choice
    # persists day to day until it's explicitly changed again.
    if prev_run_date is not None:
        for base in ("holiday_load", "holiday_unload", "holiday_mode"):
            cur_key = f"{base}_{run_date}"
            if db.get(AppSetting, cur_key) is None:
                prev_setting = db.get(AppSetting, f"{base}_{prev_run_date}")
                if prev_setting is not None:
                    db.add(AppSetting(key=cur_key, value=prev_setting.value))

    prev_states_by_num: dict[int, TruckState] = {}
    prev_loaded_on = set[int]()
    prev_spares_used = set[int]()
    prev_crossload_targets = set[int]()
    if prev_run_date is not None:
        prev_states_by_num = {
            row.truck_number: row
            for row in db.scalars(
                select(TruckState).where(TruckState.run_date == prev_run_date)
            ).all()
        }
        prev_loaded_on = {
            row.load_on_truck
            for row in db.scalars(
                select(RouteSwap).where(RouteSwap.run_date == prev_run_date)
            ).all()
        }
        # Every truck that carried someone else's freight yesterday, gathered
        # from all three places coverage gets recorded. A truck that dispatched
        # must come back dirty, so this deliberately does NOT filter on
        # `returned` the way the coverage editor does — an assignment closed
        # during the day still means the truck ran. RouteSwapLog is append-only
        # so it survives a cleared assignment, and oos_spare_route catches
        # coverage written straight onto the state row (the generic state upsert
        # accepts that field without ever creating an assignment).
        prev_spares_used = {
            row.spare_truck_number
            for row in db.scalars(
                select(SpareAssignment).where(SpareAssignment.run_date == prev_run_date)
            ).all()
        }
        prev_spares_used |= {
            row.load_on_truck
            for row in db.scalars(
                select(RouteSwapLog).where(RouteSwapLog.run_date == prev_run_date)
            ).all()
        }
        prev_spares_used |= {
            num
            for num, row in prev_states_by_num.items()
            if row.oos_spare_route is not None
        }
        # Trucks that had another truck's freight crossloaded ONTO them. The
        # marker lives on the SOURCE truck's state and points at the target, so
        # the target is otherwise invisible here: a crossload that was flagged
        # and then moved by hand creates no assignment and no swap row. If a
        # stale marker survives to end of day we still mark the target dirty —
        # a truck that shows dirty costs one tap to unload, whereas one that
        # comes back "unloaded" silently drops out of the crew's work list.
        prev_crossload_targets = {
            row.crossload_to_truck
            for row in prev_states_by_num.values()
            if row.crossload_to_truck is not None
        }

        # Retire spare assignments from run days BEFORE the previous one. Left
        # open they linger forever (assignments are per-day and never auto-closed
        # otherwise) and the historical-coverage fallback resurfaces months-old
        # coverage — a truck now running its own route gets tagged as still
        # covering a route it only covered weeks ago. The route-swap log (written
        # when a spare is assigned) preserves the coverage history, and the
        # previous run day's own assignments stay open for its coverage editor.
        stale_open_spares = db.scalars(
            select(SpareAssignment).where(
                SpareAssignment.run_date < prev_run_date,
                SpareAssignment.returned == False,
            )
        ).all()
        _now = datetime.now(timezone.utc)
        for _sp in stale_open_spares:
            _sp.returned = True
            _sp.returned_at = _now

    # When force_unloaded is set, close out the previous day first — mark any
    # trucks that are still dirty/in_progress/unfinished as unloaded so that
    # the previous day's board reflects a clean end-of-day state.
    _OPEN_STATUSES = {TruckStatus.dirty, TruckStatus.in_progress, TruckStatus.unfinished}
    if force_unloaded and prev_run_date is not None:
        for prev_state in prev_states_by_num.values():
            if prev_state.status in _OPEN_STATUSES:
                prev_state.status = TruckStatus.unloaded
                prev_state.state_source = TruckStateSource.workflow.value
                prev_state.unloading_started_at = None

    today_states = {
        row.truck_number: row
        for row in db.scalars(
            select(TruckState).where(TruckState.run_date == run_date)
        ).all()
    }
    seeded_truck_numbers: list[int] = []
    status_counts: dict[str, int] = {}

    for truck in trucks:
        if truck.truck_number in today_states:
            # A row already exists for this run date (rare — created before init
            # ran). Day init is the start of a fresh run day, so priority_hold and
            # needs_checked must not carry into it — clear them here too so the
            # reset is guaranteed for every truck, not just the freshly-seeded
            # ones. (Legitimate same-day holds/checks are set by wizard/workflow
            # AFTER init, which no longer runs once day_setup_source is set.)
            existing_today = today_states[truck.truck_number]
            if (
                existing_today.priority_hold
                or existing_today.needs_checked
                or existing_today.crossload_to_truck is not None
                or existing_today.unloading_started_at is not None
            ):
                existing_today.priority_hold = False
                existing_today.needs_checked = False
                existing_today.crossload_to_truck = None
                existing_today.unloading_started_at = None
            continue

        prior = prev_states_by_num.get(truck.truck_number)
        scheduled_off_today = (
            truck.truck_type != "Spare" and load_day_num in (truck.scheduled_off_days or [])
        )
        used_yesterday = False
        needs_checked = False
        off_note = ""
        shop_note = ""
        oos_spare_route = None
        has_dust_garment = False
        priority_hold = False
        batch_id = None
        wearers = 0
        load_day_value = load_day_num
        status = TruckStatus.unloaded

        # Recorded evidence that this truck dispatched yesterday, independent of
        # whether it had a state row of its own. Coverage and crossload targets
        # normally get one, but nothing guarantees it, and a truck that ran must
        # not fall through to the no-prior default of "unloaded".
        ran_on_record = (
            truck.truck_number in prev_loaded_on
            or truck.truck_number in prev_spares_used
            or truck.truck_number in prev_crossload_targets
        )

        if prior is not None:
            # needs_checked and ran-special off_note are intentionally NOT carried
            # forward — both reset each day.
            shop_note = prior.shop_note or ""
            used_yesterday = (
                prior.status in {TruckStatus.loaded, TruckStatus.in_progress}
                or ran_on_record
            )

            if prior.status == TruckStatus.unfinished:
                status = TruckStatus.unfinished
            elif prior.status in {TruckStatus.oos, TruckStatus.shop}:
                status = prior.status
            elif prior.status == TruckStatus.dirty:
                # Truck is physically at the dock waiting to be unloaded. Carry forward
                # regardless of the next load day's schedule.
                status = TruckStatus.dirty
            elif used_yesterday:
                # Truck was in loaded/in_progress state yesterday — it definitely dispatched
                # and returned dirty today, regardless of today's load schedule.
                status = TruckStatus.dirty
            elif prior.status == TruckStatus.unloaded and truck.truck_type != "Spare":
                # Non-spare was unloaded yesterday. Check if it actually dispatched by looking
                # at the UNLOAD day schedule (prev_load_day_num = today's unload day number).
                # Resolve this BEFORE scheduled_off_today so a truck scheduled off for
                # tomorrow's load doesn't wrongly get "off" status when it ran today.
                off_days = truck.scheduled_off_days or []
                if prev_holiday_load and prev_load_day_num is not None:
                    # Holiday ran both ship days — the truck only sat out if it was
                    # scheduled off BOTH, otherwise it ran and returned dirty.
                    prev_sched_off = (
                        prev_load_day_num in off_days
                        and (prev_second_load_day is None or prev_second_load_day in off_days)
                    )
                else:
                    prev_sched_off = (
                        prev_load_day_num is not None
                        and prev_load_day_num in off_days
                    )
                if not prev_sched_off:
                    status = TruckStatus.dirty    # dispatched → came back dirty
                elif scheduled_off_today:
                    status = TruckStatus.off      # didn't dispatch + not loading tonight
                else:
                    status = TruckStatus.unloaded  # didn't dispatch + active tonight
            elif scheduled_off_today:
                status = TruckStatus.off
            elif prior.status in {TruckStatus.off, TruckStatus.unloaded, TruckStatus.spare}:
                status = TruckStatus.unloaded
            else:
                status = TruckStatus.unloaded
        elif ran_on_record:
            used_yesterday = True
            status = TruckStatus.dirty
        else:
            status = TruckStatus.off if scheduled_off_today else TruckStatus.unloaded

        if prior is None and scheduled_off_today:
            off_note = ""
        if truck.truck_type == "Spare" and truck.truck_number not in prev_spares_used and not used_yesterday:
            # Only reset to unloaded if the spare wasn't already carrying a dirty state forward.
            if prior is None or prior.status != TruckStatus.dirty:
                status = TruckStatus.unloaded

        # NOTE: force_unloaded_on_new_day intentionally does NOT pre-mark today's
        # trucks unloaded. It only closes out the PREVIOUS day (see the block near
        # the top of this function). Trucks that ran come back dirty today so the
        # crew's unload workflow has work to do; the auto-unload is an END-OF-DAY
        # action — it happens when the NEXT day rolls over and closes this one out.

        row = TruckState(
            truck_number=truck.truck_number,
            run_date=run_date,
            status=status,
            wearers=wearers,
            batch_id=batch_id,
            load_day_num=load_day_value,
            load_start_time=None,
            load_finish_time=None,
            load_duration_seconds=None,
            off_note=off_note,
            shop_note=shop_note,
            oos_spare_route=oos_spare_route,
            has_dust_garment=has_dust_garment,
            priority_hold=priority_hold,
            needs_checked=needs_checked,
            state_source=TruckStateSource.auto.value,
        )
        db.add(row)
        seeded_truck_numbers.append(truck.truck_number)
        status_key = row.status.value if hasattr(row.status, "value") else str(row.status)
        status_counts[status_key] = status_counts.get(status_key, 0) + 1

    db.add(AppSetting(key=source_key, value="auto"))
    append_activity_event(
        db,
        actor_type="system",
        event_family="system",
        event_type="day_auto_initialized",
        run_date=run_date,
        summary=f"Auto-initialized {len(seeded_truck_numbers)} trucks for {run_date}",
        diff_json={
            "seeded_count": len(seeded_truck_numbers),
            "status_counts": status_counts,
        },
        context_json=add_related_truck_context(
            {
                "day_setup_source": "auto",
                "seeded_count": len(seeded_truck_numbers),
                "status_counts": status_counts,
            },
            seeded_truck_numbers,
        ),
    )
    # Auto-apply recurring route-swap rules for this load day (once per run-date).
    from routers.spares import apply_recurring_swaps
    apply_recurring_swaps(db, run_date, load_day_num)
    # Day init is a check-then-act with no lock: at rollover two concurrent board
    # polls can both pass the "already initialized" check at the top and both try
    # to insert the same sentinel / TruckState rows here. The whole init is one
    # transaction, so the loser's commit hits a unique-constraint violation —
    # catch it, roll back, and return. The winner's initialization already stands;
    # this request just sees the fully-initialized day on its next read.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


# ---------------------------------------------------------------------------
# Dashboard — full board for a run-date
# ---------------------------------------------------------------------------

@router.get("/prev-operating-day")
def get_prev_operating_day(
    run_date: date = Query(..., description="Operational run-date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """The previous OPERATING run date — the most recent run_date with any truck
    state before *run_date* (the exact signal day-init seeds 'dirty' from). Lets
    the client resolve previous-day coverage across mid-week plant closures that
    a plain weekday-step would skip, keeping the unload count/banner correct."""
    prev = db.scalar(
        select(func.max(TruckState.run_date)).where(TruckState.run_date < run_date)
    )
    return {"prev_run_date": prev.isoformat() if prev is not None else None}


@router.get("/garment-log", response_model=list[GarmentDayLogOut])
def get_garment_log(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Durable, append-only history of Dust-truck garment markings over the past
    N days. Each row is a change to a truck's has_dust_garment flag (the latest
    row per (run_date, truck_number) is that day's final state). Survives the
    nightly TruckState reset — the foundation for future garment logic."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()
    rows = db.scalars(
        select(GarmentDayLog)
        .where(GarmentDayLog.run_date >= cutoff)
        .order_by(GarmentDayLog.run_date.desc(), GarmentDayLog.created_at.desc())
    ).all()
    return rows


@router.get("/board", response_model=list[TruckWithState])
def get_board(
    run_date: date = Query(..., description="Operational run-date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return all active fleet trucks joined with their explicit state for *run_date*."""
    _ensure_day_initialized(run_date, db)
    trucks = db.scalars(
        select(Truck).where(Truck.is_active == True).order_by(Truck.truck_number)
    ).all()

    # Fetch today's states in one query
    states_by_num: dict[int, TruckState] = {
        s.truck_number: s
        for s in db.scalars(
            select(TruckState).where(TruckState.run_date == run_date)
        ).all()
    }

    route_swaps = db.scalars(
        select(RouteSwap).where(RouteSwap.run_date == run_date)
    ).all()
    # SPLIT rows are a different animal: the route truck ALSO runs, the helper
    # carries overflow — serialized as route_split_route, never as a takeover.
    swap_by_load_on: dict[int, int] = {
        rs.load_on_truck: rs.route_truck for rs in route_swaps if not rs.is_split
    }
    split_by_load_on: dict[int, int] = {
        rs.load_on_truck: rs.route_truck for rs in route_swaps if rs.is_split
    }

    result = []
    for t in trucks:
        s = states_by_num.get(t.truck_number)
        swap_route = swap_by_load_on.get(t.truck_number)
        # A two-way swap is stored as two reciprocal rows; a one-way swap has no
        # reciprocal — the covered truck does NOT run, so clients treat one-way
        # like a takeover.
        swap_two_way = (
            (swap_by_load_on.get(swap_route) == t.truck_number)
            if swap_route is not None
            else None
        )
        result.append(
            TruckWithState(
                id=t.id,
                truck_number=t.truck_number,
                truck_type=t.truck_type,
                is_active=t.is_active,
                is_persistent_spare=t.is_persistent_spare,
                is_oos=t.is_oos,
                scheduled_off_days=t.scheduled_off_days or [],
                state=TruckStateOut.model_validate(s) if s else None,
                route_swap_route=swap_route,
                route_swap_two_way=swap_two_way,
                route_split_route=split_by_load_on.get(t.truck_number),
            )
        )
    return result


# ---------------------------------------------------------------------------
# Single truck state
# ---------------------------------------------------------------------------

@router.get("/{truck_number}/state", response_model=TruckStateOut)
def get_truck_state(
    truck_number: int,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == truck_number,
            TruckState.run_date == run_date,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="State not found")
    return row


def _log_garment_change(
    db: Session,
    *,
    before: TruckState | None,
    after: TruckState,
    actor_user: User | None,
) -> None:
    """Append a durable GarmentDayLog row when a truck's has_dust_garment flag
    changes. Mirrors RouteSwap -> RouteSwapLog so the garment history survives the
    nightly TruckState reset. On create (before is None) only a fresh mark (True)
    is logged; on update both marks and unmarks are logged."""
    before_val = bool(before.has_dust_garment) if before is not None else False
    after_val = bool(after.has_dust_garment)
    if before_val == after_val:
        return
    db.add(GarmentDayLog(
        run_date=after.run_date,
        truck_number=after.truck_number,
        has_garment=after_val,
        source=after.state_source or TruckStateSource.workflow.value,
        actor_username=actor_user.username if actor_user is not None else None,
    ))


@router.post("/{truck_number}/state", response_model=TruckStateOut, status_code=status.HTTP_201_CREATED)
def create_truck_state(
    truck_number: int,
    payload: TruckStateCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user: User = Depends(require_non_guest),
):
    if payload.truck_number != truck_number:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="truck_number mismatch")

    truck = _assert_truck_exists(truck_number, db)

    existing = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == truck_number,
            TruckState.run_date == payload.run_date,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="State for this truck/date already exists — use PUT to update",
        )

    if payload.status and payload.status.value == "in_progress":
        _assert_no_other_in_progress(truck_number, payload.run_date, db)
        _assert_spare_has_coverage(truck, payload.run_date, db)

    row_payload = payload.model_dump()
    row_payload["state_source"] = payload.state_source or TruckStateSource.workflow.value
    row = TruckState(**row_payload)
    db.add(row)
    append_truck_state_activity(
        db,
        actor_user=_user,
        before_state=None,
        after_state=row,
        context_json={"source": "direct_write"},
    )
    _log_garment_change(db, before=None, after=row, actor_user=_user)
    db.commit()
    db.refresh(row)
    if row.priority_hold:
        background_tasks.add_task(
            dispatch_notification,
            truck_hold_notification(truck_number=truck_number, run_date=payload.run_date),
            actor=_user.username,
        )
    if row.status == "oos":
        background_tasks.add_task(
            dispatch_notification,
            truck_oos_notification(truck_number=truck_number, run_date=payload.run_date),
            actor=_user.username,
        )
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(payload.run_date), "truck_number": truck_number},
    )
    return row


@router.put("/{truck_number}/state", response_model=TruckStateOut)
def update_truck_state(
    truck_number: int,
    payload: TruckStateUpdate,
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_non_guest),
):
    """
    Partial update — only fields present in the request body are applied.
    This is the primary endpoint for status transitions (dirty → in_progress, etc.).
    """
    row = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == truck_number,
            TruckState.run_date == run_date,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="State not found")

    previous_status = row.status
    previous_hold = row.priority_hold
    before_state = TruckState(**{
        "truck_number": row.truck_number,
        "run_date": row.run_date,
        "status": row.status,
        "wearers": row.wearers,
        "batch_id": row.batch_id,
        "load_day_num": row.load_day_num,
        "load_start_time": row.load_start_time,
        "load_finish_time": row.load_finish_time,
        "load_duration_seconds": row.load_duration_seconds,
        "off_note": row.off_note,
        "shop_note": row.shop_note,
        "oos_spare_route": row.oos_spare_route,
        "has_dust_garment": row.has_dust_garment,
        "priority_hold": row.priority_hold,
        "needs_checked": row.needs_checked,
        "crossload_to_truck": row.crossload_to_truck,
        "arrived_at": row.arrived_at,
        "unloaded_at": row.unloaded_at,
        "unloading_started_at": row.unloading_started_at,
        "state_source": row.state_source,
    })
    updates = payload.model_dump(exclude_unset=True)
    if "state_source" not in updates:
        updates["state_source"] = TruckStateSource.workflow.value

    # ---- Optimistic concurrency -------------------------------------------
    # This endpoint is a bare field-setter: whatever arrives is applied to
    # whatever the row currently is. Every rule about "don't undo recorded load
    # work" therefore lived in client code, checked against a board snapshot
    # that refreshes every 5s — a check-then-act with the check on one device
    # and the act on the server. That race really did destroy load work:
    # trucks flipped loaded -> unloaded two seconds after being set loaded,
    # because the writing view had not seen the change yet.
    #
    # The precondition closes it for EVERY caller at once, including ones that
    # do not exist yet, and it deliberately does not judge the transition. A
    # supervisor correcting a mis-tap sees "loaded" and chooses "unloaded" —
    # their expectation matches, so it is allowed. The rejected case is only
    # ever "you decided based on something that is no longer true".
    expected = updates.pop("expected_status", None)
    if expected is not None and row.status != expected:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Truck {truck_number} is {row.status.value} on {run_date}, not "
                f"{getattr(expected, 'value', expected)} — your view was out of date. "
                "Refresh and try again."
            ),
        )

    if updates.get("status") and updates["status"].value == "in_progress":
        _assert_no_other_in_progress(truck_number, run_date, db)
        _assert_spare_has_coverage(_assert_truck_exists(truck_number, db), run_date, db)

    # Setup Day is a bulk pass over the roster; it is never the right surface for
    # undoing one truck's load. Proven necessary: on 2026-07-16 the wizard's
    # absent-truck branch wrote truck 88 from loaded to unloaded (event_family
    # "setup", needs_checked false -> true), and the operator had to set it back
    # 21 seconds later. That branch carried no staleness — it downgraded
    # unconditionally, so the precondition above would not have caught it.
    _LOAD_WORK_DONE = {TruckStatus.loaded, TruckStatus.in_progress}
    _UNDOES_LOAD_WORK = {TruckStatus.dirty, TruckStatus.unloaded, TruckStatus.unfinished}
    _new_status = updates.get("status")
    _src = getattr(updates.get("state_source"), "value", updates.get("state_source"))
    if (
        _src == TruckStateSource.wizard.value
        and _new_status is not None
        and row.status in _LOAD_WORK_DONE
        and _new_status in _UNDOES_LOAD_WORK
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Truck {truck_number} is already {row.status.value} for {run_date} — "
                "Setup Day will not undo load work."
            ),
        )

    for field, value in updates.items():
        setattr(row, field, value)

    # arrived_at is set ONLY by an explicit "Arrived" tap (the client sends it in
    # the payload). There is deliberately no auto-baseline on unload: arriving and
    # being unloaded are different events, so arrival never piggybacks on a status
    # change.
    #
    # unloaded_at stamps the moment a truck is genuinely unloaded via this
    # per-truck workflow (dirty / in_progress / unfinished -> unloaded), for
    # unload-timing pattern analysis. Bulk/admin status changes go through the
    # separate bulk endpoint and never stamp.
    #
    # It is cleared ONLY by a genuine UNDO — going back to an open unload state.
    # Anything else that happens to a truck afterwards (marked OOS or shop,
    # sent off, or moving on to loaded) does not rewrite the fact that it was
    # unloaded. Clearing on any non-unloaded status wiped the record when a
    # truck was marked OOS after unloading, which both erased its unload dwell
    # and dropped it out of the day's unload progress.
    _UNLOAD_OPEN = (TruckStatus.dirty, TruckStatus.in_progress, TruckStatus.unfinished)
    if row.status == TruckStatus.unloaded and previous_status in _UNLOAD_OPEN:
        row.unloaded_at = time.time()
    elif row.status in _UNLOAD_OPEN and previous_status == TruckStatus.unloaded:
        row.unloaded_at = None

    # ---- unloading_started_at: "the crew is emptying this one now" ----------
    # A transient marker for the Load board, not a status. Rules:
    #   (a) it can only be SET on a truck there is genuinely something to unload
    #       from — dirty or unfinished; anything else is a 409, not a silent no-op,
    #       so a stale tap on an already-unloaded truck is visible.
    #   (b) first tap wins: a second Start on the same truck keeps the original
    #       time (two devices, or a double-tap, must not restart the clock).
    #   (c) one truck at a time: setting it clears it on every other truck that
    #       night. The dock works one truck; the previous one just drops back to
    #       Arrived / Not arrived with no error.
    #   (d) any status change ends it. Mark Unloaded, Mark Unfinished, undo, OOS —
    #       whatever moves status also clears the marker, so it can never outlive
    #       the work it describes.
    _UNLOAD_WORKABLE = (TruckStatus.dirty, TruckStatus.unfinished)
    _marker_set = updates.get("unloading_started_at") is not None
    if _marker_set:
        if row.status not in _UNLOAD_WORKABLE:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Truck {truck_number} is {row.status.value} on {run_date} — nothing to unload.",
            )
        if before_state.unloading_started_at is not None:
            row.unloading_started_at = before_state.unloading_started_at  # (b)
        else:
            # (c) one at a time
            for other in db.scalars(
                select(TruckState).where(
                    TruckState.run_date == run_date,
                    TruckState.truck_number != truck_number,
                    TruckState.unloading_started_at.is_not(None),
                )
            ).all():
                other.unloading_started_at = None
    if row.status != previous_status or row.status not in _UNLOAD_WORKABLE:
        row.unloading_started_at = None  # (d)

    append_truck_state_activity(
        db,
        actor_user=_user,
        before_state=before_state,
        after_state=row,
        context_json={"source": "direct_write"},
    )
    _log_garment_change(db, before=before_state, after=row, actor_user=_user)
    db.commit()
    db.refresh(row)
    if not previous_hold and row.priority_hold:
        background_tasks.add_task(
            dispatch_notification,
            truck_hold_notification(truck_number=truck_number, run_date=run_date),
            actor=_user.username,
        )
    if previous_status != "oos" and row.status == "oos":
        background_tasks.add_task(
            dispatch_notification,
            truck_oos_notification(truck_number=truck_number, run_date=run_date),
            actor=_user.username,
        )
    # Truck finished unloading — the signal the load crew waits on.
    # Keyed on the STATUS transition, not the unloaded_at stamp: unloaded_at is
    # only stamped coming from dirty/in_progress/unfinished (it exists for
    # unload-timing analysis), so a Fleet-page change from e.g. loaded or spare
    # to unloaded is a real unload that would otherwise never announce itself.
    if previous_status != TruckStatus.unloaded and row.status == TruckStatus.unloaded:
        background_tasks.add_task(
            manager.broadcast,
            {
                "type": "truck_unloaded",
                "truck_number": truck_number,
                "run_date": str(run_date),
                "actor": _user.username,
            },
        )
    # Truck parked in the yard. arrived_at is set ONLY by the explicit "Arrived"
    # tap (never auto-stamped), so this None -> set edge is exactly that tap —
    # worth pushing so unload leads see the truck land without watching the board.
    if before_state.arrived_at is None and row.arrived_at is not None:
        background_tasks.add_task(
            manager.broadcast,
            {
                "type": "truck_arrived",
                "truck_number": truck_number,
                "run_date": str(run_date),
                "actor": _user.username,
            },
        )
        # Same opt-in phone push as the driver QR path; push-only, no second
        # WS broadcast (the event above already carries the in-app toast).
        _push_setting = db.get(AppSetting, "arrived_push_enabled")
        if _push_setting is not None and _push_setting.value is True:
            background_tasks.add_task(
                send_web_push,
                truck_arrived_notification(truck_number=truck_number, run_date=run_date),
            )
    # Unloading started — no push, no toast (the user wants this informational):
    # the event exists so open Load boards refresh on the tick, not the 5s poll.
    if before_state.unloading_started_at is None and row.unloading_started_at is not None:
        background_tasks.add_task(
            manager.broadcast,
            {
                "type": "truck_unloading",
                "truck_number": truck_number,
                "run_date": str(run_date),
                "actor": _user.username,
            },
        )
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(run_date), "truck_number": truck_number},
    )
    return row


# ---------------------------------------------------------------------------
# Full workday reset — wipes all per-date operational state in one transaction
# ---------------------------------------------------------------------------

@router.post("/reset-workday")
def reset_workday(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Full workday reset for *run_date*:

    1. Deletes all TruckState rows for the date (status, times, notes, garments, etc.)
    2. Deletes all RouteSwap rows for the date
    3. Deletes all Batch rows for the date
    4. Deletes per-date AppSetting keys:
         wizard_completed_<date>
         day_setup_source_<date>
         holiday_mode_<date>
         holiday_load_<date>
         holiday_unload_<date>
    """
    from models import AppSetting, Batch  # local import avoids circular

    date_str = str(run_date)
    state_truck_numbers = db.scalars(
        select(TruckState.truck_number).where(TruckState.run_date == run_date)
    ).all()
    route_swap_count = db.scalar(
        select(func.count(RouteSwap.id)).where(RouteSwap.run_date == run_date)
    ) or 0
    batch_count = db.scalar(
        select(func.count(Batch.id)).where(Batch.run_date == run_date)
    ) or 0

    # 1. Truck states
    deleted_states = db.execute(
        delete(TruckState).where(TruckState.run_date == run_date)
    ).rowcount

    # 2. Route swaps
    db.execute(delete(RouteSwap).where(RouteSwap.run_date == run_date))

    # 3. Batch assignments
    db.execute(delete(Batch).where(Batch.run_date == run_date))

    # 4. Per-date settings
    setting_keys = [
        f"wizard_completed_{date_str}",
        f"day_setup_source_{date_str}",
        f"holiday_mode_{date_str}",
        f"holiday_load_{date_str}",
        f"holiday_unload_{date_str}",
    ]
    for key in setting_keys:
        setting = db.get(AppSetting, key)
        if setting:
            db.delete(setting)

    append_activity_event(
        db,
        actor_user=_admin,
        event_family="recovery",
        event_type="workday_reset",
        run_date=run_date,
        summary=f"Reset workday for {run_date}",
        diff_json={
            "states_cleared": deleted_states,
            "route_swaps_cleared": route_swap_count,
            "batches_cleared": batch_count,
            "settings_cleared": setting_keys,
        },
        context_json=add_related_truck_context(
            {"setting_keys": setting_keys, "route_swap_count": route_swap_count, "batch_count": batch_count},
            state_truck_numbers,
        ),
    )
    db.commit()

    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": date_str},
    )

    return {"reset": True, "run_date": date_str, "states_cleared": deleted_states}


@router.post("/selective-reset")
def selective_reset(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    truck_states: bool = Query(False),
    batches: bool = Query(False),
    route_swaps: bool = Query(False),
    day_flags: bool = Query(False),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Selective workday reset — clears only the requested components for *run_date*.
    """
    from models import AppSetting, Batch  # local import avoids circular

    date_str = str(run_date)
    result: dict = {"run_date": date_str, "cleared": []}
    related_truck_numbers: list[int] = []
    diff_payload: dict[str, object] = {}

    if truck_states:
        related_truck_numbers.extend(
            db.scalars(select(TruckState.truck_number).where(TruckState.run_date == run_date)).all()
        )
        deleted = db.execute(
            delete(TruckState).where(TruckState.run_date == run_date)
        ).rowcount
        result["states_cleared"] = deleted
        diff_payload["states_cleared"] = deleted
        result["cleared"].append("truck_states")
        for key in [
            f"wizard_completed_{date_str}",
            f"day_setup_source_{date_str}",
        ]:
            setting = db.get(AppSetting, key)
            if setting:
                db.delete(setting)

    if batches:
        batch_deleted = db.execute(delete(Batch).where(Batch.run_date == run_date)).rowcount
        diff_payload["batches_cleared"] = batch_deleted
        result["cleared"].append("batches")

    if route_swaps:
        related_truck_numbers.extend(
            db.scalars(select(RouteSwap.route_truck).where(RouteSwap.run_date == run_date)).all()
        )
        related_truck_numbers.extend(
            db.scalars(select(RouteSwap.load_on_truck).where(RouteSwap.run_date == run_date)).all()
        )
        route_swap_deleted = db.execute(delete(RouteSwap).where(RouteSwap.run_date == run_date)).rowcount
        diff_payload["route_swaps_cleared"] = route_swap_deleted
        result["cleared"].append("route_swaps")

    if day_flags:
        for key in [
            f"wizard_completed_{date_str}",
            f"day_setup_source_{date_str}",
            f"holiday_mode_{date_str}",
            f"holiday_load_{date_str}",
            f"holiday_unload_{date_str}",
        ]:
            setting = db.get(AppSetting, key)
            if setting:
                db.delete(setting)
        result["cleared"].append("day_flags")
        diff_payload["day_flags_cleared"] = True

    append_activity_event(
        db,
        actor_user=_admin,
        event_family="recovery",
        event_type="selective_reset",
        run_date=run_date,
        summary=f"Selective reset cleared {', '.join(result['cleared']) or 'nothing'} for {run_date}",
        diff_json=diff_payload,
        context_json=add_related_truck_context(
            {"cleared": list(result["cleared"])},
            related_truck_numbers,
        ),
    )
    db.commit()

    if truck_states or batches or route_swaps:
        background_tasks.add_task(
            manager.broadcast,
            {"type": "truck_state_updated", "run_date": date_str},
        )

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_truck_exists(truck_number: int, db: Session) -> Truck:
    truck = db.scalars(select(Truck).where(Truck.truck_number == truck_number)).first()
    if truck is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Truck {truck_number} not in fleet")
    return truck


def _assert_no_other_in_progress(
    truck_number: int, run_date, db: Session
) -> None:
    """Raise 409 if any *other* truck is already in_progress for this run_date."""
    from models import TruckStatus  # local import avoids circular

    conflict = db.scalars(
        select(TruckState).where(
            TruckState.run_date == run_date,
            TruckState.status == TruckStatus.in_progress,
            TruckState.truck_number != truck_number,
        )
    ).first()
    if conflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Truck {conflict.truck_number} is already in progress for {run_date}. Finish it before starting another.",
        )


def _assert_spare_has_coverage(truck: Truck, run_date, db: Session) -> None:
    """Raise 409 if a Spare is asked to start loading with no route assigned.

    A spare only loads to cover another route, so before it can go in_progress
    it must either be the load_on_truck of a RouteSwap or have an active
    SpareAssignment for the run_date. Non-spare trucks are never blocked here.
    """
    if truck.truck_type != TruckType.spare:
        return

    covered_by_swap = db.scalars(
        select(RouteSwap).where(
            RouteSwap.run_date == run_date,
            RouteSwap.load_on_truck == truck.truck_number,
        )
    ).first()
    if covered_by_swap:
        return

    covered_by_assignment = db.scalars(
        select(SpareAssignment).where(
            SpareAssignment.run_date == run_date,
            SpareAssignment.spare_truck_number == truck.truck_number,
            SpareAssignment.returned.is_(False),
        )
    ).first()
    if covered_by_assignment:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Spare {truck.truck_number} has no route to cover. Assign a route before loading.",
    )


# ---------------------------------------------------------------------------
# Trend aggregation endpoints
# ---------------------------------------------------------------------------

def _completion_roster_agg(db: Session, start: date, end: date) -> dict[date, list[int]]:
    """run_date -> [roster_total, loaded] for the operational roster.

    The roster excludes off/oos/shop, idle (non-covering) Spares, AND route
    trucks scheduled off that day — matching the live sidebar's roster
    (buildOperationalDayContext / countLoaded) exactly, rather than the whole
    fleet. A truck outside the roster is excluded from BOTH sides even if it
    happens to be loaded, so the numerator is always a subset of the denominator
    (pct <= 100). 'Got loaded' uses the persisted load_finish_time (survives the
    later status change) OR a manual/bulk 'loaded' status.

    Aggregated in Python because the scheduled-off test reads each truck's
    scheduled_off_days JSON list against its stored load_day_num for the day.
    Shared by the completion trend AND the anomaly detector so both always
    score the same roster."""
    rows = db.execute(
        select(
            TruckState.run_date,
            TruckState.status,
            TruckState.load_finish_time,
            TruckState.load_day_num,
            TruckState.oos_spare_route,
            Truck.truck_type,
            Truck.scheduled_off_days,
        )
        .join(Truck, Truck.truck_number == TruckState.truck_number)
        .where(TruckState.run_date >= start, TruckState.run_date <= end)
    ).all()

    agg: dict[date, list[int]] = defaultdict(lambda: [0, 0])
    for run_date, status, load_finish_time, load_day_num, oos_spare_route, truck_type, off_days in rows:
        loaded = (load_finish_time is not None) or (status == "loaded")
        is_spare = str(getattr(truck_type, "value", truck_type)) == "Spare"
        idle_spare = is_spare and oos_spare_route is None
        scheduled_off = (
            not is_spare
            and bool(off_days)
            and load_day_num is not None
            and load_day_num in off_days
        )
        running = status not in RUNNING_STATUS_EXCLUDE
        if running and not idle_spare and not scheduled_off:
            agg[run_date][0] += 1
            if loaded:
                agg[run_date][1] += 1
    return agg


@router.get("/trends/completion", response_model=list[CompletionDailyPoint])
def truck_completion_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Per-day completion: of the trucks that actually had load work that day
    (the operational roster — see _completion_roster_agg), how many got loaded."""
    start, end = window_bounds(days_back)
    agg = _completion_roster_agg(db, start, end)
    return [
        CompletionDailyPoint(
            run_date=d,
            total_trucks=t,
            loaded_trucks=l,
            pct=round(l / t * 100, 1) if t else 0,
        )
        for d, (t, l) in sorted(agg.items())
    ]


@router.get("/trends/wearers", response_model=list[WearersDailyPoint])
def truck_wearers_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Per-day average AND total wearer count for trucks that ran (completed
    loading). The average is the per-truck staffing signal; the total is the
    day's service volume."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.avg(TruckState.wearers).label("avg_w"),
            func.sum(TruckState.wearers).label("sum_w"),
            func.count(TruckState.id).label("tc"),
        )
        .where(
            TruckState.run_date >= start,
            TruckState.run_date <= end,
            completed_load_filter(),
            TruckState.wearers > 0,
        )
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        WearersDailyPoint(
            run_date=r[0],
            avg_wearers=round(r[1], 1) if r[1] else 0,
            total_wearers=int(r[2] or 0),
            truck_count=r[3],
        )
        for r in rows
    ]


@router.get("/trends/cycle", response_model=list[CycleDailyPoint])
def truck_cycle_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Per-day average load duration (from TruckState.load_duration_seconds),
    over completed loads within the shared valid-duration band."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.avg(TruckState.load_duration_seconds).label("avg_s"),
            func.count(TruckState.id).label("tc"),
        )
        .where(
            TruckState.run_date >= start,
            TruckState.run_date <= end,
            completed_load_filter(),
            TruckState.load_duration_seconds >= MIN_LOAD_SECONDS,
            TruckState.load_duration_seconds <= MAX_LOAD_SECONDS,
        )
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        CycleDailyPoint(
            run_date=r[0],
            avg_seconds=round(r[1], 1) if r[1] else 0,
            truck_count=r[2],
        )
        for r in rows
    ]


@router.get("/trends/unload", response_model=list[UnloadDailyPoint])
def truck_unload_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Per-day unload throughput: trucks that arrived (manual arrival tap), trucks
    that finished unloading, and the average arrival→unload dwell where both
    stamps exist. 'Unloaded' mirrors loaded_load_filter's persisted-or-transient
    logic — the durable unloaded_at stamp (survives later status changes) OR a
    current 'unloaded' status (loaded→unloaded transitions don't stamp).
    Aggregated in Python to stay dialect-portable (timestamp math differs
    between SQLite dev and Postgres prod)."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            TruckState.status,
            TruckState.arrived_at,
            TruckState.unloaded_at,
        ).where(TruckState.run_date >= start, TruckState.run_date <= end)
    ).all()

    # run_date -> [arrived, unloaded, dwell_sum, dwell_count]
    agg: dict[date, list[float]] = defaultdict(lambda: [0, 0, 0.0, 0])
    for run_date, status, arrived_at, unloaded_at in rows:
        a = agg[run_date]
        if arrived_at is not None:
            a[0] += 1
        if unloaded_at is not None or status == "unloaded":
            a[1] += 1
        if arrived_at is not None and unloaded_at is not None:
            # Both columns are Float unix timestamps, so the difference is
            # already seconds — calling .total_seconds() on it raises.
            dwell = float(unloaded_at) - float(arrived_at)
            # same spirit as the load band: drop nonsense (negative / >12h)
            if 0 < dwell <= 43200:
                a[2] += dwell
                a[3] += 1
    return [
        UnloadDailyPoint(
            run_date=d,
            arrived_trucks=int(a[0]),
            unloaded_trucks=int(a[1]),
            avg_dwell_seconds=round(a[2] / a[3], 1) if a[3] else None,
        )
        for d, a in sorted(agg.items())
    ]


@router.get("/trends/anomalies", response_model=list[AnomalyDay])
def truck_anomalies(
    days_back: int = Query(default=90, ge=14, le=365),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Days where completion rate, pace, or wearers diverge >2σ from the rest of
    the window. Completion is computed from the SAME roster aggregation as the
    completion trend chart (_completion_roster_agg — scheduled-off aware), so an
    anomaly is always flagged against a percentage the chart actually showed.
    Each day's z-score is LEAVE-ONE-OUT (the day is excluded from its own
    mean/σ) so an extreme day doesn't damp its own signal."""
    from statistics import mean, stdev

    start, end = window_bounds(days_back)
    timed = completed_load_filter()    # pace/wearers basis (timed only)
    in_band = (TruckState.load_duration_seconds >= MIN_LOAD_SECONDS) & (
        TruckState.load_duration_seconds <= MAX_LOAD_SECONDS
    )
    daily = db.execute(
        select(
            TruckState.run_date,
            func.avg(case((timed & in_band, TruckState.load_duration_seconds), else_=None)).label("pac"),
            func.avg(case((timed & (TruckState.wearers > 0), TruckState.wearers), else_=None)).label("wav"),
        )
        .where(TruckState.run_date >= start, TruckState.run_date <= end)
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()

    anomalies: list[AnomalyDay] = []
    if len(daily) < 7:
        return anomalies

    comp_agg = _completion_roster_agg(db, start, end)
    comp_series = [
        (d, (l / t * 100) if t else 0.0) for d, (t, l) in sorted(comp_agg.items())
    ]
    pace_series = [(d[0], float(d[1])) for d in daily if d[1] is not None]
    wear_series = [(d[0], float(d[2])) for d in daily if d[2] is not None and d[2] > 0]

    def flag(series: list[tuple], metric: str) -> None:
        if len(series) < 7:
            return
        for run_date, value in series:
            others = [v for (rd, v) in series if rd != run_date]
            if len(others) < 2:
                continue
            m = mean(others)
            s = stdev(others)
            if not s:
                continue
            z = (value - m) / s
            if abs(z) > 2:
                anomalies.append(
                    AnomalyDay(
                        run_date=run_date,
                        metric=metric,
                        value=round(value, 1),
                        mean=round(m, 1),
                        sigma=round(s, 2),
                        z_score=round(z, 2),
                    )
                )

    flag(comp_series, "completion")
    flag(pace_series, "pace")
    flag(wear_series, "wearers")
    return sorted(anomalies, key=lambda a: a.run_date, reverse=True)
