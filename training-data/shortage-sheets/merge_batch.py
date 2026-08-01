"""Append a workflow batch of transcribed sheets into transcriptions.json.

The workflow returns sheets keyed by the COMPOSED png name; the archive record
keys on the ORIGINAL photo filename, so map back through the source directory.
Refuses to overwrite a sheet that is already recorded - re-running a batch is
a no-op rather than a silent duplicate.

Usage:  python merge_batch.py batch_result.json
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "transcriptions.json")
SRC = r"C:\Users\dinkleburgh\Desktop\Shorts"

# Byte-identical copies in the archive (sha256). Transcribing both would
# double-weight one sheet in the training set, so only the first is recorded.
REDUNDANT = {
    "1000036272.jpg", "5-Photo-5.jpg",
    "20260508_220352 - Copy (2).heic",
}

# Recorded page numbers came from ordering same-date photos by timestamp; keep
# doing that so a later batch does not renumber an earlier one.
def page_map():
    by_date = {}
    for name in sorted(os.listdir(SRC)):
        stem = os.path.splitext(name)[0]
        date = stem[:8] if stem[:8].isdigit() else None
        by_date.setdefault(date, []).append(name)
    pages = {}
    for date, names in by_date.items():
        for i, n in enumerate(names, 1):
            pages[n] = i if date else 1
    return pages


def original_for(composed):
    stem = os.path.splitext(composed)[0]
    for name in os.listdir(SRC):
        if os.path.splitext(name)[0].replace(" ", "_") == stem:
            return name
    return None


def main(path):
    store = json.load(open(STORE, encoding="utf-8"))
    have = {s["source_photo"] for s in store["sheets"]}
    pages = page_map()

    batch = json.load(open(path, encoding="utf-8"))
    sheets = batch["sheets"] if isinstance(batch, dict) else batch

    added = skipped = 0
    for s in sheets:
        composed = s.pop("source_file", None) or s.get("source_photo")
        orig = original_for(composed) or composed
        if orig in REDUNDANT:
            print(f"  skip (byte-identical duplicate) {orig}")
            skipped += 1
            continue
        if orig in have:
            print(f"  skip (already recorded) {orig}")
            skipped += 1
            continue
        rec = {"source_photo": orig,
               "date": s.get("date"),
               "page": pages.get(orig, 1)}
        for k in ("template", "note", "legibility", "columns", "entries", "_verification"):
            if s.get(k) not in (None, [], ""):
                rec[k] = s[k]
        store["sheets"].append(rec)
        have.add(orig)
        added += 1
        n_low = sum(1 for e in rec.get("entries", []) if e.get("confidence") == "low")
        print(f"  + {orig}  {len(rec.get('columns', []))} cols  "
              f"{len(rec.get('entries', []))} entries ({n_low} low)  "
              f"agreement={rec.get('_verification', {}).get('agreement')}")

    store["sheets"].sort(key=lambda s: (str(s.get("date")), s.get("page", 1)))
    with open(STORE, "w", encoding="utf-8") as fh:
        json.dump(store, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    total_e = sum(len(s.get("entries", [])) for s in store["sheets"])
    print(f"\nadded {added}, skipped {skipped} -> "
          f"{len(store['sheets'])} sheets / {total_e} entries")


if __name__ == "__main__":
    main(sys.argv[1])
