"""
Router: /settings

Key-value application settings store. Each setting is a JSON-serialisable
value stored under a string key. The React frontend and other routers can
read/write settings via these endpoints.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from activity_log import append_activity_event
from database import get_db
from models import AppSetting, AuthRole, User
from routers.auth import get_current_user, require_admin
from schemas import SettingOut, SettingUpsert

router = APIRouter(prefix="/settings", tags=["settings"])

_ADMIN_ROLES = frozenset({AuthRole.admin, AuthRole.fleet, AuthRole.supervisor})

# ---------------------------------------------------------------------------
# Well-known setting keys (informational; not enforced at the API boundary)
# ---------------------------------------------------------------------------
KNOWN_KEYS = {
    "status_badge_colors",
    "batching_disabled",
    "batch_no_cap",
    "outside_timer_enabled",
    "paper_bay_enabled",
    "arrived_tracking_enabled",
    "note_cards_enabled",
    "tracked_items_map",
    "communications_censor_words",
    "ollama_base_url",
    "shortage_sheet_ollama_model",
    "shortage_sheet_ollama_timeout_seconds",
    "shortage_sheet_llm_low_confidence_threshold",
    "shortage_sheet_preprocess_max_image_side",
}

_CLEAR_TO_EMPTY_SETTING_FACTORIES: dict[str, Callable[[], dict[str, object]]] = {
    "shortage_sheet_ocr_correction_memory": lambda: {
        "version": 1,
        "examples": [],
        "updated_at": datetime.now(UTC).isoformat(),
    },
    "shortage_sheet_ocr_header_correction_memory": lambda: {
        "version": 1,
        "examples": [],
        "updated_at": datetime.now(UTC).isoformat(),
    },
}


# Keys any authenticated user may read (non-sensitive operational settings)
_USER_READABLE_KEYS = {
    "status_badge_colors",
    "batching_disabled",
    "batch_no_cap",
    "outside_timer_enabled",
    "paper_bay_enabled",
    "arrived_tracking_enabled",
    "note_cards_enabled",
    "tracked_items_map",
}

# Keys any authenticated user may write to (e.g. personal notes)
_USER_WRITABLE_PREFIX = "personal_note_"

_OPTIONAL_DEFAULT_PREFIXES: tuple[tuple[str, object], ...] = (
    ("holiday_mode_", False),
    ("holiday_load_", False),
    ("holiday_unload_", False),
    ("wizard_completed_", False),
    ("daily_notes_", ""),
    ("load_day_override_", None),
    ("unloads_day_override_", None),
)


def _optional_default_setting(key: str) -> dict[str, object] | None:
    """Return a synthetic default setting for known optional per-date keys.

    These keys are intentionally absent until a user changes them. Returning a
    default value avoids noisy 404s in the browser and backend logs while
    preserving the same effective frontend behavior.
    """
    for prefix, default in _OPTIONAL_DEFAULT_PREFIXES:
        if key.startswith(prefix):
            return {
                "key": key,
                "value": default,
                "updated_at": datetime.now(UTC),
            }
    return None


def _is_user_writable(key: str, user: User) -> bool:
    """Personal note keys are writable by the owning user only."""
    if key.startswith(_USER_WRITABLE_PREFIX):
        owner = key[len(_USER_WRITABLE_PREFIX):]
        return owner == user.username
    return False


def _setting_activity_payload(key: str, before: object, after: object) -> dict[str, object] | None:
    run_date_value = None
    for prefix in (
        "day_setup_source_",
        "wizard_completed_",
        "holiday_mode_",
        "holiday_load_",
        "holiday_unload_",
    ):
        if key.startswith(prefix):
            try:
                run_date_value = date.fromisoformat(key[len(prefix):])
            except ValueError:
                run_date_value = None
            break

    if key.startswith("day_setup_source_"):
        return {
            "event_family": "setup",
            "event_type": "day_setup_source_changed",
            "run_date": run_date_value,
            "summary": f"Setup source for {run_date_value or key} set to {after}",
        }
    if key.startswith("wizard_completed_"):
        return {
            "event_family": "setup",
            "event_type": "setup_day_completion_changed",
            "run_date": run_date_value,
            "summary": (
                f"Setup Day marked complete for {run_date_value or key}"
                if after is True else
                f"Setup Day completion cleared for {run_date_value or key}"
            ),
        }
    if key.startswith(("holiday_mode_", "holiday_load_", "holiday_unload_")):
        return {
            "event_family": "setup",
            "event_type": "holiday_flag_changed",
            "run_date": run_date_value,
            "summary": f"{key.split('_')[0].capitalize()} flag updated for {run_date_value or key}",
        }
    return None

@router.get("", response_model=list[SettingOut])
def list_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    all_settings = db.scalars(select(AppSetting).order_by(AppSetting.key)).all()
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
    if current_user.role not in _ADMIN_ROLES:
        if key not in _USER_READABLE_KEYS and not _is_user_writable(key, current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    setting = db.get(AppSetting, key)
    if setting is None:
        default_setting = _optional_default_setting(key)
        if default_setting is not None:
            return default_setting
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
    if current_user.role not in _ADMIN_ROLES and not _is_user_writable(key, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    setting = db.get(AppSetting, key)
    before_value = setting.value if setting is not None else None
    if setting is None:
        setting = AppSetting(key=key, value=payload.value)
        db.add(setting)
    else:
        setting.value = payload.value
    activity_payload = _setting_activity_payload(key, before_value, payload.value)
    if activity_payload is not None and before_value != payload.value:
        append_activity_event(
            db,
            actor_user=current_user,
            event_family=str(activity_payload["event_family"]),
            event_type=str(activity_payload["event_type"]),
            run_date=activity_payload.get("run_date"),
            summary=str(activity_payload["summary"]),
            diff_json={"setting_key": key, "before": before_value, "after": payload.value},
            context_json={"setting_key": key},
        )
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
    clear_factory = _CLEAR_TO_EMPTY_SETTING_FACTORIES.get(key)
    if clear_factory is not None:
        setting = db.get(AppSetting, key)
        if setting is None:
            setting = AppSetting(key=key, value=clear_factory())
            db.add(setting)
        else:
            setting.value = clear_factory()
        db.commit()
        return
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
