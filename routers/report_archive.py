"""
Router: /reports/archive

The end-of-shift report archive (see report_archive.py at the repo root): each
archived run day's report inputs, which the Run Report page renders a saved day
from.

Reading is open to every signed-in role, guests included — a guest can already
open any past day's live report, and a snapshot is that same data frozen at the
end of the shift. Capturing by hand is admin-only, because a re-capture
replaces what the archive says the day was.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from database import get_db, settings
from models import ReportSnapshot, User
from report_archive import capture_snapshot, end_of_shift, worked_run_dates
from routers.auth import get_current_user, require_admin
from routers.trends_common import operational_today
from schemas import ReportSnapshotMetaOut, ReportSnapshotOut
from ws_manager import manager

router = APIRouter(prefix="/reports/archive", tags=["reports"])


@router.get("", response_model=list[ReportSnapshotMetaOut])
def list_archived_reports(
    limit: int = Query(default=60, ge=1, le=366),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Archived run days, newest first. Leaves out the inputs — the heavy part,
    only needed to render one day — and returns the headline summary instead."""
    return db.scalars(
        select(ReportSnapshot)
        .options(defer(ReportSnapshot.inputs))
        .order_by(ReportSnapshot.run_date.desc())
        .limit(limit)
    ).all()


@router.get("/{run_date}", response_model=ReportSnapshotOut)
def get_archived_report(
    run_date: date,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(ReportSnapshot).where(ReportSnapshot.run_date == run_date))
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No archived report for {run_date}.",
        )
    return row


@router.post("/{run_date}", response_model=ReportSnapshotMetaOut)
def capture_archived_report(
    run_date: date,
    background_tasks: BackgroundTasks,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Capture *run_date*'s report now as 'manual', replacing any snapshot it
    already has (e.g. to pick up a correction made after the shift).

    Refused until the day's end of shift — before then the day is still being
    worked, and archiving it would freeze half a shift — and for a day the
    shift never worked (plant closed, or never run), which has no report."""
    # A day past the operational today hasn't run at all (and date.max has no
    # next day to end its shift on).
    if run_date > operational_today():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{run_date} hasn't run yet — nothing to archive.",
        )
    moment = end_of_shift(run_date)
    if datetime.now(ZoneInfo(settings.timezone)) < moment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{run_date} is still running — it can be archived from {moment:%a %H:%M}.",
        )
    if run_date not in worked_run_dates(db, run_date, run_date):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No run on file for {run_date} — nothing to archive.",
        )
    row = capture_snapshot(db, run_date, "manual")
    # Other open Report pages holding the old snapshot refetch it now.
    background_tasks.add_task(manager.broadcast, {"type": "report_archived", "run_date": str(run_date)})
    return row
