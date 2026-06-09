"""
Router: /settings

Key-value application settings store. Each setting is a JSON-serialisable
value stored under a string key. The React frontend and other routers can
read/write settings via these endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AppSetting, User
from routers.auth import get_current_user, require_admin
from schemas import SettingOut, SettingUpsert

router = APIRouter(prefix="/settings", tags=["settings"])

# ---------------------------------------------------------------------------
# Well-known setting keys (informational; not enforced at the API boundary)
# ---------------------------------------------------------------------------
KNOWN_KEYS = {
    "status_badge_colors",
    "batching_disabled",
    "batch_no_cap",
    "outside_timer_enabled",
    "paper_bay_enabled",
    "note_cards_enabled",
    "tracked_items_map",
    "communications_censor_words",
}


# Keys any authenticated user may read (non-sensitive operational settings)
_USER_READABLE_KEYS = {
    "status_badge_colors",
    "batching_disabled",
    "batch_no_cap",
    "outside_timer_enabled",
    "paper_bay_enabled",
    "note_cards_enabled",
    "tracked_items_map",
}

# Keys any authenticated user may write to (e.g. personal notes)
_USER_WRITABLE_PREFIX = "personal_note_"


def _is_user_writable(key: str, user: User) -> bool:
    """Personal note keys are writable by the owning user only."""
    if key.startswith(_USER_WRITABLE_PREFIX):
        owner = key[len(_USER_WRITABLE_PREFIX):]
        return owner == user.username
    return False

@router.get("", response_model=list[SettingOut])
def list_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    all_settings = db.scalars(select(AppSetting).order_by(AppSetting.key)).all()
    from models import AuthRole
    _ADMIN_ROLES = frozenset({AuthRole.admin, AuthRole.fleet, AuthRole.supervisor})
    if current_user.role in _ADMIN_ROLES:
        return all_settings
    # Non-admins only see the user-readable subset
    return [s for s in all_settings if s.key in _USER_READABLE_KEYS or _is_user_writable(s.key, current_user)]


# ---------------------------------------------------------------------------
# Get a single setting
# ---------------------------------------------------------------------------

@router.get("/{key}", response_model=SettingOut)
def get_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import AuthRole
    _ADMIN_ROLES = frozenset({AuthRole.admin, AuthRole.fleet, AuthRole.supervisor})
    if current_user.role not in _ADMIN_ROLES:
        if key not in _USER_READABLE_KEYS and not _is_user_writable(key, current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    setting = db.get(AppSetting, key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Setting '{key}' not found")
    return setting


# ---------------------------------------------------------------------------
# Upsert a setting
# ---------------------------------------------------------------------------

@router.put("/{key}", response_model=SettingOut)
def upsert_setting(
    key: str,
    payload: SettingUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import AuthRole
    _ADMIN_ROLES = frozenset({AuthRole.admin, AuthRole.fleet, AuthRole.supervisor})
    if current_user.role not in _ADMIN_ROLES and not _is_user_writable(key, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    setting = db.get(AppSetting, key)
    if setting is None:
        setting = AppSetting(key=key, value=payload.value)
        db.add(setting)
    else:
        setting.value = payload.value
    db.commit()
    db.refresh(setting)
    return setting


# ---------------------------------------------------------------------------
# Delete a setting
# ---------------------------------------------------------------------------

@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_setting(
    key: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    setting = db.get(AppSetting, key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Setting '{key}' not found")
    db.delete(setting)
    db.commit()


# ---------------------------------------------------------------------------
# Bulk upsert (used on startup to seed defaults)
# ---------------------------------------------------------------------------

@router.post("/bulk", response_model=list[SettingOut])
def bulk_upsert_settings(
    payload: dict[str, object],
    db: Session = Depends(get_db),
):
    """
    Accept a dict of {key: value} and upsert each one.
    Useful for seeding default settings on first run.
    """
    results = []
    for key, value in payload.items():
        setting = db.get(AppSetting, key)
        if setting is None:
            setting = AppSetting(key=key, value=value)
            db.add(setting)
        else:
            setting.value = value
        results.append(setting)
    db.commit()
    for s in results:
        db.refresh(s)
    return results
