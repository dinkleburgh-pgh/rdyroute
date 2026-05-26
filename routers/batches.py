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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from database import get_db
from models import Batch, BatchHistory
from schemas import BatchAssign, BatchHistoryCreate, BatchHistoryOut, BatchOut, BatchSummary, BatchTruck

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
def assign_truck_to_batch(payload: BatchAssign, db: Session = Depends(get_db)):
    """
    Assign a truck to a batch for a run-date.
    If the truck is already assigned to another batch on the same date, it is
    moved (the old assignment is removed first).
    Enforces V1's BATCH_CAP=400 wearers per batch.
    """
    _validate_batch_number(payload.batch_number)

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
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{batch_number}/trucks/{truck_number}", status_code=status.HTTP_204_NO_CONTENT)
def remove_truck_from_batch(
    batch_number: int,
    truck_number: int,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    _validate_batch_number(batch_number)
    deleted = db.execute(
        delete(Batch).where(
            Batch.run_date == run_date,
            Batch.batch_number == batch_number,
            Batch.truck_number == truck_number,
        )
    ).rowcount
    if deleted == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    db.commit()


@router.delete("/{batch_number}", status_code=status.HTTP_204_NO_CONTENT)
def clear_batch(
    batch_number: int,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    """Remove all truck assignments from a batch for a run-date."""
    _validate_batch_number(batch_number)
    db.execute(
        delete(Batch).where(
            Batch.run_date == run_date,
            Batch.batch_number == batch_number,
        )
    )
    db.commit()


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
