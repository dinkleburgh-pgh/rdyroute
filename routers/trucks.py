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

from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from activity_log import add_related_truck_context, append_activity_event, append_truck_state_activity
from database import get_db
from models import AppSetting, RouteSwap, SpareAssignment, Truck, TruckState, TruckStateSource, TruckStatus, User
from notification_service import dispatch_notification, truck_hold_notification, truck_oos_notification
from routers.auth import get_current_user, require_admin, require_non_guest
from schemas import (
    AnomalyDay,
    CompletionDailyPoint,
    CycleDailyPoint,
    TruckStateCreate,
    TruckStateOut,
    TruckStateUpdate,
    TruckWithState,
    WearersDailyPoint,
)
from ws_manager import manager

router = APIRouter(prefix="/trucks", tags=["trucks"])

_PERSISTENT_STATUSES = {"off", "oos", "shop"}


def _ship_day_number(value: date) -> int:
    weekday = value.weekday()  # Mon=0 .. Sun=6
    if 0 <= weekday <= 4:
        return weekday + 1
    return 1


def _load_day_number(run_date: date) -> int:
    return _ship_day_number(run_date + timedelta(days=1))


def _ran_special(note: str | None) -> bool:
    return "ran special" in (note or "").lower()


def _ensure_day_initialized(run_date: date, db: Session) -> None:
    source_key = f"day_setup_source_{run_date}"
    if db.get(AppSetting, source_key) is not None:
        return

    trucks = db.scalars(
        select(Truck).where(Truck.is_active == True).order_by(Truck.truck_number)
    ).all()
    if not trucks:
        db.add(AppSetting(key=source_key, value="auto"))
        db.commit()
        return

    # Check force_unloaded_on_new_day setting — overrides all prior-status logic
    force_setting = db.get(AppSetting, "force_unloaded_on_new_day")
    force_unloaded = force_setting is not None and force_setting.value is True

    load_day_num = _load_day_number(run_date)
    prev_run_date = db.scalar(
        select(func.max(TruckState.run_date)).where(TruckState.run_date < run_date)
    )
    # Load-day number for the previous run date — used to determine whether a
    # truck with prior status "unloaded" was scheduled off that day (and therefore
    # didn't run a route) vs. was active and dispatched (and came back dirty).
    prev_load_day_num = _load_day_number(prev_run_date) if prev_run_date is not None else None

    prev_states_by_num: dict[int, TruckState] = {}
    prev_loaded_on = set[int]()
    prev_spares_used = set[int]()
    if prev_run_date is not None:
        prev_states_by_num = {
            row.truck_number: row
            for row in db.scalars(
                select(TruckState).where(TruckState.run_date == prev_run_date)
            ).all()
        }
        prev_loaded_on = {
            row.load_on_truck
            for row in db.scalars(
                select(RouteSwap).where(RouteSwap.run_date == prev_run_date)
            ).all()
        }
        prev_spares_used = {
            row.spare_truck_number
            for row in db.scalars(
                select(SpareAssignment).where(
                    SpareAssignment.run_date == prev_run_date,
                    SpareAssignment.returned == False,
                )
            ).all()
        }

    # When force_unloaded is set, close out the previous day first — mark any
    # trucks that are still dirty/in_progress/unfinished as unloaded so that
    # the previous day's board reflects a clean end-of-day state.
    _OPEN_STATUSES = {TruckStatus.dirty, TruckStatus.in_progress, TruckStatus.unfinished}
    if force_unloaded and prev_run_date is not None:
        for prev_state in prev_states_by_num.values():
            if prev_state.status in _OPEN_STATUSES:
                prev_state.status = TruckStatus.unloaded
                prev_state.state_source = TruckStateSource.workflow.value

    today_states = {
        row.truck_number: row
        for row in db.scalars(
            select(TruckState).where(TruckState.run_date == run_date)
        ).all()
    }
    seeded_truck_numbers: list[int] = []
    status_counts: dict[str, int] = {}

    for truck in trucks:
        if truck.truck_number in today_states:
            continue

        prior = prev_states_by_num.get(truck.truck_number)
        scheduled_off_today = (
            truck.truck_type != "Spare" and load_day_num in (truck.scheduled_off_days or [])
        )
        used_yesterday = False
        needs_checked = False
        off_note = ""
        shop_note = ""
        oos_spare_route = None
        has_dust_garment = False
        priority_hold = False
        batch_id = None
        wearers = 0
        load_day_value = load_day_num
        status = TruckStatus.unloaded

        if prior is not None:
            # needs_checked and ran-special off_note are intentionally NOT carried
            # forward — both reset each day.
            shop_note = prior.shop_note or ""
            used_yesterday = (
                prior.status in {TruckStatus.loaded, TruckStatus.in_progress}
                or truck.truck_number in prev_loaded_on
                or truck.truck_number in prev_spares_used
            )

            if prior.status == TruckStatus.unfinished:
                status = TruckStatus.unfinished
            elif prior.status in {TruckStatus.oos, TruckStatus.shop}:
                status = prior.status
            elif prior.status == TruckStatus.dirty:
                # Truck is physically at the dock waiting to be unloaded. Carry forward
                # regardless of the next load day's schedule.
                status = TruckStatus.dirty
            elif used_yesterday:
                # Truck was in loaded/in_progress state yesterday — it definitely dispatched
                # and returned dirty today, regardless of today's load schedule.
                status = TruckStatus.dirty
            elif prior.status == TruckStatus.unloaded and truck.truck_type != "Spare":
                # Non-spare was unloaded yesterday. Check if it actually dispatched by looking
                # at the UNLOAD day schedule (prev_load_day_num = today's unload day number).
                # Resolve this BEFORE scheduled_off_today so a truck scheduled off for
                # tomorrow's load doesn't wrongly get "off" status when it ran today.
                prev_sched_off = (
                    prev_load_day_num is not None
                    and prev_load_day_num in (truck.scheduled_off_days or [])
                )
                if not prev_sched_off:
                    status = TruckStatus.dirty    # dispatched → came back dirty
                elif scheduled_off_today:
                    status = TruckStatus.off      # didn't dispatch + not loading tonight
                else:
                    status = TruckStatus.unloaded  # didn't dispatch + active tonight
            elif scheduled_off_today:
                status = TruckStatus.off
            elif prior.status in {TruckStatus.off, TruckStatus.unloaded, TruckStatus.spare}:
                status = TruckStatus.unloaded
            else:
                status = TruckStatus.unloaded
        else:
            status = TruckStatus.off if scheduled_off_today else TruckStatus.unloaded

        if prior is None and scheduled_off_today:
            off_note = ""
        if truck.truck_type == "Spare" and truck.truck_number not in prev_spares_used and not used_yesterday:
            # Only reset to unloaded if the spare wasn't already carrying a dirty state forward.
            if prior is None or prior.status != TruckStatus.dirty:
                status = TruckStatus.unloaded

        row = TruckState(
            truck_number=truck.truck_number,
            run_date=run_date,
            status=status,
            wearers=wearers,
            batch_id=batch_id,
            load_day_num=load_day_value,
            load_start_time=None,
            load_finish_time=None,
            load_duration_seconds=None,
            off_note=off_note,
            shop_note=shop_note,
            oos_spare_route=oos_spare_route,
            has_dust_garment=has_dust_garment,
            priority_hold=priority_hold,
            needs_checked=needs_checked,
            state_source=TruckStateSource.auto.value,
        )
        db.add(row)
        seeded_truck_numbers.append(truck.truck_number)
        status_key = row.status.value if hasattr(row.status, "value") else str(row.status)
        status_counts[status_key] = status_counts.get(status_key, 0) + 1

    db.add(AppSetting(key=source_key, value="auto"))
    append_activity_event(
        db,
        actor_type="system",
        event_family="system",
        event_type="day_auto_initialized",
        run_date=run_date,
        summary=f"Auto-initialized {len(seeded_truck_numbers)} trucks for {run_date}",
        diff_json={
            "seeded_count": len(seeded_truck_numbers),
            "status_counts": status_counts,
        },
        context_json=add_related_truck_context(
            {
                "day_setup_source": "auto",
                "seeded_count": len(seeded_truck_numbers),
                "status_counts": status_counts,
            },
            seeded_truck_numbers,
        ),
    )
    # Auto-apply recurring route-swap rules for this load day (once per run-date).
    from routers.spares import apply_recurring_swaps
    apply_recurring_swaps(db, run_date, load_day_num)
    db.commit()


# ---------------------------------------------------------------------------
# Dashboard — full board for a run-date
# ---------------------------------------------------------------------------

@router.get("/board", response_model=list[TruckWithState])
def get_board(
    run_date: date = Query(..., description="Operational run-date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return all active fleet trucks joined with their explicit state for *run_date*."""
    _ensure_day_initialized(run_date, db)
    trucks = db.scalars(
        select(Truck).where(Truck.is_active == True).order_by(Truck.truck_number)
    ).all()

    # Fetch today's states in one query
    states_by_num: dict[int, TruckState] = {
        s.truck_number: s
        for s in db.scalars(
            select(TruckState).where(TruckState.run_date == run_date)
        ).all()
    }

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
                qr_token=t.qr_token,
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
    _user: User = Depends(get_current_user),
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
    _user: User = Depends(require_non_guest),
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

    row_payload = payload.model_dump()
    row_payload["state_source"] = payload.state_source or TruckStateSource.workflow.value
    row = TruckState(**row_payload)
    db.add(row)
    append_truck_state_activity(
        db,
        actor_user=_user,
        before_state=None,
        after_state=row,
        context_json={"source": "direct_write"},
    )
    db.commit()
    db.refresh(row)
    if row.priority_hold:
        background_tasks.add_task(
            dispatch_notification,
            truck_hold_notification(truck_number=truck_number, run_date=payload.run_date),
        )
    if row.status == "oos":
        background_tasks.add_task(
            dispatch_notification,
            truck_oos_notification(truck_number=truck_number, run_date=payload.run_date),
        )
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
    _user: User = Depends(require_non_guest),
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

    previous_status = row.status
    previous_hold = row.priority_hold
    before_state = TruckState(**{
        "truck_number": row.truck_number,
        "run_date": row.run_date,
        "status": row.status,
        "wearers": row.wearers,
        "batch_id": row.batch_id,
        "load_day_num": row.load_day_num,
        "load_start_time": row.load_start_time,
        "load_finish_time": row.load_finish_time,
        "load_duration_seconds": row.load_duration_seconds,
        "off_note": row.off_note,
        "shop_note": row.shop_note,
        "oos_spare_route": row.oos_spare_route,
        "has_dust_garment": row.has_dust_garment,
        "priority_hold": row.priority_hold,
        "needs_checked": row.needs_checked,
        "arrived_at": row.arrived_at,
        "state_source": row.state_source,
    })
    updates = payload.model_dump(exclude_unset=True)
    if "state_source" not in updates:
        updates["state_source"] = TruckStateSource.workflow.value

    if updates.get("status") and updates["status"].value == "in_progress":
        _assert_no_other_in_progress(truck_number, run_date, db)

    for field, value in updates.items():
        setattr(row, field, value)

    append_truck_state_activity(
        db,
        actor_user=_user,
        before_state=before_state,
        after_state=row,
        context_json={"source": "direct_write"},
    )
    db.commit()
    db.refresh(row)
    if not previous_hold and row.priority_hold:
        background_tasks.add_task(
            dispatch_notification,
            truck_hold_notification(truck_number=truck_number, run_date=run_date),
        )
    if previous_status != "oos" and row.status == "oos":
        background_tasks.add_task(
            dispatch_notification,
            truck_oos_notification(truck_number=truck_number, run_date=run_date),
        )
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(run_date), "truck_number": truck_number},
    )
    return row


# ---------------------------------------------------------------------------
# Full workday reset — wipes all per-date operational state in one transaction
# ---------------------------------------------------------------------------

@router.post("/reset-workday")
def reset_workday(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Full workday reset for *run_date*:

    1. Deletes all TruckState rows for the date (status, times, notes, garments, etc.)
    2. Deletes all RouteSwap rows for the date
    3. Deletes all Batch rows for the date
    4. Deletes per-date AppSetting keys:
         wizard_completed_<date>
         day_setup_source_<date>
         holiday_mode_<date>
         holiday_load_<date>
         holiday_unload_<date>
    """
    from models import AppSetting, Batch  # local import avoids circular

    date_str = str(run_date)
    state_truck_numbers = db.scalars(
        select(TruckState.truck_number).where(TruckState.run_date == run_date)
    ).all()
    route_swap_count = db.scalar(
        select(func.count(RouteSwap.id)).where(RouteSwap.run_date == run_date)
    ) or 0
    batch_count = db.scalar(
        select(func.count(Batch.id)).where(Batch.run_date == run_date)
    ) or 0

    # 1. Truck states
    deleted_states = db.execute(
        delete(TruckState).where(TruckState.run_date == run_date)
    ).rowcount

    # 2. Route swaps
    db.execute(delete(RouteSwap).where(RouteSwap.run_date == run_date))

    # 3. Batch assignments
    db.execute(delete(Batch).where(Batch.run_date == run_date))

    # 4. Per-date settings
    setting_keys = [
        f"wizard_completed_{date_str}",
        f"day_setup_source_{date_str}",
        f"holiday_mode_{date_str}",
        f"holiday_load_{date_str}",
        f"holiday_unload_{date_str}",
    ]
    for key in setting_keys:
        setting = db.get(AppSetting, key)
        if setting:
            db.delete(setting)

    append_activity_event(
        db,
        actor_user=_admin,
        event_family="recovery",
        event_type="workday_reset",
        run_date=run_date,
        summary=f"Reset workday for {run_date}",
        diff_json={
            "states_cleared": deleted_states,
            "route_swaps_cleared": route_swap_count,
            "batches_cleared": batch_count,
            "settings_cleared": setting_keys,
        },
        context_json=add_related_truck_context(
            {"setting_keys": setting_keys, "route_swap_count": route_swap_count, "batch_count": batch_count},
            state_truck_numbers,
        ),
    )
    db.commit()

    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": date_str},
    )

    return {"reset": True, "run_date": date_str, "states_cleared": deleted_states}


@router.post("/selective-reset")
def selective_reset(
    background_tasks: BackgroundTasks,
    run_date: date = Query(...),
    truck_states: bool = Query(False),
    batches: bool = Query(False),
    route_swaps: bool = Query(False),
    day_flags: bool = Query(False),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Selective workday reset — clears only the requested components for *run_date*.
    """
    from models import AppSetting, Batch  # local import avoids circular

    date_str = str(run_date)
    result: dict = {"run_date": date_str, "cleared": []}
    related_truck_numbers: list[int] = []
    diff_payload: dict[str, object] = {}

    if truck_states:
        related_truck_numbers.extend(
            db.scalars(select(TruckState.truck_number).where(TruckState.run_date == run_date)).all()
        )
        deleted = db.execute(
            delete(TruckState).where(TruckState.run_date == run_date)
        ).rowcount
        result["states_cleared"] = deleted
        diff_payload["states_cleared"] = deleted
        result["cleared"].append("truck_states")
        for key in [
            f"wizard_completed_{date_str}",
            f"day_setup_source_{date_str}",
        ]:
            setting = db.get(AppSetting, key)
            if setting:
                db.delete(setting)

    if batches:
        batch_deleted = db.execute(delete(Batch).where(Batch.run_date == run_date)).rowcount
        diff_payload["batches_cleared"] = batch_deleted
        result["cleared"].append("batches")

    if route_swaps:
        related_truck_numbers.extend(
            db.scalars(select(RouteSwap.route_truck).where(RouteSwap.run_date == run_date)).all()
        )
        related_truck_numbers.extend(
            db.scalars(select(RouteSwap.load_on_truck).where(RouteSwap.run_date == run_date)).all()
        )
        route_swap_deleted = db.execute(delete(RouteSwap).where(RouteSwap.run_date == run_date)).rowcount
        diff_payload["route_swaps_cleared"] = route_swap_deleted
        result["cleared"].append("route_swaps")

    if day_flags:
        for key in [
            f"wizard_completed_{date_str}",
            f"day_setup_source_{date_str}",
            f"holiday_mode_{date_str}",
            f"holiday_load_{date_str}",
            f"holiday_unload_{date_str}",
        ]:
            setting = db.get(AppSetting, key)
            if setting:
                db.delete(setting)
        result["cleared"].append("day_flags")
        diff_payload["day_flags_cleared"] = True

    append_activity_event(
        db,
        actor_user=_admin,
        event_family="recovery",
        event_type="selective_reset",
        run_date=run_date,
        summary=f"Selective reset cleared {', '.join(result['cleared']) or 'nothing'} for {run_date}",
        diff_json=diff_payload,
        context_json=add_related_truck_context(
            {"cleared": list(result["cleared"])},
            related_truck_numbers,
        ),
    )
    db.commit()

    if truck_states or batches or route_swaps:
        background_tasks.add_task(
            manager.broadcast,
            {"type": "truck_state_updated", "run_date": date_str},
        )

    return result


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
    _user: User = Depends(require_non_guest),
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
    previous_status_by_num = {row.truck_number: row.status for row in rows}
    changed_rows: list[dict[str, object]] = []

    # Update trucks that already have a state row
    for row in rows:
        previous_status = row.status.value if hasattr(row.status, "value") else str(row.status)
        row.status = validated_status
        row.state_source = TruckStateSource.workflow.value
        current_status = validated_status.value if hasattr(validated_status, "value") else str(validated_status)
        if previous_status != current_status:
            changed_rows.append(
                {
                    "truck_number": row.truck_number,
                    "status": {"before": previous_status, "after": current_status},
                }
            )

    # Create state rows for trucks that have none
    existing_nums = {row.truck_number for row in rows}
    for num in truck_numbers:
        if num not in existing_nums:
            db.add(TruckState(
                truck_number=num,
                run_date=run_date,
                status=validated_status,
                wearers=0,
                state_source=TruckStateSource.workflow.value,
            ))
            changed_rows.append(
                {
                    "truck_number": num,
                    "status": {"before": None, "after": validated_status.value},
                }
            )

    if changed_rows:
        append_activity_event(
            db,
            actor_user=_user,
            event_family="state",
            event_type="bulk_truck_status_changed",
            run_date=run_date,
            summary=f"Bulk set {len(changed_rows)} truck(s) to {validated_status.value}",
            status_after=validated_status.value,
            diff_json={
                "changed_count": len(changed_rows),
                "truck_changes": changed_rows,
            },
            context_json=add_related_truck_context(
                {"new_status": validated_status.value},
                [item["truck_number"] for item in changed_rows],
            ),
        )
    db.commit()
    background_tasks.add_task(
        manager.broadcast,
        {"type": "truck_state_updated", "run_date": str(run_date)},
    )
    if validated_status == TruckStatus.oos:
        for truck_number in truck_numbers:
            if previous_status_by_num.get(truck_number) == TruckStatus.oos:
                continue
            background_tasks.add_task(
                dispatch_notification,
                truck_oos_notification(truck_number=truck_number, run_date=run_date),
            )
    # Re-query to return all affected rows (includes newly-created ones)
    updated = db.scalars(
        select(TruckState).where(
            TruckState.run_date == run_date,
            TruckState.truck_number.in_(truck_numbers),
        )
    ).all()
    return updated


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


# ---------------------------------------------------------------------------
# Trend aggregation endpoints
# ---------------------------------------------------------------------------

@router.get("/trends/completion", response_model=list[CompletionDailyPoint])
def truck_completion_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day: total route trucks scheduled vs loaded, expressed as pct."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.count(TruckState.id).label("total"),
            func.sum(
                func.case((TruckState.status == "loaded", 1), else_=0)
            ).label("loaded"),
        )
        .where(TruckState.run_date >= cutoff)
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        CompletionDailyPoint(
            run_date=r[0],
            total_trucks=r[1],
            loaded_trucks=r[2] or 0,
            pct=round((r[2] or 0) / r[1] * 100, 1) if r[1] else 0,
        )
        for r in rows
    ]


@router.get("/trends/wearers", response_model=list[WearersDailyPoint])
def truck_wearers_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day average wearer count for trucks that were loaded."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.avg(TruckState.wearers).label("avg_w"),
            func.count(TruckState.id).label("tc"),
        )
        .where(
            TruckState.run_date >= cutoff,
            TruckState.status == "loaded",
            TruckState.wearers > 0,
        )
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        WearersDailyPoint(
            run_date=r[0],
            avg_wearers=round(r[1], 1) if r[1] else 0,
            truck_count=r[2],
        )
        for r in rows
    ]


@router.get("/trends/cycle", response_model=list[CycleDailyPoint])
def truck_cycle_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day average load duration (from TruckState.load_duration_seconds)."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            TruckState.run_date,
            func.avg(TruckState.load_duration_seconds).label("avg_s"),
            func.count(TruckState.id).label("tc"),
        )
        .where(
            TruckState.run_date >= cutoff,
            TruckState.status == "loaded",
            TruckState.load_duration_seconds.isnot(None),
            TruckState.load_duration_seconds >= 30,
        )
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    return [
        CycleDailyPoint(
            run_date=r[0],
            avg_seconds=round(r[1], 1) if r[1] else 0,
            truck_count=r[2],
        )
        for r in rows
    ]


@router.get("/trends/anomalies", response_model=list[AnomalyDay])
def truck_anomalies(
    days_back: int = Query(default=90, ge=14, le=365),
    db: Session = Depends(get_db),
):
    """Days where completion rate, pace, or wearers diverge >2σ from the mean."""
    from statistics import mean, stdev
    cutoff = date.today() - timedelta(days=days_back)
    daily = db.execute(
        select(
            TruckState.run_date,
            func.count(TruckState.id).label("tot"),
            func.sum(func.case((TruckState.status == "loaded", 1), else_=0)).label("lod"),
            func.avg(
                func.case(
                    (TruckState.status == "loaded", TruckState.load_duration_seconds),
                    else_=None,
                )
            ).label("pac"),
            func.avg(
                func.case(
                    (TruckState.status == "loaded", TruckState.wearers),
                    else_=None,
                )
            ).label("wav"),
        )
        .where(TruckState.run_date >= cutoff)
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()

    anomalies: list[AnomalyDay] = []
    if len(daily) < 7:
        return anomalies

    pcts = [d[2] / d[1] * 100 if d[1] else 0 for d in daily]
    paces = [d[3] for d in daily if d[3] is not None and d[3] >= 30]
    wearers_list = [d[4] for d in daily if d[4] is not None and d[4] > 0]

    for d in daily:
        if len(pcts) >= 7:
            m = mean(pcts)
            s = stdev(pcts) if len(pcts) > 1 else 1
            z = (d[2] / d[1] * 100 - m) / s if d[1] and s else 0
            if abs(z) > 2:
                anomalies.append(AnomalyDay(run_date=d[0], metric="completion", value=round(d[2] / d[1] * 100, 1) if d[1] else 0, mean=round(m, 1), sigma=round(s, 2), z_score=round(z, 2)))
        if d[3] is not None and d[3] >= 30 and len(paces) >= 7:
            m = mean(paces)
            s = stdev(paces) if len(paces) > 1 else 1
            z = (d[3] - m) / s if s else 0
            if abs(z) > 2:
                anomalies.append(AnomalyDay(run_date=d[0], metric="pace", value=round(d[3], 1), mean=round(m, 1), sigma=round(s, 2), z_score=round(z, 2)))
        if d[4] is not None and d[4] > 0 and len(wearers_list) >= 7:
            m = mean(wearers_list)
            s = stdev(wearers_list) if len(wearers_list) > 1 else 1
            z = (d[4] - m) / s if s else 0
            if abs(z) > 2:
                anomalies.append(AnomalyDay(run_date=d[0], metric="wearers", value=round(d[4], 1), mean=round(m, 1), sigma=round(s, 2), z_score=round(z, 2)))

    return sorted(anomalies, key=lambda a: a.run_date, reverse=True)
