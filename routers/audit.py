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
from routers.auth import get_current_user, require_non_guest
from routers.trends_common import (
    completed_load_filter,
    half_split_change,
    prior_bounds,
    window_bounds,
)
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
def create_audit_entry(payload: AuditEntryCreate, background_tasks: BackgroundTasks, _user: User = Depends(require_non_guest), db: Session = Depends(get_db)):
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
    _user: User = Depends(require_non_guest),
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
def mark_warning_applied(entry_id: str, _user: User = Depends(require_non_guest), db: Session = Depends(get_db)):
    """Mark a load-warning as having been seen/actioned by a loader."""
    entry = db.get(AuditEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    entry.warning_applied = True
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_entry(entry_id: str, background_tasks: BackgroundTasks, _user: User = Depends(require_non_guest), db: Session = Depends(get_db)):
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
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(AuditEntry.run_date >= start, AuditEntry.run_date <= end)
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
    """Per-day quality metrics: audit entries & qty per truck that completed
    loading. Lower = better delivery quality."""
    start, end = window_bounds(days_back)

    loaded = db.execute(
        select(
            TruckState.run_date,
            func.count(TruckState.id).label("loaded_trucks"),
        )
        .where(
            TruckState.run_date >= start,
            TruckState.run_date <= end,
            completed_load_filter(),
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
        .where(AuditEntry.run_date >= start, AuditEntry.run_date <= end)
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

    # Trend over items-per-truck (lower is better, so polarity is flipped).
    change = half_split_change([(s.run_date, s.items_per_truck or 0) for s in series], days_back)
    if change is None:
        trend_direction = "stable"
    else:
        trend_direction = "down" if change > 5 else ("up" if change < -5 else "stable")

    change_vs_prior_pct = None
    if compare_days_back and days_back > 0:
        p_start, p_end = prior_bounds(days_back)
        prior_loaded = db.execute(
            select(func.count(TruckState.id))
            .where(
                TruckState.run_date >= p_start,
                TruckState.run_date <= p_end,
                completed_load_filter(),
            )
        ).scalar() or 0
        prior_audit_qty = db.execute(
            select(func.sum(AuditEntry.quantity))
            .where(
                AuditEntry.run_date >= p_start,
                AuditEntry.run_date <= p_end,
            )
        ).scalar() or 0
        if prior_loaded > 0 and avg_items is not None:
            prior_avg = prior_audit_qty / prior_loaded
            if prior_avg > 0:
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
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            func.coalesce(AuditEntry.route_override, AuditEntry.truck_number).label("route"),
            AuditEntry.item_label,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(AuditEntry.run_date >= start, AuditEntry.run_date <= end)
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
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            AuditEntry.truck_number,
            AuditEntry.item_label,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(AuditEntry.run_date >= start, AuditEntry.run_date <= end)
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
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(AuditEntry.run_date >= start, AuditEntry.run_date <= end)
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

    # Trend: newer half vs older half of the window (equal calendar halves).
    change = half_split_change([(d.run_date, d.total_qty) for d in daily_series], days_back)
    if change is None:
        trend_direction = "stable"
    else:
        trend_direction = "up" if change > 5 else ("down" if change < -5 else "stable")

    # Prior-period comparison over the equal-width window immediately before this
    # one. Computed whenever the prior period had data, so a drop to 0 shows -100%.
    change_vs_prior_pct = None
    if compare_days_back and days_back > 0:
        p_start, p_end = prior_bounds(days_back)
        prior_total = db.execute(
            select(func.sum(AuditEntry.quantity))
            .where(
                AuditEntry.run_date >= p_start,
                AuditEntry.run_date <= p_end,
            )
        ).scalar() or 0
        if prior_total > 0:
            change_vs_prior_pct = round(((total_qty - prior_total) / prior_total) * 100, 1)

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
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(
            AuditEntry.truck_number == truck_number,
            AuditEntry.run_date >= start,
            AuditEntry.run_date <= end,
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
    start, end = window_bounds(days_back)
    route_expr = func.coalesce(AuditEntry.route_override, AuditEntry.truck_number)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(
            route_expr == route_number,
            AuditEntry.run_date >= start,
            AuditEntry.run_date <= end,
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
    """Split the window into equal calendar halves for side-by-side comparison."""
    start, end = window_bounds(days_back)
    half = days_back // 2
    mid = start + timedelta(days=half)
    # Older (prior) half [start, mid-1]; newer (current) half from mid (even) or
    # mid+1 (odd — the middle date is dropped so the halves are equal width).
    pri_start, pri_end = start, mid - timedelta(days=1)
    cur_start = mid if days_back % 2 == 0 else mid + timedelta(days=1)
    cur_end = end

    cur_rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(
            AuditEntry.run_date >= cur_start,
            AuditEntry.run_date <= cur_end,
        )
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()

    pri_rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
            func.count(AuditEntry.id).label("entry_count"),
        )
        .where(
            AuditEntry.run_date >= pri_start,
            AuditEntry.run_date <= pri_end,
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
    _user: User = Depends(require_non_guest),
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
def delete_audit_photo(photo_id: str, _user: User = Depends(require_non_guest), db: Session = Depends(get_db)):
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
    """Days where audit volume diverges >2σ from the rest of the window
    (leave-one-out: each day is excluded from its own mean/σ)."""
    from statistics import mean, stdev

    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            AuditEntry.run_date,
            func.sum(AuditEntry.quantity).label("total_qty"),
        )
        .where(AuditEntry.run_date >= start, AuditEntry.run_date <= end)
        .group_by(AuditEntry.run_date)
        .order_by(AuditEntry.run_date)
    ).all()

    anomalies: list[AnomalyDay] = []
    if len(rows) < 7:
        return anomalies

    series = [(r[0], float(r[1])) for r in rows]
    for run_date, value in series:
        others = [v for (rd, v) in series if rd != run_date]
        if len(others) < 2:
            continue
        m = mean(others)
        s = stdev(others)
        if not s:
            continue
        z = (value - m) / s
        if abs(z) > 2:
            anomalies.append(AnomalyDay(
                run_date=run_date,
                metric="audit_volume",
                value=round(value, 1),
                mean=round(m, 1),
                sigma=round(s, 2),
                z_score=round(z, 2),
            ))

    return sorted(anomalies, key=lambda a: a.run_date, reverse=True)
