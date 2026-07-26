"""
Shared helpers for the Trends endpoints (audit / shorts / trucks / load_durations).

Centralises three things every trend must agree on, which previously drifted per
router and produced wrong numbers:

  * the OPERATIONAL run-day (06:00 rollover + weekend→Friday) — trend windows
    used naive `date.today()`, so the boundary was off and "N days" spanned N+1;
  * the valid load-duration band — pace-daily used 30–7200, pace-average 120–1800,
    cycle time had no upper cap, so "average load time" meant three things;
  * the "completed a load" / "running roster" filters — completion/cycle/wearers/
    quality keyed on the TRANSIENT `status == 'loaded'`, which a truck sheds when
    it moves to unloaded/dirty, so every past run-date read 0. `load_finish_time`
    is stamped when loading finishes and persists on the row regardless of the
    later status.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from database import settings as app_settings
from models import TruckState

# One valid-load-duration band for every "average load time" metric (pace daily,
# pace-average, cycle time). Replaces the old 30–7200 / 120–1800 / no-cap mix.
MIN_LOAD_SECONDS = 30
MAX_LOAD_SECONDS = 7200

# Statuses that mean a truck did NOT run a route that day — excluded from the
# completion "running roster" denominator. loaded/unloaded/dirty/in_progress/
# unfinished/pending all count as "ran / was expected to run".
RUNNING_STATUS_EXCLUDE = ("off", "oos", "shop", "spare")


def operational_today() -> date:
    """The current OPERATIONAL run date: before 06:00 it's still the previous
    calendar day's 3rd shift, and the weekend folds onto the preceding Friday.
    Mirrors the frontend todayIso() and trucks._operational_today()."""
    now = datetime.now(ZoneInfo(app_settings.timezone))
    d = now.date()
    if now.hour < 6:
        d = d - timedelta(days=1)
    wd = d.weekday()  # Mon=0 .. Sun=6
    if wd == 5:
        d = d - timedelta(days=1)
    elif wd == 6:
        d = d - timedelta(days=2)
    return d


def window_bounds(days_back: int) -> tuple[date, date]:
    """Inclusive [start, end] spanning EXACTLY ``days_back`` calendar dates,
    ending at the operational today. Query as ``start <= run_date <= end`` so a
    14-day range is 14 dates (the old ``>= today - days_back`` spanned 15 and
    anchored on naive calendar today)."""
    end = operational_today()
    start = end - timedelta(days=days_back - 1)
    return start, end


def prior_bounds(days_back: int) -> tuple[date, date]:
    """The equal-width window immediately BEFORE ``window_bounds(days_back)`` — so
    period-over-period comparisons compare like widths (the old prior window was
    one day shorter than the current one)."""
    start, _ = window_bounds(days_back)
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=days_back - 1)
    return prior_start, prior_end


def half_split_change(points, days_back: int) -> float | None:
    """`(newer_half − older_half) / older_half × 100` over the window, split at the
    CALENDAR midpoint into equal-width halves (the middle date of an odd-width
    window is dropped so neither half is longer — the old `len//2` split of only
    the populated days biased every trend upward). Returns ``None`` when the older
    half is empty (avoids the divide-by-zero that used to 500). ``points`` is an
    iterable of ``(run_date, value)``."""
    start, _ = window_bounds(days_back)
    half = days_back // 2
    mid = start + timedelta(days=half)
    older = sum(v for (d, v) in points if d < mid)
    if days_back % 2 == 0:
        newer = sum(v for (d, v) in points if d >= mid)
    else:
        newer = sum(v for (d, v) in points if d > mid)  # drop the middle date
    if older <= 0:
        return None
    return ((newer - older) / older) * 100


def completed_load_filter():
    """SQLAlchemy predicate for 'this truck completed loading that day' — the
    persisted ``load_finish_time``, which survives the truck later moving to
    unloaded/dirty (unlike the transient ``status == 'loaded'``). Backs the
    timed metrics (cycle, wearers, quality)."""
    return TruckState.load_finish_time.isnot(None)


def loaded_load_filter():
    """'This truck got loaded that day' for the completion RATE — timed loads
    (persisted ``load_finish_time``) OR a truck marked ``loaded`` manually / in
    bulk (which doesn't stamp a finish time). Broader than
    ``completed_load_filter`` so a manual load still counts toward completion."""
    return TruckState.load_finish_time.isnot(None) | (TruckState.status == "loaded")


def is_running_filter():
    """SQLAlchemy predicate for the completion 'running roster' denominator —
    trucks that were expected to run (excludes off/oos/shop/spare)."""
    return TruckState.status.notin_(RUNNING_STATUS_EXCLUDE)
