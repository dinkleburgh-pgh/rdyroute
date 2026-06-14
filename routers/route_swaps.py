"""
Router: /route-swaps

Route swap management.

V1 mapping:
  route_swap_assignments  →  RouteSwap rows (route_truck -> load_on_truck)
  _set_two_way_route_swap →  POST with two_way=true creates both rows atomically
  _apply_manual_route_change(A, A) resets → DELETE removes the swap row(s)
"""

from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from database import get_db
from models import RouteSwap, RouteSwapLog, TruckState, TruckStatus
from notification_service import (
    coverage_assigned_notification,
    coverage_removed_notification,
    dispatch_notification,
)
from schemas import RouteSwapCreate, RouteSwapOut, RouteSwapLogOut

router = APIRouter(prefix="/route-swaps", tags=["route-swaps"])


@router.get("", response_model=list[RouteSwapOut])
def list_swaps(
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    """Return all route swap assignments for a run date."""
    rows = db.scalars(
        select(RouteSwap)
        .where(RouteSwap.run_date == run_date)
        .order_by(RouteSwap.route_truck)
    ).all()
    return rows


@router.post("", response_model=list[RouteSwapOut], status_code=status.HTTP_201_CREATED)
def create_swap(
    payload: RouteSwapCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Create a route swap assignment.  If two_way=True, also creates the
    reciprocal row (route_truck=load_on_truck, load_on_truck=route_truck).

    Returns the list of rows created (1 or 2).

    Validation mirrors V1 _apply_manual_route_change:
    - route_truck == load_on_truck is not allowed (use DELETE to reset)
    - A truck can only be assigned as load_on to one route at a time
    - Existing swap for the same route_truck is replaced (upsert)
    """
    if payload.route_truck == payload.load_on_truck:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="route_truck and load_on_truck must be different. Use DELETE to clear an assignment.",
        )

    # Prevent double-booking load_on_truck across routes on this date
    conflict = db.scalars(
        select(RouteSwap).where(
            RouteSwap.run_date == payload.run_date,
            RouteSwap.load_on_truck == payload.load_on_truck,
            RouteSwap.route_truck != payload.route_truck,
        )
    ).first()
    if conflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Truck {payload.load_on_truck} is already assigned to load "
                f"route {conflict.route_truck} on {payload.run_date}. "
                "Clear that assignment first."
            ),
        )

    created: list[RouteSwap] = []
    previous_load_on_by_route: dict[int, int | None] = {}

    def _upsert(rt: int, lo: int) -> RouteSwap:
        existing = db.scalars(
            select(RouteSwap).where(
                RouteSwap.run_date == payload.run_date,
                RouteSwap.route_truck == rt,
            )
        ).first()
        if existing:
            previous_load_on_by_route[rt] = existing.load_on_truck
            existing.load_on_truck = lo
            db.flush()
            return existing
        previous_load_on_by_route[rt] = None
        row = RouteSwap(run_date=payload.run_date, route_truck=rt, load_on_truck=lo)
        db.add(row)
        db.flush()
        return row

    created.append(_upsert(payload.route_truck, payload.load_on_truck))

    if payload.two_way:
        # For a two-way swap we also need to check the reciprocal direction
        reciprocal_conflict = db.scalars(
            select(RouteSwap).where(
                RouteSwap.run_date == payload.run_date,
                RouteSwap.load_on_truck == payload.route_truck,
                RouteSwap.route_truck != payload.load_on_truck,
            )
        ).first()
        if reciprocal_conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Truck {payload.route_truck} is already assigned to load "
                    f"route {reciprocal_conflict.route_truck} on {payload.run_date}. "
                    "Clear that assignment first."
                ),
            )
        created.append(_upsert(payload.load_on_truck, payload.route_truck))

    db.commit()
    for row in created:
        db.refresh(row)

    # Append to swap log (append-only history that survives future deletions)
    for row in created:
        db.add(RouteSwapLog(
            run_date=row.run_date,
            route_truck=row.route_truck,
            load_on_truck=row.load_on_truck,
        ))
    db.commit()

    # Activate covering trucks: if a load_on_truck is still in "spare" (idle)
    # status, move it to "dirty" so it appears in the unload workflow.
    load_on_trucks = {row.load_on_truck for row in created}
    for truck_num in load_on_trucks:
        st = db.scalars(
            select(TruckState).where(
                TruckState.truck_number == truck_num,
                TruckState.run_date == payload.run_date,
            )
        ).first()
        if st is None:
            db.add(TruckState(
                truck_number=truck_num,
                run_date=payload.run_date,
                status=TruckStatus.dirty,
            ))
        elif st.status == TruckStatus.spare:
            st.status = TruckStatus.dirty
    db.commit()

    for row in created:
        background_tasks.add_task(
            dispatch_notification,
            coverage_assigned_notification(
                run_date=row.run_date,
                route_truck=row.route_truck,
                covering_truck=row.load_on_truck,
                changed_from_truck=previous_load_on_by_route.get(row.route_truck),
            ),
        )

    return created


@router.delete("/{swap_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_swap(
    swap_id: int,
    background_tasks: BackgroundTasks,
    also_reciprocal: bool = Query(
        default=False,
        description="Also delete the reciprocal row if a two-way swap exists",
    ),
    db: Session = Depends(get_db),
):
    """
    Delete a single swap row.  Pass also_reciprocal=true to also clear the
    paired row (e.g. for a full two-way swap teardown).
    """
    row = db.get(RouteSwap, swap_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swap not found")

    removed_notifications = [
        coverage_removed_notification(
            run_date=row.run_date,
            route_truck=row.route_truck,
            covering_truck=row.load_on_truck,
        )
    ]

    if also_reciprocal:
        # Find the reciprocal: route_truck == this row's load_on_truck AND load_on_truck == this row's route_truck
        reciprocal = db.scalars(
            select(RouteSwap).where(
                RouteSwap.run_date == row.run_date,
                RouteSwap.route_truck == row.load_on_truck,
                RouteSwap.load_on_truck == row.route_truck,
            )
        ).first()
        if reciprocal:
            removed_notifications.append(
                coverage_removed_notification(
                    run_date=reciprocal.run_date,
                    route_truck=reciprocal.route_truck,
                    covering_truck=reciprocal.load_on_truck,
                )
            )
            db.delete(reciprocal)

    db.delete(row)
    db.commit()
    for event in removed_notifications:
        background_tasks.add_task(dispatch_notification, event)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_all_swaps(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    """Remove all route swap assignments for a run date."""
    rows = db.scalars(select(RouteSwap).where(RouteSwap.run_date == run_date)).all()
    db.execute(delete(RouteSwap).where(RouteSwap.run_date == run_date))
    db.commit()
    for row in rows:
        background_tasks.add_task(
            dispatch_notification,
            coverage_removed_notification(
                run_date=row.run_date,
                route_truck=row.route_truck,
                covering_truck=row.load_on_truck,
            ),
        )


@router.get("/log", response_model=list[RouteSwapLogOut])
def get_swap_log(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Return the route swap history log for the past N days."""
    from datetime import datetime, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date()
    rows = db.scalars(
        select(RouteSwapLog)
        .where(RouteSwapLog.run_date >= cutoff)
        .order_by(RouteSwapLog.run_date.desc(), RouteSwapLog.created_at.desc())
    ).all()
    return rows
