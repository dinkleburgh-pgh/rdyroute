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
from routers import audit, auth, batches, communications, exports, fleet, load_durations, notices, route_swaps, settings as settings_router, shorts, spares, trucks, ws as ws_router
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
        result = run_startup_seed(db)
        log.info("Startup seed: %s", result)
    finally:
        db.close()

    _db_url = str(engine.url)
    load_ms = (time.monotonic() - _t_start) * 1000
    print(f"\n{'='*58}")
    print(f"  ReadyRoute V2  —  ready")
    print(f"  API   : http://127.0.0.1:8000")
    print(f"  Docs  : http://127.0.0.1:8000/docs")
    print(f"  DB    : {_db_url}")
    print(f"  Load  : {load_ms:.1f} ms")
    print(f"{'='*58}\n")

    backup_task = asyncio.create_task(backup_loop())
    try:
        yield
    finally:
        backup_task.cancel()
        try:
            await backup_task
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
app.include_router(auth.router)
app.include_router(settings_router.router)
app.include_router(ws_router.router)
app.include_router(exports.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}
