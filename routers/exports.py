"""
Router: /exports

Data export and import utilities.  Lets admins download historical data as
JSON files or a full backup ZIP archive.  Import endpoints allow restoring
those files into the V2 database.

Also provides endpoints for managing pg_dump SQL backup files written by
the background backup_loop() task.
"""

import io
import ipaddress
import json
import os
import zipfile
from datetime import date, datetime
from pathlib import Path
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from activity_log import activity_event_to_dict, apply_activity_filters
from database import get_db, settings
from models import (
    ActivityEvent,
    AppSetting,
    AuditEntry,
    Batch,
    BatchHistory,
    CommunicationMessage,
    LoadDuration,
    Notice,
    RouteSwap,
    Shortage,
    SpareAssignment,
    Truck,
    TruckNote,
    TruckState,
    User,
)
from routers.auth import require_admin, require_management_access

router = APIRouter(prefix="/exports", tags=["exports"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ser(obj):
    """JSON encoder that handles date / datetime."""
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Not serialisable: {type(obj)}")


def _json_response(data: object, filename: str) -> Response:
    content = json.dumps(data, default=_ser, indent=2)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _host_is_local(host: str | None) -> bool:
    """True for loopback or private-LAN (RFC1918) hosts.

    Allows the production-sync dev tool to be reached from another device on the
    same LAN (e.g. http://192.168.1.212:5180) while still hard-blocking public
    hostnames like rdyroute.app, which never resolve to a private address.
    """
    if not host:
        return False
    normalized = host.strip().lower()
    if not normalized:
        return False
    if normalized.startswith("[") and "]" in normalized:
        normalized = normalized[1:normalized.index("]")]
    elif ":" in normalized and normalized.count(":") == 1:
        normalized = normalized.split(":", 1)[0]
    if normalized == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


def _request_is_localhost(request: Request) -> bool:
    candidates: list[str | None] = [
        request.url.hostname,
        request.client.host if request.client else None,
    ]
    for header_name in ("host", "x-forwarded-host", "origin", "referer"):
        raw = request.headers.get(header_name)
        if not raw:
            continue
        if header_name in {"origin", "referer"}:
            parsed = urllib_parse.urlparse(raw)
            candidates.append(parsed.hostname)
        else:
            candidates.extend(part.strip() for part in raw.split(","))
    return any(_host_is_local(candidate) for candidate in candidates)


def _parse_date(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _parse_datetime(value: object) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _coerce_json_rows(payload: bytes, *, file_label: str) -> list[dict]:
    try:
        rows = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in {file_label}: {exc}") from exc
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail=f"Expected a JSON array in {file_label}")
    return [row for row in rows if isinstance(row, dict)]


def _extract_backup_run_dates(content: bytes) -> list[date]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Invalid ZIP file") from exc
    run_dates: set[date] = set()
    for name in ("truck_states.json", "shortages.json", "batches.json", "audit_entries.json"):
        if name not in zf.namelist():
            continue
        for row in _coerce_json_rows(zf.read(name), file_label=name):
            parsed = _parse_date(row.get("run_date"))
            if parsed is not None:
                run_dates.add(parsed)
    return sorted(run_dates)


def _import_backup_package(content: bytes, db: Session, *, replace_existing: bool = False) -> dict[str, int]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Invalid ZIP file") from exc

    summary: dict[str, int] = {}

    if replace_existing:
        for model in (
            Batch,
            Shortage,
            AuditEntry,
            TruckState,
            LoadDuration,
            Truck,
        ):
            db.execute(delete(model))
        db.flush()

    if "load_durations.json" in zf.namelist():
        rows_data = _coerce_json_rows(zf.read("load_durations.json"), file_label="load_durations.json")
        imported = 0
        for item in rows_data:
            run_date = _parse_date(item.get("run_date"))
            if run_date is None:
                continue
            truck_number = int(item.get("truck_number", 0) or 0)
            duration_seconds = int(item.get("duration_seconds", 0) or 0)
            load_day_num = item.get("load_day_num")
            if not replace_existing:
                existing = db.scalars(
                    select(LoadDuration).where(
                        LoadDuration.truck_number == truck_number,
                        LoadDuration.run_date == run_date,
                        LoadDuration.duration_seconds == duration_seconds,
                        LoadDuration.load_day_num == load_day_num,
                    )
                ).first()
                if existing is not None:
                    continue
            db.add(LoadDuration(
                truck_number=truck_number,
                run_date=run_date,
                duration_seconds=duration_seconds,
                load_day_num=load_day_num,
            ))
            imported += 1
        db.flush()
        summary["load_durations"] = imported

    if "audit_entries.json" in zf.namelist():
        rows_data = _coerce_json_rows(zf.read("audit_entries.json"), file_label="audit_entries.json")
        imported = 0
        for item in rows_data:
            entry_id = str(item.get("id") or "").strip()
            run_date = _parse_date(item.get("run_date"))
            if not entry_id or run_date is None:
                continue
            if not replace_existing and db.get(AuditEntry, entry_id) is not None:
                continue
            db.add(AuditEntry(
                id=entry_id,
                truck_number=int(item.get("truck_number", 0) or 0),
                run_date=run_date,
                item_label=str(item.get("item_label") or ""),
                quantity=int(item.get("quantity", 1) or 1),
                note=str(item.get("note") or ""),
                warn_on_next_load=bool(item.get("warn_on_next_load", False)),
                warning_applied=bool(item.get("warning_applied", False)),
                route_override=item.get("route_override"),
                applied_day_override=item.get("applied_day_override"),
            ))
            imported += 1
        db.flush()
        summary["audit_entries"] = imported

    if "fleet.json" in zf.namelist():
        from models import TruckType
        rows_data = _coerce_json_rows(zf.read("fleet.json"), file_label="fleet.json")
        imported = 0
        updated = 0
        for item in rows_data:
            try:
                truck_number = int(item.get("truck_number", 0) or 0)
                if truck_number <= 0:
                    continue
                existing = db.get(Truck, truck_number)
                truck_type = TruckType(item["truck_type"]) if item.get("truck_type") else TruckType.uniform
                if existing is None:
                    db.add(Truck(
                        truck_number=truck_number,
                        truck_type=truck_type,
                        is_active=bool(item.get("is_active", True)),
                        is_persistent_spare=bool(item.get("is_persistent_spare", False)),
                        is_oos=bool(item.get("is_oos", False)),
                        scheduled_off_days=item.get("scheduled_off_days") or [],
                    ))
                    imported += 1
                else:
                    existing.truck_type = truck_type
                    existing.is_active = bool(item.get("is_active", existing.is_active))
                    existing.is_persistent_spare = bool(item.get("is_persistent_spare", existing.is_persistent_spare))
                    existing.is_oos = bool(item.get("is_oos", existing.is_oos))
                    existing.scheduled_off_days = item.get("scheduled_off_days") or existing.scheduled_off_days
                    updated += 1
            except (KeyError, ValueError):
                continue
        db.flush()
        summary["fleet_imported"] = imported
        summary["fleet_updated"] = updated

    if "truck_states.json" in zf.namelist():
        rows_data = _coerce_json_rows(zf.read("truck_states.json"), file_label="truck_states.json")
        imported = 0
        updated = 0
        for item in rows_data:
            run_date = _parse_date(item.get("run_date"))
            truck_number = int(item.get("truck_number", 0) or 0)
            if run_date is None or truck_number <= 0:
                continue
            existing = db.scalars(
                select(TruckState).where(
                    TruckState.truck_number == truck_number,
                    TruckState.run_date == run_date,
                )
            ).first()
            payload = {
                "status": str(item.get("status") or "dirty"),
                "wearers": int(item.get("wearers", 0) or 0),
                "batch_id": item.get("batch_id"),
                "load_day_num": item.get("load_day_num"),
                "load_start_time": item.get("load_start_time"),
                "load_finish_time": item.get("load_finish_time"),
                "load_duration_seconds": item.get("load_duration_seconds"),
                "off_note": str(item.get("off_note") or ""),
                "shop_note": str(item.get("shop_note") or ""),
                "oos_spare_route": item.get("oos_spare_route"),
                "has_dust_garment": bool(item.get("has_dust_garment", False)),
                "priority_hold": bool(item.get("priority_hold", False)),
                "needs_checked": bool(item.get("needs_checked", False)),
                "arrived_at": item.get("arrived_at"),
                "state_source": str(item.get("state_source") or "workflow"),
            }
            if existing is None:
                db.add(TruckState(truck_number=truck_number, run_date=run_date, **payload))
                imported += 1
            else:
                for key, value in payload.items():
                    setattr(existing, key, value)
                updated += 1
        db.flush()
        summary["truck_states_imported"] = imported
        summary["truck_states_updated"] = updated

    if "shortages.json" in zf.namelist():
        rows_data = _coerce_json_rows(zf.read("shortages.json"), file_label="shortages.json")
        imported = 0
        for item in rows_data:
            run_date = _parse_date(item.get("run_date"))
            truck_number = int(item.get("truck_number", 0) or 0)
            if run_date is None or truck_number <= 0:
                continue
            item_category = str(item.get("item_category") or "")
            item_detail = str(item.get("item_detail") or "")
            quantity = int(item.get("quantity", 1) or 1)
            initials = str(item.get("initials") or "")
            initials_ts = item.get("initials_ts")
            if not replace_existing:
                existing = db.scalars(
                    select(Shortage).where(
                        Shortage.truck_number == truck_number,
                        Shortage.run_date == run_date,
                        Shortage.item_category == item_category,
                        Shortage.item_detail == item_detail,
                        Shortage.quantity == quantity,
                        Shortage.initials == initials,
                    )
                ).first()
                if existing is not None:
                    continue
            db.add(Shortage(
                truck_number=truck_number,
                run_date=run_date,
                item_category=item_category,
                item_detail=item_detail,
                quantity=quantity,
                initials=initials,
                initials_ts=initials_ts,
            ))
            imported += 1
        db.flush()
        summary["shortages"] = imported

    if "batches.json" in zf.namelist():
        rows_data = _coerce_json_rows(zf.read("batches.json"), file_label="batches.json")
        imported = 0
        updated = 0
        for item in rows_data:
            run_date = _parse_date(item.get("run_date"))
            batch_number = int(item.get("batch_number", 0) or 0)
            truck_number = int(item.get("truck_number", 0) or 0)
            if run_date is None or batch_number <= 0 or truck_number <= 0:
                continue
            existing = db.scalars(
                select(Batch).where(
                    Batch.run_date == run_date,
                    Batch.batch_number == batch_number,
                    Batch.truck_number == truck_number,
                )
            ).first()
            if existing is None:
                db.add(Batch(
                    run_date=run_date,
                    batch_number=batch_number,
                    truck_number=truck_number,
                    wearers=int(item.get("wearers", 0) or 0),
                ))
                imported += 1
            else:
                existing.wearers = int(item.get("wearers", 0) or 0)
                updated += 1
        db.flush()
        summary["batches_imported"] = imported
        summary["batches_updated"] = updated

    return summary


def _import_activity_events_payload(payload: bytes, db: Session, *, replace_existing: bool = False) -> dict[str, int]:
    rows_data = _coerce_json_rows(payload, file_label="activity-events.json")
    if replace_existing:
        db.execute(delete(ActivityEvent))
        db.flush()
    imported = 0
    for item in rows_data:
        occurred_at = _parse_datetime(item.get("occurred_at"))
        if occurred_at is None:
            continue
        run_date = _parse_date(item.get("run_date"))
        truck_number = item.get("truck_number")
        summary_text = str(item.get("summary") or "")
        if not replace_existing:
            existing = db.scalars(
                select(ActivityEvent).where(
                    ActivityEvent.occurred_at == occurred_at,
                    ActivityEvent.event_type == str(item.get("event_type") or ""),
                    ActivityEvent.summary == summary_text,
                )
            ).first()
            if existing is not None:
                continue
        db.add(ActivityEvent(
            occurred_at=occurred_at,
            actor_type=str(item.get("actor_type") or "system"),
            actor_username=item.get("actor_username"),
            actor_display_name=item.get("actor_display_name"),
            actor_role=item.get("actor_role"),
            event_family=str(item.get("event_family") or "system"),
            event_type=str(item.get("event_type") or "sync"),
            run_date=run_date,
            truck_number=int(truck_number) if truck_number is not None else None,
            summary=summary_text,
            status_before=item.get("status_before"),
            status_after=item.get("status_after"),
            diff_json=item.get("diff_json") if isinstance(item.get("diff_json"), dict) else {},
            context_json=item.get("context_json") if isinstance(item.get("context_json"), dict) else {},
        ))
        imported += 1
    db.flush()
    return {"activity_events": imported}


def _import_spares_for_dates(run_date_rows: dict[date, list[dict]], db: Session, *, replace_existing: bool = False) -> dict[str, int]:
    imported = 0
    if replace_existing:
        db.execute(delete(SpareAssignment))
        db.flush()
    for run_date, rows in run_date_rows.items():
        for item in rows:
            spare_truck_number = int(item.get("spare_truck_number", 0) or 0)
            covering_route_truck = int(item.get("covering_route_truck", 0) or 0)
            if spare_truck_number <= 0 or covering_route_truck <= 0:
                continue
            db.add(SpareAssignment(
                run_date=run_date,
                spare_truck_number=spare_truck_number,
                covering_route_truck=covering_route_truck,
                returned=bool(item.get("returned", False)),
                assigned_at=_parse_datetime(item.get("assigned_at")) or datetime.utcnow(),
                returned_at=_parse_datetime(item.get("returned_at")),
            ))
            imported += 1
    db.flush()
    return {"spare_assignments": imported}


def _import_route_swaps_for_dates(run_date_rows: dict[date, list[dict]], db: Session, *, replace_existing: bool = False) -> dict[str, int]:
    imported = 0
    if replace_existing:
        db.execute(delete(RouteSwap))
        db.flush()
    for run_date, rows in run_date_rows.items():
        for item in rows:
            route_truck = int(item.get("route_truck", 0) or 0)
            load_on_truck = int(item.get("load_on_truck", 0) or 0)
            if route_truck <= 0 or load_on_truck <= 0:
                continue
            db.add(RouteSwap(
                run_date=run_date,
                route_truck=route_truck,
                load_on_truck=load_on_truck,
                created_at=_parse_datetime(item.get("created_at")) or datetime.utcnow(),
            ))
            imported += 1
    db.flush()
    return {"route_swaps": imported}


def _fetch_remote_bytes(
    url: str,
    *,
    timeout_seconds: int,
    accept: str | None = None,
    auth_token: str | None = None,
) -> bytes:
    req = urllib_request.Request(url, headers={"User-Agent": "ReadyRouteDevSync/1.0"})
    if accept:
        req.add_header("Accept", accept)
    if auth_token:
        req.add_header("Authorization", f"Bearer {auth_token}")
    try:
        with urllib_request.urlopen(req, timeout=timeout_seconds) as response:  # noqa: S310
            return response.read()
    except urllib_error.HTTPError as exc:
        detail = exc.reason if hasattr(exc, "reason") else str(exc)
        raise HTTPException(status_code=502, detail=f"Production fetch failed for {url}: {detail}") from exc
    except urllib_error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Production fetch failed for {url}: {exc.reason}") from exc


def _fetch_production_token(api_root: str, *, timeout_seconds: int) -> str | None:
    """Log into production with the configured dev-sync admin credentials and
    return a fresh JWT access token, or None when no credentials are configured.

    Production export endpoints require an admin Bearer token; the dev sync mints
    one per run so it never has to store an expiring token in .env.
    """
    username = settings.production_sync_username.strip()
    password = settings.production_sync_password
    if not username or not password:
        return None

    token_url = f"{api_root}/auth/token"
    body = urllib_parse.urlencode({"username": username, "password": password}).encode("utf-8")
    req = urllib_request.Request(
        token_url,
        data=body,
        headers={
            "User-Agent": "ReadyRouteDevSync/1.0",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=timeout_seconds) as response:  # noqa: S310
            payload = json.loads(response.read())
    except urllib_error.HTTPError as exc:
        detail = exc.reason if hasattr(exc, "reason") else str(exc)
        raise HTTPException(
            status_code=502,
            detail=f"Production login failed for {token_url}: {detail}. Check PRODUCTION_SYNC_USERNAME / PRODUCTION_SYNC_PASSWORD.",
        ) from exc
    except urllib_error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Production login failed for {token_url}: {exc.reason}") from exc

    token = payload.get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="Production login succeeded but returned no access_token.")
    return token


# ---------------------------------------------------------------------------
# Quick JSON exports
# ---------------------------------------------------------------------------

@router.get("/load-durations.json")
def export_load_durations(_admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> Response:
    rows = db.scalars(
        select(LoadDuration).order_by(LoadDuration.run_date, LoadDuration.truck_number)
    ).all()
    data = [
        {
            "truck_number": r.truck_number,
            "run_date": r.run_date,
            "duration_seconds": r.duration_seconds,
            "load_day_num": r.load_day_num,
            "recorded_at": r.recorded_at,
        }
        for r in rows
    ]
    return _json_response(data, "load_durations.json")


@router.get("/truck-states.json")
def export_truck_states(
    run_date: date | None = Query(default=None, description="Defaults to today if omitted"),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    effective_date = run_date or date.today()
    rows = db.scalars(
        select(TruckState)
        .where(TruckState.run_date == effective_date)
        .order_by(TruckState.truck_number)
    ).all()
    data = [
        {
            "truck_number": r.truck_number,
            "run_date": r.run_date,
            "status": r.status.value if hasattr(r.status, "value") else str(r.status),
            "wearers": r.wearers,
            "batch_id": r.batch_id,
            "load_day_num": r.load_day_num,
            "load_start_time": r.load_start_time,
            "load_finish_time": r.load_finish_time,
            "load_duration_seconds": r.load_duration_seconds,
            "off_note": r.off_note,
            "shop_note": r.shop_note,
            "oos_spare_route": r.oos_spare_route,
            "has_dust_garment": r.has_dust_garment,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]
    fname = f"truck_states_{effective_date}.json"
    return _json_response(data, fname)


@router.get("/audit-entries.json")
def export_audit_entries(
    run_date: date | None = Query(default=None),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    q = select(AuditEntry).order_by(
        AuditEntry.run_date, AuditEntry.truck_number, AuditEntry.recorded_at
    )
    if run_date:
        q = q.where(AuditEntry.run_date == run_date)
    rows = db.scalars(q).all()
    data = [
        {
            "id": r.id,
            "truck_number": r.truck_number,
            "run_date": r.run_date,
            "item_label": r.item_label,
            "quantity": r.quantity,
            "note": r.note,
            "source": r.source.value if hasattr(r.source, "value") else str(r.source),
            "warn_on_next_load": r.warn_on_next_load,
            "warning_applied": r.warning_applied,
            "route_override": r.route_override,
            "applied_day_override": r.applied_day_override,
            "recorded_at": r.recorded_at,
        }
        for r in rows
    ]
    fname = f"audit_entries{'_' + str(run_date) if run_date else ''}.json"
    return _json_response(data, fname)


@router.get("/shortages.json")
def export_shortages(
    run_date: date | None = Query(default=None),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    q = select(Shortage).order_by(
        Shortage.run_date, Shortage.truck_number, Shortage.recorded_at
    )
    if run_date:
        q = q.where(Shortage.run_date == run_date)
    rows = db.scalars(q).all()
    data = [
        {
            "truck_number": r.truck_number,
            "run_date": r.run_date,
            "item_category": r.item_category,
            "item_detail": r.item_detail,
            "quantity": r.quantity,
            "initials": r.initials,
            "recorded_at": r.recorded_at,
        }
        for r in rows
    ]
    fname = f"shortages{'_' + str(run_date) if run_date else ''}.json"
    return _json_response(data, fname)


@router.get("/activity-events.json")
def export_activity_events(
    run_date: date | None = Query(default=None),
    truck_number: int | None = Query(default=None, ge=1, le=999),
    actor_username: str | None = Query(default=None),
    event_family: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    status_before: str | None = Query(default=None),
    status_after: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _viewer=Depends(require_management_access),
) -> Response:
    rows = db.scalars(
        apply_activity_filters(
            select(ActivityEvent),
            run_date=run_date,
            truck_number=truck_number,
            actor_username=actor_username,
            event_family=event_family,
            event_type=event_type,
            status_before=status_before,
            status_after=status_after,
            q=q,
        ).order_by(ActivityEvent.occurred_at.desc(), ActivityEvent.id.desc())
    ).all()
    data = [activity_event_to_dict(row) for row in rows]
    suffix = str(run_date) if run_date else "all"
    return _json_response(data, f"activity_events_{suffix}.json")


# ---------------------------------------------------------------------------
# Backup package  (ZIP of all JSON exports)
# ---------------------------------------------------------------------------

@router.get("/backup.zip")
def download_backup(_admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> StreamingResponse:
    """Download a ZIP archive containing all exportable data as JSON files."""
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:

        # Fleet configuration (trucks)
        fleet_rows = db.scalars(select(Truck).order_by(Truck.truck_number)).all()
        zf.writestr(
            "fleet.json",
            json.dumps(
                [
                    {
                        "truck_number": t.truck_number,
                        "truck_type": t.truck_type.value if hasattr(t.truck_type, "value") else str(t.truck_type),
                        "is_active": t.is_active,
                        "is_persistent_spare": t.is_persistent_spare,
                        "is_oos": t.is_oos,
                        "scheduled_off_days": t.scheduled_off_days,
                    }
                    for t in fleet_rows
                ],
                indent=2,
            ),
        )

        # Load durations
        ld_rows = db.scalars(
            select(LoadDuration).order_by(LoadDuration.run_date)
        ).all()
        zf.writestr(
            "load_durations.json",
            json.dumps(
                [
                    {
                        "truck_number": r.truck_number,
                        "run_date": r.run_date.isoformat(),
                        "duration_seconds": r.duration_seconds,
                        "load_day_num": r.load_day_num,
                        "recorded_at": r.recorded_at.isoformat(),
                    }
                    for r in ld_rows
                ],
                indent=2,
            ),
        )

        # Truck states (all dates)
        ts_rows = db.scalars(
            select(TruckState).order_by(TruckState.run_date, TruckState.truck_number)
        ).all()
        zf.writestr(
            "truck_states.json",
            json.dumps(
                [
                    {
                        "truck_number": r.truck_number,
                        "run_date": r.run_date.isoformat(),
                        "status": r.status.value if hasattr(r.status, "value") else str(r.status),
                        "wearers": r.wearers,
                        "batch_id": r.batch_id,
                        "load_day_num": r.load_day_num,
                        "load_start_time": r.load_start_time,
                        "load_finish_time": r.load_finish_time,
                        "load_duration_seconds": r.load_duration_seconds,
                        "off_note": r.off_note,
                        "shop_note": r.shop_note,
                        "oos_spare_route": r.oos_spare_route,
                        "has_dust_garment": r.has_dust_garment,
                        "priority_hold": r.priority_hold,
                        "needs_checked": r.needs_checked,
                        "arrived_at": r.arrived_at,
                        "state_source": r.state_source,
                        "updated_at": r.updated_at.isoformat(),
                    }
                    for r in ts_rows
                ],
                indent=2,
            ),
        )

        # Audit entries
        ae_rows = db.scalars(
            select(AuditEntry).order_by(AuditEntry.run_date)
        ).all()
        zf.writestr(
            "audit_entries.json",
            json.dumps(
                [
                    {
                        "id": r.id,
                        "truck_number": r.truck_number,
                        "run_date": r.run_date.isoformat(),
                        "item_label": r.item_label,
                        "quantity": r.quantity,
                        "note": r.note,
                        "warning_applied": r.warning_applied,
                        "route_override": r.route_override,
                        "applied_day_override": r.applied_day_override,
                        "warn_on_next_load": r.warn_on_next_load,
                        "recorded_at": r.recorded_at.isoformat(),
                    }
                    for r in ae_rows
                ],
                indent=2,
            ),
        )

        # Shortages
        sh_rows = db.scalars(
            select(Shortage).order_by(Shortage.run_date, Shortage.truck_number)
        ).all()
        zf.writestr(
            "shortages.json",
            json.dumps(
                [
                    {
                        "id": r.id,
                        "truck_number": r.truck_number,
                        "run_date": r.run_date.isoformat(),
                        "item_category": r.item_category,
                        "item_detail": r.item_detail,
                        "quantity": r.quantity,
                        "initials": r.initials,
                        "initials_ts": r.initials_ts,
                        "recorded_at": r.recorded_at.isoformat(),
                    }
                    for r in sh_rows
                ],
                indent=2,
            ),
        )

        # Batches
        b_rows = db.scalars(
            select(Batch).order_by(Batch.run_date)
        ).all()
        zf.writestr(
            "batches.json",
            json.dumps(
                [
                    {
                        "run_date": r.run_date.isoformat(),
                        "batch_number": r.batch_number,
                        "truck_number": r.truck_number,
                        "wearers": r.wearers,
                        "assigned_at": r.assigned_at.isoformat(),
                    }
                    for r in b_rows
                ],
                indent=2,
            ),
        )

        activity_rows = db.scalars(
            select(ActivityEvent).order_by(ActivityEvent.occurred_at, ActivityEvent.id)
        ).all()
        zf.writestr(
            "activity_events.json",
            json.dumps([activity_event_to_dict(row) for row in activity_rows], indent=2),
        )

    buf.seek(0)
    today = date.today().isoformat()
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="readyroute_backup_{today}.zip"'},
    )


# ---------------------------------------------------------------------------
# Import endpoints
# ---------------------------------------------------------------------------

@router.post("/import/load-durations", status_code=status.HTTP_200_OK)
async def import_load_durations(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Import load durations from a JSON array file."""
    content = await file.read()
    try:
        rows_data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc
    if not isinstance(rows_data, list):
        raise HTTPException(status_code=400, detail="Expected a JSON array")

    imported = 0
    for item in rows_data:
        try:
            row = LoadDuration(
                truck_number=int(item["truck_number"]),
                run_date=date.fromisoformat(item["run_date"]),
                duration_seconds=int(item["duration_seconds"]),
                load_day_num=item.get("load_day_num"),
            )
            db.add(row)
            imported += 1
        except (KeyError, ValueError):
            continue
    db.commit()
    return {"imported": imported, "skipped": len(rows_data) - imported}


@router.post("/import/backup", status_code=status.HTTP_200_OK)
async def import_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """
    Import a backup ZIP package produced by GET /exports/backup.zip.
    Restores the core operational tables; existing rows are merged where
    possible to avoid duplicates.
    """
    content = await file.read()
    summary = _import_backup_package(content, db, replace_existing=False)
    zf = zipfile.ZipFile(io.BytesIO(content))
    if "activity_events.json" in zf.namelist():
        summary.update(_import_activity_events_payload(zf.read("activity_events.json"), db, replace_existing=False))
    db.commit()
    return summary


@router.post("/dev/sync-production", status_code=status.HTTP_200_OK)
def sync_from_production(
    request: Request,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
) -> dict:
    """
    Local-development helper that mirrors the live production export into the
    current local database. Hard-blocked unless the request originates from a
    loopback host.
    """
    if not _request_is_localhost(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Production sync is only available from localhost development environments.",
        )

    export_base = settings.production_sync_source_url.rstrip("/")
    timeout_seconds = max(15, int(settings.production_sync_timeout_seconds))
    api_root = export_base.removesuffix("/exports")
    # Production export endpoints require an admin Bearer token; mint a fresh one.
    auth_token = _fetch_production_token(api_root, timeout_seconds=timeout_seconds)
    backup_bytes = _fetch_remote_bytes(
        f"{export_base}/backup.zip", timeout_seconds=timeout_seconds, accept="application/zip", auth_token=auth_token
    )
    run_dates = _extract_backup_run_dates(backup_bytes)

    warnings: list[str] = []
    try:
        activity_bytes = _fetch_remote_bytes(
            f"{export_base}/activity-events.json",
            timeout_seconds=timeout_seconds,
            accept="application/json",
            auth_token=auth_token,
        )
    except HTTPException as exc:
        activity_bytes = b"[]"
        warnings.append(str(exc.detail))

    spares_payload_by_date: dict[date, list[dict]] = {}
    swaps_payload_by_date: dict[date, list[dict]] = {}
    coverage_dates = run_dates[-1:] if run_dates else []
    for run_date in coverage_dates:
        run_date_iso = run_date.isoformat()
        try:
            spares_payload_by_date[run_date] = _coerce_json_rows(
                _fetch_remote_bytes(
                    f"{api_root}/spares?run_date={run_date_iso}",
                    timeout_seconds=timeout_seconds,
                    accept="application/json",
                    auth_token=auth_token,
                ),
                file_label=f"spares_{run_date_iso}.json",
            )
        except HTTPException as exc:
            warnings.append(str(exc.detail))
            spares_payload_by_date[run_date] = []
        try:
            swaps_payload_by_date[run_date] = _coerce_json_rows(
                _fetch_remote_bytes(
                    f"{api_root}/route-swaps?run_date={run_date_iso}",
                    timeout_seconds=timeout_seconds,
                    accept="application/json",
                    auth_token=auth_token,
                ),
                file_label=f"route_swaps_{run_date_iso}.json",
            )
        except HTTPException as exc:
            warnings.append(str(exc.detail))
            swaps_payload_by_date[run_date] = []

    try:
        summary = _import_backup_package(backup_bytes, db, replace_existing=True)
        summary.update(_import_activity_events_payload(activity_bytes, db, replace_existing=True))
        summary.update(_import_spares_for_dates(spares_payload_by_date, db, replace_existing=True))
        summary.update(_import_route_swaps_for_dates(swaps_payload_by_date, db, replace_existing=True))
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "source": export_base,
        "run_dates": [run_date.isoformat() for run_date in run_dates],
        "coverage_run_dates": [run_date.isoformat() for run_date in coverage_dates],
        "backup_bytes": len(backup_bytes),
        "warnings": warnings,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# PostgreSQL backup file management
# ---------------------------------------------------------------------------

_PG_BACKUP_DIR = Path("/app/.data/backups")


def _list_pg_backups() -> list[dict]:
    """Return metadata for all pg_dump SQL backup files, newest first."""
    if not _PG_BACKUP_DIR.exists():
        return []
    files = sorted(
        _PG_BACKUP_DIR.glob("readyroute-*.sql"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    result = []
    for f in files:
        stat = f.stat()
        result.append({
            "filename": f.name,
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    return result


@router.get("/pg-backups")
def list_pg_backups(
    _admin=Depends(require_admin),
) -> list[dict]:
    """List available PostgreSQL pg_dump backup files."""
    return _list_pg_backups()


@router.get("/pg-backups/{filename}")
def download_pg_backup(
    filename: str,
    _admin=Depends(require_admin),
) -> FileResponse:
    """Download a specific pg_dump SQL backup file."""
    # Sanitise: only allow the expected filename pattern
    if not filename.startswith("readyroute-") or not filename.endswith(".sql"):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = _PG_BACKUP_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Backup '{filename}' not found")
    return FileResponse(
        path=str(path),
        media_type="application/sql",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/pg-backups/{filename}", status_code=204)
def delete_pg_backup(
    filename: str,
    _admin=Depends(require_admin),
) -> None:
    """Delete a specific pg_dump SQL backup file."""
    if not filename.startswith("readyroute-") or not filename.endswith(".sql"):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = _PG_BACKUP_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Backup '{filename}' not found")
    path.unlink()

