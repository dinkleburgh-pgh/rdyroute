"""
Router: /updates

Push-based update trigger endpoints.

This router is intentionally generic: it executes an admin-configured command
when a valid push signal is received, and persists run status in AppSetting so
the Management UI can show state/history.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import time
from threading import Lock
import subprocess
import urllib.request

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import AppSetting, User
from routers.auth import require_admin

router = APIRouter(prefix="/updates", tags=["updates"])

KEY_ENABLED = "update_push_enabled"
KEY_SECRET = "update_push_secret"
KEY_COMMAND = "update_deploy_command"
KEY_LAST = "update_last_status"

DEFAULT_COMMAND = "bash ./deploy.sh"
RUN_TIMEOUT_SECONDS = 60 * 20
_run_lock = Lock()

# ---------------------------------------------------------------------------
# Git-based update check (GitHub API)
# ---------------------------------------------------------------------------

_GIT_SHA = os.getenv("GIT_SHA", "").strip()
_GITHUB_REPO = "dinkleburgh-pgh/rdyroute"
_gh_cache: dict = {}
_GH_CACHE_TTL = 300  # seconds


def _fetch_remote_info(force: bool = False) -> dict:
    """Query GitHub API for the latest commit on main. Caches for 5 minutes."""
    global _gh_cache
    now = time.time()
    if not force and _gh_cache.get("fetched_at", 0.0) + _GH_CACHE_TTL > now:
        return _gh_cache
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{_GITHUB_REPO}/commits/main",
            headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "ReadyRoute/2"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            data = json.loads(resp.read())
        _gh_cache = {
            "fetched_at": now,
            "sha": data.get("sha", ""),
            "message": (data.get("commit", {}).get("message", "") or "").split("\n")[0][:120],
            "date": data.get("commit", {}).get("committer", {}).get("date", ""),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        _gh_cache = {
            "fetched_at": now,
            "sha": _gh_cache.get("sha", ""),  # keep last known SHA on error
            "message": _gh_cache.get("message", ""),
            "date": _gh_cache.get("date", ""),
            "error": str(exc),
        }
    return _gh_cache


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_setting(db: Session, key: str, value: object) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value


def _get_setting(db: Session, key: str, default: object) -> object:
    row = db.get(AppSetting, key)
    return default if row is None else row.value


def _run_update(source: str, ref: str | None, commit: str | None) -> None:
    # Background task gets its own DB session.
    db = SessionLocal()
    try:
        cmd = str(_get_setting(db, KEY_COMMAND, DEFAULT_COMMAND) or DEFAULT_COMMAND)
        started = _utc_now()
        _set_setting(
            db,
            KEY_LAST,
            {
                "state": "running",
                "source": source,
                "ref": ref,
                "commit": commit,
                "command": cmd,
                "started_at": started,
            },
        )
        db.commit()

        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=RUN_TIMEOUT_SECONDS,
            check=False,
        )

        _set_setting(
            db,
            KEY_LAST,
            {
                "state": "ok" if proc.returncode == 0 else "failed",
                "source": source,
                "ref": ref,
                "commit": commit,
                "command": cmd,
                "started_at": started,
                "finished_at": _utc_now(),
                "exit_code": proc.returncode,
                "stdout_tail": (proc.stdout or "")[-4000:],
                "stderr_tail": (proc.stderr or "")[-4000:],
            },
        )
        db.commit()
    except subprocess.TimeoutExpired:
        _set_setting(
            db,
            KEY_LAST,
            {
                "state": "failed",
                "source": source,
                "ref": ref,
                "commit": commit,
                "command": str(_get_setting(db, KEY_COMMAND, DEFAULT_COMMAND) or DEFAULT_COMMAND),
                "finished_at": _utc_now(),
                "error": f"Timed out after {RUN_TIMEOUT_SECONDS} seconds",
            },
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001 - state should be persisted for all failures
        _set_setting(
            db,
            KEY_LAST,
            {
                "state": "failed",
                "source": source,
                "ref": ref,
                "commit": commit,
                "command": str(_get_setting(db, KEY_COMMAND, DEFAULT_COMMAND) or DEFAULT_COMMAND),
                "finished_at": _utc_now(),
                "error": str(exc),
            },
        )
        db.commit()
    finally:
        _run_lock.release()
        db.close()


@router.get("/check")
def check_for_update(
    force: bool = False,
    _admin: User = Depends(require_admin),
):
    """Compare the running image's GIT_SHA against the latest commit on GitHub main."""
    remote = _fetch_remote_info(force=force)
    remote_sha: str = remote.get("sha") or ""
    local_sha: str = _GIT_SHA
    update_available = bool(local_sha and remote_sha and local_sha != remote_sha)
    return {
        "local_sha": local_sha or None,
        "remote_sha": remote_sha or None,
        "remote_message": remote.get("message") or None,
        "remote_date": remote.get("date") or None,
        "update_available": update_available,
        "check_error": remote.get("error"),
    }


@router.get("/status")
def get_update_status(_admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return {
        "enabled": bool(_get_setting(db, KEY_ENABLED, False)),
        "has_secret": bool(str(_get_setting(db, KEY_SECRET, "") or "").strip()),
        "command": str(_get_setting(db, KEY_COMMAND, DEFAULT_COMMAND) or DEFAULT_COMMAND),
        "running": _run_lock.locked(),
        "last": _get_setting(db, KEY_LAST, {}),
    }


@router.post("/trigger")
def trigger_update(
    background_tasks: BackgroundTasks,
    _admin: User = Depends(require_admin),
):
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Update already running")
    background_tasks.add_task(_run_update, "manual", None, None)
    return {"accepted": True, "source": "manual"}


@router.post("/push")
def trigger_update_from_push(
    payload: dict[str, object] | None,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_readyroute_secret: str | None = Header(default=None),
):
    enabled = bool(_get_setting(db, KEY_ENABLED, False))
    if not enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Push updates disabled")

    expected_secret = str(_get_setting(db, KEY_SECRET, "") or "").strip()
    if expected_secret and x_readyroute_secret != expected_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid update secret")

    if not _run_lock.acquire(blocking=False):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Update already running")

    body = payload or {}
    ref = str(body.get("ref")) if body.get("ref") is not None else None
    commit = None
    head = body.get("head_commit")
    if isinstance(head, dict) and head.get("id") is not None:
        commit = str(head.get("id"))

    background_tasks.add_task(_run_update, "push", ref, commit)
    return {"accepted": True, "source": "push", "ref": ref, "commit": commit}
