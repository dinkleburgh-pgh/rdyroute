"""Router: /debug — lightweight client-side diagnostic logging.

Receives small diagnostic events from the frontend (e.g. a progress-bar
numerator exceeding its denominator) and records them so intermittent issues
that only surface on a specific floor device are retrievable centrally:
  - written to the `uvicorn.error` logger (shows up in the container logs), and
  - appended to a persistent file under the data volume, readable via the
    admin-only GET endpoint below (no SSH needed).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from models import User
from routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/debug", tags=["debug"])
# uvicorn configures this logger with a stdout handler, so these lines actually
# reach `docker logs` (the app's own "readyroutev2.*" loggers do not).
log = logging.getLogger("uvicorn.error")
_LOG_FILE = Path("/app/.data/client-debug.log")


class ClientLogEvent(BaseModel):
    event: str
    detail: dict | None = None


@router.post("/client-log", status_code=204)
def client_log(
    payload: ClientLogEvent,
    current_user: User = Depends(get_current_user),
) -> None:
    """Record a client-side diagnostic event (container log + persistent file)."""
    line = json.dumps(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "user": getattr(current_user, "username", "?"),
            "event": payload.event,
            "detail": payload.detail,
        },
        default=str,
    )
    log.warning("[client-debug] %s", line)
    try:
        _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


@router.get("/client-log")
def read_client_log(
    limit: int = 200,
    _admin: User = Depends(require_admin),
) -> dict:
    """Return the most recent client-debug log lines (admin only)."""
    if not _LOG_FILE.exists():
        return {"lines": []}
    try:
        with open(_LOG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return {"lines": []}
    n = max(1, min(limit, 1000))
    return {"lines": [ln.rstrip("\n") for ln in lines[-n:]]}
