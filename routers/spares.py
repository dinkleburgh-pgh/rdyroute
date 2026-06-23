"""
Router: /spares

Spare truck assignment management.

V1 mapping:
  oos_spare_assignments   →  SpareAssignment rows (spare covers a route truck)
  spare_origin_route      →  SpareAssignment.covering_route_truck
  used_spares_today       →  SpareAssignment rows where run_date = today
  spares_needing_return   →  SpareAssignment rows where returned = false
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from activity_log import add_related_truck_context, append_activity_event, build_field_diff, snapshot_truck_state
from database import get_db
from models import SpareAssignment, TruckState, TruckStateSource, TruckStatus, User
from notification_service import (
    coverage_assigned_notification,
    coverage_removed_notification,
    dispatch_notification,
)
from routers.auth import get_current_user, require_non_guest
from schemas import SpareAssignCreate, SpareAssignOut, SpareAssignReturn

router = APIRouter(prefix="/spares", tags=["spares"])


@router.get("", response_model=list[SpareAssignOut])
def list_assignments(
    run_date: date = Query(...),
    returned: bool | None = Query(default=None, description="Filter by return status"),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(SpareAssignment).where(SpareAssignment.run_date == run_date)
    if returned is not None:
        q = q.where(SpareAssignment.returned == returned)
    return db.scalars(q.order_by(SpareAssignment.assigned_at)).all()


@router.post("", response_model=SpareAssignOut, status_code=status.HTTP_201_CREATED)
def assign_spare(
    payload: SpareAssignCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_non_guest),
):
    # Prevent double-assignment of the same spare on the same date
    existing = db.scalars(
        select(SpareAssignment).where(
            SpareAssignment.run_date == payload.run_date,
            SpareAssignment.spare_truck_number == payload.spare_truck_number,
            SpareAssignment.returned == False,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Spare {payload.spare_truck_number} is already assigned on {payload.run_date}",
        )
    row = SpareAssignment(**payload.model_dump())
    db.add(row)

    # Set spare truck state to "spare" and record which route it covers.
    spare_state = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == payload.spare_truck_number,
            TruckState.run_date == payload.run_date,
        )
    ).first()
    before_snapshot = snapshot_truck_state(spare_state)
    if spare_state is None:
        spare_state = TruckState(
            truck_number=payload.spare_truck_number,
            run_date=payload.run_date,
            status=TruckStatus.dirty,
            wearers=0,
            oos_spare_route=payload.covering_route_truck,
            state_source=TruckStateSource.workflow.value,
        )
        db.add(spare_state)
    else:
        # Only override status if the spare is still idle — don't step back an
        # already-active spare that is being re-assigned.
        if spare_state.status in (TruckStatus.spare, TruckStatus.dirty):
            spare_state.status = TruckStatus.dirty
        spare_state.oos_spare_route = payload.covering_route_truck
        spare_state.state_source = TruckStateSource.workflow.value

    after_snapshot = snapshot_truck_state(spare_state)
    append_activity_event(
        db,
        actor_user=current_user,
        event_family="coverage",
        event_type="spare_assigned",
        run_date=payload.run_date,
        truck_number=payload.spare_truck_number,
        summary=f"Assigned spare truck {payload.spare_truck_number} to cover route {payload.covering_route_truck}",
        status_before=before_snapshot.get("status") if before_snapshot else None,
        status_after=after_snapshot.get("status") if after_snapshot else None,
        diff_json={
            "covering_route_truck": payload.covering_route_truck,
            "truck_state": build_field_diff(before_snapshot, after_snapshot),
        },
        context_json=add_related_truck_context(
            {"covering_route_truck": payload.covering_route_truck},
            [payload.spare_truck_number, payload.covering_route_truck],
        ),
    )

    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        dispatch_notification,
        coverage_assigned_notification(
            run_date=payload.run_date,
            route_truck=payload.covering_route_truck,
            covering_truck=payload.spare_truck_number,
        ),
    )
    return row


@router.post("/{assignment_id}/return", response_model=SpareAssignOut)
def return_spare(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    payload: SpareAssignReturn | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_non_guest),
):
    row = db.get(SpareAssignment, assignment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if row.returned:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Spare already returned")
    row.returned = True
    row.returned_at = (payload.returned_at if payload else None) or datetime.now(timezone.utc)

    # Release the spare truck back to dirty.
    spare_state = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == row.spare_truck_number,
            TruckState.run_date == row.run_date,
        )
    ).first()
    before_snapshot = snapshot_truck_state(spare_state)
    if spare_state is not None:
        spare_state.status = TruckStatus.dirty
        spare_state.oos_spare_route = None
        spare_state.state_source = TruckStateSource.workflow.value

    after_snapshot = snapshot_truck_state(spare_state)
    append_activity_event(
        db,
        actor_user=current_user,
        event_family="coverage",
        event_type="spare_returned",
        run_date=row.run_date,
        truck_number=row.spare_truck_number,
        summary=f"Returned spare truck {row.spare_truck_number} from route {row.covering_route_truck}",
        status_before=before_snapshot.get("status") if before_snapshot else None,
        status_after=after_snapshot.get("status") if after_snapshot else None,
        diff_json={
            "covering_route_truck": row.covering_route_truck,
            "returned_at": row.returned_at,
            "truck_state": build_field_diff(before_snapshot, after_snapshot),
        },
        context_json=add_related_truck_context(
            {"covering_route_truck": row.covering_route_truck},
            [row.spare_truck_number, row.covering_route_truck],
        ),
    )

    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        dispatch_notification,
        coverage_removed_notification(
            run_date=row.run_date,
            route_truck=row.covering_route_truck,
            covering_truck=row.spare_truck_number,
        ),
    )
    return row


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_non_guest),
):
    row = db.get(SpareAssignment, assignment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    removed_notification = coverage_removed_notification(
        run_date=row.run_date,
        route_truck=row.covering_route_truck,
        covering_truck=row.spare_truck_number,
    )
    spare_state = db.scalars(
        select(TruckState).where(
            TruckState.truck_number == row.spare_truck_number,
            TruckState.run_date == row.run_date,
        )
    ).first()
    before_snapshot = snapshot_truck_state(spare_state)
    if spare_state is not None:
        spare_state.oos_spare_route = None
        spare_state.state_source = TruckStateSource.workflow.value
        if not row.returned:
            spare_state.status = TruckStatus.dirty
    after_snapshot = snapshot_truck_state(spare_state)
    append_activity_event(
        db,
        actor_user=current_user,
        event_family="coverage",
        event_type="spare_assignment_deleted",
        run_date=row.run_date,
        truck_number=row.spare_truck_number,
        summary=f"Deleted spare assignment {row.spare_truck_number} → route {row.covering_route_truck}",
        status_before=before_snapshot.get("status") if before_snapshot else None,
        status_after=after_snapshot.get("status") if after_snapshot else None,
        diff_json={
            "covering_route_truck": row.covering_route_truck,
            "returned": row.returned,
            "truck_state": build_field_diff(before_snapshot, after_snapshot),
        },
        context_json=add_related_truck_context(
            {"covering_route_truck": row.covering_route_truck, "returned": row.returned},
            [row.spare_truck_number, row.covering_route_truck],
        ),
    )
    db.delete(row)
    db.commit()
    background_tasks.add_task(dispatch_notification, removed_notification)
    return None
