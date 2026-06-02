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


async def backup_loop() -> None:
    db_path = _sqlite_path()
    if db_path is not None:
        log.info(
            "SQLite backup loop started. db=%s interval=%ds keep=%d",
            db_path, BACKUP_INTERVAL_SECONDS, BACKUP_KEEP,
        )
        while True:
            try:
                dest = await asyncio.to_thread(_do_backup_once, db_path)
                if dest is not None:
                    log.info("Backup written: %s", dest)
            except Exception as exc:  # noqa: BLE001 - never let a backup error kill the loop
                log.warning("Backup failed: %s", exc)
            await asyncio.sleep(BACKUP_INTERVAL_SECONDS)

    elif settings.database_url.startswith("postgresql"):
        log.info(
            "PostgreSQL backup loop started. interval=%ds keep=%d",
            BACKUP_INTERVAL_SECONDS, BACKUP_KEEP,
        )
        while True:
            try:
                dest = await asyncio.to_thread(_do_pg_backup_once)
                log.info("PG backup written: %s", dest)
            except Exception as exc:  # noqa: BLE001 - never let a backup error kill the loop
                log.warning("PG backup failed: %s", exc)
            await asyncio.sleep(BACKUP_INTERVAL_SECONDS)

    else:
        log.info("Backups disabled (unrecognised database type).")
