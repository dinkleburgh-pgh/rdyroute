"""Flatten a photographed shortage sheet before any grid work.

OFFLINE TOOL — requires opencv-python-headless and numpy, neither of which is a
backend dependency. This exists to build a training set from the photo archive
on a workstation; nothing in the running app imports it, and the backend image
stays Pillow-only.

Patching symptoms (a shift per column) cannot fix a sheet that is rotated AND
bowed, which is what the archive photos are — shot on a clipboard, so the paper
curves. Correct the geometry once, up front: find the table's outer border,
warp it to a rectangle, then straighten the residual bow by tracking the
printed rules themselves.

Verified on 2026-07-31 by eye rather than by cell count (counting cells was
what produced a bogus "106 of 132 clean" claim earlier). Feeding the flattened
image to shortage_sheet_grid.locate_cells:

    ~24 handwritten entries on the sheet, 18 located          -> ~75% recall
    40 crops emitted, ~22 of them a clean single number       -> ~55% precision

The remaining false positives are crops holding only a rule, in the upper-left
where residual bow survives the straightening. They cost review time but do not
corrupt a training set as long as the reviewer marks them as blanks; the recall
misses, at the very bottom of the sheet, are the real loss.
"""
import sys

import cv2
import numpy as np

SCRATCH = (r"C:\Users\DINKLE~1\AppData\Local\Temp\claude"
           r"\C--Users-dinkleburgh-ezpal\22deec56-788b-4844-9cdd-ff06c5a87b73\scratchpad")
OUT_W, OUT_H = 1400, 1900


def _read(path, max_side=1800):
    data = np.fromfile(path, dtype=np.uint8)           # handles non-ascii paths
    img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if img is None:                                     # HEIC -> go through Pillow
        from PIL import Image, ImageOps
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass
        with Image.open(path) as im:
            img = np.array(ImageOps.exif_transpose(im).convert("L"))
    h, w = img.shape
    s = min(1.0, max_side / max(h, w))
    if s < 1.0:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img


def find_table_quad(gray):
    """Four corners of the printed table, largest-quadrilateral style."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    binary = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY_INV, 51, 15)
    # The table is defined by its rules; closing along each axis joins them into
    # one connected frame so the outer contour is the table, not a stray mark.
    h, w = gray.shape
    horiz = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (max(10, w // 30), 1)))
    vert = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(10, h // 30))))
    frame = cv2.dilate(cv2.bitwise_or(horiz, vert),
                       cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=2)
    contours, _ = cv2.findContours(frame, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    best = max(contours, key=cv2.contourArea)
    if cv2.contourArea(best) < 0.25 * h * w:
        return None
    peri = cv2.arcLength(best, True)
    for eps in (0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(best, eps * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)
    box = cv2.boxPoints(cv2.minAreaRect(best))
    return box.astype(np.float32)


def order_quad(pts):
    """TL, TR, BR, BL — ordered by angle, not by sum/diff extremes.

    The sum/diff trick picks the same point twice on a skewed quad; that
    happened on 2026-07-09 (corner (1229,174) selected as both TL and TR),
    which collapses the perspective transform and warps the sheet to a blank.
    """
    centre = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - centre[1], pts[:, 0] - centre[0])
    ordered = pts[np.argsort(angles)]                      # clockwise from -pi
    start = int(np.argmin(ordered.sum(axis=1)))            # top-left-most
    return np.roll(ordered, -start, axis=0).astype(np.float32)


def quad_is_sane(quad, shape):
    """Reject degenerate or implausible quads instead of warping garbage."""
    h, w = shape
    if len(np.unique(quad.round(1), axis=0)) != 4:
        return False, "duplicate corners"
    area = cv2.contourArea(quad.astype(np.float32))
    if area < 0.30 * h * w:
        return False, f"only {100 * area / (h * w):.0f}% of frame"
    sides = [np.linalg.norm(quad[i] - quad[(i + 1) % 4]) for i in range(4)]
    if min(sides) < 0.25 * max(sides):
        return False, "extreme aspect"
    return True, ""


def warp(gray, ordered):
    dst = np.array([[0, 0], [OUT_W - 1, 0], [OUT_W - 1, OUT_H - 1], [0, OUT_H - 1]],
                   dtype=np.float32)
    M = cv2.getPerspectiveTransform(ordered, dst)
    return cv2.warpPerspective(gray, M, (OUT_W, OUT_H), flags=cv2.INTER_CUBIC,
                               borderValue=255)


def straighten_rows(flat):
    """Remove residual bow by tracking each printed rule across the page.

    A homography flattens a plane; paper on a clipboard is not a plane. Measure
    where the horizontal rules actually sit in each vertical slice and shear
    each slice back onto the page-average, which pulls the arch out.
    """
    binary = cv2.adaptiveThreshold(cv2.GaussianBlur(flat, (5, 5), 0), 255,
                                   cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 12)
    horiz = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (OUT_W // 12, 1)))
    slices = 24
    step = OUT_W // slices
    reference = horiz.sum(axis=1).astype(np.float32)
    shifts = []
    for i in range(slices):
        col = horiz[:, i * step:(i + 1) * step].sum(axis=1).astype(np.float32)
        best, best_score = 0, -1.0
        for sh in range(-40, 41):
            a = reference[max(0, sh):OUT_H + min(0, sh)]
            b = col[max(0, -sh):OUT_H + min(0, -sh)]
            n = min(len(a), len(b))
            score = float(np.dot(a[:n], b[:n]))
            if score > best_score:
                best_score, best = score, sh
        shifts.append(best)
    shifts = np.array(shifts, dtype=np.float32)
    # smooth so one bad slice cannot kink the remap
    kernel = np.ones(5, dtype=np.float32) / 5.0
    shifts = np.convolve(np.pad(shifts, 2, mode="edge"), kernel, mode="valid")

    xs = (np.arange(slices) + 0.5) * step
    per_col = np.interp(np.arange(OUT_W), xs, shifts).astype(np.float32)
    map_x = np.tile(np.arange(OUT_W, dtype=np.float32), (OUT_H, 1))
    map_y = (np.arange(OUT_H, dtype=np.float32)[:, None] - per_col[None, :]).astype(np.float32)
    return cv2.remap(flat, map_x, map_y, cv2.INTER_CUBIC, borderValue=255), shifts


def process(path, tag):
    gray = _read(path)
    quad = find_table_quad(gray)
    if quad is None:
        print(f"  {tag}: no table contour found")
        return None
    ordered = order_quad(quad)
    ok, why = quad_is_sane(ordered, gray.shape)
    if not ok:
        print(f"  {tag}: rejected quad ({why})")
        return None
    flat = warp(gray, ordered)
    straight, shifts = straighten_rows(flat)
    cv2.imwrite(f"{SCRATCH}\\dw_{tag}_flat.png", flat)
    cv2.imwrite(f"{SCRATCH}\\dw_{tag}_straight.png", straight)
    print(f"  {tag}: quad ok, residual bow {shifts.min():+.0f}..{shifts.max():+.0f}px")
    return straight


if __name__ == "__main__":
    import os
    for name in sys.argv[1:]:
        process(os.path.join(r"C:\Users\dinkleburgh\Desktop\Shorts", name),
                os.path.splitext(name)[0].replace(" ", "_"))
