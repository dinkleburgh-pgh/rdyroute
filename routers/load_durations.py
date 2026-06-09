"""
Router: /load-durations

Append-only load-timing records used for pace estimate calculations.

V1 mapping:
  load_durations.json         →  LoadDuration rows
  append_load_duration        →  POST /load-durations
  load_duration_history       →  GET  /load-durations
  _pace_recent_average_seconds →  GET  /load-durations/pace-average
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models import LoadDuration
from schemas import LoadDurationCreate, LoadDurationOut, PaceDailyPoint

router = APIRouter(prefix="/load-durations", tags=["load-durations"])

_DEFAULT_LOOKBACK_DAYS = 30
_MIN_VALID_SECONDS = 30
_MAX_VALID_SECONDS = 7200


@router.get("", response_model=list[LoadDurationOut])
def list_durations(
    run_date: date | None = Query(default=None),
    truck_number: int | None = Query(default=None),
    days_back: int = Query(default=_DEFAULT_LOOKBACK_DAYS, ge=1, le=365),
    db: Session = Depends(get_db),
):
    cutoff = date.today() - timedelta(days=days_back)
    q = select(LoadDuration).where(LoadDuration.run_date >= cutoff)
    if run_date:
        q = q.where(LoadDuration.run_date == run_date)
    if truck_number is not None:
        q = q.where(LoadDuration.truck_number == truck_number)
    return db.scalars(q.order_by(LoadDuration.recorded_at.desc())).all()


@router.post("", response_model=LoadDurationOut, status_code=status.HTTP_201_CREATED)
def record_duration(payload: LoadDurationCreate, db: Session = Depends(get_db)):
    row = LoadDuration(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/pace-average")
def pace_average(
    lookback_days: int = Query(default=_DEFAULT_LOOKBACK_DAYS, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """
    Compute the average load duration in seconds over the last *lookback_days* days,
    excluding abnormally short (<120 s) or long (>1800 s) records.
    Mirrors _pace_recent_average_seconds from V1.
    """
    cutoff = date.today() - timedelta(days=lookback_days)
    result = db.execute(
        select(func.avg(LoadDuration.duration_seconds).label("avg_seconds"))
        .where(
            LoadDuration.run_date >= cutoff,
            LoadDuration.duration_seconds >= 120,
            LoadDuration.duration_seconds <= 1800,
        )
    ).scalar_one_or_none()

    return {
        "avg_seconds": round(result) if result is not None else None,
        "lookback_days": lookback_days,
    }


@router.delete("/purge-abnormal", status_code=status.HTTP_200_OK)
def purge_abnormal(
    min_seconds: int = Query(default=120, ge=1),
    max_seconds: int = Query(default=1800, le=86400),
    db: Session = Depends(get_db),
):
    """
    Remove load duration records outside the valid range.
    Mirrors remove_abnormal_loadtimes from V1.
    """
    from sqlalchemy import delete

    total_before = db.scalar(select(func.count()).select_from(LoadDuration))
    db.execute(
        delete(LoadDuration).where(
            (LoadDuration.duration_seconds < min_seconds)
            | (LoadDuration.duration_seconds > max_seconds)
        )
    )
    db.commit()
    total_after = db.scalar(select(func.count()).select_from(LoadDuration))
    removed = (total_before or 0) - (total_after or 0)
    return {"removed": removed, "remaining": total_after}


@router.get("/trends/daily", response_model=list[PaceDailyPoint])
def load_pace_daily_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Per-day average load duration over the last N days (excluding <30s / >7200s)."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.execute(
        select(
            LoadDuration.run_date,
            func.avg(LoadDuration.duration_seconds).label("avg_seconds"),
            func.count(LoadDuration.id).label("load_count"),
        )
        .where(
            LoadDuration.run_date >= cutoff,
            LoadDuration.duration_seconds >= _MIN_VALID_SECONDS,
            LoadDuration.duration_seconds <= _MAX_VALID_SECONDS,
        )
        .group_by(LoadDuration.run_date)
        .order_by(LoadDuration.run_date)
    ).all()
    return [PaceDailyPoint(run_date=r[0], avg_seconds=round(r[1], 1) if r[1] else 0, load_count=r[2]) for r in rows]
