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
from routers.auth import require_admin, require_non_guest

router = APIRouter(prefix="/debug", tags=["debug"])
# uvicorn configures this logger with a stdout handler, so these lines actually
# reach `docker logs` (the app's own "readyroutev2.*" loggers do not).
log = logging.getLogger("uvicorn.error")
_LOG_FILE = Path("/app/.data/client-debug.log")
_MAX_LINE_CHARS = 4000
_MAX_LOG_BYTES = 5 * 1024 * 1024


class ClientLogEvent(BaseModel):
    event: str
    detail: dict | None = None


@router.post("/client-log", status_code=204)
def client_log(
    payload: ClientLogEvent,
    current_user: User = Depends(require_non_guest),
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
    # This file shares the data volume with audit photos, documents and DB
    # backups, so a caller must not be able to grow it without limit.
    if len(line) > _MAX_LINE_CHARS:
        line = line[:_MAX_LINE_CHARS] + '...[truncated]"}'
    log.warning("[client-debug] %s", line)
    try:
        _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        if _LOG_FILE.exists() and _LOG_FILE.stat().st_size > _MAX_LOG_BYTES:
            _LOG_FILE.replace(_LOG_FILE.with_suffix(".1"))
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
