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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models import RouteSwap, Truck, TruckState
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
# Bulk status update (e.g., end-of-day rollover)
# ---------------------------------------------------------------------------

@router.put("/bulk/status", response_model=list[TruckStateOut])
def bulk_update_status(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    truck_numbers: list[int] = Query(...),
    new_status: str = Query(...),
    db: Session = Depends(get_db),
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
