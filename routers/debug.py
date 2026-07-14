"""Router: /debug — lightweight client-side diagnostic logging.

Receives small diagnostic events from the frontend (e.g. a progress-bar
numerator exceeding its denominator) and writes them to the server log, so
intermittent issues that only surface on a specific floor device are still
retrievable centrally (via the backend container logs).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from models import User
from routers.auth import get_current_user

router = APIRouter(prefix="/debug", tags=["debug"])
log = logging.getLogger("readyroutev2.clientdebug")


class ClientLogEvent(BaseModel):
    event: str
    detail: dict | None = None


@router.post("/client-log", status_code=204)
def client_log(
    payload: ClientLogEvent,
    current_user: User = Depends(get_current_user),
) -> None:
    """Record a client-side diagnostic event in the server log (WARNING level)."""
    log.warning(
        "[client-debug] user=%s event=%s detail=%s",
        getattr(current_user, "username", "?"),
        payload.event,
        payload.detail,
    )
