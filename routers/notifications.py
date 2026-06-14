from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import asdict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db, settings
from models import PushSubscription, User
from notification_service import NotificationEvent, dispatch_notification, notifications_configured
from routers.auth import get_current_user
from schemas import (
    NotificationConfigOut,
    NotificationEventOut,
    NotificationPublicKeyOut,
    NotificationTestRequest,
    PushSubscriptionCreate,
    PushSubscriptionOut,
    PushSubscriptionRemove,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/status", response_model=NotificationConfigOut)
def get_notification_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subscription_count = db.scalar(
        select(func.count(PushSubscription.id)).where(
            PushSubscription.user_id == current_user.id,
            PushSubscription.is_active == True,
        )
    ) or 0
    return NotificationConfigOut(
        configured=notifications_configured(),
        subscription_count=subscription_count,
    )


@router.get("/public-key", response_model=NotificationPublicKeyOut)
def get_public_key(
    _current_user: User = Depends(get_current_user),
):
    configured = notifications_configured()
    if not configured:
        return NotificationPublicKeyOut(configured=False, public_key=None)
    return NotificationPublicKeyOut(
        configured=True,
        public_key=settings.web_push_vapid_public_key,
    )


@router.post("/subscribe", response_model=PushSubscriptionOut, status_code=status.HTTP_201_CREATED)
def subscribe(
    payload: PushSubscriptionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not notifications_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Push notifications are not configured")

    row = db.scalars(
        select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    ).first()
    if row is None:
        row = PushSubscription(
            user_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
        db.add(row)

    row.user_id = current_user.id
    row.p256dh = payload.keys.p256dh
    row.auth = payload.keys.auth
    row.device_label = payload.device_label
    row.user_agent = payload.user_agent or request.headers.get("user-agent")
    row.is_active = True
    row.last_seen_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(row)
    return row


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: PushSubscriptionRemove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.scalars(
        select(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint,
            PushSubscription.user_id == current_user.id,
        )
    ).first()
    if row is None:
        return None
    row.is_active = False
    row.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return None


@router.post("/test", response_model=NotificationEventOut)
def send_test_notification(
    background_tasks: BackgroundTasks,
    payload: NotificationTestRequest | None = None,
    current_user: User = Depends(get_current_user),
):
    event = NotificationEvent(
        type="test",
        title="ReadyRoute notifications enabled",
        body="This device is subscribed to ReadyRoute push notifications.",
        tag="notification-test",
        url="/fleet",
    )
    background_tasks.add_task(
        dispatch_notification,
        event,
        user_id=current_user.id,
        endpoint=payload.endpoint if payload else None,
    )
    return NotificationEventOut.model_validate(asdict(event))
