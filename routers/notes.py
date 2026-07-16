"""
Router: /notes

Truck notes — persistent reminders attached to individual trucks.

Three varieties:
  constant  — shown every operational day.
  workday   — shown when workday_num matches today's load or unload day (1-5).
  one_off   — shown until expires_on date, then archived.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import NoteType, Truck, TruckNote, User
from routers.auth import get_current_user, require_admin, require_non_guest
from schemas import NoteCreate, NoteOut, NoteUpdate

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


@router.get("/driver/{token}/info")
def driver_truck_info(token: str, db: Session = Depends(get_db)):
    """Return the truck number for a QR token (no auth required)."""
    truck = _get_truck_by_token(token, db)
    return {"truck_number": truck.truck_number}


class DriverNoteCreate(BaseModel):
    note_type: NoteType = NoteType.constant
    body: str = Field(..., min_length=1, max_length=2000)
    workday_num: int | None = Field(default=None, ge=1, le=5)
    expires_on: date | None = None


@router.post("/driver/{token}", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def driver_create_note(
    token: str,
    payload: DriverNoteCreate,
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
