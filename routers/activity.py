from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from activity_log import apply_activity_filters
from database import get_db
from models import ActivityEvent, User
from routers.auth import require_management_access
from schemas import ActivityEventPageOut

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("/events", response_model=ActivityEventPageOut)
def list_activity_events(
    run_date: date | None = Query(default=None),
    truck_number: int | None = Query(default=None, ge=1, le=999),
    actor_username: str | None = Query(default=None),
    event_family: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    status_before: str | None = Query(default=None),
    status_after: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _viewer: User = Depends(require_management_access),
):
    filtered = apply_activity_filters(
        select(ActivityEvent),
        run_date=run_date,
        truck_number=truck_number,
        actor_username=actor_username,
        event_family=event_family,
        event_type=event_type,
        status_before=status_before,
        status_after=status_after,
        q=q,
    )
    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    rows = db.scalars(
        filtered.order_by(ActivityEvent.occurred_at.desc(), ActivityEvent.id.desc()).limit(limit).offset(offset)
    ).all()
    return ActivityEventPageOut(items=rows, total=total, limit=limit, offset=offset)
