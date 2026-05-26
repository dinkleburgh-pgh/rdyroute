"""
Router: /settings

Key-value application settings store.  Replaces the ad-hoc fields that were
scattered across the V1 JSON state file (timezone_key, ui_theme, warn_seconds,
badge colors, pace parameters, off_schedule, etc.).

Each setting is a JSON-serialisable value stored under a string key.  The
React frontend and other routers can read/write settings via these endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AppSetting
from schemas import SettingOut, SettingUpsert

router = APIRouter(prefix="/settings", tags=["settings"])

# ---------------------------------------------------------------------------
# Well-known setting keys (informational; not enforced at the API boundary)
# ---------------------------------------------------------------------------
KNOWN_KEYS = {
    "timezone_key",
    "ui_theme",
    "warn_seconds",
    "rollover_prompt_hour",
    "rollover_snooze_minutes",
    "auto_refresh_ms",
    "pace_avg_override_enabled",
    "pace_avg_override_seconds",
    "pace_buffer_base_seconds",
    "pace_buffer_per_truck_seconds",
    "pace_buffer_percent",
    "pace_loader_baseline_count",
    "pace_loader_active_count",
    "status_badge_colors",
    "off_schedule",
    "shorts_mode",
    "tracked_items_map",
    "inprog_layout_style",
    "skip_batching_disabled",
    "batching_disabled",
    "role_workflow_settings",
    "communications_censor_words",
}


# ---------------------------------------------------------------------------
# List all settings
# ---------------------------------------------------------------------------

@router.get("", response_model=list[SettingOut])
def list_settings(db: Session = Depends(get_db)):
    return db.scalars(select(AppSetting).order_by(AppSetting.key)).all()


# ---------------------------------------------------------------------------
# Get a single setting
# ---------------------------------------------------------------------------

@router.get("/{key}", response_model=SettingOut)
def get_setting(key: str, db: Session = Depends(get_db)):
    setting = db.get(AppSetting, key)
    if setting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Setting '{key}' not found")
    return setting


# ---------------------------------------------------------------------------
# Upsert a setting
# ---------------------------------------------------------------------------

@router.put("/{key}", response_model=SettingOut)
def upsert_setting(key: str, payload: SettingUpsert, db: Session = Depends(get_db)):
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
def delete_setting(key: str, db: Session = Depends(get_db)):
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
