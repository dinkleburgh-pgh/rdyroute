"""
Startup seeding helpers.

Two responsibilities:

1.  ``ensure_default_user`` — guarantee that the credentials
    ``ready`` / ``ready`` always work, regardless of what is (or isn't)
    in the database.  Runs on every startup.

2.  ``import_v1_users`` — one-shot import of users from the V1 Streamlit
    app's ``auth_users.json``.  Bcrypt hashes are copied verbatim
    (V2 uses the same algorithm) so existing passwords keep working.
    Only runs when the users table is empty or when the V1 file contains
    usernames we don't yet have.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import bcrypt
from sqlalchemy.orm import Session

from models import AppSetting, AuthRole, User

DEFAULT_V1_USERS_PATH = r"C:\Users\dinkleburgh\TruckApp\auth_users.json"

# V1 used a couple of role aliases we no longer recognise.  Map them to the
# closest V2 equivalent so the import doesn't blow up on legacy data.
_ROLE_ALIASES = {
    "admin": AuthRole.fleet,
    "viewer": AuthRole.guest,
    "user": AuthRole.loader,
}


def _coerce_role(raw: str | None) -> AuthRole:
    if not raw:
        return AuthRole.loader
    key = raw.strip().lower()
    try:
        return AuthRole(key)
    except ValueError:
        return _ROLE_ALIASES.get(key, AuthRole.guest)


def _hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


# ---------------------------------------------------------------------------
# Default user
# ---------------------------------------------------------------------------

def ensure_default_user(
    db: Session,
    username: str = "ready",
    password: str = "ready",
    display_name: str = "Ready",
    role: AuthRole = AuthRole.admin,
) -> None:
    """Create or refresh a guaranteed admin account.

    If the row exists we leave the stored hash alone *unless* the supplied
    password no longer verifies — in that case we reset it so the documented
    credentials always work.
    """
    user = db.query(User).filter(User.username == username).one_or_none()
    if user is None:
        db.add(
            User(
                username=username,
                hashed_password=_hash(password),
                role=role,
                display_name=display_name,
                is_enabled=True,
            )
        )
        db.commit()
        return

    needs_reset = False
    try:
        if not bcrypt.checkpw(password.encode(), user.hashed_password.encode()):
            needs_reset = True
    except Exception:
        needs_reset = True

    if needs_reset:
        user.hashed_password = _hash(password)
    user.is_enabled = True
    if not user.display_name:
        user.display_name = display_name
    db.commit()


# ---------------------------------------------------------------------------
# V1 import
# ---------------------------------------------------------------------------

def import_v1_users(db: Session, path: str | os.PathLike[str] | None = None) -> int:
    """Import users from the V1 ``auth_users.json`` file.

    Returns the number of users newly inserted.  Existing usernames are left
    untouched — re-running is safe.
    """
    src = Path(path or os.environ.get("V1_USERS_JSON", DEFAULT_V1_USERS_PATH))
    if not src.is_file():
        return 0

    try:
        payload = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, dict):
        return 0

    existing = {u.username for u in db.query(User.username).all()}
    inserted = 0
    for raw_username, rec in users.items():
        if not isinstance(rec, dict):
            continue
        username = str(raw_username).strip().lower()
        if not username or username in existing:
            continue
        hashed = rec.get("password")
        if not isinstance(hashed, str) or not hashed.startswith("$2"):
            # Not a bcrypt hash — skip rather than store something unusable
            continue
        db.add(
            User(
                username=username,
                hashed_password=hashed,
                role=_coerce_role(rec.get("role")),
                display_name=str(rec.get("name") or username),
                is_enabled=bool(rec.get("enabled", True)),
            )
        )
        existing.add(username)
        inserted += 1

    if inserted:
        db.commit()
    return inserted


def run_startup_seed(db: Session) -> dict[str, int | bool]:
    """Convenience helper invoked from the FastAPI lifespan."""
    imported = import_v1_users(db)
    ensure_default_user(db)
    return {
        "v1_users_imported": imported,
        "default_user_ready": True,
    }
