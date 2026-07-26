"""
Router: /reports

Server-side rendering of the run report to a downloadable PDF.

The report is composed entirely in the browser (LiveReport.tsx) with a lot of
business logic, so rather than re-derive it in Python, the client POSTs its
already-computed view-model (the exact numbers/rows it shows) and this endpoint
turns that into a landscape PDF via WeasyPrint. Read-only, and guest-readable
(the /report page is public) — it renders only values the caller can already
see. Every interpolated value is HTML-escaped, and WeasyPrint's resource
fetcher is disabled, so a crafted string can't inject markup or fetch a
resource.
"""

import html
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from database import get_db  # noqa: F401  (kept for parity/future use)
from models import User
from routers.auth import get_current_user
from schemas import (
    BatchesSectionVM,
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
        # The template references no external assets; allow only inline data:
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
# HTML template (plain Python — no jinja2 in this codebase). WeasyPrint uses its
# own CSS engine, so styling is self-contained; a light theme prints cleanly.
# ---------------------------------------------------------------------------

_e = html.escape


def _css() -> str:
    return """
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: "DejaVu Sans", sans-serif; font-size: 10px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    .sub { color: #555; font-size: 11px; margin: 0 0 14px; }
    h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
    .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
    .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; min-width: 130px; }
    .kpi .label { font-size: 8px; text-transform: uppercase; letter-spacing: .08em; color: #777; }
    .kpi .value { font-size: 16px; font-weight: 700; }
    .kpi .sub { font-size: 9px; color: #666; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 2px 4px; text-align: center; font-variant-numeric: tabular-nums; }
    th.item, td.item { text-align: left; white-space: nowrap; }
    thead { display: table-header-group; }
    tr.group td { background: #eee; font-weight: 700; text-align: left; text-transform: uppercase; letter-spacing: .1em; font-size: 8px; }
    td.tot, th.tot, tr.trucktot td { font-weight: 700; background: #fafafa; }
    .empty { color: #888; font-style: italic; padding: 6px 0; }
    .batches { display: flex; flex-wrap: wrap; gap: 8px; }
    .batch { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; min-width: 150px; }
    .batch .bh { font-weight: 700; display: flex; justify-content: space-between; gap: 8px; }
    .batch .chips { margin-top: 3px; font-size: 9px; color: #333; line-height: 1.4; }
    """


def _kpis_html(kpis) -> str:
    if not kpis:
        return ""
    cells = []
    for k in kpis:
        sub = f'<div class="sub">{_e(k.sub)}</div>' if k.sub else ""
        cells.append(
            f'<div class="kpi"><div class="label">{_e(k.label)}</div>'
            f'<div class="value">{_e(k.value)}</div>{sub}</div>'
        )
    return f'<div class="kpis">{"".join(cells)}</div>'


def _batches_html(b: BatchesSectionVM | None) -> str:
    if b is None:
        return ""
    out = ["<h2>Batches</h2>"]
    if b.disabled:
        out.append('<p class="empty">Batching is turned off for this day.</p>')
        return "".join(out)
    out.append(_kpis_html(b.kpis))
    cap_txt = "∞" if b.no_cap else str(b.cap)
    cards = []
    for c in b.cards:
        chips = ", ".join(f"#{t.truck_number} ({t.wearers})" for t in c.trucks) or "Empty"
        cards.append(
            f'<div class="batch"><div class="bh"><span>Batch {int(c.batch_number)}</span>'
            f'<span>{int(c.total_wearers)} / {_e(cap_txt)}</span></div>'
            f'<div class="chips">{_e(chips)}</div></div>'
        )
    out.append(f'<div class="batches">{"".join(cards)}</div>' if cards else '<p class="empty">No batches.</p>')
    return "".join(out)


def _shortages_html(s: ShortagesSectionVM | None) -> str:
    if s is None:
        return ""
    out = ["<h2>Shortages</h2>", _kpis_html(s.kpis)]
    m = s.matrix
    if m is None or not m.rows:
        out.append('<p class="empty">No shortages logged for this day.</p>')
        return "".join(out)

    header = ['<th class="item">Item</th>']
    header += [f"<th>{int(t)}</th>" for t in m.trucks]
    header.append('<th class="tot">Tot</th>')

    body = []
    prev_group = None
    span = len(m.trucks) + 2
    for row in m.rows:
        if row.group != prev_group:
            body.append(f'<tr class="group"><td colspan="{span}">{_e(row.group)}</td></tr>')
            prev_group = row.group
        label = _e(row.label) + (f" <span style='color:#888'>{_e(row.unit)}s</span>" if row.unit else "")
        cells = "".join(f"<td>{'' if v is None else int(v)}</td>" for v in row.cells)
        body.append(f'<tr><td class="item">{label}</td>{cells}<td class="tot">{int(row.total)}</td></tr>')

    totals = "".join(f"<td>{int(v)}</td>" for v in m.truck_totals)
    foot = (
        f'<tr class="trucktot"><td class="item">Truck total</td>{totals}'
        f'<td class="tot">{int(m.grand_total)}</td></tr>'
    )

    out.append(
        f'<table><thead><tr>{"".join(header)}</tr></thead>'
        f'<tbody>{"".join(body)}{foot}</tbody></table>'
    )
    return "".join(out)


def render_report_html(vm: ReportViewModel) -> str:
    sub_bits = [vm.run_date.strftime("%A, %B %d, %Y")]
    if vm.load_day is not None:
        sub_bits.append(f"Load Day {int(vm.load_day)}")
    if vm.unload_day is not None:
        sub_bits.append(f"Unload Day {int(vm.unload_day)}")
    if vm.shift_label:
        sub_bits.append(vm.shift_label)
    if vm.generated_at is not None:
        sub_bits.append("Generated " + vm.generated_at.strftime("%b %d, %Y %I:%M %p"))
    parts = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        f"<style>{_css()}</style></head><body>",
        f"<h1>{_e(vm.title)}</h1>",
        f'<p class="sub">{_e(" · ".join(sub_bits))}</p>',
        _batches_html(vm.batches),
        _shortages_html(vm.shortages),
        "</body></html>",
    ]
    return "".join(parts)
