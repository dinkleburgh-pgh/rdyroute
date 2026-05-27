"""
Periodic SQLite backup task.

Runs inside the backend process; uses SQLite's online backup API so the
database can keep serving requests while a snapshot is taken.

Backups are written to:  <db_dir>/backups/truckv2-YYYYMMDD-HHMMSS.db
The newest BACKUP_KEEP files are retained; older ones are deleted.

Disabled automatically when DATABASE_URL is not SQLite.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path

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


async def backup_loop() -> None:
    db_path = _sqlite_path()
    if db_path is None:
        log.info("Backups disabled (non-SQLite database).")
        return
    log.info(
        "Backup loop started. db=%s interval=%ds keep=%d",
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
