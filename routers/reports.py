"""
Router: /reports

Server-side rendering of the run report to a downloadable PDF.

The report is composed entirely in the browser (LiveReport.tsx) with a lot of
business logic and heavy styling (colour, progress bars, chips). Rather than
re-derive and re-style it in Python — which never matched the screen — the
client captures each report section as a PNG (the same html-to-image capture
the "Download image" button uses) and POSTs the images here. This endpoint wraps
them, one per landscape page, into a single PDF via WeasyPrint. So the PDF *is*
the on-screen report.

Read-only and guest-readable (the /report page is public). Each image is decoded
and verified to be a real PNG before it goes anywhere near the HTML, so a crafted
string can't inject markup, and WeasyPrint's resource fetcher is disabled so it
can't fetch a network/file resource.
"""

import base64
import html
import time
from collections import defaultdict, deque
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from models import User
from routers.auth import get_current_user
from schemas import ReportImagesRequest

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


_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _clean_png_b64(raw: str) -> str:
    """Validate one client image and return safe-to-inline base64.

    Strips an optional `data:` prefix, requires the remainder to be strict
    base64 (validate=True rejects anything outside the base64 alphabet — so no
    quotes/brackets can survive into the data URI), requires the decoded bytes
    to start with the PNG signature, and fully decodes the image so a truncated
    or corrupt PNG is a clean 422 here rather than an unhandled 500 later inside
    WeasyPrint. Returns the cleaned base64 string.
    """
    s = raw.split(",", 1)[-1].strip() if raw.startswith("data:") else raw.strip()
    try:
        decoded = base64.b64decode(s, validate=True)
    except Exception:
        raise HTTPException(422, "invalid image encoding")
    if decoded[:8] != _PNG_MAGIC:
        raise HTTPException(422, "each image must be a PNG")
    try:
        from PIL import Image

        with Image.open(BytesIO(decoded)) as im:
            im.load()  # force a full decode; raises on a truncated/corrupt PNG
    except Exception:
        raise HTTPException(422, "corrupt or truncated image")
    return s


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/pdf")
def report_pdf(
    req: ReportImagesRequest,
    request: Request,
    current_user: User = Depends(get_current_user),  # any valid session incl. guest
) -> Response:
    _rate_limit(request)

    images = [_clean_png_b64(img) for img in req.images]

    # Import WeasyPrint lazily so the rest of the app (and tests) don't require
    # its native libs just to import this router.
    from weasyprint import HTML, default_url_fetcher

    def _no_network_fetcher(url: str, *args, **kwargs):
        # The template references no external assets — only inline data: URIs
        # (the report images). Refuse network/file access outright.
        if url.startswith("data:"):
            return default_url_fetcher(url, *args, **kwargs)
        raise ValueError(f"external resource blocked: {url[:64]}")

    pdf_bytes = HTML(
        string=render_report_html(req.title, req.subtitle, images),
        url_fetcher=_no_network_fetcher,
    ).write_pdf()
    filename = f"ReadyRoute-Report-{req.run_date.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# HTML template (plain Python — no jinja2 in this codebase). Each section image
# fills its own landscape page; a slim title band sits atop the first page.
# ---------------------------------------------------------------------------

_e = html.escape

_CSS = """
@page { size: A4 landscape; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "DejaVu Sans", sans-serif; background: #ffffff; }
.head { margin: 0 0 4mm; }
.head h1 { font-size: 15px; margin: 0; color: #0b1220; }
.head .sub { font-size: 10px; color: #556; margin: 1px 0 0; }
.pg { page-break-after: always; text-align: center; }
.pg:last-child { page-break-after: auto; }
/* Fit each capture within one landscape page (usable height ≈ 210 − 2·8 mm),
   leaving room on page 1 for the title band. Wide captures are width-bound. */
.pg img { max-width: 100%; max-height: 178mm; }
"""


def render_report_html(title: str, subtitle: str | None, images: list[str]) -> str:
    head = [f"<h1>{_e(title)}</h1>"]
    if subtitle:
        head.append(f'<p class="sub">{_e(subtitle)}</p>')
    pages = "".join(
        f'<div class="pg"><img src="data:image/png;base64,{b64}"></div>' for b64 in images
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_CSS}</style></head><body>"
        f'<div class="head">{"".join(head)}</div>'
        f"{pages}"
        "</body></html>"
    )
