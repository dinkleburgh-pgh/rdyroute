"""
Periodic database backup task.

SQLite:     Uses SQLite's online backup API.
            Backups: <db_dir>/backups/truckv2-YYYYMMDD-HHMMSS.db

PostgreSQL: Uses pg_dump (requires postgresql-client in the container).
            Backups: /app/.data/backups/readyroute-YYYYMMDD-HHMMSS.sql

The newest BACKUP_KEEP files are retained; older ones are deleted.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from database import settings

log = logging.getLogger("readyroutev2.backups")

BACKUP_INTERVAL_SECONDS = int(os.getenv("BACKUP_INTERVAL_SECONDS", "1800"))  # 30 min
BACKUP_KEEP = int(os.getenv("BACKUP_KEEP", "48"))                            # ~24h at 30m

# ---------------------------------------------------------------------------
# Track last backup result for the health / connections UI
# ---------------------------------------------------------------------------

_last_backup: dict = {}


def get_last_backup_status() -> dict:
    """Return metadata about the most recent backup attempt."""
    return dict(_last_backup)


# ---------------------------------------------------------------------------
# SQLite backup
# ---------------------------------------------------------------------------

def _sqlite_path() -> Path | None:
    url = settings.database_url
    if not url.startswith("sqlite"):
        return None
    # sqlite:///relative.db   -> relative.db
    # sqlite:////abs/path.db  -> /abs/path.db
    raw = url.split("sqlite:///", 1)[-1]
    return Path(raw).resolve()


def _backup_dir(db_path: Path) -> Path:
    d = db_path.parent / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _do_backup_once(db_path: Path) -> Path | None:
    if not db_path.exists():
        return None
    out_dir = _backup_dir(db_path)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = out_dir / f"{db_path.stem}-{stamp}.db"
    src = sqlite3.connect(str(db_path))
    try:
        dst = sqlite3.connect(str(dest))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    _prune_old(out_dir, db_path.stem)
    return dest


def _prune_old(out_dir: Path, stem: str) -> None:
    files = sorted(out_dir.glob(f"{stem}-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[BACKUP_KEEP:]:
        try:
            old.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# PostgreSQL backup via pg_dump
# ---------------------------------------------------------------------------

def _pg_backup_dir() -> Path:
    d = Path("/app/.data/backups")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _do_pg_backup_once() -> Path:
    url = settings.database_url
    # Strip SQLAlchemy driver prefix so urlparse can handle it
    raw = url.replace("postgresql+psycopg://", "postgresql://")
    parsed = urlparse(raw)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = _pg_backup_dir() / f"readyroute-{stamp}.sql"
    env = os.environ.copy()
    env["PGPASSWORD"] = parsed.password or ""
    cmd = [
        "pg_dump",
        "-h", parsed.hostname or "localhost",
        "-p", str(parsed.port or 5432),
        "-U", parsed.username or "",
        "-d", (parsed.path or "").lstrip("/"),
        "-F", "p",   # plain SQL — human-readable, no special restore tool needed
        "-f", str(dest),
    ]
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump exited {result.returncode}: {result.stderr.strip()}")
    _prune_pg_old(_pg_backup_dir())
    return dest


def _prune_pg_old(backup_dir: Path) -> None:
    files = sorted(backup_dir.glob("readyroute-*.sql"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[BACKUP_KEEP:]:
        try:
            old.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Backup DB connectivity check (runs once at startup)
# ---------------------------------------------------------------------------

def check_backup_db_connectivity() -> None:
    """
    Log a warning if BACKUP_DATABASE_URL is set but unreachable.
    Called once at startup so operators see the issue immediately in logs.
    """
    raw = (settings.backup_database_url or "").strip()
    if not raw:
        return
    for raw_url in [u.strip() for u in raw.split(",") if u.strip()]:
        try:
            import psycopg  # type: ignore[import]
            clean = raw_url.replace("postgresql+psycopg://", "postgresql://")
            parsed = urlparse(clean)
            conn = psycopg.connect(
                host=parsed.hostname,
                port=parsed.port or 5432,
                dbname=(parsed.path or "/").lstrip("/") or "postgres",
                user=parsed.username,
                password=parsed.password,
                connect_timeout=5,
            )
            conn.close()
            log.info("Backup DB reachable: %s@%s:%s", parsed.username, parsed.hostname, parsed.port or 5432)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "Backup DB UNREACHABLE (%s@%s): %s — "
                "WAL streaming may not be working; check replication setup.",
                urlparse(raw_url.replace("postgresql+psycopg://", "postgresql://")).username,
                urlparse(raw_url.replace("postgresql+psycopg://", "postgresql://")).hostname,
                exc,
            )


# ---------------------------------------------------------------------------
# Main backup loop
# ---------------------------------------------------------------------------

async def backup_loop() -> None:
    """
    Long-running background task. Detects DB type and runs the appropriate
    backup strategy in a loop.

    SQLite  → copies the DB file every BACKUP_INTERVAL_SECONDS seconds.
    Postgres → runs pg_dump every BACKUP_INTERVAL_SECONDS seconds.

    Note: pg_dump creates point-in-time SQL snapshots stored locally at
    /app/.data/backups/. Live replication (WAL streaming to the USB standby)
    is handled by PostgreSQL itself and is independent of this task.
    """
    global _last_backup

    # Check backup DB connectivity once at startup
    try:
        await asyncio.to_thread(check_backup_db_connectivity)
    except Exception as exc:  # noqa: BLE001
        log.warning("Backup DB connectivity check failed: %s", exc)

    db_path = _sqlite_path()

    if db_path is not None:
        # ── SQLite path ──────────────────────────────────────────────────
        log.info(
            "SQLite backup loop started. db=%s interval=%ds keep=%d",
            db_path, BACKUP_INTERVAL_SECONDS, BACKUP_KEEP,
        )
        while True:
            try:
                dest = await asyncio.to_thread(_do_backup_once, db_path)
                if dest is not None:
                    log.info("SQLite backup written: %s", dest)
                    _last_backup = {
                        "type": "sqlite",
                        "path": str(dest),
                        "ok": True,
                        "at": datetime.now().isoformat(),
                    }
            except Exception as exc:  # noqa: BLE001
                log.warning("SQLite backup failed: %s", exc)
                _last_backup = {"type": "sqlite", "ok": False, "error": str(exc), "at": datetime.now().isoformat()}
            await asyncio.sleep(BACKUP_INTERVAL_SECONDS)

    elif settings.database_url.startswith("postgresql"):
        # ── PostgreSQL path ──────────────────────────────────────────────
        log.info(
            "PostgreSQL backup loop started (pg_dump snapshots). interval=%ds keep=%d",
            BACKUP_INTERVAL_SECONDS, BACKUP_KEEP,
        )
        while True:
            try:
                dest = await asyncio.to_thread(_do_pg_backup_once)
                log.info("PG backup written: %s", dest)
                _last_backup = {
                    "type": "postgres",
                    "path": str(dest),
                    "ok": True,
                    "at": datetime.now().isoformat(),
                }
            except Exception as exc:  # noqa: BLE001
                log.warning("PG backup failed: %s", exc)
                _last_backup = {"type": "postgres", "ok": False, "error": str(exc), "at": datetime.now().isoformat()}
            await asyncio.sleep(BACKUP_INTERVAL_SECONDS)

    else:
        log.info("Backups disabled (unrecognised database type).")
