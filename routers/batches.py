"""
Router: /batches

Manages the six load batches per run-date.  Each batch groups trucks so
loaders can work in parallel.  The wearer count per batch is the sum of
wearers assigned to the trucks in that batch.

V1 mapping:
  st.session_state.batches  →  Batch rows in DB
  batch_history.json        →  BatchHistory rows
"""

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from activity_log import add_related_truck_context, append_activity_event, build_field_diff, snapshot_truck_state
from database import get_db
from models import Batch, BatchHistory, TruckState, TruckStateSource, TruckStatus, User
from routers.auth import get_current_user
from schemas import BatchAssign, BatchHistoryCreate, BatchHistoryOut, BatchOut, BatchSummary, BatchTruck
from ws_manager import manager

router = APIRouter(prefix="/batches", tags=["batches"])

_MAX_BATCHES = 6
# V1 BATCH_CAP — total wearers across all trucks in a single batch may not exceed this.
_BATCH_WEARER_CAP = 400


# ---------------------------------------------------------------------------
# Batch summary view (all 6 batches for a run-date)
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=list[BatchSummary])
def get_batch_summary(
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    """
    Return an aggregated view of all six batches for a given run-date.
    Trucks not yet assigned appear in no batch; the React board uses this
    to render the batch panel.
    """
    rows: list[Batch] = db.scalars(
        select(Batch).where(Batch.run_date == run_date).order_by(Batch.batch_number, Batch.truck_number)
    ).all()

    batches: dict[int, BatchSummary] = {
        i: BatchSummary(run_date=run_date, batch_number=i, trucks=[], total_wearers=0)
        for i in range(1, _MAX_BATCHES + 1)
    }
    for row in rows:
        b = batches[row.batch_number]
        b.trucks.append(BatchTruck(truck_number=row.truck_number, wearers=row.wearers))
        b.total_wearers += row.wearers

    return list(batches.values())


# ---------------------------------------------------------------------------
# Individual batch
# ---------------------------------------------------------------------------

@router.get("/{batch_number}", response_model=list[BatchOut])
def get_batch(
    batch_number: int,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    _validate_batch_number(batch_number)
    return db.scalars(
        select(Batch).where(
            Batch.run_date == run_date,
            Batch.batch_number == batch_number,
        ).order_by(Batch.truck_number)
    ).all()


@router.post("/assign", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
def assign_truck_to_batch(
    payload: BatchAssign,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Assign a truck to a batch for a run-date.
    If the truck is already assigned to another batch on the same date, it is
    moved (the old assignment is removed first).
    Enforces V1's BATCH_CAP=400 wearers per batch.
    """
    _validate_batch_number(payload.batch_number)

    existing_assignment = db.scalars(
        select(Batch).where(
            Batch.run_date == payload.run_date,
            Batch.truck_number == payload.truck_number,
        )
    ).first()

    # Remove any existing assignment for this truck on this date
    db.execute(
        delete(Batch).where(
            Batch.run_date == payload.run_date,
            Batch.truck_number == payload.truck_number,
        )
    )

    # Enforce wearer cap (existing wearers in the target batch + new assignment)
    current_total = db.scalar(
        select(func.coalesce(func.sum(Batch.wearers), 0)).where(
            Batch.run_date == payload.run_date,
            Batch.batch_number == payload.batch_number,
        )
    ) or 0
    if current_total + payload.wearers > _BATCH_WEARER_CAP:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Batch {payload.batch_number} cap of {_BATCH_WEARER_CAP} wearers exceeded "
                f"(current {current_total} + new {payload.wearers})."
            ),
        )

    row = Batch(
        run_date=payload.run_date,
        batch_number=payload.batch_number,
        truck_number=payload.truck_number,
        wearers=payload.wearers,
    )
    db.add(row)

    # Also upsert the truck's state: mark dirty trucks as unloaded and sync
    # batch_id + wearers. Trucks already past dirty (loaded, in_progress, etc.)
    # keep their current status — only batch_id and wearers are updated.
    state = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == payload.truck_number,
            TruckState.run_date == payload.run_date,
        )
    ).first()
    before_snapshot = snapshot_truck_state(state)
    if state is None:
        state = TruckState(
            truck_number=payload.truck_number,
            run_date=payload.run_date,
            status=TruckStatus.unloaded,
            wearers=payload.wearers,
            batch_id=payload.batch_number,
            state_source=TruckStateSource.workflow.value,
        )
        db.add(state)
    else:
        if state.status == TruckStatus.dirty:
            state.status = TruckStatus.unloaded
        state.wearers = payload.wearers
        state.batch_id = payload.batch_number
        state.state_source = TruckStateSource.workflow.value

    after_snapshot = snapshot_truck_state(state)
    append_activity_event(
        db,
        actor_user=current_user,
        event_family="batch",
        event_type="batch_assigned",
        run_date=payload.run_date,
        truck_number=payload.truck_number,
        summary=(
            f"Assigned truck {payload.truck_number} to batch {payload.batch_number}"
            + (
                f" from batch {existing_assignment.batch_number}"
                if existing_assignment and existing_assignment.batch_number != payload.batch_number
                else ""
            )
        ),
        status_before=before_snapshot.get("status") if before_snapshot else None,
        status_after=after_snapshot.get("status") if after_snapshot else None,
        diff_json={
            "batch_number": payload.batch_number,
            "previous_batch_number": existing_assignment.batch_number if existing_assignment else None,
            "wearers": payload.wearers,
            "truck_state": build_field_diff(before_snapshot, after_snapshot),
        },
        context_json=add_related_truck_context(
            {
                "batch_number": payload.batch_number,
                "previous_batch_number": existing_assignment.batch_number if existing_assignment else None,
                "wearers": payload.wearers,
            },
            [payload.truck_number],
        ),
    )

    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(payload.run_date), "truck_number": payload.truck_number},
    )
    return row


@router.delete("/{batch_number}/trucks/{truck_number}", status_code=status.HTTP_204_NO_CONTENT)
def remove_truck_from_batch(
    batch_number: int,
    truck_number: int,
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _validate_batch_number(batch_number)
    assignment = db.scalars(
        select(Batch).where(
            Batch.run_date == run_date,
            Batch.batch_number == batch_number,
            Batch.truck_number == truck_number,
        )
    ).first()
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    state = db.scalars(
        select(TruckState).where(
            TruckState.run_date == run_date,
            TruckState.truck_number == truck_number,
        )
    ).first()
    before_snapshot = snapshot_truck_state(state)
    if state is not None and state.batch_id == batch_number:
        state.batch_id = None
        state.state_source = TruckStateSource.workflow.value
    after_snapshot = snapshot_truck_state(state)
    db.delete(assignment)
    append_activity_event(
        db,
        actor_user=current_user,
        event_family="batch",
        event_type="batch_removed",
        run_date=run_date,
        truck_number=truck_number,
        summary=f"Removed truck {truck_number} from batch {batch_number}",
        status_before=before_snapshot.get("status") if before_snapshot else None,
        status_after=after_snapshot.get("status") if after_snapshot else None,
        diff_json={
            "batch_number": batch_number,
            "truck_state": build_field_diff(before_snapshot, after_snapshot),
        },
        context_json=add_related_truck_context({"batch_number": batch_number}, [truck_number]),
    )
    db.commit()
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(run_date), "truck_number": truck_number},
    )


@router.delete("/{batch_number}", status_code=status.HTTP_204_NO_CONTENT)
def clear_batch(
    batch_number: int,
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove all truck assignments from a batch for a run-date."""
    _validate_batch_number(batch_number)
    assignments = db.scalars(
        select(Batch).where(
            Batch.run_date == run_date,
            Batch.batch_number == batch_number,
        )
    ).all()
    truck_numbers = [row.truck_number for row in assignments]
    states = db.scalars(
        select(TruckState).where(
            TruckState.run_date == run_date,
            TruckState.truck_number.in_(truck_numbers),
        )
    ).all() if truck_numbers else []
    before_by_num = {state.truck_number: snapshot_truck_state(state) for state in states}
    for state in states:
        if state.batch_id == batch_number:
            state.batch_id = None
            state.state_source = TruckStateSource.workflow.value
    truck_changes = [
        {
            "truck_number": state.truck_number,
            "truck_state": build_field_diff(before_by_num.get(state.truck_number), snapshot_truck_state(state)),
        }
        for state in states
    ]
    for row in assignments:
        db.delete(row)
    append_activity_event(
        db,
        actor_user=current_user,
        event_family="batch",
        event_type="batch_cleared",
        run_date=run_date,
        summary=f"Cleared batch {batch_number} ({len(truck_numbers)} truck(s))",
        diff_json={
            "batch_number": batch_number,
            "assignment_count": len(truck_numbers),
            "truck_changes": truck_changes,
        },
        context_json=add_related_truck_context(
            {"batch_number": batch_number, "assignment_count": len(truck_numbers)},
            truck_numbers,
        ),
    )
    db.commit()
    if truck_numbers:
        background_tasks.add_task(
            manager.broadcast,
            {"type": "truck_state_updated", "run_date": str(run_date)},
        )


# ---------------------------------------------------------------------------
# Batch history (append-only; used by trends screen)
# ---------------------------------------------------------------------------

@router.get("/history", response_model=list[BatchHistoryOut])
def get_batch_history(
    run_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = select(BatchHistory).order_by(BatchHistory.recorded_at.desc())
    if run_date:
        q = q.where(BatchHistory.run_date == run_date)
    return db.scalars(q).all()


@router.post("/history", response_model=BatchHistoryOut, status_code=status.HTTP_201_CREATED)
def append_batch_history(payload: BatchHistoryCreate, db: Session = Depends(get_db)):
    row = BatchHistory(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _validate_batch_number(n: int) -> None:
    if n < 1 or n > _MAX_BATCHES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"batch_number must be between 1 and {_MAX_BATCHES}",
        )
