"""Section rotation — who works which section, week by week.

The floor rotates people through the main sections plus a floater. The floater
is the position that gets dropped when there are not enough people, so the
assignment for a week simply has no row for it; see models.RotationAssignment.

Weeks are keyed by their MONDAY. Every date the caller sends is normalised with
`_week_start`, so a request made on a Thursday and one made on the Monday of the
same week address the same week rather than silently creating two.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import RotationAssignment, RotationPerson, RotationSection, User
from routers.auth import require_admin, require_non_guest
from schemas import (
    RotationAssignIn,
    RotationPersonIn,
    RotationPersonOut,
    RotationSectionIn,
    RotationSectionOut,
    RotationWeekOut,
)

router = APIRouter(prefix="/rotation", tags=["rotation"])


def _week_start(d: date | None = None) -> date:
    """The Monday of d's week. Every week key in this module goes through here."""
    d = d or date.today()
    return d - timedelta(days=d.weekday())


def _sections(db: Session) -> list[RotationSection]:
    return list(
        db.scalars(
            select(RotationSection)
            .where(RotationSection.is_active.is_(True))
            .order_by(RotationSection.sort_order, RotationSection.id)
        ).all()
    )


def _people(db: Session) -> list[RotationPerson]:
    return list(
        db.scalars(
            select(RotationPerson)
            .where(RotationPerson.is_active.is_(True))
            .order_by(RotationPerson.sort_order, RotationPerson.id)
        ).all()
    )


def _fill_order(sections: list[RotationSection]) -> list[RotationSection]:
    """Sections in the order they get filled: main sections first, floater last.

    This is the whole skip rule. Assign people down this list and run out early
    and it is the floater that goes unfilled, which is what being short-handed
    actually looks like on the floor.
    """
    return [s for s in sections if not s.is_floater] + [s for s in sections if s.is_floater]


def _week_rows(db: Session, week: date) -> list[RotationAssignment]:
    return list(
        db.scalars(
            select(RotationAssignment).where(RotationAssignment.week_start == week)
        ).all()
    )


def _serialise_week(db: Session, week: date) -> RotationWeekOut:
    rows = {r.section_id: r for r in _week_rows(db, week)}
    people = {p.id: p for p in db.scalars(select(RotationPerson)).all()}
    out = []
    for sec in _sections(db):
        row = rows.get(sec.id)
        person = people.get(row.person_id) if row else None
        out.append(
            {
                "section_id": sec.id,
                "section_name": sec.name,
                "is_floater": sec.is_floater,
                "person_id": person.id if person else None,
                "person_name": person.name if person else None,
            }
        )
    return RotationWeekOut(week_start=week, sections=out)


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

@router.get("/sections", response_model=list[RotationSectionOut])
def list_sections(db: Session = Depends(get_db), _: User = Depends(require_non_guest)):
    return _sections(db)


@router.patch("/sections/{section_id}", response_model=RotationSectionOut)
def update_section(
    section_id: int,
    payload: RotationSectionIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Rename / reorder / retire a section. Names are floor vocabulary, so they
    are editable here rather than frozen by the migration that seeded them."""
    sec = db.get(RotationSection, section_id)
    if sec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No section {section_id}")
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        # The column is unique; say so before the index does (a 500 tells the
        # page nothing it can show).
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Section name cannot be empty")
        clash = db.scalar(
            select(RotationSection).where(RotationSection.name == name, RotationSection.id != section_id)
        )
        if clash is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, f"There is already a section named {name!r}")
        updates["name"] = name
    for field, value in updates.items():
        setattr(sec, field, value)
    db.commit()
    db.refresh(sec)
    return sec


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

@router.get("/people", response_model=list[RotationPersonOut])
def list_people(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    stmt = select(RotationPerson).order_by(RotationPerson.sort_order, RotationPerson.id)
    if not include_inactive:
        stmt = stmt.where(RotationPerson.is_active.is_(True))
    return list(db.scalars(stmt).all())


@router.post("/people", response_model=RotationPersonOut, status_code=status.HTTP_201_CREATED)
def add_person(
    payload: RotationPersonIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name is required")
    order = payload.sort_order
    if order is None:
        last = db.scalars(
            select(RotationPerson).order_by(RotationPerson.sort_order.desc())
        ).first()
        order = (last.sort_order + 1) if last else 1
    person = RotationPerson(name=name, sort_order=order, is_active=True)
    db.add(person)
    db.commit()
    db.refresh(person)
    return person


@router.patch("/people/{person_id}", response_model=RotationPersonOut)
def update_person(
    person_id: int,
    payload: RotationPersonIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    """Rename, reorder, or deactivate. Deactivating rather than deleting is the
    point: a past week must keep naming a real person after they leave."""
    person = db.get(RotationPerson, person_id)
    if person is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No person {person_id}")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = (data["name"] or "").strip()
        if not data["name"]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name cannot be blank")
    for field, value in data.items():
        setattr(person, field, value)
    db.commit()
    db.refresh(person)
    return person


# ---------------------------------------------------------------------------
# The week
# ---------------------------------------------------------------------------

@router.get("", response_model=RotationWeekOut)
def get_week(
    week: date | None = Query(None, description="Any date in the week; normalised to its Monday"),
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    return _serialise_week(db, _week_start(week))


@router.get("/history", response_model=list[RotationWeekOut])
def history(
    weeks: int = Query(8, ge=1, le=52),
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    """The last N weeks, newest first. History is just the older assignment rows
    — there is no separate log, so this can never disagree with the board."""
    this_week = _week_start()
    return [_serialise_week(db, this_week - timedelta(weeks=i)) for i in range(weeks)]


@router.put("/assign", response_model=RotationWeekOut)
def assign(
    payload: RotationAssignIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    """Set (or clear, with person_id=None) one section for one week.

    The manual override. Rotation order is a plan, not a fact — somebody calls
    off and a lead moves one name — so a single-cell edit has to exist or the
    board stops matching the floor within a week.
    """
    week = _week_start(payload.week_start)
    sec = db.get(RotationSection, payload.section_id)
    if sec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No section {payload.section_id}")

    row = db.scalars(
        select(RotationAssignment).where(
            RotationAssignment.week_start == week,
            RotationAssignment.section_id == payload.section_id,
        )
    ).first()

    if payload.person_id is None:
        if row is not None:
            db.delete(row)  # absence IS the representation of unfilled
    else:
        person = db.get(RotationPerson, payload.person_id)
        if person is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"No person {payload.person_id}")
        if row is None:
            db.add(
                RotationAssignment(
                    week_start=week, section_id=payload.section_id, person_id=person.id
                )
            )
        else:
            row.person_id = person.id
    db.commit()
    return _serialise_week(db, week)


@router.post("/advance", response_model=RotationWeekOut)
def advance(
    week: date | None = Query(None, description="Week to BUILD; defaults to this week"),
    force: bool = Query(False, description="Rebuild a week that already has assignments"),
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    """Build a week's assignment by moving everyone one section along.

    Order is taken from the PREVIOUS week where one exists, so the rotation
    follows what actually happened rather than a stored counter that drifts the
    moment anyone is moved by hand. People who joined since are appended, people
    who left drop out, and then the whole list shifts by one.

    Refuses to overwrite a week that already has assignments unless `force` —
    rebuilding a week someone has already adjusted by hand is exactly the
    surprise worth blocking, so the page asks first. `force` is how a hand
    edit to a PREVIOUS week flows forward: fix last week, rebuild this one.
    """
    target = _week_start(week)
    existing = _week_rows(db, target)
    if existing and not force:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Week of {target} already has assignments — rebuild it, or edit individually.",
        )
    for row in existing:
        db.delete(row)
    if existing:
        db.flush()

    people = _people(db)
    if not people:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No active people to rotate")

    sections = _fill_order(_sections(db))
    if not sections:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No active sections")

    prev_rows = _week_rows(db, target - timedelta(weeks=1))
    if prev_rows:
        by_section = {r.section_id: r.person_id for r in prev_rows}
        active_ids = {p.id for p in people}
        # last week's people, in section order, minus anyone now inactive
        ordered = [
            by_section[s.id] for s in sections if s.id in by_section and by_section[s.id] in active_ids
        ]
        # anyone who has joined since goes on the end
        ordered += [p.id for p in people if p.id not in ordered]
    else:
        ordered = [p.id for p in people]

    # the rotation itself: everyone moves one section along
    if len(ordered) > 1:
        ordered = ordered[1:] + ordered[:1]

    # fill main sections first; run out and it is the floater that goes empty
    for sec, person_id in zip(sections, ordered):
        db.add(RotationAssignment(week_start=target, section_id=sec.id, person_id=person_id))
    db.commit()
    return _serialise_week(db, target)
