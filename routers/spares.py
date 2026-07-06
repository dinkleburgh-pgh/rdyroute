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
from models import AppSetting, RouteSwapLog, SpareAssignment, Truck, TruckState, TruckStateSource, TruckStatus, User
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
    run_date: date | None = Query(default=None),
    returned: bool | None = Query(default=None, description="Filter by return status"),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List spare assignments. Filtered to a run date if given, else across
    every date on file (e.g. GET /spares?returned=false returns every spare
    assignment nobody has returned yet, regardless of which day it was made —
    the authoritative "is this coverage still active" signal)."""
    q = select(SpareAssignment)
    if run_date is not None:
        q = q.where(SpareAssignment.run_date == run_date)
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

    # Record in the append-only swap log (route_truck → load_on_truck) so the
    # coverage is "known" for the next day's unload view, same as route swaps.
    db.add(RouteSwapLog(
        run_date=payload.run_date,
        route_truck=payload.covering_route_truck,
        load_on_truck=payload.spare_truck_number,
    ))

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


def apply_recurring_swaps(db: Session, run_date: date, load_day_num: int) -> list[SpareAssignment]:
    """Auto-apply recurring coverage rules whose day matches the load day.

    Reads the ``recurring_route_swaps`` app setting — a list of
    ``{route_truck, load_on_truck, days, two_way?}`` — and creates a
    SpareAssignment (covering_route_truck=route_truck, spare_truck_number=
    load_on_truck) for every rule that runs on ``load_day_num``. Mirrors the core
    of ``assign_spare`` (create row + activate the covering truck) without the
    interactive validation/notifications.

    Idempotent: never clobbers an existing assignment for the same route or
    covering truck on this date, so re-initializing a day is safe and manual
    swaps are preserved. Called once per run-date from ``_ensure_day_initialized``.
    The caller is responsible for committing the surrounding transaction.
    """
    setting = db.get(AppSetting, "recurring_route_swaps")
    rules = setting.value if (setting is not None and isinstance(setting.value, list)) else []
    if not rules:
        return []

    # The caller (_ensure_day_initialized) seeds today's TruckState rows but the
    # session has autoflush disabled, so flush them first — otherwise the lookups
    # below won't see them and we'd insert a duplicate (run_date, truck) row.
    db.flush()

    existing = db.scalars(
        select(SpareAssignment).where(
            SpareAssignment.run_date == run_date,
            SpareAssignment.returned == False,
        )
    ).all()
    covered_routes = {a.covering_route_truck for a in existing}
    used_spares = {a.spare_truck_number for a in existing}
    active_truck_numbers = {
        n for (n,) in db.execute(select(Truck.truck_number).where(Truck.is_active == True)).all()
    }

    applied: list[SpareAssignment] = []

    def _apply(route_truck: int, load_on_truck: int) -> None:
        if route_truck == load_on_truck:
            return
        if route_truck in covered_routes or load_on_truck in used_spares:
            return
        if route_truck not in active_truck_numbers or load_on_truck not in active_truck_numbers:
            return
        row = SpareAssignment(
            run_date=run_date,
            spare_truck_number=load_on_truck,
            covering_route_truck=route_truck,
        )
        db.add(row)
        # Record in the append-only swap log, same as assign_spare — otherwise
        # auto-applied recurring coverage never appears in swap history and the
        # "previous load-day coverage" fallback can't see it once this
        # assignment is returned/deleted.
        db.add(RouteSwapLog(
            run_date=run_date,
            route_truck=route_truck,
            load_on_truck=load_on_truck,
        ))
        # Activate the covering truck and record which route it covers.
        st = db.scalars(
            select(TruckState).where(
                TruckState.truck_number == load_on_truck,
                TruckState.run_date == run_date,
            )
        ).first()
        if st is None:
            db.add(TruckState(
                truck_number=load_on_truck,
                run_date=run_date,
                status=TruckStatus.dirty,
                wearers=0,
                oos_spare_route=route_truck,
                state_source=TruckStateSource.workflow.value,
            ))
        else:
            if st.status in (TruckStatus.spare, TruckStatus.dirty):
                st.status = TruckStatus.dirty
            st.oos_spare_route = route_truck
            st.state_source = TruckStateSource.workflow.value
        covered_routes.add(route_truck)
        used_spares.add(load_on_truck)
        applied.append(row)

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        days = rule.get("days") or []
        if load_day_num not in days:
            continue
        try:
            route_truck = int(rule["route_truck"])
            load_on_truck = int(rule["load_on_truck"])
        except (KeyError, TypeError, ValueError):
            continue
        _apply(route_truck, load_on_truck)
        if rule.get("two_way"):
            _apply(load_on_truck, route_truck)

    if applied:
        db.flush()
        append_activity_event(
            db,
            actor_type="system",
            event_family="coverage",
            event_type="recurring_swaps_applied",
            run_date=run_date,
            summary=f"Auto-applied {len(applied)} recurring route swap(s) for load day {load_day_num}",
            diff_json={
                "swaps": [
                    {"covering_route_truck": a.covering_route_truck, "spare_truck_number": a.spare_truck_number}
                    for a in applied
                ],
            },
            context_json={"load_day_num": load_day_num},
        )
    return applied


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
