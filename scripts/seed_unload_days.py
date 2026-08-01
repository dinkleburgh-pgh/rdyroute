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
# THE FORM CHANGED. The sheet was revised on 05/26/26: the bottom-left table
# used to read "Routes and ( Wearers )" and now reads "Routes and ( Garments )".
# Batching runs on GARMENTS — those are the numbers written into each batch's
# WEARERS column and summed against the 1,800 cap. They run roughly 4-5x the old
# wearer counts, which is the whole point: a day totals ~8,000 garments and
# splits into five or six batches, whereas the old wearer totals (~1,600) would
# not have filled one.
#
# So the pre-05/26 photos cannot be salvaged — they simply do not contain
# garment figures. Days 3, 4 and 5 below come from post-revision sheets. Days 1
# and 2 are left EMPTY on purpose: prefilling the old wearer numbers would build
# batches at about a fifth of capacity, which is worse than prompting for entry.
# Photograph a current day-1 and day-2 sheet and enter them in the app.
#
# This script is now only the initial seed. Day-to-day maintenance happens in
# the app: Batching -> Wearer defaults, which writes the same settings keys.
WEARERS = {
    # Day 1 — no post-revision sheet. Superseded pre-05/26 WEARERS-form values,
    # kept only as provenance, NOT loaded:
    #   4:144, 7:51, 52:141, 54:79, 55:51, 57:61, 58:83, 59:110, 60:105,
    #   61:75, 62:32, 64:122, 65:71, 66:57, 68:76, 70:94, 73:50, 75:37
    1: {},
    # Day 2 — no post-revision sheet. Superseded pre-05/26 WEARERS-form values
    # (from the 20260505 photo, headed "Routes and ( Wearers )"), NOT loaded:
    #   7:101, 50:95, 51:44, 52:61, 53:77, 55:33, 56:54, 57:87, 59:67,
    #   60:201, 61:70, 62:96, 64:108, 66:80, 68:77, 69:214, 70:33, 75:49, 91:91
    2: {},
    # Day 3 — from the 20260729 photo (printed "Updated: 05/26/26").
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
    # Day 4 — from the 20260723 photo (printed "Updated: 05/26/26").
    # Cross-checked against that sheet's handwritten batches:
    #   B1 65+69+51+4 = 1540    B2 66+54+75+68+58 = 1670
    #   B3 59+56+7+91+61 = 1728 B4 50+53+62 = 1246   B5 52+73+70 = 711
    #   B6 60 = 1854 alone (one truck over cap, unavoidable)
    4: {
        # Routes and (Garments) — UNIFORM
        4: 666, 7: 382, 50: 403, 51: 131, 52: 168, 53: 542, 54: 368,
        56: 369, 58: 165, 59: 483, 60: 1854, 61: 281, 62: 301, 65: 255,
        66: 388, 68: 389, 69: 488, 70: 175, 73: 368, 75: 360, 91: 213,
        # DUST table
        80: 7, 82: 0, 83: 53, 84: 0, 85: 0, 86: 51, 87: 0, 88: 94,
        89: 0, 92: 52, 94: 0, 95: 4,
    },
    # Day 5 — from the 20260612 photo (printed "Updated: 05/26/26"), already a
    # post-revision sheet, which is why its numbers always looked like outliers
    # next to the old wearer counts. The uniform half was right from the start;
    # the DUST rows were missed on the first pass and are added here.
    # Re-read 2026-07-31 from the "Updated: 05/26/26" sheet. Same 28-route
    # roster as before, but 20 of the 28 counts had moved; superseded values are
    # kept below for reference. Uniform 6,960 + dust 122 = 7,082 (was 7,619).
    #   4:673, 50:289, 51:424, 53:564, 54:339, 55:148, 56:354, 57:486,
    #   58:348, 60:741, 62:401, 64:642, 65:330, 69:319, 73:332, 88:123,
    #   91:409, 81:53, 83:59, 95:52
    5: {
        # Routes and (Garments) — UNIFORM
        4: 629, 7: 533, 50: 271, 51: 401, 53: 621, 54: 357, 55: 122,
        56: 302, 57: 469, 58: 311, 60: 647, 62: 333, 64: 530, 65: 263,
        69: 309, 73: 323, 88: 175, 91: 364,
        # DUST table
        80: 0, 81: 44, 82: 0, 83: 43, 84: 0, 85: 0, 86: 0, 87: 0,
        93: 0, 95: 35,
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
