"""
Router: /route-drivers

The SSR (driver) assigned to each route, originally captured from the printed
"Truck Demand by Day" dock board into the route_drivers table.

Reading is gated to signed-in non-guest users — the Fleet Schedule page itself
is guest-visible, but employee names are not. Writing is admin-only, matching
the schedule edit it sits next to (PUT /fleet/{n} is require_admin): the SSR
column is edited from the same "Edit Schedule" mode, so the two must not
disagree about who is allowed to change the board.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from activity_log import append_activity_event
from database import get_db
from models import RouteDriver, User
from routers.auth import require_admin, require_non_guest
from schemas import RouteDriverOut, RouteDriverUpsert

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


@router.put("/{route_number}", status_code=status.HTTP_204_NO_CONTENT)
def upsert_route_driver(
    route_number: int,
    payload: RouteDriverUpsert,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Set the SSR on a route, or clear it with a blank name.

    Upsert rather than update: most routes have no row until someone names a
    driver, and the board capture only ever filled in the routes it could read.

    Clearing DEACTIVATES rather than deletes. The row carries `captured_at` and
    `source` provenance from the original board scan, and the table's whole
    purpose is to be a durable record of who ran what — throwing that away to
    represent "nobody right now" would lose history the list endpoint can still
    surface with include_inactive.
    """
    name = payload.driver_name.strip()
    row = db.scalars(
        select(RouteDriver).where(RouteDriver.route_number == route_number)
    ).first()
    before = row.driver_name if row is not None and row.is_active else ""

    if row is None:
        if not name:
            return  # nothing on file and nothing to set
        row = RouteDriver(
            route_number=route_number,
            route_label=str(route_number),
            driver_name=name,
            source="fleet-schedule",
        )
        db.add(row)
    else:
        if name:
            row.driver_name = name
            row.is_active = True
        else:
            row.is_active = False

    if before != name:
        append_activity_event(
            db,
            actor_user=current_user,
            event_family="setup",
            event_type="route_driver_changed",
            truck_number=route_number,
            summary=(
                f"SSR for route {route_number} set to {name}" if name
                else f"SSR cleared for route {route_number}"
            ),
            diff_json={"driver_name": {"before": before, "after": name}},
            context_json={"route_number": route_number},
        )
    db.commit()
