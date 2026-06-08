"""
Router: /exports

Data export and import utilities.  Lets admins download historical data as
JSON files or a full backup ZIP archive.  Import endpoints allow restoring
those files into the V2 database.

Also provides endpoints for managing pg_dump SQL backup files written by
the background backup_loop() task.
"""

import io
import json
import os
import zipfile
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AuditEntry, Batch, BatchHistory, LoadDuration, Shortage, Truck, TruckState
from routers.auth import require_admin

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


# ---------------------------------------------------------------------------
# Quick JSON exports
# ---------------------------------------------------------------------------

@router.get("/load-durations.json")
def export_load_durations(db: Session = Depends(get_db)) -> Response:
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


# ---------------------------------------------------------------------------
# Backup package  (ZIP of all JSON exports)
# ---------------------------------------------------------------------------

@router.get("/backup.zip")
def download_backup(db: Session = Depends(get_db)) -> StreamingResponse:
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
                        "load_duration_seconds": r.load_duration_seconds,
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
                        "truck_number": r.truck_number,
                        "run_date": r.run_date.isoformat(),
                        "item_category": r.item_category,
                        "item_detail": r.item_detail,
                        "quantity": r.quantity,
                        "initials": r.initials,
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
                    }
                    for r in b_rows
                ],
                indent=2,
            ),
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
    Load durations and audit entries are restored; existing entries are
    skipped to avoid duplicates.
    """
    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Invalid ZIP file") from exc

    summary: dict[str, int] = {}

    # Load durations
    if "load_durations.json" in zf.namelist():
        rows_data = json.loads(zf.read("load_durations.json"))
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
        db.flush()
        summary["load_durations"] = imported

    # Audit entries (skip rows whose UUID already exists)
    if "audit_entries.json" in zf.namelist():
        rows_data = json.loads(zf.read("audit_entries.json"))
        imported = 0
        for item in rows_data:
            try:
                entry_id = item["id"]
                if db.get(AuditEntry, entry_id) is not None:
                    continue
                row = AuditEntry(
                    id=entry_id,
                    truck_number=int(item["truck_number"]),
                    run_date=date.fromisoformat(item["run_date"]),
                    item_label=item["item_label"],
                    quantity=int(item.get("quantity", 1)),
                    note=item.get("note", ""),
                    warn_on_next_load=bool(item.get("warn_on_next_load", False)),
                )
                db.add(row)
                imported += 1
            except (KeyError, ValueError):
                continue
        db.flush()
        summary["audit_entries"] = imported

    # Fleet (upsert — create if new, update fields if already present)
    if "fleet.json" in zf.namelist():
        from models import TruckType
        rows_data = json.loads(zf.read("fleet.json"))
        imported = skipped = 0
        for item in rows_data:
            try:
                truck_number = int(item["truck_number"])
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
                    skipped += 1
            except (KeyError, ValueError):
                continue
        db.flush()
        summary["fleet_imported"] = imported
        summary["fleet_updated"] = skipped

    db.commit()
    return summary


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

