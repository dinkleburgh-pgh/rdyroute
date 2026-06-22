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

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from ws_manager import manager
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from routers.auth import get_current_user
from models import AuditEntry, AuditPhoto, TruckState, User
from schemas import (
    AnomalyDay,
    AuditEntryCreate,
    AuditEntryOut,
    AuditEntryUpdate,
    AuditPhotoOut,
    QualityRatePoint,
    QualityRateSummary,
    TrendComparison,
    TrendDailyPoint,
    TrendRoutePoint,
    TrendSummary,
    TrendTruckPoint,
)

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
# Available dates
# ---------------------------------------------------------------------------


@router.get("/dates")
def audit_dates(_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.execute(select(AuditEntry.run_date).distinct().order_by(AuditEntry.run_date.desc()))
        .scalars()
        .all()
    )
    return [str(r) for r in rows]


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("/entries", response_model=list[AuditEntryOut])
def list_audit_entries(
    run_date: date | None = Query(default=None),
    truck_number: int | None = Query(default=None),
    warn_only: bool = Query(default=False, description="Return only entries with warn_on_next_load=true"),
    _user: User = Depends(get_current_user),
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
def create_audit_entry(payload: AuditEntryCreate, background_tasks: BackgroundTasks, _user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = AuditEntry(id=uuid.uuid4().hex, **payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    background_tasks.add_task(manager.broadcast, {"type": "audit_updated"})
    return entry


@router.patch("/entries/{entry_id}", response_model=AuditEntryOut)
def update_audit_entry(
    entry_id: str,
    payload: AuditEntryUpdate,
    background_tasks: BackgroundTasks,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    background_tasks.add_task(manager.broadcast, {"type": "audit_updated"})
    return entry


@router.post("/entries/{entry_id}/warning-applied", response_model=AuditEntryOut)
def mark_warning_applied(entry_id: str, _user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark a load-warning as having been seen/actioned by a loader."""
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    entry.warning_applied = True
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_entry(entry_id: str, background_tasks: BackgroundTasks, _user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    db.delete(entry)
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "audit_updated"})


# ---------------------------------------------------------------------------
# Trend / analytics endpoints
# ---------------------------------------------------------------------------

@router.get("/trends/daily")
def audit_daily_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    _user: User = Depends(get_current_user),
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


@router.get("/trends/quality-rate", response_model=QualityRateSummary)
def audit_quality_rate(
    days_back: int = Query(default=14, ge=1, le=365),
    compare_days_back: int | None = Query(default=None, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-day quality metrics: audit entries & qty per loaded truck. Lower = better delivery quality."""
    cutoff = date.today() - timedelta(days=days_back)

    loaded = db.execute(
        select(
            TruckState.run_date,
            func.count(TruckState.id).label("loaded_trucks"),
        )
        .where(
            TruckState.run_date >= cutoff,
            TruckState.status == "loaded",
        )
        .group_by(TruckState.run_date)
        .order_by(TruckState.run_date)
    ).all()
    loaded_map = {r[0]: r[1] for r in loaded}

    audits = db.execute(
        select(
            AuditEntry.run_date,
            func.count(AuditEntry.id).label("entry_count"),
            func.sum(AuditEntry.quantity).label("audit_qty"),
        )
        .where(AuditEntry.run_date >= cutoff)
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()
    audit_map = {r[0]: (r[1], r[2] or 0) for r in audits}

    all_dates = sorted(set(list(loaded_map.keys()) + list(audit_map.keys())))
    series = []
    for d in all_dates:
        lt = loaded_map.get(d, 0)
        ec, aq = audit_map.get(d, (0, 0))
        dr = round(ec / lt, 4) if lt > 0 else None
        ipt = round(aq / lt, 2) if lt > 0 else None
        series.append(QualityRatePoint(run_date=d, loaded_trucks=lt, audit_entry_count=ec, audit_qty=aq, discrepancy_rate=dr, items_per_truck=ipt))

    total_loaded = sum(r.loaded_trucks for r in series)
    total_audit_qty = sum(r.audit_qty for r in series)
    total_audit_entries = sum(r.audit_entry_count for r in series)
    days_with_data = len(series)

    avg_items = round(total_audit_qty / total_loaded, 2) if total_loaded > 0 else None
    avg_dr = round(total_audit_entries / total_loaded, 4) if total_loaded > 0 else None

    mid = len(series) // 2
    if mid >= 2 and len(series) >= 4:
        first_half = sum(s.items_per_truck or 0 for s in series[:mid])
        second_half = sum(s.items_per_truck or 0 for s in series[mid:])
        if first_half > 0:
            change = ((second_half - first_half) / first_half) * 100
            # lower items_per_truck = improvement, so flip polarity
            trend_direction = "down" if change > 5 else ("up" if change < -5 else "stable")
        else:
            trend_direction = "stable"
    else:
        trend_direction = "stable"

    change_vs_prior_pct = None
    if compare_days_back and days_back > 0:
        prior_cutoff = cutoff - timedelta(days=compare_days_back)
        prior_cutoff_end = cutoff - timedelta(days=1)
        prior_loaded = db.execute(
            select(func.count(TruckState.id))
            .where(
                TruckState.run_date >= prior_cutoff,
                TruckState.run_date <= prior_cutoff_end,
                TruckState.status == "loaded",
            )
        ).scalar() or 0
        prior_audit_qty = db.execute(
            select(func.sum(AuditEntry.quantity))
            .where(
                AuditEntry.run_date >= prior_cutoff,
                AuditEntry.run_date <= prior_cutoff_end,
            )
        ).scalar() or 0
        if prior_loaded > 0 and avg_items:
            prior_avg = prior_audit_qty / prior_loaded
            change_vs_prior_pct = round(((avg_items - prior_avg) / prior_avg) * 100, 1)

    return QualityRateSummary(
        avg_items_per_truck=avg_items,
        avg_discrepancy_rate=avg_dr,
        days_with_data=days_with_data,
        trend_direction=trend_direction,
        change_vs_prior_pct=change_vs_prior_pct,
        daily_series=series,
    )


@router.get("/trends/by-route")
def audit_by_route(
    days_back: int = Query(default=30, ge=1, le=365),
    _user: User = Depends(get_current_user),
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
    _user: User = Depends(get_current_user),
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


@router.get("/trends/summary")
def trend_summary(
    days_back: int = Query(default=14, ge=1, le=365),
    compare_days_back: int | None = Query(default=None, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Consolidated KPI summary with optional prior-period comparison."""
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

    daily_series = [
        TrendDailyPoint(run_date=r.run_date, total_qty=r.total_qty, entry_count=r.entry_count)
        for r in rows
    ]
    total_qty = sum(r.total_qty for r in rows)
    entry_count = sum(r.entry_count for r in rows)
    days_with_data = len(rows)
    avg_per_day = round(total_qty / days_with_data, 1) if days_with_data else 0.0

    peak = max(rows, key=lambda r: r.total_qty) if rows else None
    peak_day = peak.run_date if peak else None
    peak_qty = peak.total_qty if peak else 0

    # Simple trend: compare first half vs second half of the period
    mid = len(daily_series) // 2
    if mid >= 2 and len(daily_series) >= 4:
        first_half = sum(d.total_qty for d in daily_series[:mid])
        second_half = sum(d.total_qty for d in daily_series[mid:])
        change = ((second_half - first_half) / first_half) * 100
        trend_direction = "up" if change > 5 else ("down" if change < -5 else "stable")
    else:
        change = None
        trend_direction = "stable"

    # Prior-period comparison
    change_vs_prior_pct = None
    if compare_days_back and days_back > 0:
        prior_cutoff = cutoff - timedelta(days=compare_days_back)
        prior_cutoff_end = cutoff - timedelta(days=1)
        prior_rows = db.execute(
            select(func.sum(AuditEntry.quantity).label("total_qty"))
            .where(
                AuditEntry.run_date >= prior_cutoff,
                AuditEntry.run_date <= prior_cutoff_end,
            )
        ).scalar()
        if prior_rows and total_qty > 0:
            change_vs_prior_pct = round(
                ((total_qty - prior_rows) / prior_rows) * 100, 1
            )

    return TrendSummary(
        total_qty=total_qty,
        avg_per_day=avg_per_day,
        peak_day=peak_day,
        peak_qty=peak_qty,
        entry_count=entry_count,
        days_with_data=days_with_data,
        trend_direction=trend_direction,
        change_vs_prior_pct=change_vs_prior_pct,
        daily_series=daily_series,
    )


@router.get("/trends/by-truck/{truck_number}")
def trend_by_truck(
    truck_number: int,
    days_back: int = Query(default=30, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Daily trend for a single truck."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(
            AuditEntry.truck_number == truck_number,
            AuditEntry.run_date >= cutoff,
        )
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()
    return [
        TrendTruckPoint(run_date=r.run_date, total_qty=r.total_qty) for r in rows
    ]


@router.get("/trends/by-route/{route_number}")
def trend_by_route(
    route_number: int,
    days_back: int = Query(default=30, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Daily trend for a single route."""
    cutoff = date.today() - timedelta(days=days_back)
    route_expr = func.coalesce(AuditEntry.route_override, AuditEntry.truck_number)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(
            route_expr == route_number,
            AuditEntry.run_date >= cutoff,
        )
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()
    return [
        TrendRoutePoint(run_date=r.run_date, total_qty=r.total_qty) for r in rows
    ]


@router.get("/trends/comparison")
def trend_comparison(
    days_back: int = Query(default=14, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Split current period in half for side-by-side trend comparison."""
    total_days = days_back
    half = total_days // 2
    today = date.today()

    # Current half (most recent)
    cur_cutoff = today - timedelta(days=half)
    cur_rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(
            AuditEntry.run_date >= cur_cutoff,
            AuditEntry.run_date <= today,
        )
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()

    # Prior half
    pri_cutoff = today - timedelta(days=total_days)
    pri_cutoff_end = today - timedelta(days=half + 1)
    pri_rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(
            AuditEntry.run_date >= pri_cutoff,
            AuditEntry.run_date <= pri_cutoff_end,
        )
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()

    return TrendComparison(
        current=[TrendDailyPoint(run_date=r.run_date, total_qty=r.total_qty, entry_count=r.entry_count) for r in cur_rows],
        prior=[TrendDailyPoint(run_date=r.run_date, total_qty=r.total_qty, entry_count=r.entry_count) for r in pri_rows],
    )


@router.get("/active-warnings")
def active_warnings(
    run_date: date = Query(...),
    _user: User = Depends(get_current_user),
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
    _user: User = Depends(get_current_user),
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
    _user: User = Depends(get_current_user),
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
def download_audit_photo(photo_id: str, _user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(AuditPhoto, photo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = Path(row.stored_path)
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Stored file missing")
    return FileResponse(path, media_type=row.mime_type, filename=row.file_name)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_photo(photo_id: str, _user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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


@router.get("/trends/anomalies", response_model=list[AnomalyDay])
def audit_anomalies(
    days_back: int = Query(default=90, ge=14, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Days where audit volume diverges >2σ from the mean."""
    from statistics import mean, stdev
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(AuditEntry.run_date >= cutoff)
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()

    anomalies: list[AnomalyDay] = []
    if len(rows) < 7:
        return anomalies

    volumes = [r[1] for r in rows]
    m = mean(volumes)
    s = stdev(volumes) if len(volumes) > 1 else 1

    for r in rows:
        z = (r[1] - m) / s if s else 0
        if abs(z) > 2:
            anomalies.append(AnomalyDay(
                run_date=r[0],
                metric="audit_volume",
                value=round(r[1], 1),
                mean=round(m, 1),
                sigma=round(s, 2),
                z_score=round(z, 2),
            ))

    return sorted(anomalies, key=lambda a: a.run_date, reverse=True)
