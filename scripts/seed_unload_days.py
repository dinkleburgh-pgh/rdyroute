"""Seed the per-unload-day standing sheets (wearers + notes) from the paper
sheet photos.

Wearers come from each sheet's "Routes and (...)" table. Day 5's sheet heads
that column "Garments" rather than "Wearers", but it is the day-5 wearers list
(confirmed by the user) — its values simply run an order of magnitude higher
than days 1-4.

Idempotent: writes the settings rows outright, so re-running just refreshes.
Set BASE to point at prod or dev.
"""
import json
import os
import sys

sys.path.insert(0, r"C:\Users\dinkleburgh\readyroutev2")

# ---- transcribed from the sheet photos -----------------------------------
WEARERS = {
    # Day 1 — the "Routes and (Wearers)" table in the message screenshot.
    1: {
        4: 144, 7: 51, 52: 141, 54: 79, 55: 51, 57: 61, 58: 83,
        59: 110, 60: 105, 61: 75, 62: 32, 64: 122, 65: 71, 66: 57,
        68: 76, 70: 94, 73: 50, 75: 37,
    },
    # Day 2 — 20260505 sheet.
    2: {
        7: 101, 50: 95, 51: 44, 52: 61, 53: 77, 55: 33, 56: 54,
        57: 87, 59: 67, 60: 201, 61: 70, 62: 96, 64: 108, 66: 80,
        68: 77, 69: 214, 70: 33, 75: 49, 91: 91,
    },
    # Day 3 — 20260506 sheet.
    3: {
        4: 82, 50: 38, 51: 46, 52: 49, 53: 57, 54: 81, 55: 91,
        56: 97, 57: 115, 58: 67, 59: 139, 61: 60, 64: 92, 65: 74,
        66: 65, 68: 107, 69: 168, 70: 79, 73: 92, 75: 61, 91: 78,
    },
    # Day 4 — 20260507 sheet.
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
