"""
Router: /ws

Single WebSocket endpoint. Clients connect here and receive broadcast
events whenever truck state or shortages change elsewhere in the app.

Authentication: the handshake carries the same httpOnly cookies as any REST
call, and is rejected when they don't resolve to an enabled user. Broadcasts
carry operational content (chat bodies, driver notes, truck state), so an
unauthenticated subscriber would get a live feed of the whole operation.

Event shapes sent to clients:
  {"type": "truck_state_updated", "run_date": "YYYY-MM-DD", "truck_number": N}
  {"type": "shortage_updated",    "run_date": "YYYY-MM-DD"}
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from database import SessionLocal
from routers.auth import authenticate_websocket
from ws_manager import manager

router = APIRouter(tags=["ws"])


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    # A plain Session is used rather than the get_db dependency: WebSocket
    # routes can't return an HTTP error, so the check has to run inline and
    # release the connection before the long-lived socket loop begins.
    db = SessionLocal()
    try:
        user = authenticate_websocket(ws.cookies, db)
    finally:
        db.close()

    if user is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(ws)
    try:
        # Keep the connection alive; we only push data, but we still need to
        # drain incoming frames (pings / close handshakes) to avoid buffer stalls.
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:  # noqa: BLE001 — treat any other error as a clean disconnect
        await manager.disconnect(ws)
