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
    # When on, assigning a batch no longer marks the truck unloaded, so the
    # paper batch sheet can be transcribed ahead of the actual unload.
    "prebatch_mode",
    "outside_timer_enabled",
    "paper_bay_enabled",
    "arrived_tracking_enabled",
    "note_cards_enabled",
    "realtime_toasts_enabled",
    "toast_settings",
    "tracked_items_map",
    "tracked_item_categories",
    # Notes that apply every run day, one set per workflow. The per-workday
    # notes live under the {scope}_day_notes_{1-5} prefixes.
    "unload_persistent_notes",
    "load_persistent_notes",
    "calculator_fab_enabled",
    "calendar_fab_enabled",
    "force_unloaded_on_new_day",
    "unload_page_style",
    # These five are written by the Management UI and read by the app, but were
    # never registered — so list_settings filtered them out for every non-admin
    # role (lead / atl / guest) and those sessions silently fell back to the
    # hardcoded client defaults: the floor saw a 1800 wearer cap whatever it was
    # set to, and timer countdowns that disagreed with a supervisor's.
    "wearer_cap",
    "shift_notes_enabled",
    "outside_timer_minutes",
    "paper_bay_timer_minutes",
    "recurring_route_swaps",
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
    # Read by every batching surface to show the "won't mark unloaded" banner,
    # so it must reach floor roles, not just admins.
    "prebatch_mode",
    "outside_timer_enabled",
    "paper_bay_enabled",
    "arrived_tracking_enabled",
    "note_cards_enabled",
    "realtime_toasts_enabled",
    # Per-pop-up enable + dwell time, one document keyed by alert kind. Read by
    # every session to decide what pops and for how long.
    "toast_settings",
    "tracked_items_map",
    # Sibling metadata to tracked_items_map (category existence + colour preset).
    # Every shortage-entry surface resolves its palette from this, so leaving it
    # admin-only meant non-admins logged a 403 per page and fell back to
    # uncoloured categories.
    "tracked_item_categories",
    "unload_persistent_notes",
    "load_persistent_notes",
    "calculator_fab_enabled",
    "calendar_fab_enabled",
    "force_unloaded_on_new_day",
    "unload_page_style",
    # Every one of these drives behaviour on a floor surface, so the roles
    # actually working the floor have to receive them.
    "wearer_cap",
    "shift_notes_enabled",
    "outside_timer_minutes",
    "paper_bay_timer_minutes",
    "recurring_route_swaps",
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
    # Next Up is unset on most days and the load timers poll it every ~10s, so
    # leaving it out produced a steady stream of 404s in the client log.
    ("runday_next_up_", None),
    # A corrected load order only exists for days someone actually fixed, so
    # the common case is "no override" rather than an error.
    ("load_order_", None),
)

# Per-run-date operational keys any authenticated session may READ. These are
# not a privilege — they are what the board needs to render itself correctly
# (which day is a holiday, which load/unload day is in effect, what's queued
# next). The board is already readable, so refusing these only produced a
# constant 403 stream that buried real errors, and left a non-admin viewing a
# board drawn with the wrong day flags. Writes are unaffected: those still go
# through the admin check below.
_USER_READABLE_PREFIXES: tuple[str, ...] = (
    "holiday_mode_",
    "holiday_load_",
    "holiday_unload_",
    "wizard_completed_",
    "daily_notes_",
    "load_day_override_",
    "unloads_day_override_",
    "runday_next_up_",
    "day_setup_source_",
    # Read so any surface can show the corrected order; WRITING still needs an
    # admin role, which is what makes this supervisor-only.
    "load_order_",
    # Standing per-workday notes and the batching wearer sheets. These drive
    # what the Unload, Batching and Load surfaces render for everyone, so
    # withholding them from non-admins meant a lead saw no sheet notes and no
    # wearer prefill at all — the floor is exactly who needs them.
    "unload_day_notes_",
    "unload_day_wearers_",
    "load_day_notes_",
)


def _is_user_readable(key: str, user: User) -> bool:
    return (
        key in _USER_READABLE_KEYS
        or key.startswith(_USER_READABLE_PREFIXES)
        or _is_user_writable(key, user)
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
    return [s for s in all_settings if _is_user_readable(s.key, current_user)]


# ---------------------------------------------------------------------------
# Get a single setting
# ---------------------------------------------------------------------------

@router.get("/{key}", response_model=SettingOut)
def get_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _ADMIN_ROLES and not _is_user_readable(key, current_user):
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
        is_setup = activity_payload.get("event_family") == "setup"
        append_activity_event(
            db,
            actor_user=None if is_setup else current_user,
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
    _admin: User = Depends(require_admin),
):
    """
    Accept a dict of {key: value} and upsert each one.
    Useful for seeding default settings on first run.

    Admin-gated like PUT/DELETE /settings/{key}: this writes ARBITRARY keys
    (wearer cap, holiday mode, feature toggles, censor list…), and it was
    reachable unauthenticated — anyone who could reach the API could rewrite
    the app's configuration. Nothing calls it programmatically, so requiring
    admin costs nothing.
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
