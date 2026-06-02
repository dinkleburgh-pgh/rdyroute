"""
SQLAlchemy ORM models derived from the V1 Streamlit application data structures.

Entity map:
  Truck              — fleet member record (number, type, active flag)
  TruckState         — one row per (truck, run_date); tracks live operational status
  LoadDuration       — historical load-time record used for pace calculations
  Shortage           — shortage items recorded per truck per run-date
  AuditEntry         — items removed / flagged during audit workflow
  Batch              — truck-to-batch assignment (batches 1-6) per run-date
  BatchHistory       — append-only wearer-count record used by trends
  User               — authenticated system users with RBAC roles
  AuthRequest        — self-service account requests awaiting admin approval
  Session            — server-side session tokens (survive server restarts)
  CommunicationMessage — team-chat messages
  SpareAssignment    — maps a spare truck to the route truck it covers
  AppSetting         — key/value store for runtime configuration
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class TruckStatus(str, enum.Enum):
    dirty = "dirty"
    unfinished = "unfinished"
    shop = "shop"
    in_progress = "in_progress"
    unloaded = "unloaded"
    loaded = "loaded"
    off = "off"
    oos = "oos"
    spare = "spare"


class TruckType(str, enum.Enum):
    uniform = "Uniform"
    dust = "Dust"
    spare = "Spare"


class AuthRole(str, enum.Enum):
    admin = "admin"        # super-admin (ready account)
    fleet = "fleet"        # admin
    atl = "atl"
    supervisor = "supervisor"
    lead = "lead"
    loader = "loader"
    unloader = "unloader"
    guest = "guest"


class AuthRequestStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"


class NoteType(str, enum.Enum):
    constant = "constant"    # shown every shift
    workday  = "workday"     # shown only when workday_num matches the current load/unload day
    one_off  = "one_off"     # shown until expires_on date, then archived


class AuditSource(str, enum.Enum):
    workflow = "workflow"
    manual = "manual"
    mobile = "mobile"


# ---------------------------------------------------------------------------
# Truck & Fleet
# ---------------------------------------------------------------------------

class Truck(Base):
    """Master fleet record for a truck number."""
    __tablename__ = "trucks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    truck_number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    truck_type: Mapped[str] = mapped_column(
        SAEnum(TruckType, name="truck_type_enum"), nullable=False, default=TruckType.uniform
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_persistent_spare: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_oos: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    scheduled_off_days: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    qr_token: Mapped[str | None] = mapped_column(
        String(36), unique=True, nullable=True, index=True,
        default=lambda: str(uuid.uuid4()),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    states: Mapped[list["TruckState"]] = relationship("TruckState", back_populates="truck_ref", cascade="all, delete-orphan")


class TruckState(Base):
    """
    Operational state of a single truck on a specific run-date.
    One row is created (or upserted) per (truck_number, run_date) pair each shift.
    """
    __tablename__ = "truck_states"
    __table_args__ = (UniqueConstraint("truck_number", "run_date", name="uq_truck_state_truck_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    truck_number: Mapped[int] = mapped_column(
        Integer, ForeignKey("trucks.truck_number", ondelete="CASCADE"), nullable=False, index=True
    )
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        SAEnum(TruckStatus, name="truck_status_enum"), nullable=False, default=TruckStatus.dirty
    )
    # Wearer count assigned to this truck (from batching workflow)
    wearers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Batch assignment (1-6, NULL = not yet batched)
    batch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Load day within the run-date (trucks can be loaded multiple times; 1-5 day-of-week)
    load_day_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Unix timestamps for pace calculation
    load_start_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    load_finish_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    load_duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Notes
    off_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    shop_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Spare / OOS coverage
    oos_spare_route: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Dust garment flag
    has_dust_garment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    truck_ref: Mapped["Truck"] = relationship("Truck", back_populates="states")


# ---------------------------------------------------------------------------
# Load Duration History (used for pace estimate averages)
# ---------------------------------------------------------------------------

class LoadDuration(Base):
    """
    Append-only record of how many seconds it took to load a truck.
    Used by pace estimate calculations in the supervisor view.
    """
    __tablename__ = "load_durations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    load_day_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Shortages
# ---------------------------------------------------------------------------

class Shortage(Base):
    """
    Short item recorded against a truck during the loading workflow.
    Corresponds to the 'shorts' dict in V1 state.
    """
    __tablename__ = "shortages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    item_category: Mapped[str] = mapped_column(String(120), nullable=False)
    item_detail: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Initials of the person who recorded the shortage
    initials: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    initials_ts: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditEntry(Base):
    """
    Audit log entry — an item that was removed or flagged during an audit.
    Corresponds to the audit_history JSON file in V1.
    """
    __tablename__ = "audit_entries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)   # UUID hex
    truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    item_label: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(
        SAEnum(AuditSource, name="audit_source_enum"), nullable=False, default=AuditSource.workflow
    )
    warn_on_next_load: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    warning_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Optional overrides used for multi-day routes
    route_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    applied_day_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AuditPhoto(Base):
    """
    Photo attached to an audit (optionally linked to an AuditEntry).
    Files are stored on disk under ``./audit_photos/{YYYY-MM-DD}/{id}{ext}``;
    only metadata lives in the DB. Mirrors V1's audit photo archive feature.
    """
    __tablename__ = "audit_photos"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)   # UUID hex
    truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    entry_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("audit_entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    caption: Mapped[str] = mapped_column(Text, nullable=False, default="")
    uploaded_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Batches
# ---------------------------------------------------------------------------

class Batch(Base):
    """
    Associates a truck with a batch number (1-6) for a given run-date.
    Batches group trucks so loaders can work in parallel.
    """
    __tablename__ = "batches"
    __table_args__ = (UniqueConstraint("run_date", "batch_number", "truck_number", name="uq_batch_truck_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    batch_number: Mapped[int] = mapped_column(Integer, nullable=False)   # 1-6
    truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    wearers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class BatchHistory(Base):
    """
    Append-only wearer assignment history used by the Trends screen.
    Corresponds to batch_history.json in V1.
    """
    __tablename__ = "batch_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    batch_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wearers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    action: Mapped[str] = mapped_column(String(20), nullable=False, default="assign")
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class User(Base):
    """System user with an RBAC role."""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(
        SAEnum(AuthRole, name="auth_role_enum"), nullable=False, default=AuthRole.loader
    )
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    display_role: Mapped[str | None] = mapped_column(String(80), nullable=True, default=None)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AuthRequest(Base):
    """Self-service account request submitted from the login portal."""
    __tablename__ = "auth_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    requested_role: Mapped[str] = mapped_column(
        SAEnum(AuthRole, name="auth_req_role_enum"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    status: Mapped[str] = mapped_column(
        SAEnum(AuthRequestStatus, name="auth_req_status_enum"),
        nullable=False,
        default=AuthRequestStatus.pending,
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(80), nullable=True)


class Session(Base):
    """Server-side session token so auth survives Streamlit (now FastAPI) restarts."""
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)   # UUID hex
    username: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    created_ts: Mapped[float] = mapped_column(Float, nullable=False)
    expires_ts: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(256), nullable=True)


# ---------------------------------------------------------------------------
# Communications
# ---------------------------------------------------------------------------

class CommunicationMessage(Base):
    """Team-chat message. Soft-deleted rather than hard-deleted."""
    __tablename__ = "communication_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)   # UUID hex
    channel: Mapped[str] = mapped_column(String(80), nullable=False, default="Team", index=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    sender_role: Mapped[str | None] = mapped_column(String(30), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sent_ts: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Spare Assignments
# ---------------------------------------------------------------------------

class SpareAssignment(Base):
    """
    Records that a spare truck is covering a route truck on a given run-date.
    Corresponds to oos_spare_assignments / spare_origin_route in V1 state.
    """
    __tablename__ = "spare_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    spare_truck_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    covering_route_truck: Mapped[int] = mapped_column(Integer, nullable=False)
    returned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Route Swaps (V1: route_swap_assignments)
# ---------------------------------------------------------------------------

class RouteSwap(Base):
    """
    Records that one truck is loading another truck's route on a given run-date.
    Corresponds to route_swap_assignments in V1 state.

    A two-way swap (Truck A ↔ Truck B) is stored as two rows:
      (route_truck=A, load_on_truck=B) and (route_truck=B, load_on_truck=A).

    Unique constraint prevents a route from having multiple load-on assignments
    on the same date.
    """
    __tablename__ = "route_swaps"
    __table_args__ = (
        UniqueConstraint("run_date", "route_truck", name="uq_route_swap_date_route"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # The truck whose route is being run (who is absent / in shop)
    route_truck: Mapped[int] = mapped_column(Integer, nullable=False)
    # The truck who is actually loading this route today
    load_on_truck: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Notices (Run Day banner)
# ---------------------------------------------------------------------------

class Notice(Base):
    """
    Short operational notice shown in the Run Day banner.
    Active notices are shown until ``expires_at`` passes or ``is_active`` is cleared.
    """
    __tablename__ = "notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="info")  # info|warn|critical
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# App Settings
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Truck Notes
# ---------------------------------------------------------------------------

class TruckNote(Base):
    """
    Persistent note attached to a truck.  Three varieties:
      constant  — shown every operational day.
      workday   — shown only when ``workday_num`` matches the current load or unload day (1-5).
      one_off   — shown until ``expires_on`` passes; auto-archived afterwards.
    """
    __tablename__ = "truck_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    truck_number: Mapped[int] = mapped_column(
        Integer, ForeignKey("trucks.truck_number", ondelete="CASCADE"), nullable=False, index=True
    )
    note_type: Mapped[str] = mapped_column(
        SAEnum(NoteType, name="note_type_enum"), nullable=False, default=NoteType.constant
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Day number (1-5 Mon-Fri) — only meaningful for note_type = workday
    workday_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Expiry date — only meaningful for note_type = one_off; note is hidden after this date
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AppSetting(Base):
    """
    Key-value store for runtime configuration.
    Replaces the ad-hoc settings fields persisted in the V1 JSON state file
    (timezone_key, ui_theme, warn_seconds, badge colors, pace params, etc.).
    Value is stored as JSON so it can hold any scalar or nested structure.
    """
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
