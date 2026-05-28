"""
Router: /audit

Audit entry management and trend reporting.

V1 mapping:
  audit_history.json          →  AuditEntry rows
  _append_audit_history_entry →  POST /audit/entries
  _delete_audit_history_entry →  DELETE /audit/entries/{id}
  _mark_audit_warning_applied →  PATCH /audit/entries/{id}/warning-applied
  _audit_trend_rows           →  GET  /audit/trends
  _audit_route_category_rows  →  GET  /audit/trends/by-route
  _audit_truck_category_rows  →  GET  /audit/trends/by-truck
"""

import mimetypes
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models import AuditEntry, AuditPhoto
from schemas import AuditEntryCreate, AuditEntryOut, AuditEntryUpdate, AuditPhotoOut

router = APIRouter(prefix="/audit", tags=["audit"])

# Photos are written to disk so the SQLite row stays small.
# In production the backend data volume is mounted at /app/.data — photos live
# there so they survive repulls.  In local dev (no /app/.data) falls back to
# ./audit_photos relative to cwd.  Override any time with AUDIT_PHOTOS_DIR.
_PHOTO_ROOT = Path(
    os.environ.get(
        "AUDIT_PHOTOS_DIR",
        "/app/.data/audit_photos" if Path("/app/.data").exists() else "./audit_photos",
    )
).resolve()
_MAX_PHOTO_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"}


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("/entries", response_model=list[AuditEntryOut])
def list_audit_entries(
    run_date: date | None = Query(default=None),
    truck_number: int | None = Query(default=None),
    warn_only: bool = Query(default=False, description="Return only entries with warn_on_next_load=true"),
    db: Session = Depends(get_db),
):
    q = select(AuditEntry).order_by(AuditEntry.recorded_at.desc())
    if run_date:
        q = q.where(AuditEntry.run_date == run_date)
    if truck_number is not None:
        q = q.where(AuditEntry.truck_number == truck_number)
    if warn_only:
        q = q.where(AuditEntry.warn_on_next_load == True, AuditEntry.warning_applied == False)
    return db.scalars(q).all()


@router.post("/entries", response_model=AuditEntryOut, status_code=status.HTTP_201_CREATED)
def create_audit_entry(payload: AuditEntryCreate, db: Session = Depends(get_db)):
    entry = AuditEntry(id=uuid.uuid4().hex, **payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/entries/{entry_id}", response_model=AuditEntryOut)
def update_audit_entry(
    entry_id: str,
    payload: AuditEntryUpdate,
    db: Session = Depends(get_db),
):
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/entries/{entry_id}/warning-applied", response_model=AuditEntryOut)
def mark_warning_applied(entry_id: str, db: Session = Depends(get_db)):
    """Mark a load-warning as having been seen/actioned by a loader."""
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    entry.warning_applied = True
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_entry(entry_id: str, db: Session = Depends(get_db)):
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    db.delete(entry)
    db.commit()


# ---------------------------------------------------------------------------
# Trend / analytics endpoints
# ---------------------------------------------------------------------------

@router.get("/trends/daily")
def audit_daily_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """
    Return total quantities removed per day over the last *days_back* days.
    Mirrors _audit_trend_rows from V1.
    """
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(AuditEntry.run_date >= cutoff)
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()
    return [{"run_date": r.run_date, "total_qty": r.total_qty, "entry_count": r.entry_count} for r in rows]


@router.get("/trends/by-route")
def audit_by_route(
    days_back: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """
    Quantities removed grouped by (route_override / truck_number, item_label).
    Mirrors _audit_route_category_rows from V1.
    """
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            func.coalesce(AuditEntry.route_override, AuditEntry.truck_number).label("route"),
            AuditEntry.item_label,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(AuditEntry.run_date >= cutoff)
        .group_by("route", AuditEntry.item_label)
        .order_by("route", AuditEntry.item_label)
    ).all()
    return [{"route": r.route, "item_label": r.item_label, "total_qty": r.total_qty} for r in rows]


@router.get("/trends/by-truck")
def audit_by_truck(
    days_back: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """
    Quantities removed grouped by (truck_number, item_label).
    Mirrors _audit_truck_category_rows from V1.
    """
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            AuditEntry.truck_number,
            AuditEntry.item_label,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(AuditEntry.run_date >= cutoff)
        .group_by(AuditEntry.truck_number, AuditEntry.item_label)
        .order_by(AuditEntry.truck_number, AuditEntry.item_label)
    ).all()
    return [{"truck_number": r.truck_number, "item_label": r.item_label, "total_qty": r.total_qty} for r in rows]


@router.get("/active-warnings")
def active_warnings(
    run_date: date = Query(...),
    db: Session = Depends(get_db),
):
    """
    Return all unacknowledged load-warning entries for a run-date, grouped by truck.
    Used by the loader workflow to surface warnings before starting a truck.
    """
    rows = db.scalars(
        select(AuditEntry).where(
            AuditEntry.run_date == run_date,
            AuditEntry.warn_on_next_load == True,
            AuditEntry.warning_applied == False,
        ).order_by(AuditEntry.truck_number, AuditEntry.recorded_at)
    ).all()

    grouped: dict[int, list] = {}
    for row in rows:
        grouped.setdefault(row.truck_number, []).append(AuditEntryOut.model_validate(row))
    return grouped


# ---------------------------------------------------------------------------
# Audit photos
# ---------------------------------------------------------------------------

@router.get("/photos", response_model=list[AuditPhotoOut])
def list_audit_photos(
    run_date: date | None = Query(default=None),
    truck_number: int | None = Query(default=None),
    entry_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = select(AuditPhoto).order_by(AuditPhoto.uploaded_at.desc())
    if run_date:
        q = q.where(AuditPhoto.run_date == run_date)
    if truck_number is not None:
        q = q.where(AuditPhoto.truck_number == truck_number)
    if entry_id:
        q = q.where(AuditPhoto.entry_id == entry_id)
    return db.scalars(q).all()


@router.post("/photos", response_model=AuditPhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_audit_photo(
    truck_number: int = Form(...),
    run_date: date = Form(...),
    entry_id: str | None = Form(default=None),
    caption: str = Form(default=""),
    uploaded_by: str = Form(default=""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a photo attached to an audit (optionally tied to an entry)."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file upload")
    if len(content) > _MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_PHOTO_BYTES // (1024*1024)} MB limit")

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    if mime not in _ALLOWED_PHOTO_MIME:
        raise HTTPException(status_code=415, detail=f"Unsupported mime: {mime}")

    if entry_id is not None and db.get(AuditEntry, entry_id) is None:
        raise HTTPException(status_code=404, detail=f"Audit entry {entry_id} not found")

    photo_id = uuid.uuid4().hex
    ext = Path(file.filename or "").suffix.lower() or mimetypes.guess_extension(mime) or ".bin"
    day_dir = _PHOTO_ROOT / run_date.isoformat()
    day_dir.mkdir(parents=True, exist_ok=True)
    dest = day_dir / f"{photo_id}{ext}"
    dest.write_bytes(content)

    row = AuditPhoto(
        id=photo_id,
        truck_number=truck_number,
        run_date=run_date,
        entry_id=entry_id,
        file_name=file.filename or f"{photo_id}{ext}",
        stored_path=str(dest),
        mime_type=mime,
        size_bytes=len(content),
        caption=caption,
        uploaded_by=uploaded_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/photos/{photo_id}/file")
def download_audit_photo(photo_id: str, db: Session = Depends(get_db)):
    row = db.get(AuditPhoto, photo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = Path(row.stored_path)
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Stored file missing")
    return FileResponse(path, media_type=row.mime_type, filename=row.file_name)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_photo(photo_id: str, db: Session = Depends(get_db)):
    row = db.get(AuditPhoto, photo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        Path(row.stored_path).unlink(missing_ok=True)
    except OSError:
        # File is gone but row still needs to be removed.
        pass
    db.delete(row)
    db.commit()
