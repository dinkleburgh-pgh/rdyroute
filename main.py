"""
ReadyRoute V2 — FastAPI backend entry point.

Start the server:
    uvicorn main:app --reload --port 8000

The React frontend (any origin) connects via the CORS middleware.
Interactive API docs: http://localhost:8000/docs
"""
# test: updater smoke test 2026-06-08

from contextlib import asynccontextmanager
import asyncio
import logging
from pathlib import Path
import time
from collections import defaultdict

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from database import Base, SessionLocal, engine, settings
from routers import activity, audit, auth, batches, communications, exports, fleet, load_durations, notes as notes_router, notices, notifications, route_swaps, settings as settings_router, short_imports, shorts, spares, trucks, updates, ws as ws_router
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

    # Run all pending Alembic migrations before accepting traffic.
    # This replaces the old inline ALTER TABLE statements and create_all().
    # Alembic applies migrations idempotently: already-applied versions are skipped.
    from alembic.config import Config as _AlembicConfig
    from alembic import command as _alembic_command
    import os as _os
    _alembic_cfg = _AlembicConfig(_os.path.join(_os.path.dirname(__file__), "alembic.ini"))
    _alembic_cfg.set_main_option("sqlalchemy.url", str(engine.url))
    try:
        _alembic_command.upgrade(_alembic_cfg, "head")
        log.info("Alembic: migrations applied (or already current)")
    except BaseException as _alembic_err:
        log.error("Alembic migration failed: %s — falling back to create_all()", _alembic_err)
        Base.metadata.create_all(bind=engine)
        try:
            _alembic_command.stamp(_alembic_cfg, "head")
            log.warning("Alembic: stamped head after create_all() fallback")
        except BaseException as _stamp_err:
            log.error("Alembic stamp after create_all() failed: %s", _stamp_err)

    db = SessionLocal()
    try:
        try:
            # Data backfill: ensure all trucks have a QR token (safe to re-run; skips non-null)
            import uuid as _uuid
            from sqlalchemy import select as _select
            from models import Truck as _Truck
            _trucks_no_token = db.scalars(_select(_Truck).where(_Truck.qr_token.is_(None))).all()
            for _t in _trucks_no_token:
                _t.qr_token = str(_uuid.uuid4())
            if _trucks_no_token:
                db.commit()
            result = run_startup_seed(db)
            log.info("Startup seed: %s", result)
        except Exception as _e:
            log.error("Startup operations failed (non-fatal, app will run): %s", _e)
        log.info("Startup operations complete.")
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
        """Hourly task to prune expired session rows and old login attempt records."""
        from datetime import timezone as _tz
        from sqlalchemy import text as _t2
        from routers.auth import _prune_login_attempts
        while True:
            await asyncio.sleep(3600)
            _db = SessionLocal()
            try:
                from datetime import datetime as _dt
                _now = _dt.now(_tz.utc).timestamp()
                _db.execute(_t2("DELETE FROM sessions WHERE expires_ts <= :now"), {"now": _now})
                _db.commit()
                _prune_login_attempts(_db)
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

import os as _os
_APP_VERSION = _os.environ.get("APP_VERSION", "dev")

app = FastAPI(
    title="ReadyRoute V2 API",
    description=(
        "FastAPI backend for the Load Management System. "
        "Migrated from the V1 Streamlit monolith."
    ),
    version=_APP_VERSION,
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

# Browsers reject credentialed requests (withCredentials:true) to wildcard
# origins. Log a warning so it's obvious in prod logs if misconfigured.
if "*" in _origins:
    import warnings as _w
    _w.warn(
        "CORS_ORIGINS is set to '*'. This disables cookie-based session auth "
        "for browsers. Set CORS_ORIGINS=https://yourdomain.com in production.",
        stacklevel=1,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials="*" not in _origins,  # credentials only when origins are explicit
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# `/api/*` compatibility shim
# The dev frontend talks to the backend through Vite's `/api` proxy. When the
# built frontend is served directly by FastAPI on the same origin, keep those
# paths working by rewriting `/api/foo` -> `/foo` before routing.
# ---------------------------------------------------------------------------

@app.middleware("http")
async def _strip_api_prefix(request: Request, call_next) -> Response:
    path = request.scope.get("path", "")
    request.scope["readyroute_original_path"] = path
    if path == "/api" or path.startswith("/api/"):
        request.scope["path"] = path[4:] or "/"
    return await call_next(request)


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

    original_path = str(request.scope.get("readyroute_original_path", request.url.path or ""))
    content_type = str(response.headers.get("content-type", "")).lower()
    if (
        original_path == "/api"
        or original_path.startswith("/api/")
        or "application/json" in content_type
    ):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(fleet.router)
app.include_router(trucks.router)
app.include_router(activity.router)
app.include_router(load_durations.router)
app.include_router(batches.router)
app.include_router(shorts.router)
app.include_router(short_imports.router)
app.include_router(audit.router)
app.include_router(spares.router)
app.include_router(route_swaps.router)
app.include_router(communications.router)
app.include_router(notices.router)
app.include_router(notes_router.router)
app.include_router(auth.router)
app.include_router(settings_router.router)
app.include_router(notifications.router)
app.include_router(updates.router)
app.include_router(ws_router.router)
app.include_router(exports.router)


# ---------------------------------------------------------------------------
# Frontend static app (production build)
# Serves frontend/dist on the same origin as the backend so service workers,
# push, and API cookies all operate on one HTTPS origin when the backend is
# exposed through a tunnel or reverse proxy.
# ---------------------------------------------------------------------------

_FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist"


def _frontend_file_response(request: Request, requested_path: str = "") -> Response:
    original_path = str(request.scope.get("readyroute_original_path", ""))
    if original_path == "/api" or original_path.startswith("/api/"):
        return PlainTextResponse("API route not found", status_code=404)

    if not _FRONTEND_DIST.exists():
        return PlainTextResponse(
            "Frontend build not found. Run `npm run build` in `frontend/` first.",
            status_code=404,
        )

    clean = requested_path.lstrip("/").replace("\\", "/")
    candidate = (_FRONTEND_DIST / clean).resolve() if clean else (_FRONTEND_DIST / "index.html").resolve()

    try:
        candidate.relative_to(_FRONTEND_DIST.resolve())
    except ValueError:
        return PlainTextResponse("Invalid path", status_code=400)

    if clean and candidate.is_file():
        return FileResponse(candidate)

    return FileResponse(_FRONTEND_DIST / "index.html")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

_start_time = time.time()

@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version}


@app.get("/health/detail", tags=["meta"])
def health_detail():
    """Detailed health info — DB connectivity, pool stats, uptime."""
    import platform
    from sqlalchemy import create_engine as _create_engine, text as _text
    from database import engine as _engine, settings as _settings

    uptime_s = int(time.time() - _start_time)
    db_url = _settings.database_url
    is_sqlite = db_url.startswith("sqlite")

    def _mask_url(url: str) -> str:
        try:
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(url)
            masked = urlunparse(parsed._replace(netloc=parsed.hostname or parsed.netloc))
            return masked
        except Exception:
            return "sqlite" if url.startswith("sqlite") else url.split("@")[-1] if "@" in url else url

    def _probe_db(url: str, existing_engine=None):
        """Returns dict with ok, latency_ms, error, pool, type, masked_url."""
        is_sq = url.startswith("sqlite")
        result: dict = {
            "ok": False,
            "type": "sqlite" if is_sq else "postgresql",
            "url": _mask_url(url),
            "latency_ms": None,
            "error": None,
            "pool": {},
        }
        eng = existing_engine
        created = False
        try:
            if eng is None:
                eng = _create_engine(url, pool_pre_ping=True,
                                     connect_args={"check_same_thread": False} if is_sq else {})
                created = True
            t0 = time.perf_counter()
            with eng.connect() as conn:
                conn.execute(_text("SELECT 1"))
            result["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            result["ok"] = True
            pool = eng.pool
            try:
                result["pool"] = {
                    "size":        pool.size(),
                    "checked_out": pool.checkedout(),
                    "overflow":    pool.overflow(),
                }
            except Exception:
                pass
        except Exception as exc:
            result["error"] = str(exc)
        finally:
            if created and eng is not None:
                try:
                    eng.dispose()
                except Exception:
                    pass
        return result

    # Primary DB (reuse existing engine)
    primary = _probe_db(db_url, existing_engine=_engine)

    # Backup / extra DBs
    extras: list[dict] = []
    raw_backup = (_settings.backup_database_url or "").strip()
    if raw_backup:
        for raw_url in [u.strip() for u in raw_backup.split(",") if u.strip()]:
            probe = _probe_db(raw_url)
            probe["label"] = "Backup DB"
            extras.append(probe)

    overall_ok = primary["ok"] and all(e["ok"] for e in extras)

    fallback_reason = _os.environ.get("DB_FALLBACK_REASON")

    # Include last backup status so the UI can surface it
    from backups import get_last_backup_status
    last_backup = get_last_backup_status()

    return {
        "status": "ok" if overall_ok else "degraded",
        "version": app.version,
        "uptime_seconds": uptime_s,
        "python": platform.python_version(),
        "db": primary,
        "db_fallback": fallback_reason,
        "extra_dbs": extras,
        "last_backup": last_backup if last_backup else None,
    }


@app.get("/", include_in_schema=False)
def frontend_index(request: Request):
    return _frontend_file_response(request)


@app.get("/{full_path:path}", include_in_schema=False)
def frontend_catchall(request: Request, full_path: str):
    return _frontend_file_response(request, full_path)
