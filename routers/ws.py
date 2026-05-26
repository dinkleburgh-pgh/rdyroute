"""
Router: /ws

Single WebSocket endpoint. Clients connect here and receive broadcast
events whenever truck state or shortages change elsewhere in the app.

Event shapes sent to clients:
  {"type": "truck_state_updated", "run_date": "YYYY-MM-DD", "truck_number": N}
  {"type": "shortage_updated",    "run_date": "YYYY-MM-DD"}
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ws_manager import manager

router = APIRouter(tags=["ws"])


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
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
