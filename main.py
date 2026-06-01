"""
ReadyRoute V2 — FastAPI backend entry point.

Start the server:
    uvicorn main:app --reload --port 8000

The React frontend (any origin) connects via the CORS middleware.
Interactive API docs: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager
import asyncio
import logging
import time
from collections import defaultdict

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from database import Base, SessionLocal, engine, settings
from routers import audit, auth, batches, communications, exports, fleet, load_durations, notes as notes_router, notices, route_swaps, settings as settings_router, shorts, spares, trucks, updates, ws as ws_router
from seed import run_startup_seed
from backups import backup_loop

log = logging.getLogger("readyroutev2.startup")
_http_log = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# Error rate-limiter — suppress repeated identical 500s to one log per minute
# ---------------------------------------------------------------------------

_err_last_seen: dict[str, float] = defaultdict(float)
_ERR_SUPPRESS_SECONDS = 60


def _should_log_error(key: str) -> bool:
    now = time.monotonic()
    if now - _err_last_seen[key] >= _ERR_SUPPRESS_SECONDS:
        _err_last_seen[key] = now
        return True
    return False


# ---------------------------------------------------------------------------
# Lifespan: create all tables on startup (idempotent — safe in dev & CI)
# and seed the default account + V1 user import.
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _t_start = time.monotonic()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Status enum migration: legacy combined 'oos_spare' status was
        # split into separate 'oos' and 'spare' values. Map existing rows:
        # any with a covering route assignment → spare, otherwise → oos.
        from sqlalchemy import text as _sql_text
        try:
            db.execute(_sql_text(
                "UPDATE truck_states SET status='spare' "
                "WHERE status='oos_spare' AND oos_spare_route IS NOT NULL"
            ))
            db.execute(_sql_text(
                "UPDATE truck_states SET status='oos' WHERE status='oos_spare'"
            ))
            db.commit()
        except Exception:  # noqa: BLE001 - dev migration, ignore if column missing
            db.rollback()
        # Column migration: add scheduled_off_days if it doesn't exist yet
        try:
            db.execute(_sql_text(
                "ALTER TABLE trucks ADD COLUMN scheduled_off_days JSON DEFAULT '[]'"
            ))
            db.commit()
        except Exception:  # noqa: BLE001 - column already exists
            db.rollback()
        # Column migrations: add ip_address and user_agent to sessions table
        for _col, _typedef in [("ip_address", "VARCHAR(45)"), ("user_agent", "VARCHAR(256)")]:
            try:
                db.execute(_sql_text(f"ALTER TABLE sessions ADD COLUMN {_col} {_typedef}"))
                db.commit()
            except Exception:  # noqa: BLE001 - column already exists
                db.rollback()
        result = run_startup_seed(db)
        log.info("Startup seed: %s", result)
    finally:
        db.close()

    _init_ms = (time.monotonic() - _t_start) * 1000
    print(f"\n{'='*58}")
    print(f"  ReadyRoute V2  —  initialised ({_init_ms:.0f} ms)")
    print(f"  DB    : {engine.url}")
    print(f"{'='*58}\n")

    async def _confirm_healthy() -> None:
        """Print a final banner once uvicorn is actually accepting TCP connections."""
        _port = 8000
        for _ in range(60):
            await asyncio.sleep(1)
            try:
                _r, _w = await asyncio.open_connection("127.0.0.1", _port)
                _w.close()
                await _w.wait_closed()
            except OSError:
                continue
            _up_ms = (time.monotonic() - _t_start) * 1000
            _up_str  = f"{_up_ms:.0f} ms"
            _db_str  = str(engine.url)
            W = 54
            print(f"\n╔{'═'*W}╗")
            print(f"║{'  ReadyRoute V2  —  ✓ HEALTHY  ':^{W}}║")
            print(f"╠{'═'*W}╣")
            print(f"║  API   : http://127.0.0.1:{_port:<{W-18}}║")
            print(f"║  Docs  : http://127.0.0.1:{_port}/docs{'':<{W-24}}║")
            print(f"║  DB    : {_db_str:<{W-10}}║")
            print(f"║  Up in : {_up_str:<{W-10}}║")
            print(f"╚{'═'*W}╝\n")
            return
        log.warning("Health-confirm: server did not open port %d within 60 s", _port)

    async def _cleanup_expired_sessions() -> None:
        """Hourly task to prune expired session rows so the table doesn't grow unboundedly."""
        from datetime import timezone as _tz
        from sqlalchemy import text as _t2
        while True:
            await asyncio.sleep(3600)
            _db = SessionLocal()
            try:
                from datetime import datetime as _dt
                _now = _dt.now(_tz.utc).timestamp()
                _db.execute(_t2("DELETE FROM sessions WHERE expires_ts <= :now"), {"now": _now})
                _db.commit()
            except Exception:  # noqa: BLE001
                pass
            finally:
                _db.close()

    backup_task  = asyncio.create_task(backup_loop())
    health_task  = asyncio.create_task(_confirm_healthy())
    cleanup_task = asyncio.create_task(_cleanup_expired_sessions())
    try:
        yield
    finally:
        backup_task.cancel()
        health_task.cancel()
        cleanup_task.cancel()
        for _t in (backup_task, health_task, cleanup_task):
            try:
                await _t
            except (asyncio.CancelledError, Exception):
                pass


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ReadyRoute V2 API",
    description=(
        "FastAPI backend for the Load Management System. "
        "Migrated from the V1 Streamlit monolith."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# Allow all origins in development so the React dev server can connect.
# Tighten this before deploying to production.
# ---------------------------------------------------------------------------

_origins = (
    [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    if settings.cors_origins != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request timing + error logging middleware
# ---------------------------------------------------------------------------

_req_log = logging.getLogger("uvicorn.error")

@app.middleware("http")
async def _log_requests(request: Request, call_next) -> Response:
    t0 = time.monotonic()
    try:
        response: Response = await call_next(request)
    except Exception as exc:  # noqa: BLE001 - convert to 500, never crash worker
        key = f"{request.method}:{request.url.path}:exception"
        if _should_log_error(key):
            _req_log.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
        return Response(content="Internal Server Error", status_code=500, media_type="text/plain")
    ms = (time.monotonic() - t0) * 1000
    status = response.status_code
    path = request.url.path
    if status >= 500:
        key = f"{request.method}:{path}:{status}"
        if _should_log_error(key):
            _req_log.error("%s %s → %d  (%.0f ms)", request.method, path, status, ms)
    elif status >= 400:
        _req_log.warning("%s %s → %d  (%.0f ms)", request.method, path, status, ms)
    else:
        _req_log.debug("%s %s → %d  (%.0f ms)", request.method, path, status, ms)
    return response

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(fleet.router)
app.include_router(trucks.router)
app.include_router(load_durations.router)
app.include_router(batches.router)
app.include_router(shorts.router)
app.include_router(audit.router)
app.include_router(spares.router)
app.include_router(route_swaps.router)
app.include_router(communications.router)
app.include_router(notices.router)
app.include_router(notes_router.router)
app.include_router(auth.router)
app.include_router(settings_router.router)
app.include_router(updates.router)
app.include_router(ws_router.router)
app.include_router(exports.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}
