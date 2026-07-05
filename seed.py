"""
Startup seeding helpers.

Two responsibilities:

1.  ``ensure_default_user`` — seed a first admin account ONLY on a genuinely
    empty database (initial password from ``INITIAL_ADMIN_PASSWORD`` or a random
    one logged once). Never resets or re-enables an existing account, so an
    admin can durably change the password or disable it.

2.  ``import_v1_users`` — one-shot import of users from the V1 Streamlit
    app's ``auth_users.json``.  Bcrypt hashes are copied verbatim
    (V2 uses the same algorithm) so existing passwords keep working.
    Only runs when the users table is empty or when the V1 file contains
    usernames we don't yet have.
"""

from __future__ import annotations

import json
import os
import secrets
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
    display_name: str = "Ready",
    role: AuthRole = AuthRole.admin,
) -> None:
    """Seed an initial admin ONLY when the database has no users at all.

    Previously this ran every startup and force-reset the ``ready`` account's
    password back to ``ready`` and re-enabled it whenever the stored hash didn't
    verify — so an admin could never durably change the password or disable the
    account (a restart undid it), and the credentials stayed trivially guessable
    on an internet-facing app.

    Now it only creates a first admin on a genuinely empty database, and never
    touches an existing account. The initial password comes from
    ``INITIAL_ADMIN_PASSWORD`` if set, otherwise a random one printed once to the
    startup log so the operator can retrieve it and change it immediately.
    """
    if db.query(User.id).first() is not None:
        # DB already has users — the admin account is managed normally from here.
        return

    initial_pw = os.environ.get("INITIAL_ADMIN_PASSWORD", "").strip()
    generated = not initial_pw
    if generated:
        initial_pw = secrets.token_urlsafe(15)

    db.add(
        User(
            username=username,
            hashed_password=_hash(initial_pw),
            role=role,
            display_name=display_name,
            is_enabled=True,
        )
    )
    db.commit()

    if generated:
        print(
            f"[seed] Created initial admin '{username}' with a GENERATED password: {initial_pw}\n"
            f"[seed] Log in and change it immediately (or set INITIAL_ADMIN_PASSWORD before first boot).",
            flush=True,
        )


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
