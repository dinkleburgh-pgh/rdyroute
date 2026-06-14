from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select

from database import SessionLocal, settings
from models import PushSubscription
from ws_manager import manager

log = logging.getLogger(__name__)


@dataclass(slots=True)
class NotificationEvent:
    type: str
    title: str
    body: str
    tag: str
    url: str
    truck_number: int | None = None
    route_truck: int | None = None
    covering_truck: int | None = None
    run_date: str | None = None


def notifications_configured() -> bool:
    return bool(
        settings.web_push_vapid_public_key
        and settings.web_push_vapid_private_key
        and settings.web_push_vapid_subject
    )


def truck_hold_notification(*, truck_number: int, run_date: date) -> NotificationEvent:
    return NotificationEvent(
        type="truck_hold",
        title=f"Truck #{truck_number} placed on hold",
        body=f"Truck #{truck_number} now has a priority hold for {run_date.isoformat()}.",
        tag=f"truck-hold-{run_date.isoformat()}-{truck_number}",
        url=f"/fleet?truck={truck_number}",
        truck_number=truck_number,
        run_date=run_date.isoformat(),
    )


def truck_oos_notification(*, truck_number: int, run_date: date) -> NotificationEvent:
    return NotificationEvent(
        type="truck_oos",
        title=f"Truck #{truck_number} marked OOS",
        body=f"Truck #{truck_number} is out of service for {run_date.isoformat()}.",
        tag=f"truck-oos-{run_date.isoformat()}-{truck_number}",
        url=f"/fleet?truck={truck_number}",
        truck_number=truck_number,
        run_date=run_date.isoformat(),
    )


def coverage_assigned_notification(
    *,
    run_date: date,
    route_truck: int,
    covering_truck: int,
    changed_from_truck: int | None = None,
) -> NotificationEvent:
    verb = "changed" if changed_from_truck is not None else "assigned"
    if changed_from_truck is not None:
        body = (
            f"Route #{route_truck} coverage changed from truck #{changed_from_truck} "
            f"to truck #{covering_truck} for {run_date.isoformat()}."
        )
    else:
        body = (
            f"Truck #{covering_truck} is covering route #{route_truck} "
            f"for {run_date.isoformat()}."
        )
    return NotificationEvent(
        type=f"coverage_{verb}",
        title=f"Coverage {verb}: route #{route_truck}",
        body=body,
        tag=f"coverage-{run_date.isoformat()}-{route_truck}",
        url=f"/fleet?truck={covering_truck}",
        route_truck=route_truck,
        covering_truck=covering_truck,
        run_date=run_date.isoformat(),
    )


def coverage_removed_notification(
    *,
    run_date: date,
    route_truck: int,
    covering_truck: int,
) -> NotificationEvent:
    return NotificationEvent(
        type="coverage_removed",
        title=f"Coverage removed: route #{route_truck}",
        body=(
            f"Truck #{covering_truck} is no longer covering route #{route_truck} "
            f"for {run_date.isoformat()}."
        ),
        tag=f"coverage-{run_date.isoformat()}-{route_truck}",
        url=f"/fleet?truck={route_truck}",
        route_truck=route_truck,
        covering_truck=covering_truck,
        run_date=run_date.isoformat(),
    )


async def dispatch_notification(
    event: NotificationEvent,
    *,
    user_id: int | None = None,
    endpoint: str | None = None,
) -> None:
    await manager.broadcast({"type": "notification", "event": asdict(event)})
    if not notifications_configured():
        return
    await asyncio.to_thread(_send_push_sync, event, user_id, endpoint)


def _send_push_sync(
    event: NotificationEvent,
    user_id: int | None = None,
    endpoint: str | None = None,
) -> None:
    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:  # noqa: BLE001
        log.warning("Web push dependency unavailable: %s", exc)
        return

    db = SessionLocal()
    try:
        query = select(PushSubscription).where(PushSubscription.is_active == True)
        if user_id is not None:
            query = query.where(PushSubscription.user_id == user_id)
        if endpoint is not None:
            query = query.where(PushSubscription.endpoint == endpoint)
        subscriptions = db.scalars(query).all()
        if not subscriptions:
            return

        payload = json.dumps(asdict(event))
        for subscription in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": subscription.endpoint,
                        "keys": {
                            "p256dh": subscription.p256dh,
                            "auth": subscription.auth,
                        },
                    },
                    data=payload,
                    vapid_private_key=settings.web_push_vapid_private_key,
                    vapid_claims={"sub": settings.web_push_vapid_subject},
                )
                subscription.last_seen_at = datetime.now(timezone.utc)
            except WebPushException as exc:
                status_code = getattr(getattr(exc, "response", None), "status_code", None)
                if status_code in {404, 410}:
                    subscription.is_active = False
                log.warning("Web push failed for subscription %s: %s", subscription.id, exc)
            except Exception as exc:  # noqa: BLE001
                log.warning("Unexpected web push failure for subscription %s: %s", subscription.id, exc)
        db.commit()
    finally:
        db.close()
