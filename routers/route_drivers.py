"""
Router: /route-drivers

Read-only view of the SSR (driver) assigned to each route, captured from the
printed "Truck Demand by Day" dock board into the route_drivers table.

Deliberately read-only: the table is a capture of the paper board, not a live
editing surface. Gated to signed-in non-guest users — the Fleet Schedule page
itself is guest-visible, but employee names are not.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import RouteDriver, User
from routers.auth import require_non_guest
from schemas import RouteDriverOut

router = APIRouter(prefix="/route-drivers", tags=["route-drivers"])


@router.get("", response_model=list[RouteDriverOut])
def list_route_drivers(
    include_inactive: bool = False,
    _user: User = Depends(require_non_guest),
    db: Session = Depends(get_db),
):
    stmt = select(RouteDriver)
    if not include_inactive:
        stmt = stmt.where(RouteDriver.is_active.is_(True))
    # Numeric routes ascending; the non-numeric ones (shuttle) sort last.
    rows = list(db.scalars(stmt).all())
    rows.sort(key=lambda r: (r.route_number is None, r.route_number or 0, r.driver_name))
    return rows
