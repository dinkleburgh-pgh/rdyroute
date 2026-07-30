"""Seed the per-unload-day standing sheets (wearers + notes) from the paper
sheet photos.

Wearers come from each sheet's "Routes and (...)" table. Day 5's sheet heads
that column "Garments" rather than "Wearers", but it is the day-5 wearers list
(confirmed by the user) — its values simply run an order of magnitude higher
than days 1-4.

Idempotent: writes the settings rows outright, so re-running just refreshes.
Set BASE to point at prod or dev.
"""
import sys

from pathlib import Path

# Repo root, so this runs the same from a dev checkout or inside the container.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ---- transcribed from the sheet photos -----------------------------------
#
# WRONG COLUMN, days 1/2/4: these were read off a small-numbers column and do
# NOT match what batching actually uses. The batching figure is the "Routes and
# ( Garments )" table — the same numbers that get written into each batch's
# WEARERS column and summed against the 1,800 cap. Day 3 has been corrected
# from the 2026-07-29 photo and day 5 was always taken from that table; days 1,
# 2 and 4 are still ~1/4 of reality and need re-photographing.
#
# This script is now only the initial seed. Day-to-day maintenance happens in
# the app: Batching -> Wearer defaults, which writes the same settings keys.
WEARERS = {
    # Day 1 — STALE, wrong column. Re-shoot the sheet.
    1: {
        4: 144, 7: 51, 52: 141, 54: 79, 55: 51, 57: 61, 58: 83,
        59: 110, 60: 105, 61: 75, 62: 32, 64: 122, 65: 71, 66: 57,
        68: 76, 70: 94, 73: 50, 75: 37,
    },
    # Day 2 — STALE, wrong column. Re-shoot the sheet.
    2: {
        7: 101, 50: 95, 51: 44, 52: 61, 53: 77, 55: 33, 56: 54,
        57: 87, 59: 67, 60: 201, 61: 70, 62: 96, 64: 108, 66: 80,
        68: 77, 69: 214, 70: 33, 75: 49, 91: 91,
    },
    # Day 3 — CORRECTED 2026-07-30 from the 20260729 sheet photo (printed
    # "Updated: 05/26/26"). The earlier day-3 numbers here were read off the
    # wrong column and were ~1/4 of reality; see the WRONG COLUMN note above.
    # Verified against the sheet's own handwritten batches, which each land
    # just under the 1,800 cap using exactly these values:
    #   B1 4+66+69+52 = 1768   B2 53+54+56+59+51 = 1789
    #   B3 61+75+65+50+91 = 1611   B4 57+58+70+68 = 1666
    3: {
        # Routes and (Garments) — UNIFORM
        4: 393, 50: 154, 51: 186, 52: 284, 53: 193, 54: 482, 55: 240,
        56: 389, 57: 655, 58: 264, 59: 539, 61: 316, 64: 409, 65: 417,
        66: 325, 68: 473, 69: 766, 70: 274, 73: 501, 75: 296, 91: 428,
        # DUST table. The printed zeros are real — those trucks run empty and
        # are still batched — so they are stored rather than omitted.
        80: 41, 81: 21, 82: 1, 85: 0, 86: 0, 87: 39, 89: 7, 92: 27,
        93: 0, 94: 7, 95: 64,
    },
    # Day 4 — STALE, wrong column. Re-shoot the sheet.
    4: {
        4: 123, 7: 75, 50: 73, 51: 29, 52: 37, 53: 107, 54: 95,
        56: 69, 58: 37, 59: 121, 60: 221, 61: 58, 62: 70, 65: 40,
        66: 73, 68: 64, 69: 92, 70: 46, 73: 64, 75: 90, 91: 39,
    },
    # Day 5 — 20260612 sheet. Its column is headed "Garments" but it IS the
    # day-5 wearers list; the counts genuinely run much higher than days 1-4.
    5: {
        4: 673, 7: 533, 50: 289, 51: 424, 53: 564, 54: 339, 55: 148,
        56: 354, 57: 486, 58: 348, 60: 741, 62: 401, 64: 642, 65: 330,
        69: 319, 73: 332, 88: 123, 91: 409,
    },
}

NOTES = {
    1: "",  # not photographed
    2: (
        "62 and 95 have black napkins\n"
        "69 must be in its own batch\n"
        "Truck 94 has color micro NOGs, 89 has bath towel NOG"
    ),
    3: "Keep 56 execs separate from others\n93 has black napkins",
    4: "Do not place 58 and 60 in the same batch.",
    5: "",  # sheet's notes box was empty
}


def main() -> None:
    from database import SessionLocal
    from models import AppSetting

    db = SessionLocal()
    wrote = []
    try:
        for day, table in WEARERS.items():
            key = f"unload_day_wearers_{day}"
            row = db.get(AppSetting, key)
            value = {str(k): v for k, v in sorted(table.items())}
            if row is None:
                db.add(AppSetting(key=key, value=value))
            else:
                row.value = value
            wrote.append(f"{key} ({len(table)} routes)")
        for day, text in NOTES.items():
            if not text:
                continue
            key = f"unload_day_notes_{day}"
            row = db.get(AppSetting, key)
            if row is None:
                db.add(AppSetting(key=key, value=text))
            else:
                row.value = text
            wrote.append(f"{key} ({len(text.splitlines())} lines)")
        db.commit()
    finally:
        db.close()

    for w in wrote:
        print("  wrote", w)
    print(f"\nseeded {len(wrote)} settings rows")


if __name__ == "__main__":
    main()
