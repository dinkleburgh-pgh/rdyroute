"""
Router: /shorts

Records and retrieves shortage items per truck per run-date.

V1 mapping:
  st.session_state.shorts          →  Shortage rows (item_category → quantity)
  st.session_state.shorts_initials →  Shortage.initials
"""

from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from database import get_db
from routers.auth import get_current_user, require_non_guest
from routers.trends_common import half_split_change, prior_bounds, window_bounds
from models import Shortage, User
from schemas import (
    ShortageBulkCreate,
    ShortageCategoryPoint,
    ShortageCellUpsert,
    ShortageCreate,
    ShortageDailyPoint,
    ShortageItemPoint,
    ShortageTruckPoint,
    ShortageOut,
    ShortageSummary,
    ShortageUpdate,
)
from ws_manager import manager

router = APIRouter(prefix="/shorts", tags=["shorts"])

# ---------------------------------------------------------------------------
# List shortages
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ShortageOut])
def list_shortages(
    run_date: date = Query(...),
    truck_number: int | None = Query(default=None),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Shortage).where(Shortage.run_date == run_date)
    if truck_number is not None:
        q = q.where(Shortage.truck_number == truck_number)
    return db.scalars(q.order_by(Shortage.truck_number, Shortage.recorded_at)).all()


# ---------------------------------------------------------------------------
# Create / update / delete
# ---------------------------------------------------------------------------

@router.post("", response_model=ShortageOut, status_code=status.HTTP_201_CREATED)
def create_shortage(payload: ShortageCreate, background_tasks: BackgroundTasks, _user: User = Depends(require_non_guest), db: Session = Depends(get_db)):
    row = Shortage(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "shortage_updated", "run_date": str(payload.run_date)},
    )
    return row


@router.post("/bulk", response_model=list[ShortageOut], status_code=status.HTTP_201_CREATED)
def create_shortages_bulk(
    payload: ShortageBulkCreate,
    background_tasks: BackgroundTasks,
    _user: User = Depends(require_non_guest),
    db: Session = Depends(get_db),
):
    """One shortage row per entry for a single item/run-date (item-first bulk entry).

    Semantically identical to N single POSTs — no dedupe or merging — but
    atomic, and emits ONE shortage_updated broadcast instead of N.
    """
    rows = [
        Shortage(
            truck_number=entry.truck_number,
            run_date=payload.run_date,
            item_category=payload.item_category,
            item_detail=payload.item_detail,
            quantity=entry.quantity,
            initials=payload.initials,
            initials_ts=payload.initials_ts,
        )
        for entry in payload.entries
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "shortage_updated", "run_date": str(payload.run_date)},
    )
    return rows


@router.put("/cells", response_model=list[ShortageOut])
def upsert_shortage_cells(
    payload: ShortageCellUpsert,
    background_tasks: BackgroundTasks,
    _user: User = Depends(require_non_guest),
    db: Session = Depends(get_db),
):
    """Idempotent cell upsert for the editable Short Sheet.

    Each entry is a (truck, item) CELL: set its quantity to the canonical total
    for the run-date. quantity > 0 keeps exactly ONE Shortage row for the cell
    (patched in place) and deletes any duplicates; quantity == 0 clears the cell
    (deletes every matching row). Unlike POST /shorts/bulk (insert-only), this is
    safe to call repeatedly — the grid / guided sheet re-saves the same cell
    without piling up duplicate rows. Matching is exact on
    (run_date, truck_number, item_category, item_detail).
    """
    result_rows: list[Shortage] = []
    for entry in payload.entries:
        existing = list(
            db.scalars(
                select(Shortage)
                .where(
                    Shortage.run_date == payload.run_date,
                    Shortage.truck_number == entry.truck_number,
                    Shortage.item_category == entry.item_category,
                    Shortage.item_detail == entry.item_detail,
                )
                .order_by(Shortage.recorded_at)
            ).all()
        )
        if entry.quantity <= 0:
            for row in existing:
                db.delete(row)
            continue
        if existing:
            keep = existing[0]
            keep.quantity = entry.quantity
            keep.initials = payload.initials
            keep.initials_ts = payload.initials_ts
            for extra in existing[1:]:  # collapse duplicates to one canonical row
                db.delete(extra)
            result_rows.append(keep)
        else:
            row = Shortage(
                truck_number=entry.truck_number,
                run_date=payload.run_date,
                item_category=entry.item_category,
                item_detail=entry.item_detail,
                quantity=entry.quantity,
                initials=payload.initials,
                initials_ts=payload.initials_ts,
            )
            db.add(row)
            result_rows.append(row)
    db.commit()
    for row in result_rows:
        db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "shortage_updated", "run_date": str(payload.run_date)},
    )
    return result_rows


@router.patch("/{shortage_id}", response_model=ShortageOut)
def update_shortage(
    shortage_id: int,
    payload: ShortageUpdate,
    background_tasks: BackgroundTasks,
    _user: User = Depends(require_non_guest),
    db: Session = Depends(get_db),
):
    row = db.get(Shortage, shortage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortage not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    background_tasks.add_task(
        manager.broadcast,
        {"type": "shortage_updated", "run_date": str(row.run_date)},
    )
    return row


@router.delete("/{shortage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shortage(shortage_id: int, background_tasks: BackgroundTasks, _user: User = Depends(require_non_guest), db: Session = Depends(get_db)):
    row = db.get(Shortage, shortage_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortage not found")
    run_date = str(row.run_date)
    db.delete(row)
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "shortage_updated", "run_date": run_date})


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_shortages_for_truck(
    background_tasks: BackgroundTasks,
    truck_number: int = Query(...),
    run_date: date = Query(...),
    _user: User = Depends(require_non_guest),
    db: Session = Depends(get_db),
):
    """Clear all shortages for a specific truck on a run-date (used by 'reset shorts' action)."""
    db.execute(
        delete(Shortage).where(
            Shortage.truck_number == truck_number,
            Shortage.run_date == run_date,
        )
    )
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "shortage_updated", "run_date": str(run_date)})


# ---------------------------------------------------------------------------
# Trend aggregation endpoints
# ---------------------------------------------------------------------------

@router.get("/trends/daily", response_model=list[ShortageDailyPoint])
def shortage_daily_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-day total shortage quantity and entry count."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            Shortage.run_date,
            func.sum(Shortage.quantity).label("total_qty"),
            func.count(Shortage.id).label("entry_count"),
        )
        .where(Shortage.run_date >= start, Shortage.run_date <= end)
        .group_by(Shortage.run_date)
        .order_by(Shortage.run_date)
    ).all()
    return [
        ShortageDailyPoint(run_date=r[0], total_qty=r[1] or 0, entry_count=r[2])
        for r in rows
    ]


@router.get("/trends/by-category", response_model=list[ShortageCategoryPoint])
def shortage_by_category_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Shortage quantities grouped by item category, sorted descending."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            Shortage.item_category.label("category"),
            func.sum(Shortage.quantity).label("total_qty"),
        )
        .where(Shortage.run_date >= start, Shortage.run_date <= end)
        .group_by(Shortage.item_category)
        .order_by(func.sum(Shortage.quantity).desc())
    ).all()
    return [
        ShortageCategoryPoint(category=r[0], total_qty=r[1] or 0)
        for r in rows
    ]


@router.get("/trends/by-item", response_model=list[ShortageItemPoint])
def shortage_by_item_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Shortage quantities grouped by EXACT item (item_category + item_detail),
    sorted descending. The label is fully-qualified the same way the Live Report
    and shortage matrix build it ('Bulk > Towels Red Shop'), so the exact item
    names are consistent across surfaces — a bare 'Black'/'Onyx' would be
    ambiguous across mats/aprons/towels."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            Shortage.item_category.label("category"),
            Shortage.item_detail.label("detail"),
            func.sum(Shortage.quantity).label("total_qty"),
        )
        .where(Shortage.run_date >= start, Shortage.run_date <= end)
        .group_by(Shortage.item_category, Shortage.item_detail)
        .order_by(func.sum(Shortage.quantity).desc())
    ).all()
    return [
        ShortageItemPoint(
            category=r[0],
            detail=r[1] or "",
            label=f"{r[0]} {r[1]}" if r[1] else r[0],
            total_qty=r[2] or 0,
        )
        for r in rows
    ]


@router.get("/trends/by-truck", response_model=list[ShortageTruckPoint])
def shortage_by_truck_trend(
    days_back: int = Query(default=14, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Shortage quantities grouped by truck, sorted descending — which trucks
    keep going out short."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            Shortage.truck_number,
            func.sum(Shortage.quantity).label("total_qty"),
            func.count(Shortage.id).label("entry_count"),
        )
        .where(Shortage.run_date >= start, Shortage.run_date <= end)
        .group_by(Shortage.truck_number)
        .order_by(func.sum(Shortage.quantity).desc())
    ).all()
    return [
        ShortageTruckPoint(truck_number=r[0], total_qty=r[1] or 0, entry_count=r[2])
        for r in rows
    ]


@router.get("/trends/summary", response_model=ShortageSummary)
def shortage_trend_summary(
    days_back: int = Query(default=14, ge=1, le=365),
    compare_days_back: int | None = Query(default=None, ge=1, le=365),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Consolidated shortage KPIs with trend direction and prior-period comparison."""
    start, end = window_bounds(days_back)
    rows = db.execute(
        select(
            Shortage.run_date,
            func.sum(Shortage.quantity).label("total_qty"),
            func.count(Shortage.id).label("entry_count"),
        )
        .where(Shortage.run_date >= start, Shortage.run_date <= end)
        .group_by(Shortage.run_date)
        .order_by(Shortage.run_date)
    ).all()

    daily_series = [
        ShortageDailyPoint(run_date=r[0], total_qty=r[1] or 0, entry_count=r[2])
        for r in rows
    ]
    total_qty = sum(r[1] or 0 for r in rows)
    entry_count = sum(r[2] for r in rows)
    days_with_data = len(rows)
    avg_per_day = round(total_qty / days_with_data, 1) if days_with_data else 0.0

    peak = max(rows, key=lambda r: r[1]) if rows else None
    peak_day = peak[0] if peak else None
    peak_qty = peak[1] or 0 if peak else 0

    change = half_split_change([(d.run_date, d.total_qty) for d in daily_series], days_back)
    if change is None:
        trend_direction = "stable"
    else:
        trend_direction = "up" if change > 5 else ("down" if change < -5 else "stable")

    change_vs_prior_pct = None
    if compare_days_back and days_back > 0:
        p_start, p_end = prior_bounds(days_back)
        prior_total = db.execute(
            select(func.sum(Shortage.quantity))
            .where(
                Shortage.run_date >= p_start,
                Shortage.run_date <= p_end,
            )
        ).scalar() or 0
        if prior_total > 0:
            change_vs_prior_pct = round(((total_qty - prior_total) / prior_total) * 100, 1)

    return ShortageSummary(
        total_qty=total_qty,
        avg_per_day=avg_per_day,
        peak_day=peak_day,
        peak_qty=peak_qty,
        entry_count=entry_count,
        days_with_data=days_with_data,
        trend_direction=trend_direction,
        change_vs_prior_pct=change_vs_prior_pct,
        daily_series=daily_series,
    )


@router.get("/dates", response_model=list[date])
def shortage_dates(_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Distinct dates with at least one shortage, most recent first."""
    rows = db.scalars(
        select(Shortage.run_date)
        .where(Shortage.run_date.isnot(None))
        .distinct()
        .order_by(Shortage.run_date.desc())
        .limit(90)
    ).all()
    return list(rows)
