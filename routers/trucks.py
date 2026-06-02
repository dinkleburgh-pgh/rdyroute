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

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from database import get_db
from models import RouteSwap, Truck, TruckState, User
from routers.auth import get_current_user, require_admin
from schemas import TruckStateCreate, TruckStateOut, TruckStateUpdate, TruckWithState
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

    states_by_num: dict[int, TruckState] = {
        s.truck_number: s
        for s in db.scalars(
            select(TruckState).where(TruckState.run_date == run_date)
        ).all()
    }

    # For trucks with no today-state, look up their most recent prior state.
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

    # Build a lookup: load_on_truck -> route_truck for today's route swaps.
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

    updates = payload.model_dump(exclude_unset=True)

    if updates.get("status") and updates["status"].value == "in_progress":
        _assert_no_other_in_progress(truck_number, run_date, db)

    for field, value in updates.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
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

    for row in rows:
        row.status = validated_status

    db.commit()
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(run_date)},
    )
    return rows


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
