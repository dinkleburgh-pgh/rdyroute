"""
Pydantic schemas for request validation and response serialisation.
Each section mirrors a SQLAlchemy model in models.py.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models import AuditSource, AuthRequestStatus, AuthRole, NoteType, TruckStatus, TruckType

TruckStateSource = Literal["auto", "wizard", "workflow"]
ActivityActorType = Literal["user", "system"]
ActivityEventFamily = Literal["state", "batch", "coverage", "setup", "recovery", "system"]


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

class _OrmBase(BaseModel):
    """Shared config that enables ORM-mode (from_attributes) on all schemas."""
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Truck & Fleet
# ---------------------------------------------------------------------------

class TruckCreate(BaseModel):
    truck_number: int = Field(..., ge=1, le=999)
    truck_type: TruckType = TruckType.uniform
    is_persistent_spare: bool = False
    scheduled_off_days: list[int] = Field(default_factory=list)


class TruckUpdate(BaseModel):
    truck_type: TruckType | None = None
    is_active: bool | None = None
    is_persistent_spare: bool | None = None
    is_oos: bool | None = None
    uniform_size: str | None = None
    scheduled_off_days: list[int] | None = None


class TruckOut(_OrmBase):
    id: int
    truck_number: int
    truck_type: TruckType
    is_active: bool
    is_persistent_spare: bool
    is_oos: bool
    uniform_size: str | None = None
    scheduled_off_days: list[int]
    qr_token: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Truck State
# ---------------------------------------------------------------------------

class TruckStateCreate(BaseModel):
    truck_number: int
    run_date: date
    status: TruckStatus = TruckStatus.dirty
    wearers: int = Field(default=0, ge=0)
    batch_id: int | None = None
    load_day_num: int | None = Field(default=None, ge=1, le=7)
    load_start_time: float | None = None
    load_finish_time: float | None = None
    load_duration_seconds: int | None = None
    off_note: str = ""
    shop_note: str = ""
    oos_spare_route: int | None = None
    has_dust_garment: bool = False
    priority_hold: bool = False
    needs_checked: bool = False
    arrived_at: float | None = None
    state_source: TruckStateSource | None = None


class TruckStateUpdate(BaseModel):
    status: TruckStatus | None = None
    wearers: int | None = Field(default=None, ge=0)
    batch_id: int | None = None
    load_day_num: int | None = Field(default=None, ge=1, le=7)
    load_start_time: float | None = None
    load_finish_time: float | None = None
    load_duration_seconds: int | None = None
    off_note: str | None = None
    shop_note: str | None = None
    oos_spare_route: int | None = None
    has_dust_garment: bool | None = None
    priority_hold: bool | None = None
    needs_checked: bool | None = None
    arrived_at: float | None = None
    state_source: TruckStateSource | None = None


class TruckStateOut(_OrmBase):
    id: int
    truck_number: int
    run_date: date
    status: TruckStatus
    wearers: int
    batch_id: int | None
    load_day_num: int | None
    load_start_time: float | None
    load_finish_time: float | None
    load_duration_seconds: int | None
    off_note: str
    shop_note: str
    oos_spare_route: int | None
    has_dust_garment: bool
    priority_hold: bool = False
    needs_checked: bool = False
    arrived_at: float | None = None
    state_source: TruckStateSource
    updated_at: datetime


class TruckWithState(_OrmBase):
    """Combined truck + current-day state, used by the dashboard endpoint."""
    id: int
    truck_number: int
    truck_type: TruckType
    is_active: bool
    is_persistent_spare: bool
    is_oos: bool = False
    scheduled_off_days: list[int] = Field(default_factory=list)
    qr_token: str | None = None
    state: TruckStateOut | None = None
    route_swap_route: int | None = None  # set when this truck is the load_on_truck in a route swap


# ---------------------------------------------------------------------------
# Activity Events
# ---------------------------------------------------------------------------

class ActivityEventOut(_OrmBase):
    id: int
    occurred_at: datetime
    actor_type: ActivityActorType
    actor_username: str | None = None
    actor_display_name: str | None = None
    actor_role: AuthRole | None = None
    event_family: ActivityEventFamily
    event_type: str
    run_date: date | None = None
    truck_number: int | None = None
    summary: str
    status_before: str | None = None
    status_after: str | None = None
    diff_json: dict[str, Any] = Field(default_factory=dict)
    context_json: dict[str, Any] = Field(default_factory=dict)


class ActivityEventPageOut(BaseModel):
    items: list[ActivityEventOut]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Load Duration
# ---------------------------------------------------------------------------

class LoadDurationCreate(BaseModel):
    truck_number: int
    run_date: date
    duration_seconds: int = Field(..., ge=30, le=7200)
    load_day_num: int | None = Field(default=None, ge=1, le=7)


class LoadDurationOut(_OrmBase):
    id: int
    truck_number: int
    run_date: date
    duration_seconds: int
    load_day_num: int | None
    recorded_at: datetime


# ---------------------------------------------------------------------------
# Shortages
# ---------------------------------------------------------------------------

class ShortageCreate(BaseModel):
    truck_number: int
    run_date: date
    item_category: str = Field(..., min_length=1, max_length=120)
    item_detail: str = Field(default="", max_length=120)
    quantity: int = Field(default=1, ge=1)
    initials: str = Field(default="", max_length=20)
    initials_ts: float | None = None


class ShortageUpdate(BaseModel):
    item_category: str | None = Field(default=None, max_length=120)
    item_detail: str | None = Field(default=None, max_length=120)
    quantity: int | None = Field(default=None, ge=1)
    initials: str | None = Field(default=None, max_length=20)


class ShortageOut(_OrmBase):
    id: int
    truck_number: int
    run_date: date
    item_category: str
    item_detail: str
    quantity: int
    initials: str
    initials_ts: float | None
    recorded_at: datetime


# ---------------------------------------------------------------------------
# Shortage Sheet Imports
# ---------------------------------------------------------------------------

class ShortageSheetRowDraftCreate(BaseModel):
    truck_number: int = Field(..., ge=1, le=999)
    source_column_index: int | None = Field(default=None, ge=1, le=16)
    item_category: str = Field(..., min_length=1, max_length=120)
    item_detail: str = Field(default="", max_length=120)
    quantity: int = Field(default=1, ge=1)
    initials: str = Field(default="", max_length=20)
    raw_text: str = Field(default="", max_length=4000)
    review_status: str = Field(default="accepted", pattern="^(needs_review|accepted|rejected)$")
    reviewer_note: str = Field(default="", max_length=2000)
    confidence_score: float | None = Field(default=None, ge=0, le=1)
    source_photo_id: str | None = Field(default=None, max_length=64)


class ShortageSheetRowDraftUpdate(BaseModel):
    truck_number: int | None = Field(default=None, ge=1, le=999)
    source_column_index: int | None = Field(default=None, ge=1, le=16)
    item_category: str | None = Field(default=None, min_length=1, max_length=120)
    item_detail: str | None = Field(default=None, max_length=120)
    quantity: int | None = Field(default=None, ge=1)
    initials: str | None = Field(default=None, max_length=20)
    raw_text: str | None = Field(default=None, max_length=4000)
    review_status: str | None = Field(default=None, pattern="^(needs_review|accepted|rejected)$")
    reviewer_note: str | None = Field(default=None, max_length=2000)
    confidence_score: float | None = Field(default=None, ge=0, le=1)
    source_photo_id: str | None = Field(default=None, max_length=64)


class ShortageSheetPhotoOut(_OrmBase):
    id: str
    import_id: str
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_at: datetime


class ShortageSheetColumnDraftOut(BaseModel):
    column_index: int
    truck_number: int | None = None
    route_number: int | None = None
    initials: str = ""
    confidence_score: float | None = None
    issues: list[str] = Field(default_factory=list)
    review_status: str = Field(default="needs_review")
    source_photo_id: str | None = None


class ShortageSheetColumnDraftUpdate(BaseModel):
    truck_number: int | None = Field(default=None, ge=1, le=999)
    route_number: int | None = Field(default=None, ge=1, le=999)
    initials: str | None = Field(default=None, max_length=20)
    review_status: str | None = Field(default=None, pattern="^(needs_review|accepted|rejected)$")
    reviewer_note: str | None = Field(default=None, max_length=2000)
    source_photo_id: str | None = Field(default=None, max_length=64)


class ShortageSheetRowDraftOut(_OrmBase):
    id: int
    import_id: str
    source_photo_id: str | None
    source_column_index: int | None
    row_index: int
    truck_number: int | None
    item_category: str
    item_detail: str
    quantity: int | None
    initials: str
    raw_text: str
    confidence_score: float | None
    issues: list[str]
    review_status: str
    reviewer_note: str
    created_at: datetime
    updated_at: datetime


class ShortageSheetImportOut(_OrmBase):
    id: str
    run_date: date
    status: str
    extraction_mode: str
    sheet_template_id: str
    uploaded_by_user_id: int | None
    uploaded_by_username: str
    reviewed_by_username: str | None
    applied_by_username: str | None
    error_message: str
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None
    applied_at: datetime | None
    photo_count: int = 0
    row_count: int = 0
    needs_review_count: int = 0


class ShortageSheetImportDetailOut(ShortageSheetImportOut):
    photos: list[ShortageSheetPhotoOut] = Field(default_factory=list)
    header_columns: list[ShortageSheetColumnDraftOut] = Field(default_factory=list)
    rows: list[ShortageSheetRowDraftOut] = Field(default_factory=list)


class ShortageSheetTemplateRowOut(BaseModel):
    row_key: str
    printed_label: str
    item_category: str
    item_detail: str


class ShortageSheetTemplateOut(BaseModel):
    id: str
    name: str
    description: str
    top_3x10_order: list[str] = Field(default_factory=list)
    footer_fields: list[str] = Field(default_factory=list)
    row_keys: list[str] = Field(default_factory=list)
    rows: list[ShortageSheetTemplateRowOut] = Field(default_factory=list)


class ShortageSheetOllamaStatusOut(BaseModel):
    configured: bool
    reachable: bool
    model_available: bool
    base_url: str
    model: str
    timeout_seconds: int
    low_confidence_threshold: float
    preprocess_max_image_side: int
    available_models: list[str] = Field(default_factory=list)
    error: str | None = None


class ShortageSheetOllamaProbeIn(BaseModel):
    base_url: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=200)
    timeout_seconds: int | None = Field(default=None, ge=1, le=300)
    low_confidence_threshold: float | None = Field(default=None, ge=0, le=1)
    preprocess_max_image_side: int | None = Field(default=None, ge=600, le=6000)


class ShortageSheetImportReject(BaseModel):
    reason: str = Field(default="", max_length=2000)


class ShortageSheetOcrMemoryStatusOut(BaseModel):
    example_count: int = 0
    accepted_example_count: int = 0
    header_example_count: int = 0
    accepted_header_example_count: int = 0
    template_ids: list[str] = Field(default_factory=list)
    last_reviewed_at: datetime | None = None
    last_header_reviewed_at: datetime | None = None
    model_hint: str = ""
    adapter_export_supported: bool = True
    header_adapter_export_supported: bool = True


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditEntryCreate(BaseModel):
    truck_number: int
    run_date: date
    item_label: str = Field(..., min_length=1, max_length=120)
    quantity: int = Field(default=1, ge=1)
    note: str = Field(default="", max_length=1000)
    source: AuditSource = AuditSource.workflow
    warn_on_next_load: bool = False
    route_override: int | None = None
    applied_day_override: int | None = Field(default=None, ge=1, le=7)


class AuditEntryUpdate(BaseModel):
    warn_on_next_load: bool | None = None
    warning_applied: bool | None = None
    note: str | None = Field(default=None, max_length=1000)


class AuditEntryOut(_OrmBase):
    id: str
    truck_number: int
    run_date: date
    item_label: str
    quantity: int
    note: str
    source: AuditSource
    warn_on_next_load: bool
    warning_applied: bool
    route_override: int | None
    applied_day_override: int | None
    recorded_at: datetime


class AuditPhotoOut(_OrmBase):
    id: str
    truck_number: int
    run_date: date
    entry_id: str | None
    file_name: str
    mime_type: str
    size_bytes: int
    caption: str
    uploaded_by: str
    uploaded_at: datetime


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------

class BatchAssign(BaseModel):
    """Assign a single truck to a batch."""
    run_date: date
    batch_number: int = Field(..., ge=1, le=6)
    truck_number: int
    wearers: int = Field(default=0, ge=0)


class BatchOut(_OrmBase):
    id: int
    run_date: date
    batch_number: int
    truck_number: int
    wearers: int
    assigned_at: datetime


class BatchTruck(BaseModel):
    """Per-truck detail within a batch summary."""
    truck_number: int
    wearers: int


class BatchSummary(BaseModel):
    """Aggregated view of a single batch — list of trucks and total wearers."""
    run_date: date
    batch_number: int
    trucks: list[BatchTruck]
    total_wearers: int


class BatchHistoryCreate(BaseModel):
    run_date: date
    truck_number: int
    batch_number: int | None = None
    wearers: int = Field(default=0, ge=0)
    action: str = Field(default="assign", max_length=20)


class BatchHistoryOut(_OrmBase):
    id: int
    run_date: date
    truck_number: int
    batch_number: int | None
    wearers: int
    action: str
    recorded_at: datetime


# ---------------------------------------------------------------------------
# Auth — Users
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=80)
    password: str = Field(..., min_length=5)
    role: AuthRole = AuthRole.loader
    display_name: str = Field(default="", max_length=120)


class UserUpdate(BaseModel):
    role: AuthRole | None = None
    display_name: str | None = Field(default=None, max_length=120)
    is_enabled: bool | None = None


class UserPasswordUpdate(BaseModel):
    new_password: str = Field(..., min_length=5)


class UserOut(_OrmBase):
    id: int
    username: str
    role: AuthRole
    display_name: str
    display_role: str | None
    is_enabled: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Auth — Requests
# ---------------------------------------------------------------------------

class AuthRequestCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=80)
    requested_role: AuthRole
    display_name: str = Field(default="", max_length=120)


class AuthRequestResolve(BaseModel):
    status: AuthRequestStatus
    resolved_by: str = Field(..., min_length=1, max_length=80)


class AuthRequestOut(_OrmBase):
    id: int
    username: str
    requested_role: AuthRole
    display_name: str
    status: AuthRequestStatus
    requested_at: datetime
    resolved_at: datetime | None
    resolved_by: str | None


# ---------------------------------------------------------------------------
# Auth — Login / Sessions
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: AuthRole
    username: str


class SessionOut(_OrmBase):
    id: str
    username: str
    role: str
    created_ts: float
    expires_ts: float
    ip_address: str | None
    user_agent: str | None


# ---------------------------------------------------------------------------
# Communications
# ---------------------------------------------------------------------------

class MessageCreate(BaseModel):
    channel: str = Field(default="Team", max_length=80)
    username: str = Field(..., min_length=1, max_length=80)
    sender_role: str | None = None
    message: str = Field(..., min_length=1, max_length=1000)


class MessageOut(_OrmBase):
    id: str
    channel: str
    username: str
    sender_role: str | None
    message: str
    is_deleted: bool
    sent_ts: float
    sent_at: datetime


# ---------------------------------------------------------------------------
# Spare Assignments
# ---------------------------------------------------------------------------

class SpareAssignCreate(BaseModel):
    run_date: date
    spare_truck_number: int
    covering_route_truck: int


class SpareAssignReturn(BaseModel):
    returned_at: datetime


class SpareAssignOut(_OrmBase):
    id: int
    run_date: date
    spare_truck_number: int
    covering_route_truck: int
    returned: bool
    assigned_at: datetime
    returned_at: datetime | None


# ---------------------------------------------------------------------------
# Route Swaps
# ---------------------------------------------------------------------------

class RouteSwapCreate(BaseModel):
    run_date: date
    route_truck: int = Field(..., ge=1, le=999)
    load_on_truck: int = Field(..., ge=1, le=999)
    two_way: bool = Field(default=False, description="Also create the reciprocal swap row")


class RouteSwapOut(_OrmBase):
    id: int
    run_date: date
    route_truck: int
    load_on_truck: int
    created_at: datetime


class RouteSwapLogOut(_OrmBase):
    id: int
    run_date: date
    route_truck: int
    load_on_truck: int
    created_at: datetime


# ---------------------------------------------------------------------------
# Notices
# ---------------------------------------------------------------------------

class NoticeCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    body: str = Field(default="", max_length=4000)
    severity: str = Field(default="info", pattern="^(info|warn|critical)$")
    expires_at: datetime | None = None


class NoticeUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, max_length=4000)
    severity: str | None = Field(default=None, pattern="^(info|warn|critical)$")
    is_active: bool | None = None
    expires_at: datetime | None = None


class NoticeOut(_OrmBase):
    id: int
    title: str
    body: str
    severity: str
    is_active: bool
    created_by: str
    created_at: datetime
    expires_at: datetime | None


# ---------------------------------------------------------------------------
# Truck Notes
# ---------------------------------------------------------------------------

class NoteCreate(BaseModel):
    truck_number: int = Field(..., ge=1, le=999)
    note_type: NoteType = NoteType.constant
    body: str = Field(..., min_length=1, max_length=2000)
    workday_num: int | None = Field(default=None, ge=1, le=5)
    expires_on: date | None = None

    @field_validator("workday_num")
    @classmethod
    def _workday_required_for_workday_type(cls, v: int | None, info: Any) -> int | None:
        if hasattr(info, "data") and info.data.get("note_type") == NoteType.workday and v is None:
            raise ValueError("workday_num is required for workday notes")
        return v


class NoteUpdate(BaseModel):
    note_type: NoteType | None = None
    body: str | None = Field(default=None, min_length=1, max_length=2000)
    workday_num: int | None = Field(default=None, ge=1, le=5)
    expires_on: date | None = None
    is_active: bool | None = None


class NoteOut(_OrmBase):
    id: int
    truck_number: int
    note_type: NoteType
    body: str
    workday_num: int | None
    expires_on: date | None
    is_active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# App Settings
# ---------------------------------------------------------------------------

class SettingUpsert(BaseModel):
    value: Any


class SettingOut(_OrmBase):
    key: str
    value: Any
    updated_at: datetime


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(..., min_length=1)
    auth: str = Field(..., min_length=1)


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(..., min_length=1)
    keys: PushSubscriptionKeys
    device_label: str | None = Field(default=None, max_length=120)
    user_agent: str | None = Field(default=None, max_length=512)


class PushSubscriptionRemove(BaseModel):
    endpoint: str = Field(..., min_length=1)


class PushSubscriptionOut(_OrmBase):
    id: int
    user_id: int
    endpoint: str
    device_label: str | None
    user_agent: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime


class NotificationConfigOut(BaseModel):
    configured: bool
    subscription_count: int


class NotificationPublicKeyOut(BaseModel):
    configured: bool
    public_key: str | None = None


class NotificationEventOut(BaseModel):
    type: str
    title: str
    body: str
    tag: str
    url: str
    truck_number: int | None = None
    route_truck: int | None = None
    covering_truck: int | None = None
    run_date: date | None = None


class NotificationTestRequest(BaseModel):
    endpoint: str | None = None


# ---------------------------------------------------------------------------
# Trend / Analytics
# ---------------------------------------------------------------------------

class TrendDailyPoint(BaseModel):
    run_date: date
    total_qty: int
    entry_count: int


class TrendSummary(BaseModel):
    total_qty: int
    avg_per_day: float
    peak_day: date | None
    peak_qty: int
    entry_count: int
    days_with_data: int
    trend_direction: str  # "up" | "down" | "stable"
    change_vs_prior_pct: float | None
    daily_series: list[TrendDailyPoint]


class TrendTruckPoint(BaseModel):
    run_date: date
    total_qty: int


class TrendRoutePoint(BaseModel):
    run_date: date
    total_qty: int


class TrendTruckPoint(BaseModel):
    run_date: date
    total_qty: int


class TrendRoutePoint(BaseModel):
    run_date: date
    total_qty: int


class TrendComparison(BaseModel):
    current: list[TrendDailyPoint]
    prior: list[TrendDailyPoint]

# ---------------------------------------------------------------------------
# Load-pace trend types
# ---------------------------------------------------------------------------

class PaceDailyPoint(BaseModel):
    run_date: date
    avg_seconds: float
    load_count: int


class CompletionDailyPoint(BaseModel):
    run_date: date
    total_trucks: int
    loaded_trucks: int
    pct: float


class WearersDailyPoint(BaseModel):
    run_date: date
    avg_wearers: float
    truck_count: int


class CycleDailyPoint(BaseModel):
    run_date: date
    avg_seconds: float
    truck_count: int


class ShortageDailyPoint(BaseModel):
    run_date: date
    total_qty: int
    entry_count: int


class ShortageCategoryPoint(BaseModel):
    category: str
    total_qty: int


class ShortageSummary(BaseModel):
    total_qty: int
    avg_per_day: float
    peak_day: date | None
    peak_qty: int
    entry_count: int
    days_with_data: int
    trend_direction: str  # "up" | "down" | "stable"
    change_vs_prior_pct: float | None
    daily_series: list[ShortageDailyPoint]


class QualityRatePoint(BaseModel):
    run_date: date
    loaded_trucks: int
    audit_entry_count: int
    audit_qty: int
    discrepancy_rate: float | None   # audit_entry_count / loaded_trucks; lower = better
    items_per_truck: float | None    # audit_qty / loaded_trucks; lower = better


class QualityRateSummary(BaseModel):
    avg_items_per_truck: float | None   # total audit qty / total loaded trucks
    avg_discrepancy_rate: float | None  # total audit entries / total loaded trucks
    days_with_data: int
    trend_direction: str
    change_vs_prior_pct: float | None
    daily_series: list[QualityRatePoint]


class AnomalyDay(BaseModel):
    run_date: date
    metric: str           # "completion", "pace", "wearers", "audit_volume"
    value: float
    mean: float
    sigma: float
    z_score: float
