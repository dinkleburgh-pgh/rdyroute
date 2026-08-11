"""
Router: /settings

Key-value application settings store. Each setting is a JSON-serialisable
value stored under a string key. The React frontend and other routers can
read/write settings via these endpoints.
"""

import re
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
    # Who last confirmed the monthly wearer sheets, and for which month. Written
    # only through PUT /settings/wearer_defaults_review, which stamps the actor
    # server-side — see _stamp_wearer_defaults_review.
    "wearer_defaults_review",
}

# The monthly wearer-sheet review marker. Its value is server-stamped rather
# than taken from the client, so it lives behind its own constant and is
# refused by the bulk endpoint.
WEARER_DEFAULTS_REVIEW_KEY = "wearer_defaults_review"
_PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

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
    # Named by hand rather than by prefix, so widening who can see which member
    # of staff transcribed the sheets is a deliberate choice and not a
    # prefix-match accident. The sheet NUMBERS are already readable by every
    # authenticated role via the "unload_day_wearers_" entry in
    # _USER_READABLE_PREFIXES below; naming their author is the same class of
    # information the app already shows on notes and document uploads. Writing
    # is still admin/fleet/supervisor via the _ADMIN_ROLES check on PUT.
    "wearer_defaults_review",
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


def _stamp_wearer_defaults_review(before: object, payload_value: object, user: User) -> dict:
    """Build the wearer-sheet review marker, with the actor stamped server-side.

    The client sends only `period` and `changed_days`; everything identifying
    WHO confirmed is taken from the authenticated user here, so the identity
    cannot be forged through the generic PUT the way a client-supplied name
    could be.

    Two things about the return value are load-bearing:

    1. It must be a BRAND-NEW dict, never a mutation of `before`. AppSetting.value
       is a plain JSON column, not a MutableDict, so SQLAlchemy only notices a
       reassignment — an in-place edit would be silently dropped on flush.
    2. `confirmed_at` moves on every call, which is what makes the row dirty even
       when not a single wearer number changed. That is the entire monthly
       mechanic: "I checked August, nothing moved" has to be recordable, and
       today it is unrepresentable because an identical value writes nothing.
    """
    if not isinstance(payload_value, dict):
        raise HTTPException(status_code=422, detail="Expected an object")
    period = str(payload_value.get("period") or "")
    if not _PERIOD_RE.match(period):
        raise HTTPException(status_code=422, detail="period must be YYYY-MM")

    changed_days = sorted({
        int(d) for d in (payload_value.get("changed_days") or [])
        if isinstance(d, (int, str)) and str(d).isdigit() and 1 <= int(d) <= 5
    })

    prior = before if isinstance(before, dict) else {}
    prior_days = prior.get("days")
    # display_name is non-nullable with a "" default, so coalesce the same way
    # activity_log does rather than rendering an empty byline.
    stamp = {
        "period": period,
        "at": datetime.now(UTC).isoformat(),
        "by": user.username,
        "by_display": user.display_name or user.username,
    }
    return {
        "version": 1,
        "period": period,
        "confirmed_at": stamp["at"],
        "confirmed_by": stamp["by"],
        "confirmed_by_display": stamp["by_display"],
        "confirmed_by_role": getattr(user.role, "value", user.role),
        "changed_days": changed_days,
        # Per-day authorship is only credited for days that actually changed —
        # confirming a month you didn't retype shouldn't put your name on all
        # five sheets. Older entries carry forward.
        "days": {
            **(dict(prior_days) if isinstance(prior_days, dict) else {}),
            **{str(d): stamp for d in changed_days},
        },
    }


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

    # "actor" decides whether the event is attributed to the signed-in user or
    # to the system. The three keys below stay "system" deliberately: they are
    # written by day rollover off a plain GET /trucks/board, so the "actor"
    # would be whoever happened to load the board first — worse than "System".
    if key.startswith("day_setup_source_"):
        return {
            "event_family": "setup",
            "event_type": "day_setup_source_changed",
            "run_date": run_date_value,
            "actor": "system",
            "summary": f"Setup source for {run_date_value or key} set to {after}",
        }
    if key.startswith("wizard_completed_"):
        return {
            "event_family": "setup",
            "event_type": "setup_day_completion_changed",
            "run_date": run_date_value,
            "actor": "system",
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
            "actor": "system",
            "summary": f"{key.split('_')[0].capitalize()} flag updated for {run_date_value or key}",
        }
    if key == WEARER_DEFAULTS_REVIEW_KEY and isinstance(after, dict):
        changed = after.get("changed_days") or []
        return {
            # "batch" rather than "setup" because of the actor rule above: a
            # "setup" family event is recorded as System, which would reproduce
            # the exact missing-"who" this feature exists to fix. "batch" is
            # already in the ActivityEventFamily literal and already has a badge
            # colour and a filter chip, so nothing else has to change.
            "event_family": "batch",
            "event_type": "wearer_defaults_confirmed",
            "run_date": None,
            "actor": "user",
            "summary": (
                f"Wearer sheets confirmed for {after.get('period')} — "
                + (
                    f"days {', '.join(str(d) for d in changed)} updated"
                    if changed else "no changes"
                )
            ),
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

    # Server-stamped keys ignore most of what the client sent. Everything below
    # writes new_value, never payload.value.
    new_value = payload.value
    if key == WEARER_DEFAULTS_REVIEW_KEY:
        new_value = _stamp_wearer_defaults_review(before_value, payload.value, current_user)

    if setting is None:
        setting = AppSetting(key=key, value=new_value)
        db.add(setting)
    else:
        setting.value = new_value
    activity_payload = _setting_activity_payload(key, before_value, new_value)
    if activity_payload is not None and before_value != new_value:
        # Was `event_family == "setup"`, which every branch returned — so the
        # user arm was unreachable and every setting change in the app logged as
        # System. Attribution is now stated per payload instead of inferred.
        actor = activity_payload.get("actor", "system")
        append_activity_event(
            db,
            actor_user=current_user if actor == "user" else None,
            event_family=str(activity_payload["event_family"]),
            event_type=str(activity_payload["event_type"]),
            run_date=activity_payload.get("run_date"),
            summary=str(activity_payload["summary"]),
            diff_json={"setting_key": key, "before": before_value, "after": new_value},
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
        if key == WEARER_DEFAULTS_REVIEW_KEY:
            # This key's whole point is that the server stamps who confirmed.
            # Letting it through here would accept a forged confirmed_by.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Managed key — use PUT /settings/{WEARER_DEFAULTS_REVIEW_KEY}",
            )
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
