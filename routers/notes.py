"""
Router: /notes

Truck notes — persistent reminders attached to individual trucks.

Three varieties:
  constant  — shown every operational day.
  workday   — shown when workday_num matches today's load or unload day (1-5).
  one_off   — shown until expires_on date, then archived.
"""

import time
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from activity_log import append_activity_event
from database import get_db
from models import (
    AppSetting,
    NoteType,
    RouteSwap,
    RouteSwapLog,
    SpareAssignment,
    Truck,
    TruckNote,
    TruckState,
    TruckStatus,
    TruckType,
    User,
)
from routers.auth import get_current_user, require_admin, require_non_guest
from notification_service import send_web_push, truck_arrived_notification
from routers.trends_common import operational_today
from schemas import NoteCreate, NoteOut, NoteUpdate
from ws_manager import manager

router = APIRouter(prefix="/notes", tags=["notes"])

# created_by value used for all driver-submitted notes
_DRIVER_AUTHOR = "driver"


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _query_active_notes(
    db: Session,
    truck_number: int | None = None,
    load_day: int | None = None,
) -> list[TruckNote]:
    """Shared query used by both the authenticated and public endpoints."""
    from sqlalchemy import or_
    today = _today()
    q = (
        select(TruckNote)
        .where(
            TruckNote.is_active == True,
            or_(
                TruckNote.note_type != NoteType.one_off.value,
                TruckNote.expires_on.is_(None),
                TruckNote.expires_on >= today,
            ),
        )
        .order_by(TruckNote.truck_number, TruckNote.created_at)
    )
    if truck_number is not None:
        q = q.where(TruckNote.truck_number == truck_number)
    notes = list(db.scalars(q).all())
    if load_day is not None:
        notes = [n for n in notes if n.note_type != NoteType.workday.value or n.workday_num == load_day]
    return notes


# ---------------------------------------------------------------------------
# List / filter (authenticated)
# ---------------------------------------------------------------------------

@router.get("", response_model=list[NoteOut])
def list_notes(
    truck_number: int | None = Query(default=None),
    active_only: bool = Query(default=True),
    load_day: int | None = Query(default=None, ge=1, le=5,
                                  description="If provided, include workday notes matching this day"),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return notes, optionally filtered by truck and/or applicability for a given day.

    - ``truck_number``: restrict to one truck.
    - ``load_day``: when supplied, workday notes are filtered to those matching the day.
    - ``active_only=true`` (default): exclude archived and expired one-off notes.
    """
    if active_only:
        return _query_active_notes(db, truck_number=truck_number, load_day=load_day)

    # active_only=false — return everything including archived / expired
    q = select(TruckNote).order_by(TruckNote.truck_number, TruckNote.created_at)
    if truck_number is not None:
        q = q.where(TruckNote.truck_number == truck_number)
    notes = list(db.scalars(q).all())
    if load_day is not None:
        notes = [n for n in notes if n.note_type != NoteType.workday.value or n.workday_num == load_day]
    return notes


# ---------------------------------------------------------------------------
# Driver endpoints — no auth required, scoped to one truck via QR token
# ---------------------------------------------------------------------------

def _get_truck_by_token(token: str, db: Session) -> Truck:
    truck = db.scalar(select(Truck).where(Truck.qr_token == token))
    if truck is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return truck


@router.get("/driver/{token}", response_model=list[NoteOut])
def driver_get_notes(
    token: str,
    db: Session = Depends(get_db),
):
    """
    All active notes for the truck identified by the QR token.
    Includes both staff-created and driver-created notes.
    No authentication required.
    """
    truck = _get_truck_by_token(token, db)
    return _query_active_notes(db, truck_number=truck.truck_number)


def _resolve_spare_coverage(db: Session, truck_number: int) -> dict | None:
    """Which route is this spare carrying for the run that ends today?

    Checked in confidence order — the first hit wins:
      1. Today's own records: an oos_spare_route written straight onto the
         day-D state row, or a live RouteSwap loading onto this spare.
      2. An open SpareAssignment (returned == False) — the assignment the
         coverage editor holds open until the spare comes back.
      3. The previous operating day's RouteSwapLog (append-only, so it
         survives a cleared assignment). Splits are excluded: on a split the
         original route also ran, so the spare's driver is not "route N".
    """
    today = operational_today()

    row = db.scalar(
        select(TruckState).where(
            TruckState.truck_number == truck_number,
            TruckState.run_date == today,
        )
    )
    if row is not None and row.oos_spare_route is not None:
        return {"route_truck": row.oos_spare_route, "run_date": str(today), "source": "state"}

    swap = db.scalar(
        select(RouteSwap).where(
            RouteSwap.load_on_truck == truck_number,
            RouteSwap.run_date == today,
        )
    )
    if swap is not None:
        return {"route_truck": swap.route_truck, "run_date": str(today), "source": "swap"}

    assignment = db.scalar(
        select(SpareAssignment)
        .where(
            SpareAssignment.spare_truck_number == truck_number,
            SpareAssignment.returned == False,
        )
        .order_by(SpareAssignment.run_date.desc(), SpareAssignment.id.desc())
    )
    if assignment is not None:
        return {
            "route_truck": assignment.covering_route_truck,
            "run_date": str(assignment.run_date),
            "source": "assignment",
        }

    prev_run_date = db.scalar(
        select(func.max(TruckState.run_date)).where(TruckState.run_date < today)
    )
    if prev_run_date is not None:
        log = db.scalar(
            select(RouteSwapLog)
            .where(
                RouteSwapLog.run_date == prev_run_date,
                RouteSwapLog.load_on_truck == truck_number,
                RouteSwapLog.is_split == False,
            )
            .order_by(RouteSwapLog.id.desc())
        )
        if log is not None:
            return {"route_truck": log.route_truck, "run_date": str(prev_run_date), "source": "log"}

    return None


@router.get("/driver/{token}/info")
def driver_truck_info(token: str, db: Session = Depends(get_db)):
    """Truck identity for a QR token (no auth required).

    For spares this also carries what the driver page needs to route them:
    resolved coverage (if any), a pending claim, and — when neither exists —
    the list of route numbers for the "Select Route" picker. Only truck
    NUMBERS leave this endpoint; never tokens or state beyond the claim.
    """
    truck = _get_truck_by_token(token, db)
    is_spare = truck.truck_type == TruckType.spare
    out: dict = {
        "truck_number": truck.truck_number,
        "is_spare": is_spare,
        "coverage": None,
        "claimed_route": None,
    }
    if not is_spare:
        return out

    out["coverage"] = _resolve_spare_coverage(db, truck.truck_number)
    row = db.scalar(
        select(TruckState).where(
            TruckState.truck_number == truck.truck_number,
            TruckState.run_date == operational_today(),
        )
    )
    if row is not None and row.driver_claimed_route is not None:
        out["claimed_route"] = row.driver_claimed_route
    if out["coverage"] is None:
        out["route_options"] = sorted(
            db.scalars(
                select(Truck.truck_number).where(
                    Truck.is_active == True,
                    Truck.truck_type != TruckType.spare,
                )
            ).all()
        )
    return out


@router.get("/driver/{token}/coverage-notes", response_model=list[NoteOut])
def driver_coverage_notes(token: str, db: Session = Depends(get_db)):
    """Active notes for the ROUTE a spare is covering (no auth required).

    Token-scoped like everything else on the driver surface: it only answers
    for the one route the coverage records tie to this spare today, so it
    exposes nothing a lookup of the spare's own notes wouldn't.
    """
    truck = _get_truck_by_token(token, db)
    if truck.truck_type != TruckType.spare:
        return []
    coverage = _resolve_spare_coverage(db, truck.truck_number)
    if coverage is None:
        return []
    return _query_active_notes(db, truck_number=coverage["route_truck"])


# --- "I'm Back" ------------------------------------------------------------
#
# Unauthenticated, so it is throttled per token. The stamp is worth very little
# to an attacker (a timestamp), but it feeds return-time predictions, so a
# script should not be able to spray it.
_ARRIVE_MAX = 6
_ARRIVE_WINDOW = 60.0
_arrive_hits: dict[str, deque] = defaultdict(deque)


def _arrive_rate_limit(token: str) -> None:
    now = time.time()
    dq = _arrive_hits[token]
    while dq and dq[0] < now - _ARRIVE_WINDOW:
        dq.popleft()
    if len(dq) >= _ARRIVE_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many taps — wait a moment.",
        )
    dq.append(now)


@router.post("/driver/{token}/arrived")
def driver_mark_arrived(
    token: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Record that this truck is back in the yard. No auth — QR token only.

    Idempotent: the FIRST tap wins and later taps return that same time rather
    than overwriting it. Drivers double-scan, and the whole value of the stamp
    is that it is when the truck actually landed.
    """
    _arrive_rate_limit(token)
    truck = _get_truck_by_token(token, db)

    # The OPERATIONAL run date, not the calendar one. A driver back at 2am
    # belongs to the previous day's shift; a plain date.today() would file the
    # arrival against a day the crew has not started.
    run_date = operational_today()

    row = db.scalar(
        select(TruckState).where(
            TruckState.truck_number == truck.truck_number,
            TruckState.run_date == run_date,
        )
    )
    if row is None:
        # Day-init runs off the authenticated board, so if no staff member has
        # opened the app yet there is nothing to stamp. Create the row rather
        # than dropping the arrival — deliberately WITHOUT calling day-init,
        # which closes out the previous day and must never be triggered by an
        # anonymous scan. Day-init later skips trucks that already have a row.
        row = TruckState(
            truck_number=truck.truck_number,
            run_date=run_date,
            status=TruckStatus.dirty,
            arrived_at=time.time(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        first = True
    elif row.arrived_at is None:
        row.arrived_at = time.time()
        db.commit()
        db.refresh(row)
        first = True
    else:
        first = False

    if first:
        background_tasks.add_task(
            manager.broadcast,
            {
                "type": "truck_arrived",
                "truck_number": truck.truck_number,
                "run_date": str(run_date),
                "actor": "driver",
            },
        )
        # Phone push, opt-in. send_web_push skips the WS "notification"
        # broadcast on purpose — the truck_arrived event above already drives
        # the in-app toast, with its own settings and dedupe.
        _push_setting = db.get(AppSetting, "arrived_push_enabled")
        if _push_setting is not None and _push_setting.value is True:
            background_tasks.add_task(
                send_web_push,
                truck_arrived_notification(truck_number=truck.truck_number, run_date=run_date),
            )
    return {
        "truck_number": truck.truck_number,
        "arrived_at": row.arrived_at,
        "already": not first,
    }


class DriverRunReport(BaseModel):
    choice: Literal["route", "ran_special", "clean"]
    route_truck: int | None = Field(default=None, ge=1, le=999)


@router.post("/driver/{token}/run-report")
def driver_run_report(
    token: str,
    payload: DriverRunReport,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """A spare driver reports how their run ended. No auth — QR token only.

    Three choices, with deliberately different authority:
      route       — "I carried route N". A CLAIM, not coverage: it lands in
                    driver_claimed_route for a lead to confirm (which writes
                    the real assignment through the authenticated path) or
                    dismiss. Flags needs_checked so it can't be missed.
      ran_special — authoritative, same effect a lead tapping Ran Special has:
                    truck comes back dirty with the Ran Special note appended.
      clean       — arrival stamp only; the spare never left clean status.

    Every choice stamps arrival (first tap wins, same as /arrived). Spare
    trucks only — a route truck's QR never shows these buttons, and the
    endpoint 404s rather than confirm the token maps to a non-spare.
    """
    _arrive_rate_limit(token)
    truck = _get_truck_by_token(token, db)
    if truck.truck_type != TruckType.spare or not truck.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    claimed_route: int | None = None
    if payload.choice == "route":
        if payload.route_truck is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Pick a route number.",
            )
        target = db.scalar(
            select(Truck).where(
                Truck.truck_number == payload.route_truck,
                Truck.is_active == True,
                Truck.truck_type != TruckType.spare,
            )
        )
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That route number doesn't exist.",
            )
        claimed_route = payload.route_truck

    run_date = operational_today()
    now = time.time()
    row = db.scalar(
        select(TruckState).where(
            TruckState.truck_number == truck.truck_number,
            TruckState.run_date == run_date,
        )
    )
    if row is None:
        # Same rule as /arrived: create the row rather than drop the report,
        # but NEVER trigger day-init from an anonymous scan. A clean return
        # starts unloaded (nothing to do); the other choices mean it ran.
        row = TruckState(
            truck_number=truck.truck_number,
            run_date=run_date,
            status=TruckStatus.unloaded if payload.choice == "clean" else TruckStatus.dirty,
            arrived_at=now,
        )
        db.add(row)
        first_arrival = True
    else:
        first_arrival = row.arrived_at is None
        if first_arrival:
            row.arrived_at = now

    # Statuses a driver report may pull back to dirty. Never step back a truck
    # the crew already touched today (loaded / in_progress / unfinished), and
    # never pull one out of shop/oos.
    _REPORT_DIRTYABLE = {TruckStatus.unloaded, TruckStatus.off, TruckStatus.spare}

    if payload.choice == "route":
        row.driver_claimed_route = claimed_route
        if row.status in _REPORT_DIRTYABLE:
            row.status = TruckStatus.dirty
        row.needs_checked = True
        append_activity_event(
            db,
            event_family="coverage",
            event_type="driver_claimed_route",
            run_date=run_date,
            truck_number=truck.truck_number,
            summary=(
                f"Driver on Spare #{truck.truck_number} reported covering "
                f"route {claimed_route} — awaiting lead confirmation"
            ),
            diff_json={"driver_claimed_route": {"after": claimed_route}},
            context_json={"via": "driver_qr"},
        )
    elif payload.choice == "ran_special":
        if row.status in _REPORT_DIRTYABLE:
            row.status = TruckStatus.dirty
        if "ran special" not in (row.off_note or "").lower():
            row.off_note = f"{row.off_note} | Ran Special" if row.off_note else "Ran Special"
        row.needs_checked = True
        append_activity_event(
            db,
            event_family="state",
            event_type="driver_ran_special",
            run_date=run_date,
            truck_number=truck.truck_number,
            summary=f"Driver on Spare #{truck.truck_number} reported Ran Special",
            context_json={"via": "driver_qr"},
        )
    else:  # clean — arrival stamp only
        append_activity_event(
            db,
            event_family="state",
            event_type="driver_returned_clean",
            run_date=run_date,
            truck_number=truck.truck_number,
            summary=f"Driver on Spare #{truck.truck_number} reported returning clean",
            context_json={"via": "driver_qr"},
        )

    db.commit()
    db.refresh(row)

    background_tasks.add_task(
        manager.broadcast,
        {
            "type": "truck_state_updated",
            "run_date": str(run_date),
            "truck_number": truck.truck_number,
        },
    )
    if first_arrival:
        background_tasks.add_task(
            manager.broadcast,
            {
                "type": "truck_arrived",
                "truck_number": truck.truck_number,
                "run_date": str(run_date),
                "actor": "driver",
            },
        )
        _push_setting = db.get(AppSetting, "arrived_push_enabled")
        if _push_setting is not None and _push_setting.value is True:
            background_tasks.add_task(
                send_web_push,
                truck_arrived_notification(truck_number=truck.truck_number, run_date=run_date),
            )
    return {
        "truck_number": truck.truck_number,
        "choice": payload.choice,
        "arrived_at": row.arrived_at,
        "claimed_route": row.driver_claimed_route,
        "status": row.status,
    }


class DriverNoteCreate(BaseModel):
    note_type: NoteType = NoteType.constant
    body: str = Field(..., min_length=1, max_length=2000)
    workday_num: int | None = Field(default=None, ge=1, le=5)
    expires_on: date | None = None


@router.post("/driver/{token}", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def driver_create_note(
    token: str,
    payload: DriverNoteCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Create a note on the driver's own route.
    No authentication required. Notes are tagged with created_by='driver'.
    """
    truck = _get_truck_by_token(token, db)
    note = TruckNote(
        truck_number=truck.truck_number,
        note_type=payload.note_type.value,
        body=payload.body.strip(),
        workday_num=payload.workday_num,
        expires_on=payload.expires_on,
        created_by=_DRIVER_AUTHOR,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    # Push it to every open app session so the Notes board updates live and the
    # crew gets a "New Driver Note" toast without refreshing.
    background_tasks.add_task(
        manager.broadcast,
        {
            "type": "driver_note_created",
            "truck_number": int(truck.truck_number),
            "note_id": int(note.id),
            "body": note.body[:120],
        },
    )
    return note


@router.delete("/driver/{token}/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def driver_delete_note(
    token: str,
    note_id: int,
    db: Session = Depends(get_db),
):
    """
    Delete a driver-created note.
    Only notes with created_by='driver' on the matching truck can be deleted this way.
    """
    truck = _get_truck_by_token(token, db)
    note = db.get(TruckNote, note_id)
    if note is None or note.truck_number != truck.truck_number:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    if note.created_by != _DRIVER_AUTHOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only driver-added notes can be removed from this view",
        )
    db.delete(note)
    db.commit()


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    note = TruckNote(
        **payload.model_dump(),
        created_by=current_user.username,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


# ---------------------------------------------------------------------------
# Update (body / type / active flag)
# ---------------------------------------------------------------------------

@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    note = db.get(TruckNote, note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    db.commit()
    db.refresh(note)
    return note


# ---------------------------------------------------------------------------
# Delete (hard delete — admins only)
# ---------------------------------------------------------------------------

@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    note = db.get(TruckNote, note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    db.delete(note)
    db.commit()
