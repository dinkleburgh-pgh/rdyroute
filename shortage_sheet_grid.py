"""Geometric cell extraction for the V1A shortage sheet.

NOT WIRED INTO THE IMPORT PIPELINE YET — see the accuracy note at the bottom.

The sheet is a rigid printed form: 53 item rows x 16 truck columns, ~848 cells,
of which a typical day has around 20 written in. `shortage_sheet_ocr` currently
hands whole regions to the model and asks it to both FIND and READ the numbers,
using fixed fractional crops that assume a squared-up scan. This module does the
finding geometrically instead, so the model only ever sees one number at a time.

Measured on .data/shortage_sheet_photos/2026-06-11 (7 photos):

  * grid detection lands 848 cells (53 x 16) — the exact template shape
  * empty cells measure 0.000 ink, so the ~20 written cells separate cleanly

Three things mattered, each found by looking at the failures:

1. Thin item rules are far fainter than the band separators. Thresholding low
   enough to catch them re-admits noise, so instead detect the strong rules and
   subdivide any gap that is a multiple of the modal pitch. 39 detected rules
   become the correct 54 that way.
2. A single global ink threshold fails on a hand-held photo — the shaded half
   of the page reads as ink everywhere (276 false "filled" cells against ~20).
   Compare each pixel to a locally blurred background instead.
3. Handwriting overruns the cell it belongs to, and any small offset in the
   derived column grid clips the same side of every entry (960 read as 60, 200
   as 0). The window used to DECIDE a cell is written in must therefore be
   tight, while the window CROPPED for the model is deliberately wider.

Pure Pillow, no numpy/OpenCV: profiles are taken by resizing to a 1px strip,
which pushes the per-pixel work into Pillow's C resampler and keeps the backend
image dependency exactly as it is today.
"""
from __future__ import annotations

import io
from collections import Counter
from dataclasses import dataclass

from PIL import Image, ImageChops, ImageFilter, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover - optional codec dependency
    pass

N_COLS = 16
DETECT_SIDE = 1600
# The printed form has 53 item rows; detection lands within a couple either way
# on a good photo, so anything further out means the geometry did not resolve.
TEMPLATE_ROWS = 53
ROW_COUNT_TOLERANCE = 6
# Deliberately low: the row COUNT is what actually separates a resolved grid
# from a broken one. 2026-05-22 finds only 21 rules yet subdivides to a correct
# 52 rows, while 2026-06-24 finds 39 and subdivides to 83. Gating on the rule
# count threw away good sheets.
MIN_STRONG_RULES = 12


class LowConfidenceSheet(RuntimeError):
    """Raised when the grid did not resolve well enough to trust the crops."""


@dataclass(frozen=True)
class SheetCell:
    """One located cell. `box` indexes the FULL-RESOLUTION image."""

    row_index: int
    column_index: int
    box: tuple[int, int, int, int]
    ink: float


def _load(content: bytes, max_side: int | None) -> Image.Image:
    with Image.open(io.BytesIO(content)) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        if max_side:
            scale = min(1.0, max_side / max(im.size))
            if scale < 1.0:
                im = im.resize((int(im.width * scale), int(im.height * scale)),
                               Image.Resampling.LANCZOS)
        return im.copy()


def _cell_ink(crop: Image.Image, drop: int = 55) -> float:
    """Fraction of pixels far darker than THIS cell's own paper tone.

    A global (or even locally-blurred) threshold cannot separate writing from
    the grey shaded rows on the later form revision: printed grey is a halftone
    dot pattern, and a blur wide enough to span a 20px band averages grey and
    white together so whole bands read as "darker than background". Judging each
    cell against its own median makes the paper tone irrelevant — the cell is
    written in only if it holds pixels much darker than its own background.
    """
    histogram = crop.histogram()
    total = sum(histogram)
    if not total:
        return 0.0
    acc = 0
    median = 255
    for value, count in enumerate(histogram):
        acc += count
        if acc >= total * 0.55:
            median = value
            break
    cutoff = max(0, median - drop)
    return sum(histogram[: cutoff + 1]) / total


def _profile(im: Image.Image, axis: str) -> list[int]:
    if axis == "h":
        strip = im.resize((1, im.height), Image.Resampling.BOX)
        return [strip.getpixel((0, y)) for y in range(im.height)]
    strip = im.resize((im.width, 1), Image.Resampling.BOX)
    return [strip.getpixel((x, 0)) for x in range(im.width)]


def _ridges(values: list[int], cutoff: float, min_gap: int, offset: int = 0) -> list[int]:
    found: list[int] = []
    run: list[int] = []
    for i, v in enumerate(values):
        if v >= cutoff:
            run.append(i)
        elif run:
            found.append(sum(run) // len(run))
            run = []
    if run:
        found.append(sum(run) // len(run))
    merged: list[int] = []
    for p in found:
        if merged and p - merged[-1] < min_gap:
            merged[-1] = (merged[-1] + p) // 2
        else:
            merged.append(p)
    return [p + offset for p in merged]


def _best_shift(reference: list[int], other: list[int], max_shift: int, step: int = 2) -> int:
    """Vertical displacement of `other` against `reference`, by correlation.

    Sheets photographed on a clipboard bow, so a rule is not at one y across the
    whole page — it arches. Correlating each column strip's profile against a
    reference strip measures that displacement directly, which is far more
    robust than trying to fit the curve analytically.
    """
    n = min(len(reference), len(other))
    best_shift, best_score = 0, -1.0
    for shift in range(-max_shift, max_shift + 1):
        lo = max(0, -shift)
        hi = min(n, n - shift)
        if hi - lo < n // 3:
            continue
        score = 0
        for i in range(lo, hi, step):
            score += reference[i] * other[i + shift]
        if score > best_score:
            best_score, best_shift = float(score), shift
    return best_shift


def _modal_pitch(lines: list[int], lo: int, hi: int) -> float | None:
    gaps = [lines[i + 1] - lines[i] for i in range(len(lines) - 1)]
    usable = [g for g in gaps if lo <= g <= hi]
    if not usable:
        return None
    mode = Counter(usable).most_common(1)[0][0]
    near = [g for g in usable if abs(g - mode) <= 3]
    return sum(near) / len(near) if near else float(mode)


def _subdivide(lines: list[int], pitch: float, tol: float = 0.34) -> list[int]:
    """Insert the faint rules that thresholding missed."""
    out: list[int] = []
    for i in range(len(lines) - 1):
        a, b = lines[i], lines[i + 1]
        out.append(a)
        k = round((b - a) / pitch)
        if k >= 2 and abs((b - a) / pitch - k) < tol * k:
            step = (b - a) / k
            out.extend(int(round(a + step * j)) for j in range(1, k))
    out.append(lines[-1])
    return out


def locate_cells(content: bytes, *, ink_cutoff: float = 0.24) -> tuple[Image.Image, list[SheetCell]]:
    """Return the full-resolution image plus every cell that has writing in it.

    Geometry is derived on a downscaled copy (cheap, and the rules are heavy
    enough to survive) while the returned boxes index the original, because a
    3000x4000 photo downscaled to 1800 leaves ~26px rows and a digit that small
    cannot be identified no matter how far it is upscaled afterwards.
    """
    small = _load(content, DETECT_SIDE)
    full = _load(content, None)
    # A truncated upload (one 1x1 PNG exists in .data) would otherwise blow up
    # deep in the profiling with an opaque "height and width must be > 0".
    if small.width < 400 or small.height < 500:
        raise ValueError(
            f"image is {small.width}x{small.height}; a shortage sheet needs to be at "
            "least 400x500 for the grid rules to be resolvable"
        )
    scale = full.width / small.width
    width, height = small.size

    histogram = small.histogram()
    total = sum(histogram)
    acc = 0
    global_cut = 120
    for i, count in enumerate(histogram):
        acc += count
        if acc > total * 0.18:
            global_cut = max(60, min(180, i))
            break
    rules = small.point(lambda p: 255 if p < global_cut else 0)

    # The printed label block is solid black; its right edge anchors the data area.
    left = rules.crop((0, int(height * 0.10), int(width * 0.40), int(height * 0.85)))
    left_profile = _profile(left, "v")
    darkest = max(range(len(left_profile)), key=lambda i: left_profile[i])
    label_edge = next(
        (x for x in range(darkest, len(left_profile))
         if left_profile[x] < left_profile[darkest] * 0.35),
        darkest,
    )

    body = rules.crop((label_edge, int(height * 0.12), width, int(height * 0.82)))
    vertical = _profile(body, "v")
    v_rules = _ridges(vertical, max(vertical) * 0.28, 12, offset=label_edge)
    # Derive columns from the pitch, never from the rightmost dark pixel — the
    # page edge and its shadow sit outside the table and would stretch the grid.
    pitch_x = _modal_pitch(v_rules, 25, 60) or 41.0
    columns = [label_edge + pitch_x * i for i in range(N_COLS + 1)]

    # Rows are found on a NARROW reference strip, not the full width: across a
    # bowed page the rules are at different heights in different columns, so a
    # full-width profile smears them together and most simply vanish under the
    # threshold (38 of 54 found, on the clipboard photos).
    ref_lo = int(columns[0] + (columns[-1] - columns[0]) * 0.34)
    ref_hi = int(columns[0] + (columns[-1] - columns[0]) * 0.60)
    reference = _profile(rules.crop((ref_lo, 0, ref_hi, height)), "h")
    strong = [y for y in _ridges(reference, max(reference) * 0.22, 8)
              if int(height * 0.088) < y < int(height * 0.88)]

    # Choose the pitch that reproduces the template's row count, rather than
    # trusting the modal gap outright. On sheets where few rules survive, the
    # modal gap is simply wrong (15.6px against a true ~22px on 2026-06-24) and
    # subdivision then invents rows — 83 of them, against the 53 the form has —
    # which is what produced hundreds of bogus cells.
    candidates: list[float] = []
    modal = _modal_pitch(strong, 13, 26)
    if modal:
        candidates.append(modal)
    if len(strong) >= 2:
        gaps = sorted(strong[i + 1] - strong[i] for i in range(len(strong) - 1))
        candidates.append(float(gaps[len(gaps) // 2]))
        candidates.append((strong[-1] - strong[0]) / max(1, TEMPLATE_ROWS - 1))
    candidates = [p for p in candidates if 12.0 <= p <= 30.0] or [19.0]

    pitch_y, rows = None, None
    for candidate in sorted(set(candidates)):
        subdivided = _subdivide(strong, candidate)
        if rows is None or abs(len(subdivided) - TEMPLATE_ROWS) < abs(len(rows) - TEMPLATE_ROWS):
            pitch_y, rows = candidate, subdivided

    # Refuse to guess. A sheet whose geometry did not resolve would emit crops
    # cut from the wrong places, and mislabelled crops are worse than no crops
    # when the point is to build a training set.
    if len(strong) < MIN_STRONG_RULES or abs(len(rows) - TEMPLATE_ROWS) > ROW_COUNT_TOLERANCE:
        raise LowConfidenceSheet(
            f"grid did not resolve: {len(strong)} rules found "
            f"(need {MIN_STRONG_RULES}), pitch {pitch_y:.1f}px, "
            f"{len(rows)} rows against a template of {TEMPLATE_ROWS}"
        )

    # How far each column's rules sit above/below the reference strip.
    #
    # This is a single shift per column, i.e. a rigid vertical slide. A bow is
    # really a 2D warp, and measuring the top and bottom of each column
    # separately to interpolate between them is the obvious refinement — but it
    # measured WORSE (135 -> 207 stray cells on 2026-07-31, and 35 -> 43 on the
    # flat reference), because correlating a third of a profile is far noisier
    # than correlating the whole thing. Keeping the honest, simpler version.
    max_shift = max(6, int(pitch_y * 1.5))
    shifts: list[int] = []
    strip_profiles: list[list[int]] = []
    for ci in range(N_COLS):
        strip = _profile(rules.crop((int(columns[ci]), 0, int(columns[ci + 1]), height)), "h")
        strip_profiles.append(strip)
        shifts.append(_best_shift(reference, strip, max_shift))

    # Better still: take each column's rules from its OWN profile, where they
    # are locally sharp, instead of sliding one set of reference rows around.
    # That sidesteps modelling the curve at all. It is only usable when a strip
    # yields the same number of boundaries as the reference, since row index
    # has to mean the same item in every column; otherwise fall back to the
    # shift. Subdivision uses the global pitch, which is steadier than a pitch
    # re-estimated from one narrow strip.
    lo_y, hi_y = int(height * 0.088), int(height * 0.88)
    per_column_rows: list[list[int]] = []
    for ci in range(N_COLS):
        strip = strip_profiles[ci]
        peak = max(strip) or 1
        found = [y for y in _ridges(strip, peak * 0.22, 8) if lo_y < y < hi_y]
        candidate = _subdivide(found, pitch_y) if len(found) >= 4 else []
        if len(candidate) == len(rows):
            per_column_rows.append(candidate)
        else:
            per_column_rows.append([y + shifts[ci] for y in rows])

    detect_x, detect_y = max(6, int(pitch_x * 0.20)), max(5, int(pitch_y * 0.34))
    pad_y = max(2, int(pitch_y * 0.14))

    cells: list[SheetCell] = []
    for ri in range(len(rows) - 1):
        if not (10 <= rows[ri + 1] - rows[ri] <= pitch_y * 1.6):
            continue
        for ci in range(N_COLS):
            column_rows = per_column_rows[ci]
            y0, y1 = column_rows[ri], column_rows[ri + 1]
            if y0 < 0 or y1 > height or not (10 <= y1 - y0 <= pitch_y * 1.6):
                continue
            detect = (int(columns[ci]) + detect_x, y0 + detect_y,
                      int(columns[ci + 1]) - detect_x, y1 - detect_y)
            if detect[2] <= detect[0] or detect[3] <= detect[1]:
                continue
            density = _cell_ink(small.crop(detect))
            # Upper bound as well as lower: a cell that is nearly solid dark is
            # a band separator or a rule the shift pushed us onto, not writing.
            # Handwriting covers roughly 10-35% of a cell; a band covers most of
            # it, and those were the false positives in the empty right columns.
            if not ink_cutoff <= density <= 0.55:
                continue
            read = (max(0, int(columns[ci] - pitch_x * 0.40)), max(0, y0 + pad_y),
                    min(width, int(columns[ci + 1] + pitch_x * 0.12)), min(height, y1 - pad_y))
            cells.append(SheetCell(ri, ci, tuple(int(v * scale) for v in read), round(density, 3)))
    return full, cells


def crop_cell(full: Image.Image, cell: SheetCell, *, min_width: int = 180) -> bytes:
    """PNG bytes for one cell, contrast-stretched and never below `min_width`."""
    crop = ImageOps.autocontrast(full.crop(cell.box))
    if crop.width < min_width:
        scale = min_width / crop.width
        crop = crop.resize((int(crop.width * scale), int(crop.height * scale)),
                           Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    crop.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Coverage on the real photo archive (Desktop/Shorts, 132 photos, 54 dates)
# ---------------------------------------------------------------------------
# Those photos are shot on a clipboard, so the paper bows and a rule is not at
# one y across the page. Detecting rows on a narrow reference strip and
# correlating each column against it recovers the arch (measured shifts run
# monotonically, e.g. -3,-1,-1,-1,-1,0,0,0,0,0,3,6,8,10,12,17) and the row
# lines then track the real rules. That took the worst sheets from unusable to
# usable, and one that had reported 261 stray cells down to 15.
#
# Current state across the archive, at the default cutoff:
#
#   106 photos  clean     (<=45 located cells, about the true count)
#    13 photos  mid       (46-90)
#    10 photos  noisy     (>90)
#     3 photos  rejected  (geometry did not resolve — raises LowConfidenceSheet)
#
#   4417 located cells in total.
#
# Getting there needed two more things beyond the arch correction. Choosing the
# row pitch by which candidate reproduces the template's 53 rows, rather than
# trusting the modal gap: on 2026-06-24 the modal gap was 15.6px against a true
# ~22px, and subdivision then invented 83 rows and hundreds of bogus cells.
# And refusing to emit anything at all when the row count still comes out wrong,
# because a crop cut from the wrong place is worse than a missing crop when the
# whole point is a training set.
#
# One approach was tried and rejected: modelling the bow in 2D by measuring the
# top and bottom of each column separately and interpolating. It is the obvious
# refinement and it measured WORSE (135 -> 207 stray cells on 2026-07-31, and
# 35 -> 43 on the flat reference), because correlating a third of a profile is
# far noisier than correlating all of it. Documented here rather than kept.
#
# ---------------------------------------------------------------------------
# Why this is not wired in yet
# ---------------------------------------------------------------------------
# Localisation is solved; RECOGNITION is not, and it is not a prompt problem.
# Reading the located cells one at a time, against the 2026-06-11 sheet:
#
#   minicpm-v:latest   ~9/18 correct   11s/sheet
#   qwen2.5vl:7b       ~8/18 correct   52s/sheet
#
# Both are general 7-8B VLMs and both drop or invent digits on this
# handwriting; the stronger, slower model was not the better one. They do fail
# on DIFFERENT cells, so agreement between two models is a usable confidence
# signal — auto-fill where they agree, queue the rest for review — but neither
# is trustworthy alone, and nothing here should write to a sheet unreviewed.
#
# The durable fix is a small recogniser trained on these crops, which is well
# within a 3060 Ti. That needs labelled examples, and production currently has
# none (0 imports, 0 photos). This module is what produces them: it reliably
# reduces a sheet to ~20 clean single-number crops, so every human correction
# in the existing review flow becomes one training pair.
