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

from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.orm import Session

from database import get_db
from models import RouteSwap, Truck, TruckState, User
from notification_service import dispatch_notification, truck_hold_notification, truck_oos_notification
from routers.auth import get_current_user, require_admin
from schemas import (
    AnomalyDay,
    CompletionDailyPoint,
    CycleDailyPoint,
    TruckStateCreate,
    TruckStateOut,
    TruckStateUpdate,
    TruckWithState,
    WearersDailyPoint,
)
from ws_manager import manager

router = APIRouter(prefix="/trucks", tags=["trucks"])

# Statuses that represent a truck that is not running and should carry forward
# automatically to the next day if no new state row exists.
_PERSISTENT_STATUSES = {"off", "oos", "shop"}


# ---------------------------------------------------------------------------
# Dashboard — full board for a run-date
# ---------------------------------------------------------------------------

@router.get("/board", response_model=list[TruckWithState])
def get_board(
    run_date: date = Query(..., description="Operational run-date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """
    Return all active fleet trucks joined with their state for *run_date*.

    - Trucks with a state row for run_date are returned as-is.
    - Trucks with no state row today that had a *persistent* status (off/oos/shop)
      on their most recent prior day are returned with that status so it carries
      forward automatically.
    - All other trucks with no state row are returned with state=null (treated
      as 'dirty' by the frontend).
    """
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

    # For trucks with no today-state, fetch their most recent prior persistent state.
    # Combine into one query using (truck_number, max_date) tuple join instead of
    # two separate round-trips.
    missing_nums = [t.truck_number for t in trucks if t.truck_number not in states_by_num]
    if missing_nums:
        subq = (
            select(
                TruckState.truck_number,
                func.max(TruckState.run_date).label("max_date"),
            )
            .where(TruckState.truck_number.in_(missing_nums))
            .where(TruckState.run_date < run_date)
            .group_by(TruckState.truck_number)
            .subquery()
        )
        prev_states = db.scalars(
            select(TruckState).join(
                subq,
                (TruckState.truck_number == subq.c.truck_number)
                & (TruckState.run_date == subq.c.max_date),
            )
        ).all()
        for s in prev_states:
            if s.status in _PERSISTENT_STATUSES:
                states_by_num[s.truck_number] = s

        # Carry forward "unloaded" for idle Spare trucks whose garments
        # are still clean (never went out on a route).
        truck_by_num = {t.truck_number: t for t in trucks}
        unloaded_spare_candidates = [
            s for s in prev_states
            if s.status == "unloaded"
            and states_by_num.get(s.truck_number) is None
            and truck_by_num.get(s.truck_number) is not None
            and truck_by_num[s.truck_number].truck_type == "Spare"
            and not s.oos_spare_route
        ]
        if unloaded_spare_candidates:
            spare_nums = [c.truck_number for c in unloaded_spare_candidates]
            spare_dates = list({c.run_date for c in unloaded_spare_candidates})
            covered = {
                (rs.load_on_truck, rs.run_date)
                for rs in db.scalars(
                    select(RouteSwap).where(
                        RouteSwap.run_date.in_(spare_dates),
                        RouteSwap.load_on_truck.in_(spare_nums),
                    )
                ).all()
            }
            for s in unloaded_spare_candidates:
                if (s.truck_number, s.run_date) not in covered:
                    states_by_num[s.truck_number] = s

    # Fetch route swaps and trucks + states all in parallel via the same connection.
    route_swaps = db.scalars(
        select(RouteSwap).where(RouteSwap.run_date == run_date)
    ).all()
    swap_by_load_on: dict[int, int] = {rs.load_on_truck: rs.route_truck for rs in route_swaps}

    result = []
    for t in trucks:
        s = states_by_num.get(t.truck_number)
        result.append(
            TruckWithState(
                id=t.id,
                truck_number=t.truck_number,
                truck_type=t.truck_type,
                is_active=t.is_active,
                is_persistent_spare=t.is_persistent_spare,
                is_oos=t.is_oos,
                scheduled_off_days=t.scheduled_off_days or [],
                qr_token=t.qr_token,
                state=TruckStateOut.model_validate(s) if s else None,
                route_swap_route=swap_by_load_on.get(t.truck_number),
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


@router.post("/{truck_number}/state", response_model=TruckStateOut, status_code=status.HTTP_201_CREATED)
def create_truck_state(
    truck_number: int,
    payload: TruckStateCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    if payload.truck_number != truck_number:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="truck_number mismatch")

    _assert_truck_exists(truck_number, db)

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

    row = TruckState(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    if row.priority_hold:
        background_tasks.add_task(
            dispatch_notification,
            truck_hold_notification(truck_number=truck_number, run_date=payload.run_date),
        )
    if row.status == "oos":
        background_tasks.add_task(
            dispatch_notification,
            truck_oos_notification(truck_number=truck_number, run_date=payload.run_date),
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
    _user: User = Depends(get_current_user),
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
    updates = payload.model_dump(exclude_unset=True)

    if updates.get("status") and updates["status"].value == "in_progress":
        _assert_no_other_in_progress(truck_number, run_date, db)

    for field, value in updates.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    if not previous_hold and row.priority_hold:
        background_tasks.add_task(
            dispatch_notification,
            truck_hold_notification(truck_number=truck_number, run_date=run_date),
        )
    if previous_status != "oos" and row.status == "oos":
        background_tasks.add_task(
            dispatch_notification,
            truck_oos_notification(truck_number=truck_number, run_date=run_date),
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
         holiday_mode_<date>
         holiday_load_<date>
         holiday_unload_<date>
    """
    from models import AppSetting, Batch  # local import avoids circular

    date_str = str(run_date)

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
        f"holiday_mode_{date_str}",
        f"holiday_load_{date_str}",
        f"holiday_unload_{date_str}",
    ]
    for key in setting_keys:
        setting = db.get(AppSetting, key)
        if setting:
            db.delete(setting)

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

    if truck_states:
        deleted = db.execute(
            delete(TruckState).where(TruckState.run_date == run_date)
        ).rowcount
        result["states_cleared"] = deleted
        result["cleared"].append("truck_states")

    if batches:
        db.execute(delete(Batch).where(Batch.run_date == run_date))
        result["cleared"].append("batches")

    if route_swaps:
        db.execute(delete(RouteSwap).where(RouteSwap.run_date == run_date))
        result["cleared"].append("route_swaps")

    if day_flags:
        for key in [
            f"wizard_completed_{date_str}",
            f"holiday_mode_{date_str}",
            f"holiday_load_{date_str}",
            f"holiday_unload_{date_str}",
        ]:
            setting = db.get(AppSetting, key)
            if setting:
                db.delete(setting)
        result["cleared"].append("day_flags")

    db.commit()

    if truck_states or batches or route_swaps:
        background_tasks.add_task(
            manager.broadcast,
            {"type": "truck_state_updated", "run_date": date_str},
        )

    return result


# ---------------------------------------------------------------------------
# Bulk status update (e.g., end-of-day rollover)
# ---------------------------------------------------------------------------

@router.put("/bulk/status", response_model=list[TruckStateOut])
def bulk_update_status(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    truck_numbers: list[int] = Query(...),
    new_status: str = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """
    Set all listed trucks to *new_status* for *run_date*.
    Used by supervisor bulk-action controls (e.g., mark all dirty).
    """
    from models import TruckStatus  # local import avoids circular

    try:
        validated_status = TruckStatus(new_status)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid status '{new_status}'")

    rows = db.scalars(
        select(TruckState).where(
            TruckState.run_date == run_date,
            TruckState.truck_number.in_(truck_numbers),
        )
    ).all()
    previous_status_by_num = {row.truck_number: row.status for row in rows}

    # Update trucks that already have a state row
    for row in rows:
        row.status = validated_status

    # Create state rows for trucks that have none (they appear as 'dirty' via null state)
    existing_nums = {row.truck_number for row in rows}
    for num in truck_numbers:
        if num not in existing_nums:
            db.add(TruckState(
                truck_number=num,
                run_date=run_date,
                status=validated_status,
                wearers=0,
            ))

    db.commit()
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(run_date)},
    )
    if validated_status == TruckStatus.oos:
        for truck_number in truck_numbers:
            if previous_status_by_num.get(truck_number) == TruckStatus.oos:
                continue
            background_tasks.add_task(
                dispatch_notification,
                truck_oos_notification(truck_number=truck_number, run_date=run_date),
            )
    # Re-query to return all affected rows (includes newly-created ones)
    updated = db.scalars(
        select(TruckState).where(
            TruckState.run_date == run_date,
            TruckState.truck_number.in_(truck_numbers),
        )
    ).all()
    return updated


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


# ---------------------------------------------------------------------------
# Trend aggregation endpoints
# ---------------------------------------------------------------------------

@router.get("/trends/completion", response_model=list[CompletionDailyPoint])
def truck_completion_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day: total route trucks scheduled vs loaded, expressed as pct."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.count(TruckState.id).label("total"),
            func.sum(
                func.case((TruckState.status == "loaded", 1), else_=0)
            ).label("loaded"),
        )
        .where(TruckState.run_date >= cutoff)
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        CompletionDailyPoint(
            run_date=r[0],
            total_trucks=r[1],
            loaded_trucks=r[2] or 0,
            pct=round((r[2] or 0) / r[1] * 100, 1) if r[1] else 0,
        )
        for r in rows
    ]


@router.get("/trends/wearers", response_model=list[WearersDailyPoint])
def truck_wearers_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day average wearer count for trucks that were loaded."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.avg(TruckState.wearers).label("avg_w"),
            func.count(TruckState.id).label("tc"),
        )
        .where(
            TruckState.run_date >= cutoff,
            TruckState.status == "loaded",
            TruckState.wearers > 0,
        )
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        WearersDailyPoint(
            run_date=r[0],
            avg_wearers=round(r[1], 1) if r[1] else 0,
            truck_count=r[2],
        )
        for r in rows
    ]


@router.get("/trends/cycle", response_model=list[CycleDailyPoint])
def truck_cycle_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day average load duration (from TruckState.load_duration_seconds)."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.avg(TruckState.load_duration_seconds).label("avg_s"),
            func.count(TruckState.id).label("tc"),
        )
        .where(
            TruckState.run_date >= cutoff,
            TruckState.status == "loaded",
            TruckState.load_duration_seconds.isnot(None),
            TruckState.load_duration_seconds >= 30,
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


@router.get("/trends/anomalies", response_model=list[AnomalyDay])
def truck_anomalies(
    days_back: int = Query(default=90, ge=14, le=365),
    db: Session = Depends(get_db),
):
    """Days where completion rate, pace, or wearers diverge >2σ from the mean."""
    from statistics import mean, stdev
    cutoff = date.today() - timedelta(days=days_back)
    daily = db.execute(
        select(
            TruckState.run_date,
            func.count(TruckState.id).label("tot"),
            func.sum(func.case((TruckState.status == "loaded", 1), else_=0)).label("lod"),
            func.avg(
                func.case(
                    (TruckState.status == "loaded", TruckState.load_duration_seconds),
                    else_=None,
                )
            ).label("pac"),
            func.avg(
                func.case(
                    (TruckState.status == "loaded", TruckState.wearers),
                    else_=None,
                )
            ).label("wav"),
        )
        .where(TruckState.run_date >= cutoff)
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()

    anomalies: list[AnomalyDay] = []
    if len(daily) < 7:
        return anomalies

    pcts = [d[2] / d[1] * 100 if d[1] else 0 for d in daily]
    paces = [d[3] for d in daily if d[3] is not None and d[3] >= 30]
    wearers_list = [d[4] for d in daily if d[4] is not None and d[4] > 0]

    for d in daily:
        if len(pcts) >= 7:
            m = mean(pcts)
            s = stdev(pcts) if len(pcts) > 1 else 1
            z = (d[2] / d[1] * 100 - m) / s if d[1] and s else 0
            if abs(z) > 2:
                anomalies.append(AnomalyDay(run_date=d[0], metric="completion", value=round(d[2] / d[1] * 100, 1) if d[1] else 0, mean=round(m, 1), sigma=round(s, 2), z_score=round(z, 2)))
        if d[3] is not None and d[3] >= 30 and len(paces) >= 7:
            m = mean(paces)
            s = stdev(paces) if len(paces) > 1 else 1
            z = (d[3] - m) / s if s else 0
            if abs(z) > 2:
                anomalies.append(AnomalyDay(run_date=d[0], metric="pace", value=round(d[3], 1), mean=round(m, 1), sigma=round(s, 2), z_score=round(z, 2)))
        if d[4] is not None and d[4] > 0 and len(wearers_list) >= 7:
            m = mean(wearers_list)
            s = stdev(wearers_list) if len(wearers_list) > 1 else 1
            z = (d[4] - m) / s if s else 0
            if abs(z) > 2:
                anomalies.append(AnomalyDay(run_date=d[0], metric="wearers", value=round(d[4], 1), mean=round(m, 1), sigma=round(s, 2), z_score=round(z, 2)))

    return sorted(anomalies, key=lambda a: a.run_date, reverse=True)
