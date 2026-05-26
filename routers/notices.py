"""
Router: /notices

Operational notices shown in the Run Day banner.
Admins (fleet/atl) create/update/delete; everyone can read active notices.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from database import get_db
from models import Notice, User
from routers.auth import get_current_user, require_admin
from schemas import NoticeCreate, NoticeOut, NoticeUpdate

router = APIRouter(prefix="/notices", tags=["notices"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("", response_model=list[NoticeOut])
def list_notices(
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    q = select(Notice).order_by(Notice.created_at.desc())
    if active_only:
        now = _now()
        q = q.where(
            Notice.is_active == True,
            or_(Notice.expires_at.is_(None), Notice.expires_at > now),
        )
    return db.scalars(q).all()


@router.post("", response_model=NoticeOut, status_code=status.HTTP_201_CREATED)
def create_notice(
    payload: NoticeCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    notice = Notice(**payload.model_dump(), created_by=current_user.username)
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return notice


@router.patch("/{notice_id}", response_model=NoticeOut)
def update_notice(
    notice_id: int,
    payload: NoticeUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    notice = db.get(Notice, notice_id)
    if notice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notice not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(notice, field, value)
    db.commit()
    db.refresh(notice)
    return notice


@router.delete("/{notice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notice(
    notice_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    notice = db.get(Notice, notice_id)
    if notice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notice not found")
    db.delete(notice)
    db.commit()
