"""Integrity checks over transcriptions.json.

These caught two real problems the eye missed: a quantity attributed to a column
that did not exist in its sheet's header, and a sheet whose photo cut off the
printed item-label column entirely, leaving every "item" a placeholder string.
Both are legitimate observations about the paper, but silently mixed into a
training set they read as labelled data. Run this after every merge.

Exit code is non-zero if any ERROR-level check fails.

Usage:  python validate.py
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "transcriptions.json")

# A sheet flagged unusable is expected to violate the label check; it is kept
# for its quantities and grid locators, not as labelled training data.
UNUSABLE_KEY = "usable"


def main():
    store = json.load(open(STORE, encoding="utf-8"))
    sheets = store["sheets"]
    errors, warnings = [], []

    seen_photos = Counter(s["source_photo"] for s in sheets)
    for photo, n in seen_photos.items():
        if n > 1:
            errors.append(f"{photo}: recorded {n} times")

    for s in sheets:
        photo = s["source_photo"]
        cols = {c["col"] for c in s.get("columns", [])}
        usable = s.get(UNUSABLE_KEY, True)

        for e in s.get("entries", []):
            if e["col"] not in cols:
                errors.append(
                    f"{photo}: entry {e['item'][:32]!r} references column "
                    f"{e['col']}, which is not in the header ({sorted(cols)})"
                )
            if e.get("qty") is not None and e["qty"] < 0:
                errors.append(f"{photo}: negative quantity {e['qty']}")
            if e["confidence"] not in {"high", "low"}:
                errors.append(f"{photo}: bad confidence {e['confidence']!r}")
            if usable and e["item"].strip().startswith("["):
                errors.append(
                    f"{photo}: placeholder item label {e['item'][:40]!r} on a sheet "
                    f"not marked {UNUSABLE_KEY}=false"
                )

        if s.get("entries") and all(e["confidence"] == "low" for e in s["entries"]):
            warnings.append(f"{photo}: every entry is low confidence ({len(s['entries'])})")

        agreement = (s.get("_verification") or {}).get("agreement")
        if agreement == "unverified":
            warnings.append(f"{photo}: single-read (second reader never ran)")

    entries = [e for s in sheets for e in s.get("entries", [])]
    print(f"{len(sheets)} sheets / {len(entries)} entries")
    print("  verification:", dict(Counter((s.get('_verification') or {}).get('agreement', '(pre-verify)') for s in sheets)))
    print("  confidence:  ", dict(Counter(e["confidence"] for e in entries)))
    print(f"  unusable sheets: {sum(1 for s in sheets if not s.get(UNUSABLE_KEY, True))}")

    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  ERROR {e}")
    print(f"\n{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
