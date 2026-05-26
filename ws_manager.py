"""
WebSocket ConnectionManager — shared singleton used by all routers.

Keeps a list of active WebSocket connections and broadcasts JSON events
to all of them. Dead connections are silently pruned on next broadcast.
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._active: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._active.append(ws)
        log.debug("WS connected — %d active", len(self._active))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            try:
                self._active.remove(ws)
            except ValueError:
                pass
        log.debug("WS disconnected — %d remaining", len(self._active))

    async def broadcast(self, event: dict[str, Any]) -> None:
        """Send *event* as JSON text to every connected client.
        Connections that fail to receive are pruned automatically."""
        message = json.dumps(event)
        dead: list[WebSocket] = []

        async with self._lock:
            targets = list(self._active)

        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    try:
                        self._active.remove(ws)
                    except ValueError:
                        pass


# Module-level singleton — import this in routers that need to broadcast.
manager = ConnectionManager()
