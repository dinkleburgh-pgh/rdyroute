"""One readable view per sheet: magnified header over the full body.

Transcribing needs two things at once — the truck/route/initials header at
enough magnification to align columns, and the body to read quantities from.
Stacking a 2x header strip above the body puts both in a single image, so a
sheet costs one look instead of four, and the column boundaries stay visually
continuous between the two halves.
"""
import os
import sys

import cv2
import numpy as np

SCRATCH = (r"C:\Users\DINKLE~1\AppData\Local\Temp\claude"
           r"\C--Users-dinkleburgh-ezpal\22deec56-788b-4844-9cdd-ff06c5a87b73\scratchpad")
FLAT = os.path.join(SCRATCH, "sheets_flat")
OUT = os.path.join(SCRATCH, "compose")
os.makedirs(OUT, exist_ok=True)

HEADER_TOP, HEADER_BOT = 55, 200      # the TRUCK/ROUTE/INITIALS band on the flat canvas


def compose(name):
    img = cv2.imread(os.path.join(FLAT, name), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    img = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(img)
    h, w = img.shape

    header = img[HEADER_TOP:HEADER_BOT, :]
    header = cv2.resize(header, (w * 2, (HEADER_BOT - HEADER_TOP) * 2),
                        interpolation=cv2.INTER_CUBIC)
    body = cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)

    gap = np.full((14, w * 2), 255, dtype=np.uint8)
    out = np.vstack([header, gap, body])
    # column ticks along the top so the eye can carry alignment down the page
    out = cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)
    cv2.putText(out, name, (10, 26), 0, 0.8, (0, 0, 200), 2)
    path = os.path.join(OUT, name)
    cv2.imwrite(path, out)
    return path


if __name__ == "__main__":
    for n in sys.argv[1:]:
        p = compose(n)
        print(("  ok   " if p else "  FAIL ") + n)
