"""Build a canonical grid on the dewarped canvas.

Re-deriving the grid from every photo has broken in a new way each time. Every
photo is the same printed form, and dewarp already puts it on one fixed canvas,
so measure the geometry ONCE from the average of many sheets and reuse it.

Averaging is also the test: if the dewarp lands sheets consistently the printed
rules reinforce and come out crisp, and if it does not they blur away.
"""
import glob
import os
import sys

import cv2
import numpy as np

SCRATCH = (r"C:\Users\DINKLE~1\AppData\Local\Temp\claude"
           r"\C--Users-dinkleburgh-ezpal\22deec56-788b-4844-9cdd-ff06c5a87b73\scratchpad")
sys.path.insert(0, SCRATCH)
from dewarp import (OUT_H, OUT_W, _read, expand_quad, find_table_quad,  # noqa: E402
                    order_quad, quad_is_sane, straighten_rows, warp)

SRC = r"C:\Users\dinkleburgh\Desktop\Shorts"


def dewarped(path):
    gray = _read(path)
    quad = find_table_quad(gray)
    if quad is None:
        return None
    ordered = order_quad(quad)
    ok, _ = quad_is_sane(ordered, gray.shape)
    if not ok:
        return None
    # expand_quad: the contour follows the rules, but the item labels sit just
    # outside them and were being clipped off the bottom-left of some sheets.
    flat, _ = straighten_rows(warp(gray, expand_quad(ordered)))
    return flat


def main(limit=40):
    files = sorted(glob.glob(os.path.join(SRC, "*")))[:limit]
    stack, used = [], []
    for p in files:
        try:
            f = dewarped(p)
        except Exception:  # noqa: BLE001
            f = None
        if f is not None:
            stack.append(f.astype(np.float32))
            used.append(os.path.basename(p))
    print(f"dewarped {len(stack)} / {len(files)} photos")
    if not stack:
        return
    mean = np.mean(stack, axis=0)
    cv2.imwrite(f"{SCRATCH}\\canon_mean.png", mean.astype(np.uint8))

    # Sharpness of the mean tells us whether the dewarp is repeatable: crisp
    # rules mean the sheets landed on top of each other.
    lap = cv2.Laplacian(mean.astype(np.uint8), cv2.CV_64F).var()
    single = cv2.Laplacian(stack[0].astype(np.uint8), cv2.CV_64F).var()
    print(f"laplacian variance  mean-image={lap:.0f}   single-sheet={single:.0f}")
    print(f"  ratio {lap / max(1e-6, single):.2f}  (near 1.0 = sheets align; near 0 = they blur out)")

    # Rule positions from the averaged image.
    inv = 255 - mean
    hp = inv.mean(axis=1)
    vp = inv.mean(axis=0)
    np.save(f"{SCRATCH}\\canon_hp.npy", hp)
    np.save(f"{SCRATCH}\\canon_vp.npy", vp)

    vis = cv2.cvtColor(mean.astype(np.uint8), cv2.COLOR_GRAY2BGR)
    for y in range(OUT_H):
        if hp[y] > hp.mean() + 2.2 * hp.std():
            cv2.line(vis, (0, y), (OUT_W, y), (0, 0, 255), 1)
    for x in range(OUT_W):
        if vp[x] > vp.mean() + 2.2 * vp.std():
            cv2.line(vis, (x, 0), (x, OUT_H), (255, 120, 0), 1)
    cv2.imwrite(f"{SCRATCH}\\canon_rules.png", vis)
    print(f"-> canon_mean.png / canon_rules.png")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 40)
