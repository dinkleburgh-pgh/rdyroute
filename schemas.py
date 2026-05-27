"""
Pydantic schemas for request validation and response serialisation.
Each section mirrors a SQLAlchemy model in models.py.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models import AuditSource, AuthRequestStatus, AuthRole, TruckStatus, TruckType


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
    scheduled_off_days: list[int] | None = None


class TruckOut(_OrmBase):
    id: int
    truck_number: int
    truck_type: TruckType
    is_active: bool
    is_persistent_spare: bool
    is_oos: bool
    scheduled_off_days: list[int]
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
    state: TruckStateOut | None = None
    route_swap_route: int | None = None  # set when this truck is the load_on_truck in a route swap


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
# App Settings
# ---------------------------------------------------------------------------

class SettingUpsert(BaseModel):
    value: Any


class SettingOut(_OrmBase):
    key: str
    value: Any
    updated_at: datetime
