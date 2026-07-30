"""
Router: /reports

Server-side rendering of the run report to a downloadable PDF.

The report is composed in the browser (LiveReport.tsx) with a lot of business
logic, so rather than re-derive it in Python, the client POSTs its already-
computed view-model — the exact numbers/rows it shows plus the hex colours it
paints them with — and this endpoint renders that to a dark, app-matching PDF
via WeasyPrint. Rendering real HTML/CSS (not pasted screenshots) keeps the PDF
text SELECTABLE while still matching the screen.

Read-only and guest-readable (the /report page is public). Every text value is
HTML-escaped; every colour is pattern-validated 6-digit hex at the schema layer
(so nothing can break out of an inline style="…"); and WeasyPrint's resource
fetcher refuses everything but inline data: URIs, so a crafted string can neither
inject markup nor fetch a network/file resource.
"""

import html
import time
from collections import defaultdict, deque
from datetime import timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from database import settings
from models import User
from routers.auth import get_current_user
from schemas import (
    AuditSectionVM,
    BatchesSectionVM,
    CoverageSectionVM,
    LoadTimesSectionVM,
    ReportViewModel,
    ShortagesSectionVM,
)

router = APIRouter(prefix="/reports", tags=["reports"])


# ---------------------------------------------------------------------------
# Lightweight per-IP rate limit — WeasyPrint is CPU-heavy and this route is
# guest-callable. In-memory sliding window (mirrors the auth rate-limit shape
# without recording to the login-attempts table).
# ---------------------------------------------------------------------------
_RATE_WINDOW = 60.0
_RATE_MAX = 20
_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    now = time.time()
    dq = _hits[ip]
    while dq and dq[0] < now - _RATE_WINDOW:
        dq.popleft()
    if len(dq) >= _RATE_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many report requests — wait a moment and try again.",
        )
    dq.append(now)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/pdf")
def report_pdf(
    vm: ReportViewModel,
    request: Request,
    current_user: User = Depends(get_current_user),  # any valid session incl. guest
) -> Response:
    _rate_limit(request)

    # Import WeasyPrint lazily so the rest of the app (and tests) don't require
    # its native libs just to import this router.
    from weasyprint import HTML, default_url_fetcher

    def _no_network_fetcher(url: str, *args, **kwargs):
        # The template references no external assets. Allow only inline data:
        # URIs and refuse network/file access outright.
        if url.startswith("data:"):
            return default_url_fetcher(url, *args, **kwargs)
        raise ValueError(f"external resource blocked: {url[:64]}")

    pdf_bytes = HTML(string=render_report_html(vm), url_fetcher=_no_network_fetcher).write_pdf()
    filename = f"ReadyRoute-Report-{vm.run_date.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Dark HTML template (plain Python f-strings — no jinja2 in this codebase). The
# palette mirrors the app's Tailwind theme so the PDF reads like the screen;
# WeasyPrint paints backgrounds by default, so the dark theme renders. Every
# text value is escaped; hex colours come only from schema-validated fields.
# ---------------------------------------------------------------------------

_e = html.escape

_CSS = """
@page { size: A4 landscape; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "DejaVu Sans", sans-serif; background: #07090d; color: #f2f6fb;
       font-size: 10px; print-color-adjust: exact; -weasy-print-color-adjust: exact; }
.mono { font-family: "DejaVu Sans Mono", monospace; }
.dim { color: #7a8698; }
.head { margin: 0 0 12px; text-align: center; }
.head h1 { font-size: 26px; font-weight: 700; letter-spacing: .01em; margin: 0; }
.head .sub { font-size: 10px; color: #8a96a8; margin: 3px 0 0; }
section { margin: 0 0 14px; page-break-inside: avoid; }
/* Each major section is read as its own standalone sheet, so it starts a fresh
   page and is allowed to flow across pages when it outgrows one (the default
   page-break-inside:avoid above would otherwise shunt a tall section wholesale
   onto the next page and leave the one before it empty). The FIRST block on
   page 1 must never carry this — that is exactly what left the title stranded
   on a blank opening page. */
section.page { page-break-before: always; page-break-inside: auto; }
/* The lead section shares page 1 with the title; allow it to flow rather than
   orphan the header if it ever grows past the remaining space. */
section.lead { page-break-inside: auto; }
/* Section headers are centred and large so each block reads as its own titled
   sheet (e.g. "Unload / Batches"). */
.shead { text-align: center; margin: 0 0 8px; }
.eyebrow { font-size: 8px; text-transform: uppercase; letter-spacing: .14em; color: #7a8698; }
.shead h2 { font-size: 20px; font-weight: 700; margin: 1px 0 0; }
h2 { font-size: 14px; font-weight: 700; margin: 1px 0 6px; }
.subhead { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: .04em;
           text-transform: uppercase; color: #cdd6e2; margin: 2px 0 6px; }
.empty { border: 1px dashed rgba(255,255,255,0.10); background: rgba(22,29,43,0.5);
         color: #8a96a8; text-align: center; padding: 10px; border-radius: 8px; }

.kpis { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
.kpi { flex: 1 1 130px; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
       border-radius: 10px; padding: 7px 10px; }
.klabel { font-size: 8px; text-transform: uppercase; letter-spacing: .06em; color: #7a8698; }
.kvalue { font-size: 16px; font-weight: 700; }
.ksub { font-size: 9px; color: #8a96a8; margin-top: 1px; }

.cards { display: flex; flex-wrap: wrap; gap: 8px; }
/* Batches render as fixed rows of three (1-2-3 over 4-5-6) to mirror the paper
   batch sheet; spacers keep the widths equal when a row is short. */
.cards-row { display: flex; gap: 8px; }
.cards-row + .cards-row { margin-top: 8px; }
.batch { flex: 1 1 0; min-width: 0; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
         border-radius: 12px; padding: 9px 10px; }
.batch.spacer { border-color: transparent; background: transparent; }
.bh { display: flex; justify-content: space-between; align-items: baseline; }
.bname { font-weight: 700; font-size: 11px; }
.cnt { font-size: 11px; }
.bar-track { height: 6px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.06);
             background: #111722; margin: 6px 0; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; }
.chips { line-height: 1.8; }
.chip { display: inline-block; background: #141a27; border-radius: 6px; padding: 1px 6px;
        margin: 0 3px 0 0; font-size: 9px; }
.pill { display: inline-block; border-radius: 6px; padding: 0 5px; margin-left: 5px;
        font-size: 8px; font-weight: 700; background: #141a27; color: #8a96a8; }
.pill.rec, .pill.over { background: rgba(245,158,11,0.20); color: #fcd34d; }

.list { border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; }
.row { display: flex; align-items: center; gap: 8px; padding: 5px 10px; font-size: 10px; }
.row + .row { border-top: 1px solid rgba(255,255,255,0.06); }
.route { color: #7dd3fc; }
/* Load-time tiles: three per row, values grouped and centred inside each tile
   (mirrors the report page). */
.lt-row { display: flex; gap: 6px; page-break-inside: avoid; }
.lt-row + .lt-row { margin-top: 6px; }
.lt { flex: 1 1 0; min-width: 0; display: flex; align-items: baseline; justify-content: center;
      gap: 8px; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
      border-radius: 10px; padding: 5px 10px; }
.lt.spacer { border-color: transparent; background: transparent; }
.ltnum { font-size: 12px; font-weight: 700; min-width: 34px; text-align: right; }
.ltfin { font-size: 9px; min-width: 52px; text-align: center; }
.ltdur { font-size: 12px; font-weight: 700; min-width: 44px; }
.w12 { min-width: 34px; }
.status, .dur { margin-left: auto; }

table { border-collapse: collapse; width: 100%; font-size: 8.5px; }
th, td { border: 1px solid rgba(255,255,255,0.06); padding: 2px 3px; text-align: center;
         font-variant-numeric: tabular-nums; }
th.item, td.item { text-align: left; white-space: nowrap; }
thead { display: table-header-group; }
thead th { background: #111722; color: #8a96a8; font-size: 9px; }
tr.group td { background: #141a27; color: #cdd6e2; font-weight: 700; text-align: left;
              text-transform: uppercase; letter-spacing: .1em; font-size: 8px; }
tr.alt td { background: rgba(255,255,255,0.02); }
td.qty { color: #fcd34d; font-weight: 700; }
td.z { color: #33404f; }
td.tot, th.tot { color: #fcd34d; font-weight: 700; background: #111722; }
tr.trucktot td { background: #111722; color: #fcd34d; font-weight: 700; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 999px;
       margin-right: 5px; vertical-align: middle; }
.unit { font-size: 8px; }

.achips { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 8px; }
.achip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid rgba(255,255,255,0.06);
         background: #161d2b; border-radius: 999px; padding: 2px 9px; font-size: 10px; }
.acards { display: flex; flex-wrap: wrap; gap: 8px; }
.acard { flex: 1 1 220px; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
         border-radius: 12px; padding: 8px 10px; }
/* Top-shorted trucks: one equal-width card per truck on a single row. With
   flex-basis 220px the 5th card wrapped and stretched to the full width, and
   sat flush against the shortage table below. */
.tcards { display: flex; gap: 6px; margin: 0 0 12px; page-break-inside: avoid; }
.tcard { flex: 1 1 0; min-width: 0; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
         border-radius: 12px; padding: 7px 9px; }
.rank { font-size: 10px; font-weight: 700; color: #7a8698; }
.tnum { text-align: center; font-size: 19px; font-weight: 700; letter-spacing: -.01em;
        line-height: 1.1; padding-bottom: 3px; margin-bottom: 3px;
        border-bottom: 1px solid rgba(255,255,255,0.06); }

.inum { text-align: center; font-size: 12px; font-weight: 700; line-height: 1.2;
        padding-bottom: 3px; margin-bottom: 2px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.igroup { text-align: center; font-size: 7px; text-transform: uppercase;
          letter-spacing: .14em; color: #7a8698; }

/* Per-truck "Sheet" cards. The section flows across pages via section.page;
   each ROW is kept intact so a card never splits mid-truck. */
.sc-row { display: flex; gap: 6px; page-break-inside: avoid; }
.sc-row + .sc-row { margin-top: 6px; }
.sc { flex: 1 1 0; min-width: 0; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
      border-radius: 10px; padding: 6px 8px; }
.sc.spacer { border-color: transparent; background: transparent; }
.sch { display: flex; justify-content: space-between; align-items: baseline;
       border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 3px; margin-bottom: 3px; }
.scnum { font-size: 15px; font-weight: 700; }
.scttl { font-size: 9px; color: #fcd34d; }
.scgroup { font-size: 6.5px; text-transform: uppercase; letter-spacing: .14em;
           color: #7a8698; margin: 3px 0 1px; }
.scrow { display: flex; justify-content: space-between; gap: 6px; font-size: 8.5px; padding: 0.5px 0; }
.scitem { color: #cdd6e2; }
.scqty { color: #fcd34d; font-weight: 700; }

/* Coverage renders as big paired ROUTE -> TRUCK cards (the app's canonical
   coverage read) rather than a dense list. */
.cov-row { display: flex; gap: 8px; page-break-inside: avoid; }
.cov-row + .cov-row { margin-top: 8px; }
.cov { flex: 1 1 0; min-width: 0; border: 1px solid rgba(255,255,255,0.06); background: #161d2b;
       border-radius: 12px; padding: 9px 10px; text-align: center; }
.cov.spacer { border-color: transparent; background: transparent; }
.covpair { display: flex; align-items: center; justify-content: center; gap: 10px; }
.covlab { font-size: 7px; text-transform: uppercase; letter-spacing: .14em; color: #7a8698; }
.covnum { font-size: 23px; font-weight: 700; line-height: 1.05; }
.covarrow { font-size: 16px; color: #7a8698; }
.covchips { margin-top: 5px; }
.covstat { margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 4px; font-size: 9px; }
.ah { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
.alist { list-style: none; margin: 0; padding: 0; }
.alist li { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; font-size: 9.5px; }
/* Top-shorted-ITEM cards list every truck rather than truncating, so the rows
   run in two balanced columns. Only these cards: the per-truck cards list item
   names, which are words and need the full width. */
.alist.cols { column-count: 2; column-gap: 10px; }
.alist.cols li { break-inside: avoid; }
.il { color: #cdd6e2; }
.warn { display: inline-block; border-radius: 4px; padding: 0 4px; margin-left: 5px; font-size: 8px;
        font-weight: 700; text-transform: uppercase; background: rgba(245,158,11,0.20); color: #fcd34d; }
.warn.done { background: #334155; color: #cbd5e1; }
"""


def _section_head(eyebrow: str, title: str) -> str:
    """Centred two-line section header — small eyebrow over a large title."""
    return (
        f'<div class="shead"><div class="eyebrow">{_e(eyebrow)}</div>'
        f"<h2>{_e(title)}</h2></div>"
    )


def _kpis_html(kpis) -> str:
    if not kpis:
        return ""
    cells = []
    for k in kpis:
        tone = f' style="color:{k.tone}"' if k.tone else ""
        sub = f'<div class="ksub">{_e(k.sub)}</div>' if k.sub else ""
        cells.append(
            f'<div class="kpi"><div class="klabel">{_e(k.label)}</div>'
            f'<div class="kvalue"{tone}>{_e(k.value)}</div>{sub}</div>'
        )
    return f'<div class="kpis">{"".join(cells)}</div>'


def _batches_html(b: BatchesSectionVM | None) -> str:
    if b is None:
        return ""
    out = ['<section class="page">', _section_head("Unload", "Batches")]
    if b.disabled:
        out.append('<div class="empty">Batching is turned off for this day.</div></section>')
        return "".join(out)
    out.append(_kpis_html(b.kpis))
    if not b.cards:
        out.append('<div class="empty">No batches.</div>')
    else:
        cards = []
        for c in sorted(b.cards, key=lambda x: int(x.batch_number)):
            over = '<span class="pill over">over</span>' if c.overbatched else ""
            chips = "".join(
                f'<span class="chip"><span class="mono">#{int(t.truck_number)}</span> '
                f'<span class="dim">({int(t.wearers)})</span></span>'
                for t in c.trucks
            ) or '<span class="dim">Empty</span>'
            cards.append(
                f'<div class="batch"><div class="bh">'
                f'<span class="bname">Batch {int(c.batch_number)}{over}</span>'
                f'<span class="cnt mono" style="color:{c.text_hex}">{_e(c.cap_label)}</span></div>'
                f'<div class="bar-track"><div class="bar-fill" style="width:{int(c.pct)}%;background:{c.bar_hex}"></div></div>'
                f'<div class="chips">{chips}</div></div>'
            )
        # Fixed rows of three so the sheet always reads 1-2-3 over 4-5-6, like
        # the paper batch sheet. Short rows get invisible spacers so every card
        # keeps the same width.
        rows = []
        for i in range(0, len(cards), 3):
            chunk = cards[i : i + 3]
            chunk += ['<div class="batch spacer"></div>'] * (3 - len(chunk))
            rows.append(f'<div class="cards-row">{"".join(chunk)}</div>')
        out.append("".join(rows))
    out.append("</section>")
    return "".join(out)


def _coverage_html(c: CoverageSectionVM | None) -> str:
    if c is None:
        return ""
    out = ['<section class="lead">', _section_head("Load", "Routes covered")]
    if not c.rows:
        out.append('<div class="empty">No route coverage recorded for this day.</div></section>')
        return "".join(out)
    cards = []
    for r in c.rows:
        rec = '<span class="pill rec">recurring</span>' if r.recurring else ""
        ret = '<span class="pill">returned</span>' if r.returned else ""
        # A split load runs the route on BOTH trucks, so it joins with "+" —
        # an arrow would read as a handoff. `type` is checked as a fallback so
        # a client cached before `split` shipped still renders splits correctly.
        joiner = "+" if (r.split or r.type == "Split") else "&#8594;"
        cards.append(
            f'<div class="cov"><div class="covpair">'
            f'<div><div class="covlab">Route</div>'
            f'<div class="covnum mono route">#{int(r.route_truck)}</div></div>'
            f'<div class="covarrow">{joiner}</div>'
            f'<div><div class="covlab">{"Loaded on" if r.loaded else "Loads on"}</div>'
            f'<div class="covnum mono">#{int(r.load_on_truck)}</div></div></div>'
            f'<div class="covchips"><span class="chip">{_e(r.type)}</span>{rec}{ret}</div>'
            f'<div class="covstat" style="color:{r.status_hex}">{_e(r.status_label)}</div></div>'
        )
    # Rows of three, spacers keeping widths even (same shape as the batch grid).
    rows = []
    for i in range(0, len(cards), 3):
        chunk = cards[i : i + 3]
        chunk += ['<div class="cov spacer"></div>'] * (3 - len(chunk))
        rows.append(f'<div class="cov-row">{"".join(chunk)}</div>')
    out.append(f'{"".join(rows)}</section>')
    return "".join(out)


def _load_times_html(lt: LoadTimesSectionVM | None) -> str:
    if lt is None:
        return ""
    out = ['<section class="page">', _section_head("Load", "Load times"), _kpis_html(lt.kpis)]
    if not lt.rows:
        out.append('<div class="empty">No trucks have finished loading yet.</div></section>')
        return "".join(out)
    # Condensed tiles, three per row — the same shape the report page uses. A
    # full-width row per truck stranded the duration a page-width away from the
    # truck number it belongs to, and ran three times as long.
    tiles = [
        f'<div class="lt"><span class="mono ltnum">#{int(r.truck_number)}</span>'
        f'<span class="dim ltfin">{_e(r.finish_label)}</span>'
        f'<span class="mono ltdur" style="color:{r.tone}">{_e(r.duration_label)}</span></div>'
        for r in lt.rows
    ]
    rows = []
    for i in range(0, len(tiles), 3):
        chunk = tiles[i : i + 3]
        chunk += ['<div class="lt spacer"></div>'] * (3 - len(chunk))
        rows.append(f'<div class="lt-row">{"".join(chunk)}</div>')
    out.append(f'{"".join(rows)}</section>')
    return "".join(out)


def _top_trucks_html(top) -> str:
    if not top:
        return ""
    cards = []
    for i, t in enumerate(top, 1):
        items = "".join(
            f'<li><span class="il">{_e(it.label)}</span>'
            f'<span class="mono" style="color:#fcd34d">{int(it.qty)}</span></li>'
            for it in t.items
        )
        # Place + qty flank the row above so the truck number stays centred.
        cards.append(
            f'<div class="tcard">'
            f'<div class="ah"><span class="rank">#{i}</span>'
            f'<span class="mono" style="color:#fcd34d">{int(t.total)} <span class="dim">qty</span></span></div>'
            f'<div class="tnum mono">#{int(t.truck_number)}</div>'
            f'<ul class="alist">{items}</ul></div>'
        )
    return (
        '<div class="subhead">Top shorted trucks</div>'
        f'<div class="tcards">{"".join(cards)}</div>'
    )


def _top_items_html(m) -> str:
    """Top 5 shorted items. Derived from the matrix rows (whose `total` is the
    item's qty across every truck) so it can never disagree with the sheet
    printed right below it."""
    if m is None or not m.rows:
        return ""
    ranked = sorted(m.rows, key=lambda r: int(r.total), reverse=True)[:5]
    cards = []
    for i, r in enumerate(ranked, 1):
        # Which trucks made up this item's total, biggest first — the mirror of
        # the per-truck cards above, which list items.
        hits = sorted(
            ((int(m.trucks[idx]), int(q)) for idx, q in enumerate(r.cells) if q),
            key=lambda kv: kv[1],
            reverse=True,
        )
        # Every truck, in two balanced columns. The rows are two short numbers
        # in different colours, so they stay legible at half width — and an item
        # is routinely short on 15-20 trucks, where a "+14 more" tail hid the
        # detail the page exists to show.
        rows_html = "".join(
            f'<li><span class="il mono">#{tn}</span>'
            f'<span class="mono" style="color:#fcd34d">{q}</span></li>'
            for tn, q in hits
        )
        cards.append(
            f'<div class="tcard">'
            f'<div class="ah"><span class="rank">#{i}</span>'
            f'<span class="mono" style="color:#fcd34d">{int(r.total)} <span class="dim">qty</span></span></div>'
            f'<div class="inum"><span class="dot" style="background:{r.dot_hex}"></span>'
            f"{_e(r.label)}</div>"
            f'<div class="igroup">{_e(r.group)}</div>'
            f'<ul class="alist cols">{rows_html}</ul></div>'
        )
    return (
        '<div class="subhead">Top shorted items</div>'
        f'<div class="tcards">{"".join(cards)}</div>'
    )


def _sheet_cards_html(s: ShortagesSectionVM | None) -> str:
    """The per-truck "Sheet" cards — one card per shorted truck listing its
    items grouped by family — on their own page after the main report."""
    if s is None or s.matrix is None or not s.matrix.rows:
        return ""
    m = s.matrix
    cards = []
    for idx, truck in enumerate(m.trucks):
        hits = [r for r in m.rows if r.cells[idx]]
        if not hits:
            continue
        body, prev_group = [], None
        for r in hits:
            if r.group != prev_group:
                body.append(f'<div class="scgroup">{_e(r.group)}</div>')
                prev_group = r.group
            body.append(
                f'<div class="scrow"><span class="scitem">'
                f'<span class="dot" style="background:{r.dot_hex}"></span>{_e(r.label)}</span>'
                f'<span class="mono scqty">{int(r.cells[idx])}</span></div>'
            )
        cards.append(
            f'<div class="sc"><div class="sch">'
            f'<span class="mono scnum">{int(truck)}</span>'
            f'<span class="mono scttl">{int(m.truck_totals[idx])} <span class="dim">qty</span></span>'
            f'</div>{"".join(body)}</div>'
        )
    if not cards:
        return ""
    rows = []
    for i in range(0, len(cards), 4):
        chunk = cards[i : i + 4]
        chunk += ['<div class="sc spacer"></div>'] * (4 - len(chunk))
        rows.append(f'<div class="sc-row">{"".join(chunk)}</div>')
    return (
        '<section class="page">'
        + _section_head("Load", "Short sheet by truck")
        + "".join(rows)
        + "</section>"
    )


def _shortages_html(s: ShortagesSectionVM | None) -> str:
    """The shortage SUMMARY — KPIs, top shorted trucks, top shorted items. This
    is the report's opening block, so it shares page 1 with the title. The
    truck x item grid is a separate section (_short_grid_html) that gets its own
    page."""
    if s is None:
        return ""
    return "".join(
        [
            '<section class="lead">',
            _section_head("Load", "Shortages"),
            _kpis_html(s.kpis),
            _top_trucks_html(s.top_trucks),
            _top_items_html(s.matrix),
            "</section>",
        ]
    )


def _short_grid_html(s: ShortagesSectionVM | None) -> str:
    """The short-sheet GRID (item rows x truck columns), on its own page."""
    if s is None:
        return ""
    m = s.matrix
    if m is None:
        # The grid is its own selectable section — a null matrix means it wasn't
        # included, which is not the same as "no shortages".
        return ""
    out = ['<section class="page">', _section_head("Load", "Short sheet")]
    if not m.rows:
        out.append('<div class="empty">No shortages logged for this day.</div></section>')
        return "".join(out)

    header = ['<th class="item">Item</th>']
    header += [f"<th>{int(t)}</th>" for t in m.trucks]
    header.append('<th class="tot">Tot</th>')

    body = []
    prev_group = None
    span = len(m.trucks) + 2
    di = 0
    for row in m.rows:
        if row.group != prev_group:
            body.append(f'<tr class="group"><td colspan="{span}">{_e(row.group)}</td></tr>')
            prev_group = row.group
        tr_cls = ' class="alt"' if di % 2 else ""
        di += 1
        unit = f' <span class="dim unit">{_e(row.unit)}s</span>' if row.unit else ""
        label = f'<span class="dot" style="background:{row.dot_hex}"></span>{_e(row.label)}{unit}'
        cells = "".join(
            (f'<td class="qty">{int(v)}</td>' if v is not None else '<td class="z">-</td>')
            for v in row.cells
        )
        body.append(f'<tr{tr_cls}><td class="item">{label}</td>{cells}<td class="tot">{int(row.total)}</td></tr>')

    totals = "".join(f"<td>{int(v)}</td>" for v in m.truck_totals)
    foot = (
        f'<tr class="trucktot"><td class="item">Truck total</td>{totals}'
        f'<td class="tot">{int(m.grand_total)}</td></tr>'
    )
    out.append(
        f'<table><thead><tr>{"".join(header)}</tr></thead>'
        f'<tbody>{"".join(body)}{foot}</tbody></table></section>'
    )
    return "".join(out)


def _audit_html(a: AuditSectionVM | None) -> str:
    if a is None:
        return ""
    out = ['<section class="page">', _section_head("Load", "Audit"), _kpis_html(a.kpis)]
    if a.chips:
        chips = "".join(
            f'<span class="achip"><span class="dot" style="background:{c.dot_hex}"></span>'
            f'<span class="dim">{_e(c.category)}</span> <span class="mono">{int(c.qty)}</span></span>'
            for c in a.chips
        )
        out.append(f'<div class="achips">{chips}</div>')
    if not a.cards:
        out.append('<div class="empty">No audit entries logged for this day.</div></section>')
        return "".join(out)
    cards = []
    for c in a.cards:
        ro = ""
        if c.route_override is not None and c.route_override != c.truck_number:
            ro = f' <span class="dim">(route {int(c.route_override)})</span>'
        items = []
        for e in c.entries:
            warn = ""
            if e.warn:
                warn = f'<span class="warn{" done" if e.warn_applied else ""}">warn</span>'
            items.append(
                f'<li><span class="il">{_e(e.item_label)}{warn}</span>'
                f'<span class="mono">×{int(e.quantity)}</span></li>'
            )
        n = len(c.entries)
        cards.append(
            f'<div class="acard"><div class="ah">'
            f'<span><span class="mono">#{int(c.truck_number)}</span>{ro}</span>'
            f'<span class="dim">{n} item{"" if n == 1 else "s"}</span></div>'
            f'<ul class="alist">{"".join(items)}</ul></div>'
        )
    out.append(f'<div class="acards">{"".join(cards)}</div></section>')
    return "".join(out)


def render_report_html(vm: ReportViewModel) -> str:
    bits = [vm.run_date.strftime("%A, %B %d, %Y")]
    if vm.load_day is not None:
        bits.append(f"Load Day {int(vm.load_day)}")
    if vm.unload_day is not None:
        bits.append(f"Unload Day {int(vm.unload_day)}")
    if vm.shift_label:
        bits.append(vm.shift_label)
    if vm.generated_at is not None:
        # The client sends an ISO instant (UTC). Show it in the app timezone
        # (Eastern) so the "Generated" stamp reads as local wall-clock.
        gen = vm.generated_at
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        gen = gen.astimezone(ZoneInfo(settings.timezone))
        bits.append("Generated " + gen.strftime("%b %d, %Y %I:%M %p"))
    body = "".join(
        [
            # Page 1 leads with route coverage — who is carrying whose
            # route is the first thing to know — followed by the shortage
            # summary. Every section after those starts a fresh page.
            _coverage_html(vm.coverage),
            _shortages_html(vm.shortages),
            _short_grid_html(vm.shortages),
            _sheet_cards_html(vm.shortages),
            _load_times_html(vm.load_times),
            _audit_html(vm.audit),
            # Batches last.
            _batches_html(vm.batches),
        ]
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_CSS}</style></head><body>"
        f'<div class="head"><h1>{_e(vm.title)}</h1>'
        f'<p class="sub">{_e(" · ".join(bits))}</p></div>'
        f"{body}</body></html>"
    )
