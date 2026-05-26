"""
Router: /shorts

Records and retrieves shortage items per truck per run-date.

V1 mapping:
  st.session_state.shorts          →  Shortage rows (item_category → quantity)
  st.session_state.shorts_initials →  Shortage.initials
  SHORTS_BUTTON_MAP                →  served via GET /shorts/categories
"""

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from database import get_db
from models import Shortage
from schemas import ShortageCreate, ShortageOut, ShortageUpdate
from ws_manager import manager

router = APIRouter(prefix="/shorts", tags=["shorts"])

# ---------------------------------------------------------------------------
# Category catalogue  (mirrors SHORTS_BUTTON_MAP from V1)
# ---------------------------------------------------------------------------

SHORTS_BUTTON_MAP: dict = {
    "3x10": ["Black", "Onyx", "Copper", "Indigo", "Blue", "Brown"],
    "3x5": ["Black", "Onyx", "Copper", "Indigo", "Blue", "Brown"],
    "4x6": ["Logo", "Black", "Onyx", "Copper", "Indigo", "Blue", "Brown", "2x3"],
    "Paper": [
        "C-PULL", "DRC (AIRLAID)", "BROWN HW", "SIG HW",
        "SIG Z-FOLD", "SIG DUAL TP", "JRT", "B&V TP", "B&V Z-FOLD",
    ],
    "Bulk": {
        "Dust Mops": ["WET MOP", '24"', '36"', '46"', '60"', "Fender Covers"],
        "Aprons": ["White", "Black", "Red", "Green", "Blue", "Denim"],
        "Towels": [
            "Grid/Terry", "Glass", "Regular", "Premium",
            "Small Ink", "Large Ink", "Napkins", "Red Shop", "White Shop",
        ],
    },
}


@router.get("/categories")
def get_shortage_categories():
    """Return the canonical shortage category/item map for the React shorts form."""
    return SHORTS_BUTTON_MAP


# ---------------------------------------------------------------------------
# List shortages
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ShortageOut])
def list_shortages(
    run_date: date = Query(...),
    truck_number: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = select(Shortage).where(Shortage.run_date == run_date)
    if truck_number is not None:
        q = q.where(Shortage.truck_number == truck_number)
    return db.scalars(q.order_by(Shortage.truck_number, Shortage.recorded_at)).all()


# ---------------------------------------------------------------------------
# Create / update / delete
# ---------------------------------------------------------------------------

@router.post("", response_model=ShortageOut, status_code=status.HTTP_201_CREATED)
def create_shortage(payload: ShortageCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    row = Shortage(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "shortage_updated", "run_date": str(payload.run_date)},
    )
    return row


@router.patch("/{shortage_id}", response_model=ShortageOut)
def update_shortage(
    shortage_id: int,
    payload: ShortageUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    row = db.get(Shortage, shortage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortage not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "shortage_updated", "run_date": str(row.run_date)},
    )
    return row


@router.delete("/{shortage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shortage(shortage_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    row = db.get(Shortage, shortage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortage not found")
    run_date = str(row.run_date)
    db.delete(row)
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "shortage_updated", "run_date": run_date})


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_shortages_for_truck(
    background_tasks: BackgroundTasks,
    truck_number: int = Query(...),
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    """Clear all shortages for a specific truck on a run-date (used by 'reset shorts' action)."""
    db.execute(
        delete(Shortage).where(
            Shortage.truck_number == truck_number,
            Shortage.run_date == run_date,
        )
    )
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "shortage_updated", "run_date": str(run_date)})
