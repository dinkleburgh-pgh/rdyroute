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
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import TruckNote, User
from routers.auth import get_current_user, require_admin
from schemas import NoteCreate, NoteOut, NoteUpdate

router = APIRouter(prefix="/notes", tags=["notes"])


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ---------------------------------------------------------------------------
# List / filter
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
    q = select(TruckNote).order_by(TruckNote.truck_number, TruckNote.created_at)

    if truck_number is not None:
        q = q.where(TruckNote.truck_number == truck_number)

    if active_only:
        today = _today()
        from sqlalchemy import or_, and_
        from models import NoteType
        q = q.where(
            TruckNote.is_active == True,
            # one_off notes: exclude if expired
            or_(
                TruckNote.note_type != NoteType.one_off.value,
                TruckNote.expires_on.is_(None),
                TruckNote.expires_on >= today,
            ),
        )

    notes = db.scalars(q).all()

    # If a specific day is requested filter workday notes server-side
    if load_day is not None:
        from models import NoteType
        notes = [
            n for n in notes
            if n.note_type != NoteType.workday.value or n.workday_num == load_day
        ]

    return notes


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
