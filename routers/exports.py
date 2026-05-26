"""
Router: /exports

Data export and import utilities.  Lets admins download historical data as
JSON files or a full backup ZIP archive.  Import endpoints allow restoring
those files into the V2 database.
"""

import io
import json
import zipfile
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AuditEntry, Batch, BatchHistory, LoadDuration, Shortage, TruckState

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

    db.commit()
    return summary
