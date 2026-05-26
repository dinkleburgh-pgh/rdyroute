"""
Router: /fleet

CRUD for fleet membership (which truck numbers are in the fleet, their type,
and active/spare flags). Mirrors the truck_fleet.json + truck type management
from V1.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from database import get_db
from models import Truck
from schemas import TruckCreate, TruckOut, TruckUpdate

router = APIRouter(prefix="/fleet", tags=["fleet"])


@router.get("", response_model=list[TruckOut])
def list_fleet(include_inactive: bool = False, db: Session = Depends(get_db)):
    """Return all fleet trucks. Pass include_inactive=true to see decommissioned trucks."""
    q = select(Truck)
    if not include_inactive:
        q = q.where(Truck.is_active == True)
    return db.scalars(q.order_by(Truck.truck_number)).all()


@router.post("", response_model=TruckOut, status_code=status.HTTP_201_CREATED)
def add_truck(payload: TruckCreate, db: Session = Depends(get_db)):
    existing = db.scalars(select(Truck).where(Truck.truck_number == payload.truck_number)).first()
    if existing:
        if not existing.is_active:
            # Re-activate a previously removed truck
            existing.is_active = True
            existing.truck_type = payload.truck_type
            existing.is_persistent_spare = payload.is_persistent_spare
            db.commit()
            db.refresh(existing)
            return existing
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Truck {payload.truck_number} already exists in the fleet",
        )
    truck = Truck(**payload.model_dump())
    db.add(truck)
    db.commit()
    db.refresh(truck)
    return truck


@router.get("/{truck_number}", response_model=TruckOut)
def get_truck(truck_number: int, db: Session = Depends(get_db)):
    truck = db.scalars(select(Truck).where(Truck.truck_number == truck_number)).first()
    if truck is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Truck not found")
    return truck


@router.patch("/{truck_number}", response_model=TruckOut)
def update_truck(truck_number: int, payload: TruckUpdate, db: Session = Depends(get_db)):
    truck = db.scalars(select(Truck).where(Truck.truck_number == truck_number)).first()
    if truck is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Truck not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(truck, field, value)
        if field == "scheduled_off_days":
            flag_modified(truck, field)
    db.commit()
    db.refresh(truck)
    return truck


@router.delete("/{truck_number}", status_code=status.HTTP_204_NO_CONTENT)
def remove_truck(truck_number: int, db: Session = Depends(get_db)):
    """Soft-delete: marks the truck as inactive rather than deleting its history."""
    truck = db.scalars(select(Truck).where(Truck.truck_number == truck_number)).first()
    if truck is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Truck not found")
    truck.is_active = False
    db.commit()
