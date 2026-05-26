"""
One-off migration: read off_schedule_defaults.json from the old TruckApp and
write scheduled_off_days into the trucks table of the new app.

Both old and new formats use 1-5 (Mon=1 … Fri=5).
Old format: day keys "1"-"5" → list of truck numbers that are off.
New format: list of those same day integers stored on each truck row.
"""

import json
from pathlib import Path
from database import SessionLocal
from models import Truck

OLD_FILE = Path(r"C:\Users\dinkleburgh\TruckApp\off_schedule_defaults.json")

# Invert: build {truck_number: [day, ...]}
with OLD_FILE.open() as f:
    raw: dict[str, list[int]] = json.load(f)

truck_off_days: dict[int, list[int]] = {}
for day_str, truck_numbers in raw.items():
    day = int(day_str)  # already 1-5, no conversion needed
    for num in truck_numbers:
        truck_off_days.setdefault(num, []).append(day)

# Sort each list for consistency
for num in truck_off_days:
    truck_off_days[num].sort()

# Apply to database
db = SessionLocal()
try:
    updated = 0
    skipped = 0
    for truck_number, off_days in truck_off_days.items():
        truck = db.query(Truck).filter(Truck.truck_number == truck_number).first()
        if truck is None:
            print(f"  SKIP  truck {truck_number} — not in fleet")
            skipped += 1
            continue
        truck.scheduled_off_days = off_days
        print(f"  SET   truck {truck_number} → {off_days}")
        updated += 1
    db.commit()
    print(f"\nDone. Updated {updated} trucks, skipped {skipped}.")
finally:
    db.close()
