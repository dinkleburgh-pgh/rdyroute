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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models import RotationAssignment, RotationPerson, RotationSection, User
from rotation_planner import plan_week
from routers.auth import require_admin, require_non_guest
from schemas import (
    RotationAssignIn,
    RotationPersonIn,
    RotationPersonOut,
    RotationStaleWeekOut,
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
                # A ghost: still assigned, but no longer on the rotation.
                "person_active": person.is_active if person else True,
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
    existing = db.scalars(
        select(RotationPerson).where(func.lower(RotationPerson.name) == name.lower())
    ).first()
    if existing is not None and existing.is_active:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{existing.name} is already on the rotation")
    if existing is not None:
        # Re-adding a removed name REACTIVATES the same person. A twin row
        # would sever their history — the no-back-to-back and no-repeat rules
        # read it, and a severed newcomer measurably lands on what they just
        # worked. Their roster run restarts at the given (or current) week.
        existing.is_active = True
        existing.active_since = _week_start(payload.active_since)
        if payload.sort_order is not None:
            existing.sort_order = payload.sort_order
        db.commit()
        db.refresh(existing)
        return existing
    order = payload.sort_order
    if order is None:
        last = db.scalars(
            select(RotationPerson).order_by(RotationPerson.sort_order.desc())
        ).first()
        order = (last.sort_order + 1) if last else 1
    # active_since defaults to this week; an explicit date (normalised to its
    # Monday) covers "added Friday, starts Monday" without a rebuild of the
    # current week pulling the newcomer in early.
    person = RotationPerson(
        name=name, sort_order=order, is_active=True, active_since=_week_start(payload.active_since)
    )
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
    if data.get("active_since") is not None:
        data["active_since"] = _week_start(data["active_since"])
    elif "active_since" in data:
        # An explicit null means "leave it alone", not "erase the start week".
        data.pop("active_since")
    # Coming back onto the rotation starts a new roster run: the weeks they were
    # away must not read as weeks they sat out. An explicit start date in the
    # same request wins over the reset.
    if data.get("is_active") is True and not person.is_active and "active_since" not in data:
        person.active_since = _week_start()
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


@router.get("/stale", response_model=list[RotationStaleWeekOut])
def stale_weeks(
    db: Session = Depends(get_db),
    _: User = Depends(require_non_guest),
):
    """Current and FUTURE built weeks whose rows no longer match the roster —
    they name someone who has left, or were built before someone joined and
    still have an open seat. The page turns these into a rebuild prompt;
    nothing rebuilds automatically, because a rebuild discards hand edits and
    that trade stays the lead's call."""
    this_week = _week_start()
    rows = list(
        db.scalars(
            select(RotationAssignment).where(RotationAssignment.week_start >= this_week)
        ).all()
    )
    if not rows:
        return []
    people = {p.id: p for p in db.scalars(select(RotationPerson)).all()}
    active = [p for p in people.values() if p.is_active]
    n_sections = len(_sections(db))
    by_week: dict[date, list[RotationAssignment]] = {}
    for r in rows:
        by_week.setdefault(r.week_start, []).append(r)
    out: list[RotationStaleWeekOut] = []
    for wk in sorted(by_week):
        wrows = by_week[wk]
        assigned = {r.person_id for r in wrows}
        gone = sorted(
            p.name for pid in assigned if (p := people.get(pid)) is not None and not p.is_active
        )
        # Someone eligible with no row only matters while the week still has an
        # open seat — with more people than sections, sitting out is normal.
        missing = (
            sorted(
                p.name
                for p in active
                if p.id not in assigned and (p.active_since is None or p.active_since <= wk)
            )
            if len(wrows) < n_sections
            else []
        )
        reasons: list[str] = []
        if gone:
            reasons.append(f"assigned to {', '.join(gone)} — no longer on the rotation")
        if missing:
            reasons.append(f"built before {', '.join(missing)} joined")
        if reasons:
            out.append(RotationStaleWeekOut(week_start=wk, reasons=reasons))
    return out


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
        if not person.is_active:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{person.name} has left the rotation — re-add them first or pick someone else",
            )
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
    """Build a week's assignment: the fair rotation (see rotation_planner.py).

    Everyone works every section once before repeating any, and the week is
    solved as a whole. It reads the recent weeks as they actually happened
    (hand edits included) rather than a stored counter, and the week after
    too when it is already built, so gaps, weeks built ahead, people joining
    or leaving and staffing changes keep the cycle intact. (The first builder
    moved last week's order one along; it only looked one week back, so an
    empty previous week restarted it and whole layouts repeated every other
    week.)

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
    # Anyone already placed in the week stays on its roster (a hand edit, or
    # someone reactivated since, whose active_since was reset) — read before
    # the rows go.
    held_ids = {r.person_id for r in existing}
    for row in existing:
        db.delete(row)
    if existing:
        db.flush()

    # Only people on the rotation in the target week: rebuilding a past week
    # must not put someone into a week before they joined.
    people = [
        p for p in _people(db)
        if p.active_since is None or p.active_since <= target or p.id in held_ids
    ]
    if not people:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No active people to rotate")

    sections = _fill_order(_sections(db))
    if not sections:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No active sections")

    # The weeks before the target, newest first, one entry per week (an empty
    # week still counts as a week). Three rotations back: the last one decides
    # who repeats what, the rest evens out the long-run totals.
    lookback = min(52, 3 * len(people) + 1)
    rows = db.scalars(
        select(RotationAssignment)
        .where(
            RotationAssignment.week_start >= target - timedelta(weeks=lookback),
            RotationAssignment.week_start < target,
        )
        .order_by(RotationAssignment.week_start, RotationAssignment.section_id)
    ).all()
    by_week: dict[date, dict[int, int]] = {}
    for r in rows:
        by_week.setdefault(r.week_start, {})[r.section_id] = r.person_id
    history = [by_week.get(target - timedelta(weeks=k), {}) for k in range(1, lookback + 1)]
    # Who was on the rotation each of those weeks (RotationPerson.active_since).
    rosters = [
        {p.id for p in people if p.active_since is None or p.active_since <= target - timedelta(weeks=k)}
        for k in range(1, lookback + 1)
    ]
    # The week after, when it is already built (building ahead, or rebuilding
    # a past week): nobody gets the section they already hold there either.
    following = {
        r.section_id: r.person_id
        for r in sorted(_week_rows(db, target + timedelta(weeks=1)), key=lambda r: r.section_id)
    }

    # `sections` is in fill order (main first, floater last), which is what
    # makes the floater the one left empty when short-handed.
    plan = plan_week(
        [s.id for s in sections],
        [p.id for p in people],
        history,
        rosters,
        following=following or None,
        floaters=[s.id for s in sections if s.is_floater],
    )
    for sec in sections:
        person_id = plan.get(sec.id)
        if person_id is not None:
            db.add(RotationAssignment(week_start=target, section_id=sec.id, person_id=person_id))
    db.commit()
    return _serialise_week(db, target)
