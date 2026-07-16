from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Iterable

from sqlalchemy import String, Select, cast, or_
from sqlalchemy.orm import Session

from models import ActivityEvent, TruckState, User

_TRUCK_STATE_FIELDS: tuple[str, ...] = (
    "status",
    "wearers",
    "batch_id",
    "load_day_num",
    "load_start_time",
    "load_finish_time",
    "load_duration_seconds",
    "off_note",
    "shop_note",
    "oos_spare_route",
    "has_dust_garment",
    "priority_hold",
    "needs_checked",
    "arrived_at",
    "state_source",
)


def _normalize(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    if isinstance(value, tuple):
        return [_normalize(v) for v in value]
    return value


def snapshot_truck_state(state: TruckState | None) -> dict[str, Any] | None:
    if state is None:
        return None
    return {
        "truck_number": state.truck_number,
        "run_date": _normalize(state.run_date),
        **{field: _normalize(getattr(state, field)) for field in _TRUCK_STATE_FIELDS},
    }


def build_field_diff(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    *,
    fields: Iterable[str] | None = None,
) -> dict[str, Any]:
    keys = list(fields) if fields is not None else sorted(set((before or {}).keys()) | set((after or {}).keys()))
    changed: dict[str, dict[str, Any]] = {}
    for key in keys:
        before_value = _normalize((before or {}).get(key))
        after_value = _normalize((after or {}).get(key))
        if before_value != after_value:
            changed[key] = {"before": before_value, "after": after_value}
    return {
        "field_count": len(changed),
        "changed_fields": list(changed.keys()),
        "fields": changed,
    }


def add_related_truck_context(
    context_json: dict[str, Any] | None,
    truck_numbers: Iterable[int | None],
) -> dict[str, Any]:
    base = dict(context_json or {})
    cleaned = sorted({int(num) for num in truck_numbers if num is not None})
    if cleaned:
        base["related_truck_numbers"] = cleaned
        base["related_truck_numbers_csv"] = "|" + "|".join(str(num) for num in cleaned) + "|"
    return base


def build_truck_state_summary(
    *,
    truck_number: int,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    family: str,
) -> str:
    prefix = "Setup Day " if family == "setup" else ""
    before_status = (before or {}).get("status")
    after_status = (after or {}).get("status")
    before_arrived = (before or {}).get("arrived_at")
    after_arrived = (after or {}).get("arrived_at")
    if before_arrived != after_arrived:
        if before_arrived is None and after_arrived is not None:
            return f"{prefix}marked truck {truck_number} arrived"
        if before_arrived is not None and after_arrived is None:
            return f"{prefix}cleared arrived time for truck {truck_number}"
    if before is None and after_status is not None:
        return f"{prefix}created truck {truck_number} as {after_status}"
    if before_status != after_status and before_status is not None and after_status is not None:
        return f"{prefix}truck {truck_number} {before_status} → {after_status}"
    return f"{prefix}updated truck {truck_number}"


def append_activity_event(
    db: Session,
    *,
    actor_user: User | None = None,
    actor_type: str = "system",
    event_family: str,
    event_type: str,
    run_date: date | None = None,
    truck_number: int | None = None,
    summary: str,
    status_before: str | None = None,
    status_after: str | None = None,
    diff_json: dict[str, Any] | None = None,
    context_json: dict[str, Any] | None = None,
) -> ActivityEvent:
    actor_role = None
    if actor_user is not None:
        actor_type = "user"
        actor_role = getattr(actor_user.role, "value", actor_user.role)
    row = ActivityEvent(
        actor_type=actor_type,
        actor_username=actor_user.username if actor_user is not None else None,
        actor_display_name=(
            (actor_user.display_name or actor_user.username) if actor_user is not None else "System"
        ),
        actor_role=actor_role,
        event_family=event_family,
        event_type=event_type,
        run_date=run_date,
        truck_number=truck_number,
        summary=summary,
        status_before=status_before,
        status_after=status_after,
        diff_json=_normalize(diff_json or {}),
        context_json=_normalize(context_json or {}),
    )
    db.add(row)
    return row


def append_truck_state_activity(
    db: Session,
    *,
    actor_user: User | None,
    before_state: TruckState | None,
    after_state: TruckState,
    event_type: str = "truck_state_changed",
    event_family: str | None = None,
    summary: str | None = None,
    context_json: dict[str, Any] | None = None,
) -> ActivityEvent | None:
    before_snapshot = snapshot_truck_state(before_state)
    after_snapshot = snapshot_truck_state(after_state)
    diff = build_field_diff(before_snapshot, after_snapshot, fields=_TRUCK_STATE_FIELDS)
    if before_snapshot is not None and diff["field_count"] == 0:
        return None
    family = event_family or ("setup" if after_state.state_source == "wizard" else "state")
    # Setup/wizard events are system actions, not attributed to a specific user
    setup_actor = None if family == "setup" else actor_user
    return append_activity_event(
        db,
        actor_user=setup_actor,
        event_family=family,
        event_type=event_type,
        run_date=after_state.run_date,
        truck_number=after_state.truck_number,
        summary=summary
        or build_truck_state_summary(
            truck_number=after_state.truck_number,
            before=before_snapshot,
            after=after_snapshot,
            family=family,
        ),
        status_before=before_snapshot.get("status") if before_snapshot else None,
        status_after=after_snapshot.get("status") if after_snapshot else None,
        diff_json=diff,
        context_json=add_related_truck_context(context_json, [after_state.truck_number]),
    )


def apply_activity_filters(
    query: Select[tuple[ActivityEvent]] | Select[Any],
    *,
    run_date: date | None = None,
    truck_number: int | None = None,
    actor_username: str | None = None,
    event_family: str | None = None,
    event_type: str | None = None,
    status_before: str | None = None,
    status_after: str | None = None,
    q: str | None = None,
) -> Select[Any]:
    if run_date is not None:
        query = query.where(ActivityEvent.run_date == run_date)
    if truck_number is not None:
        related_like = f"%|{truck_number}|%"
        query = query.where(
            or_(
                ActivityEvent.truck_number == truck_number,
                cast(ActivityEvent.context_json, String).like(related_like),
            )
        )
    if actor_username:
        query = query.where(ActivityEvent.actor_username == actor_username)
    if event_family:
        query = query.where(ActivityEvent.event_family == event_family)
    if event_type:
        query = query.where(ActivityEvent.event_type == event_type)
    if status_before:
        query = query.where(ActivityEvent.status_before == status_before)
    if status_after:
        query = query.where(ActivityEvent.status_after == status_after)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(
                ActivityEvent.summary.ilike(pattern),
                ActivityEvent.actor_username.ilike(pattern),
                ActivityEvent.actor_display_name.ilike(pattern),
                cast(ActivityEvent.truck_number, String).ilike(pattern),
                cast(ActivityEvent.context_json, String).ilike(pattern),
            )
        )
    return query


def activity_event_to_dict(row: ActivityEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "occurred_at": _normalize(row.occurred_at),
        "actor_type": row.actor_type,
        "actor_username": row.actor_username,
        "actor_display_name": row.actor_display_name,
        "actor_role": row.actor_role,
        "event_family": row.event_family,
        "event_type": row.event_type,
        "run_date": _normalize(row.run_date),
        "truck_number": row.truck_number,
        "summary": row.summary,
        "status_before": row.status_before,
        "status_after": row.status_after,
        "diff_json": _normalize(row.diff_json or {}),
        "context_json": _normalize(row.context_json or {}),
    }
