from __future__ import annotations

import base64
import io
import json
import re
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from PIL import Image, ImageFilter, ImageOps
try:
    from pillow_heif import register_heif_opener
except ImportError:  # pragma: no cover - optional codec dependency
    register_heif_opener = None

from shortage_sheet_template import SHORTAGE_V1A_TEMPLATE, ShortageSheetRowDefinition, ShortageSheetTemplate

if register_heif_opener is not None:
    register_heif_opener()


@dataclass(frozen=True)
class HeaderColumn:
    column_index: int
    truck_number: int | None
    route_number: int | None
    initials: str
    confidence: float | None


@dataclass(frozen=True)
class ExtractionContext:
    template: ShortageSheetTemplate
    low_confidence_threshold: float
    timeout_seconds: int
    base_url: str
    model: str


def _normalise_text(value: object) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def _coerce_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    digits = "".join(ch for ch in _normalise_text(value) if ch.isdigit())
    return int(digits) if digits else None


def _coerce_quantity(value: object) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = _normalise_text(value)
    if not text:
        return None
    matches = re.findall(r"\d+", text)
    if len(matches) != 1:
        return None
    try:
        return int(matches[0])
    except ValueError:
        return None


def _coerce_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, parsed))


def preprocess_sheet_image(content: bytes, *, max_side: int = 1800) -> bytes:
    with Image.open(io.BytesIO(content)) as image:
        image = ImageOps.exif_transpose(image).convert("L")
        image = ImageOps.autocontrast(image)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        image = image.filter(ImageFilter.SHARPEN)
        width, height = image.size
        scale = min(1.0, max_side / max(width, height))
        if scale < 1.0:
            image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()


def crop_fractional_region(content: bytes, *, left: float, top: float, right: float, bottom: float) -> bytes:
    with Image.open(io.BytesIO(content)) as image:
        width, height = image.size
        left_px = max(0, int(width * left))
        top_px = max(0, int(height * top))
        right_px = min(width, int(width * right))
        bottom_px = min(height, int(height * bottom))
        if right_px <= left_px:
            right_px = min(width, left_px + 1)
        if bottom_px <= top_px:
            bottom_px = min(height, top_px + 1)
        box = (left_px, top_px, right_px, bottom_px)
        cropped = image.crop(box)
        buffer = io.BytesIO()
        cropped.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue()


def _call_ollama_json(*, context: ExtractionContext, prompt: str, images: list[bytes]) -> tuple[Any, str | None]:
    payload = json.dumps(
        {
            "model": context.model,
            "prompt": prompt,
            "images": [base64.b64encode(image).decode("ascii") for image in images],
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0,
                "top_p": 0.1,
            },
        }
    ).encode("utf-8")
    request = urlrequest.Request(
        f"{context.base_url.rstrip('/')}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(request, timeout=context.timeout_seconds) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urlerror.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return None, f"Ollama request failed ({exc})"
    raw_response = body.get("response")
    try:
        return json.loads(raw_response) if isinstance(raw_response, str) else raw_response, None
    except json.JSONDecodeError as exc:
        return None, f"Ollama returned invalid JSON ({exc})"


def _select_header_correction_examples(
    header_correction_examples: list[dict[str, object]],
    *,
    limit: int = 8,
) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    seen: set[tuple[int, int, str]] = set()
    for entry in header_correction_examples:
        if _normalise_text(entry.get("review_status")).lower() != "accepted":
            continue
        truck_number = _coerce_quantity(entry.get("truck_number"))
        route_number = _coerce_quantity(entry.get("route_number"))
        initials = _normalise_text(entry.get("initials")).upper()[:20]
        if truck_number is None and route_number is None and not initials:
            continue
        fingerprint = (truck_number or -1, route_number or -1, initials)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        selected.append(
            {
                "column_index": _coerce_int(entry.get("column_index")),
                "truck_number": truck_number,
                "route_number": route_number,
                "initials": initials,
            }
        )
        if len(selected) >= limit:
            break
    return selected


def _header_prompt(
    template: ShortageSheetTemplate,
    header_correction_examples: list[dict[str, object]] | None = None,
) -> str:
    prompt = (
        "This is the header area of a shortage sheet.\n"
        f"Template id: {template.template_id}\n"
        "Read only the handwritten TRUCK, ROUTE, and INITIALS rows.\n"
        "Return valid JSON only with shape:\n"
        '{"columns":[{"column_index":1,"truck_number":81,"route_number":81,"initials":"PB","confidence":0.97}]}\n'
        "Column indexes are left-to-right starting at 1. Skip blank columns."
    )
    examples = _select_header_correction_examples(list(header_correction_examples or []))
    if examples:
        prompt += (
            "\nVerified header examples from past human-reviewed sheets:\n"
            f"{json.dumps(examples, ensure_ascii=False)}\n"
            "Use these as handwriting guidance only. Do not copy values unless the image matches."
        )
    return prompt


def _header_row_prompt(
    row_name: str,
    example_values: list[str],
    header_correction_examples: list[dict[str, object]] | None = None,
) -> str:
    prompt = (
        f"This image contains the handwritten {row_name.upper()} row from a shortage sheet.\n"
        "There are exactly 16 handwritten cells across the row.\n"
        "Transcribe the 16 cell values left-to-right.\n"
        f"Return JSON only like {json.dumps({'values': example_values})}.\n"
        "Use empty strings for unreadable cells, but always return 16 strings."
    )
    examples = _select_header_correction_examples(list(header_correction_examples or []))
    row_examples = [
        str(example.get(f"{row_name.lower()}_number") if row_name.lower() in {"truck", "route"} else example.get("initials"))
        if row_name.lower() in {"truck", "route"}
        else _normalise_text(example.get("initials")).upper()[:20]
        for example in examples
    ]
    row_examples = [value for value in row_examples if value and value != "None"]
    if row_examples:
        prompt += (
            f"\nVerified {row_name.upper()} handwriting examples from human-reviewed sheets: "
            f"{json.dumps(row_examples[:12], ensure_ascii=False)}.\n"
            "Use them as handwriting guidance only."
        )
    return prompt


def _normalise_example_text(value: object) -> str:
    return re.sub(r"\s+", " ", _normalise_text(value)).strip().lower()


def _select_correction_examples(
    correction_examples: list[dict[str, object]],
    *,
    allowed_row_keys: set[str] | None = None,
    limit: int = 12,
) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    seen: set[tuple[str, str, str]] = set()
    for entry in correction_examples:
        if _normalise_text(entry.get("review_status")).lower() != "accepted":
            continue
        row_key = _normalise_text(entry.get("row_key")).lower()
        if allowed_row_keys is not None and row_key and row_key not in allowed_row_keys:
            continue
        raw_text = _normalise_text(entry.get("raw_text"))
        quantity = _coerce_int(entry.get("quantity"))
        item_detail = _normalise_text(entry.get("item_detail"))
        if quantity is None or not raw_text or not item_detail:
            continue
        fingerprint = (row_key, raw_text.lower(), item_detail.lower())
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        selected.append(
            {
                "row_key": row_key,
                "item_category": _normalise_text(entry.get("item_category")),
                "item_detail": item_detail,
                "raw_text": raw_text,
                "quantity": quantity,
            }
        )
        if len(selected) >= limit:
            break
    return selected


def _correction_examples_prompt_block(correction_examples: list[dict[str, object]]) -> str:
    if not correction_examples:
        return ""
    return (
        "Verified examples from prior human-reviewed shortage sheets "
        "(use these as hints for handwriting and row matching, not as hard rules):\n"
        f"{json.dumps(correction_examples)}\n"
    )


def _body_prompt(
    template: ShortageSheetTemplate,
    columns: list[HeaderColumn],
    correction_examples: list[dict[str, object]],
) -> str:
    row_catalog = [
        {
            "row_key": row.row_key,
            "printed_label": row.printed_label,
            "item_category": row.item_category,
            "item_detail": row.item_detail,
        }
        for row in template.rows
    ]
    known_columns = [
        {
            "column_index": column.column_index,
            "truck_number": column.truck_number,
            "route_number": column.route_number,
            "initials": column.initials,
        }
        for column in columns
    ]
    prompt_examples = _select_correction_examples(correction_examples, limit=14)
    return (
        "This is the body of a shortage sheet.\n"
        f"Template id: {template.template_id}\n"
        "Only extract non-empty shortage cells. Use the printed row labels exactly from this catalog.\n"
        f"Known columns: {json.dumps(known_columns)}\n"
        f"Row catalog: {json.dumps(row_catalog)}\n"
        f"{_correction_examples_prompt_block(prompt_examples)}"
        "Return valid JSON only with shape:\n"
        '{"entries":[{"row_key":"grid_towels_x1936","column_index":4,"quantity":250,"raw_text":"250","confidence":0.91}]}\n'
        "Quantity must be an integer. If a cell is unclear, still include it with the best reading and lower confidence."
    )


def _banded_body_prompt(
    *,
    row_catalog: list[dict[str, str]],
    columns: list[HeaderColumn],
    correction_examples: list[dict[str, object]],
) -> str:
    known_columns = [
        {
            "column_index": column.column_index,
            "truck_number": column.truck_number,
            "route_number": column.route_number,
            "initials": column.initials,
        }
        for column in columns
    ]
    allowed_row_keys = {str(row.get("row_key") or "").lower() for row in row_catalog}
    prompt_examples = _select_correction_examples(
        correction_examples,
        allowed_row_keys=allowed_row_keys,
        limit=10,
    )
    return (
        "This shortage sheet image band contains only the listed rows.\n"
        f"Known columns: {json.dumps(known_columns)}\n"
        f"Allowed rows: {json.dumps(row_catalog)}\n"
        f"{_correction_examples_prompt_block(prompt_examples)}"
        "Image 1 contains the printed row labels. Image 2 contains the matching handwritten grid cells.\n"
        "Extract every non-empty handwritten entry you can see.\n"
        "Ignore the printed row labels and ignore printed item/product codes like x2873, x27012, x9110, etc.\n"
        "Only return actual handwritten shortage marks from the grid cells.\n"
        "Return JSON only with shape:\n"
        '{"entries":[{"row_key":"grid_towels_x1936","column_index":4,"quantity":250,"raw_text":"250","confidence":0.91}]}\n'
        "If a handwritten mark is visible but the number is unclear, still include the row_key and column_index, "
        'set "raw_text" to the visible handwriting, and set "quantity" to null.\n'
        "Only use row_key values from the allowed rows."
    )


def _row_focus_prompt(
    *,
    row_definition: ShortageSheetRowDefinition,
    columns: list[HeaderColumn],
    correction_examples: list[dict[str, object]],
) -> str:
    known_columns = [
        {
            "column_index": column.column_index,
            "truck_number": column.truck_number,
            "route_number": column.route_number,
            "initials": column.initials,
        }
        for column in columns
    ]
    prompt_examples = _select_correction_examples(
        correction_examples,
        allowed_row_keys={row_definition.row_key.lower()},
        limit=8,
    )
    return (
        "These images show exactly one printed shortage-sheet row and its matching handwritten cells.\n"
        f"Fixed row: {json.dumps({'row_key': row_definition.row_key, 'printed_label': row_definition.printed_label, 'item_category': row_definition.item_category, 'item_detail': row_definition.item_detail})}\n"
        f"Known columns: {json.dumps(known_columns)}\n"
        f"{_correction_examples_prompt_block(prompt_examples)}"
        "Image 1 is the printed row label. Image 2 is the handwritten grid cells for that same row.\n"
        "Extract only real handwritten shortage quantities from the grid cells.\n"
        "Ignore the printed row label and ignore printed product codes like x2873 or x27012.\n"
        "Return JSON only with shape:\n"
        f'{{"entries":[{{"row_key":"{row_definition.row_key}","column_index":4,"quantity":250,"raw_text":"250","confidence":0.91}}]}}\n'
        "Use the fixed row_key for every entry. Skip blank columns.\n"
        'If a handwritten mark is visible but the number is unclear, set "quantity" to null and keep the visible handwriting in "raw_text".'
    )


def _footer_prompt(template: ShortageSheetTemplate) -> str:
    return (
        "This is the footer area of a shortage sheet.\n"
        f"Template id: {template.template_id}\n"
        f"Footer fields: {json.dumps(list(template.footer_fields))}\n"
        "Return valid JSON only with shape:\n"
        '{"footer":{"dust_routes_with_uniforms":"","soaker_pads_needed":"","ink_towels_needed":"","installs":"","misc":"","special_requests":""}}\n'
        "Use empty strings for blank fields."
    )


def _repair_prompt(
    template: ShortageSheetTemplate,
    suspect_entries: list[dict[str, Any]],
    columns: list[HeaderColumn],
    correction_examples: list[dict[str, object]],
) -> str:
    suspect_row_keys = {str(entry.get("row_key") or "").lower() for entry in suspect_entries}
    prompt_examples = _select_correction_examples(
        correction_examples,
        allowed_row_keys=suspect_row_keys,
        limit=10,
    )
    return (
        "Repair uncertain shortage-sheet entries using the supplied sheet image.\n"
        f"Template id: {template.template_id}\n"
        f"Known columns: {json.dumps([column.__dict__ for column in columns])}\n"
        f"Suspect entries: {json.dumps(suspect_entries)}\n"
        f"{_correction_examples_prompt_block(prompt_examples)}"
        "Return valid JSON only with shape:\n"
        '{"repairs":[{"row_key":"grid_towels_x1936","column_index":4,"quantity":250,"raw_text":"250","confidence":0.89}]}\n'
        "Only include repaired entries you are confident about. Leave anything ambiguous out."
    )


def _apply_correction_memory(
    *,
    entries: list[dict[str, object]],
    correction_examples: list[dict[str, object]],
    low_confidence_threshold: float,
) -> tuple[list[dict[str, object]], int]:
    memory_map: dict[tuple[str, str], set[int]] = {}
    for example in correction_examples:
        if _normalise_text(example.get("review_status")).lower() != "accepted":
            continue
        row_key = _normalise_text(example.get("row_key")).lower()
        raw_text = _normalise_example_text(example.get("raw_text"))
        quantity = _coerce_int(example.get("quantity"))
        if not row_key or not raw_text or quantity is None:
            continue
        memory_map.setdefault((row_key, raw_text), set()).add(quantity)

    applied = 0
    updated_entries: list[dict[str, object]] = []
    for entry in entries:
        row_key = _normalise_text(entry.get("row_key")).lower()
        raw_text = _normalise_example_text(entry.get("raw_text"))
        remembered_quantities = memory_map.get((row_key, raw_text))
        if not remembered_quantities or len(remembered_quantities) != 1:
            updated_entries.append(entry)
            continue
        remembered_quantity = next(iter(remembered_quantities))
        confidence = _coerce_float(entry.get("confidence_score")) or 0.0
        should_apply = (
            entry.get("quantity") is None
            or remembered_quantity != _coerce_int(entry.get("quantity"))
            or confidence < low_confidence_threshold
            or "Unclear handwritten quantity" in list(entry.get("issues") or [])
        )
        if not should_apply:
            updated_entries.append(entry)
            continue
        patched = {**entry}
        patched["quantity"] = remembered_quantity
        patched["confidence_score"] = max(confidence, 0.92)
        patched_issues = [
            issue
            for issue in list(patched.get("issues") or [])
            if issue not in {"Missing quantity", "Unclear handwritten quantity", "Low extraction confidence"}
        ]
        patched["issues"] = patched_issues
        note = _normalise_text(patched.get("reviewer_note"))
        patched["reviewer_note"] = f"{note}; memory_quantity={remembered_quantity}".strip("; ")
        if not patched_issues:
            patched["review_status"] = "accepted"
        updated_entries.append(patched)
        applied += 1
    return updated_entries, applied


def _parse_header_columns(payload: Any) -> list[HeaderColumn]:
    raw_columns = payload.get("columns") if isinstance(payload, dict) else None
    if not isinstance(raw_columns, list):
        return []
    columns: list[HeaderColumn] = []
    for raw in raw_columns:
        if not isinstance(raw, dict):
            continue
        column_index = _coerce_int(raw.get("column_index"))
        if column_index is None:
            continue
        columns.append(
            HeaderColumn(
                column_index=column_index,
                truck_number=_coerce_int(raw.get("truck_number")),
                route_number=_coerce_int(raw.get("route_number")),
                initials=_normalise_text(raw.get("initials")).upper()[:20],
                confidence=_coerce_float(raw.get("confidence")),
            )
        )
    return sorted(columns, key=lambda column: column.column_index)


def _parse_string_values(payload: Any, *, expected: int = 16) -> list[str]:
    raw_values = payload.get("values") if isinstance(payload, dict) else None
    if not isinstance(raw_values, list):
        return []
    values = [_normalise_text(value) for value in raw_values[:expected]]
    while len(values) < expected:
        values.append("")
    return values[:expected]


def _build_rowwise_header_columns(
    context: ExtractionContext,
    normalized: bytes,
    header_correction_examples: list[dict[str, object]] | None = None,
) -> list[HeaderColumn]:
    truck_payload, truck_error = _call_ollama_json(
        context=context,
        prompt=_header_row_prompt(
            "truck",
            ["62", "88", "35", "69", "54", "60", "82", "54", "79", "65", "07", "46", "58", "53", "94", "32"],
            header_correction_examples,
        ),
        images=[crop_fractional_region(normalized, left=0.17, top=0.004, right=0.995, bottom=0.035)],
    )
    route_payload, route_error = _call_ollama_json(
        context=context,
        prompt=_header_row_prompt(
            "route",
            ["62", "88", "35", "69", "54", "60", "82", "54", "79", "65", "07", "46", "58", "53", "94", "32"],
            header_correction_examples,
        ),
        images=[crop_fractional_region(normalized, left=0.155, top=0.026, right=0.995, bottom=0.064)],
    )
    initials_payload, initials_error = _call_ollama_json(
        context=context,
        prompt=_header_row_prompt(
            "initials",
            ["PO", "PB", "PB", "NE", "PL", "WP", "PB", "MB", "PC", "VB", "OB", "ML", "PB", "YS", "PB", "PK"],
            header_correction_examples,
        ),
        images=[crop_fractional_region(normalized, left=0.17, top=0.051, right=0.995, bottom=0.088)],
    )
    if truck_error and route_error and initials_error:
        return []
    truck_values = _parse_string_values(truck_payload)
    route_values = _parse_string_values(route_payload)
    initials_values = _parse_string_values(initials_payload)
    if not truck_values and not route_values and not initials_values:
        return []
    columns: list[HeaderColumn] = []
    for index in range(16):
        truck_text = truck_values[index] if index < len(truck_values) else ""
        route_text = route_values[index] if index < len(route_values) else ""
        initials_text = initials_values[index] if index < len(initials_values) else ""
        if truck_text.upper() == "TRUCK":
            truck_text = ""
        if route_text.upper() == "ROUTE":
            route_text = ""
        if initials_text.upper() == "INITIALS":
            initials_text = ""
        confidence_parts = [
            0.95 if truck_text else 0.0,
            0.95 if route_text else 0.0,
            0.95 if initials_text else 0.0,
        ]
        confidence = max(confidence_parts) if any(confidence_parts) else None
        columns.append(
            HeaderColumn(
                column_index=index + 1,
                truck_number=_coerce_quantity(truck_text),
                route_number=_coerce_quantity(route_text),
                initials=initials_text.upper()[:20],
                confidence=confidence,
            )
        )
    return columns


def _merge_header_columns(primary: list[HeaderColumn], secondary: list[HeaderColumn]) -> list[HeaderColumn]:
    primary_lookup = {column.column_index: column for column in primary}
    secondary_lookup = {column.column_index: column for column in secondary}
    merged: list[HeaderColumn] = []
    for column_index in range(1, 17):
        first = primary_lookup.get(column_index)
        second = secondary_lookup.get(column_index)
        merged.append(
            HeaderColumn(
                column_index=column_index,
                truck_number=(
                    first.truck_number
                    if first and first.truck_number is not None
                    else (second.truck_number if second else None)
                ),
                route_number=(
                    first.route_number
                    if first and first.route_number is not None
                    else (second.route_number if second else None)
                ),
                initials=(
                    first.initials
                    if first and first.initials
                    else (second.initials if second else "")
                ),
                confidence=(
                    first.confidence
                    if first and first.confidence is not None
                    else (second.confidence if second else None)
                ),
            )
        )
    return merged


def _entries_from_payload(
    payload: Any,
    *,
    template: ShortageSheetTemplate,
    columns: list[HeaderColumn],
) -> list[dict[str, object]]:
    raw_entries = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(raw_entries, list):
        return []
    column_lookup = {column.column_index: column for column in columns}
    row_lookup = template.row_lookup
    entries: list[dict[str, object]] = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            continue
        row_key = _normalise_text(raw.get("row_key"))
        column_index = _coerce_int(raw.get("column_index"))
        raw_text = _normalise_text(raw.get("raw_text") or raw.get("quantity"))
        quantity = _coerce_quantity(raw.get("quantity"))
        if quantity is None and raw_text:
            quantity = _coerce_quantity(raw_text)
        confidence = _coerce_float(raw.get("confidence"))
        raw_digits = re.findall(r"\d+", raw_text)
        if (
            not row_key
            or row_key not in row_lookup
            or column_index is None
            or column_index < 1
            or column_index > 16
            or (quantity is None and not raw_text)
            or (quantity is None and not raw_digits)
        ):
            continue
        row_definition: ShortageSheetRowDefinition = row_lookup[row_key]
        printed_label = _normalise_text(row_definition.printed_label)
        printed_label_lower = printed_label.lower()
        raw_text_lower = raw_text.lower()
        printed_code_quantity = _coerce_quantity(printed_label)
        if raw_text and printed_label_lower and printed_label_lower in raw_text_lower:
            continue
        if (
            quantity is not None
            and printed_code_quantity is not None
            and quantity == printed_code_quantity
            and (
                not raw_text
                or "x" in raw_text_lower
                or printed_label_lower.split(" - ")[0] in raw_text_lower
            )
        ):
            continue
        column = column_lookup.get(column_index)
        issues: list[str] = []
        if column is None or column.truck_number is None:
            issues.append("Missing truck number")
        if not column or not column.initials:
            issues.append("Missing initials")
        if quantity is None:
            issues.append("Missing quantity")
            if raw_text:
                issues.append("Unclear handwritten quantity")
        if confidence is not None and confidence < 0.7:
            issues.append("Low extraction confidence")
        entries.append(
            {
                "truck_number": column.truck_number if column else None,
                "item_category": row_definition.item_category,
                "item_detail": row_definition.item_detail,
                "quantity": quantity,
                "initials": column.initials if column else "",
                "raw_text": raw_text,
                "confidence_score": confidence,
                "issues": issues,
                "review_status": "needs_review",
                "reviewer_note": f"sheet_row={row_key}; column={column_index}",
                "source_photo_id": None,
                "row_key": row_key,
                "column_index": column_index,
            }
        )
    return entries


def _merge_repairs(
    *,
    entries: list[dict[str, object]],
    repairs_payload: Any,
    low_confidence_threshold: float,
) -> list[dict[str, object]]:
    raw_repairs = repairs_payload.get("repairs") if isinstance(repairs_payload, dict) else None
    if not isinstance(raw_repairs, list):
        return entries
    repair_map: dict[tuple[str, int], dict[str, object]] = {}
    for raw in raw_repairs:
        if not isinstance(raw, dict):
            continue
        row_key = _normalise_text(raw.get("row_key"))
        column_index = _coerce_int(raw.get("column_index"))
        quantity = _coerce_int(raw.get("quantity"))
        confidence = _coerce_float(raw.get("confidence"))
        if not row_key or column_index is None or quantity is None:
            continue
        repair_map[(row_key, column_index)] = {
            "quantity": quantity,
            "raw_text": _normalise_text(raw.get("raw_text") or quantity),
            "confidence_score": confidence,
        }
    merged: list[dict[str, object]] = []
    for entry in entries:
        key = (_normalise_text(entry.get("row_key")), int(entry.get("column_index") or 0))
        repair = repair_map.get(key)
        if repair:
            entry = {**entry, **repair}
            entry["issues"] = [issue for issue in entry["issues"] if issue != "Low extraction confidence"]
            confidence = repair.get("confidence_score")
            if isinstance(confidence, float) and confidence >= low_confidence_threshold:
                entry["review_status"] = "accepted" if not entry["issues"] else "needs_review"
        merged.append(entry)
    return merged


def _merge_entries(
    entries: list[dict[str, object]],
    supplement: list[dict[str, object]],
) -> list[dict[str, object]]:
    def _entry_source_priority(entry: dict[str, object]) -> int:
        reviewer_note = _normalise_text(entry.get("reviewer_note")).lower()
        if "source=rowwise_ocr" in reviewer_note:
            return 3
        if "source=banded_ocr" in reviewer_note:
            return 1
        return 2

    merged: dict[tuple[str, int], dict[str, object]] = {}
    for entry in entries + supplement:
        key = (_normalise_text(entry.get("row_key")), int(entry.get("column_index") or 0))
        existing = merged.get(key)
        if existing is None:
            merged[key] = entry
            continue
        existing_quantity = existing.get("quantity")
        new_quantity = entry.get("quantity")
        existing_conf = _coerce_float(existing.get("confidence_score"))
        new_conf = _coerce_float(entry.get("confidence_score"))
        existing_score = (
            1 if existing_quantity is not None else 0,
            _entry_source_priority(existing),
            existing_conf or 0.0,
        )
        new_score = (
            1 if new_quantity is not None else 0,
            _entry_source_priority(entry),
            new_conf or 0.0,
        )
        should_replace = new_score > existing_score
        if should_replace:
            merged[key] = entry
    return list(merged.values())


def _rowwise_body_entries(
    *,
    context: ExtractionContext,
    normalized: bytes,
    template: ShortageSheetTemplate,
    columns: list[HeaderColumn],
    correction_examples: list[dict[str, object]],
    candidate_row_keys: set[str],
) -> tuple[list[dict[str, object]], int]:
    body_top = 0.102
    body_bottom = 0.892
    row_h = (body_bottom - body_top) / max(1, len(template.rows))
    recovered_entries: list[dict[str, object]] = []
    failed_rows = 0
    for row_index, row_definition in enumerate(template.rows, start=1):
        if row_definition.row_key not in candidate_row_keys:
            continue
        row_top = max(0.0, body_top + (row_index - 1) * row_h + 0.0008)
        row_bottom = min(1.0, body_top + row_index * row_h - 0.0008)
        label_region = crop_fractional_region(normalized, left=0.0, top=row_top, right=0.31, bottom=row_bottom)
        grid_region = crop_fractional_region(normalized, left=0.18, top=row_top, right=0.995, bottom=row_bottom)
        row_payload, row_error = _call_ollama_json(
            context=context,
            prompt=_row_focus_prompt(
                row_definition=row_definition,
                columns=columns,
                correction_examples=correction_examples,
            ),
            images=[label_region, grid_region],
        )
        if row_error:
            failed_rows += 1
            continue
        row_entries = _entries_from_payload(row_payload, template=template, columns=columns)
        for entry in row_entries:
            issues = list(entry.get("issues") or [])
            if entry.get("quantity") is None and "Row OCR needs verification" not in issues:
                issues.append("Row OCR needs verification")
            entry["issues"] = issues
            entry["review_status"] = "needs_review" if issues else entry["review_status"]
            note = _normalise_text(entry.get("reviewer_note"))
            entry["reviewer_note"] = f"{note}; source=rowwise_ocr".strip("; ")
        recovered_entries.extend(row_entries)
    return recovered_entries, failed_rows


def extract_shortage_rows_with_llm(
    *,
    content: bytes,
    file_name: str,
    source_photo_id: str,
    base_url: str,
    model: str,
    timeout_seconds: int,
    low_confidence_threshold: float = 0.82,
    preprocess_max_image_side: int = 1800,
    template: ShortageSheetTemplate = SHORTAGE_V1A_TEMPLATE,
    correction_examples: list[dict[str, object]] | None = None,
    header_correction_examples: list[dict[str, object]] | None = None,
) -> tuple[list[dict[str, object]], list[str], list[HeaderColumn]]:
    context = ExtractionContext(
        template=template,
        low_confidence_threshold=low_confidence_threshold,
        timeout_seconds=timeout_seconds,
        base_url=base_url,
        model=model,
    )
    normalized = preprocess_sheet_image(content, max_side=preprocess_max_image_side)
    correction_examples = list(correction_examples or [])
    header_correction_examples = list(header_correction_examples or [])
    header_region = crop_fractional_region(normalized, left=0.16, top=0.0, right=0.98, bottom=0.12)
    body_region = crop_fractional_region(normalized, left=0.0, top=0.10, right=0.98, bottom=0.90)
    footer_region = crop_fractional_region(normalized, left=0.0, top=0.88, right=0.98, bottom=1.0)

    notes: list[str] = []

    header_payload, header_error = _call_ollama_json(
        context=context,
        prompt=_header_prompt(template, header_correction_examples),
        images=[header_region],
    )
    if header_error:
        return [], [f"{file_name}: {header_error}"], []
    columns = _parse_header_columns(header_payload)
    rowwise_columns = _build_rowwise_header_columns(context, normalized, header_correction_examples)
    if rowwise_columns:
        columns = _merge_header_columns(rowwise_columns, columns)
        notes.append(f"{file_name}: row-wise header OCR recovered {sum(1 for column in columns if column.truck_number is not None or column.route_number is not None or column.initials)} columns")
    if not columns:
        fallback_header_region = crop_fractional_region(normalized, left=0.10, top=0.0, right=0.995, bottom=0.18)
        fallback_payload, fallback_error = _call_ollama_json(
            context=context,
            prompt=_header_prompt(template, header_correction_examples),
            images=[fallback_header_region, normalized],
        )
        if fallback_error:
            notes.append(f"{file_name}: header fallback failed ({fallback_error})")
        else:
            columns = _parse_header_columns(fallback_payload)
            if columns:
                notes.append(f"{file_name}: header fallback recovered {len(columns)} columns")
        if not columns:
            notes.append(f"{file_name}: header extraction returned no columns")

    body_payload, body_error = _call_ollama_json(
        context=context,
        prompt=_body_prompt(template, columns, correction_examples),
        images=[body_region],
    )
    if body_error:
        return [], notes + [f"{file_name}: {body_error}"], columns
    entries = _entries_from_payload(body_payload, template=template, columns=columns)
    should_run_banded_pass = (not entries) or len(entries) < 18
    if should_run_banded_pass:
        body_top = 0.102
        body_bottom = 0.892
        row_h = (body_bottom - body_top) / max(1, len(template.rows))
        band_ranges = [(5, 16), (17, 23), (31, 39), (49, len(template.rows))]
        supplemental_entries: list[dict[str, object]] = []
        for start_index, end_index in band_ranges:
            band_top = max(0.0, body_top + (start_index - 1) * row_h - 0.004)
            band_bottom = min(1.0, body_top + end_index * row_h + 0.004)
            labels_region = crop_fractional_region(normalized, left=0.0, top=band_top, right=0.31, bottom=band_bottom)
            grid_region = crop_fractional_region(normalized, left=0.18, top=band_top, right=0.995, bottom=band_bottom)
            row_catalog = [
                {"row_key": row.row_key, "printed_label": row.printed_label}
                for row in template.rows[start_index - 1:end_index]
            ]
            band_payload, band_error = _call_ollama_json(
                context=context,
                prompt=_banded_body_prompt(
                    row_catalog=row_catalog,
                    columns=columns,
                    correction_examples=correction_examples,
                ),
                images=[labels_region, grid_region],
            )
            if band_error:
                notes.append(f"{file_name}: body band {start_index}-{end_index} failed ({band_error})")
                continue
            band_entries = _entries_from_payload(band_payload, template=template, columns=columns)
            for entry in band_entries:
                issues = list(entry.get("issues") or [])
                if "Banded OCR needs verification" not in issues:
                    issues.append("Banded OCR needs verification")
                entry["issues"] = issues
                entry["review_status"] = "needs_review"
                note = _normalise_text(entry.get("reviewer_note"))
                entry["reviewer_note"] = f"{note}; source=banded_ocr".strip("; ")
            supplemental_entries.extend(band_entries)
        if supplemental_entries:
            entries = _merge_entries(entries, supplemental_entries)
            notes.append(f"{file_name}: banded body OCR recovered {len(supplemental_entries)} draft entries")

    footer_payload, footer_error = _call_ollama_json(context=context, prompt=_footer_prompt(template), images=[footer_region])
    if footer_error:
        notes.append(f"{file_name}: {footer_error}")
    elif isinstance(footer_payload, dict):
        footer = footer_payload.get("footer")
        if isinstance(footer, dict):
            footer_values = {key: _normalise_text(value) for key, value in footer.items() if _normalise_text(value)}
            if footer_values:
                notes.append(f"{file_name}: footer={json.dumps(footer_values)}")

    suspect_entries = [
        {
            "row_key": entry["row_key"],
            "column_index": entry["column_index"],
            "quantity": entry["quantity"],
            "raw_text": entry["raw_text"],
            "confidence": entry["confidence_score"],
            "issues": entry["issues"],
        }
        for entry in entries
        if entry["confidence_score"] is None or float(entry["confidence_score"]) < low_confidence_threshold or entry["issues"]
    ]
    if suspect_entries:
        repairs_payload, repair_error = _call_ollama_json(
            context=context,
            prompt=_repair_prompt(template, suspect_entries, columns, correction_examples),
            images=[body_region, header_region],
        )
        if repair_error:
            notes.append(f"{file_name}: {repair_error}")
        else:
            entries = _merge_repairs(
                entries=entries,
                repairs_payload=repairs_payload,
                low_confidence_threshold=low_confidence_threshold,
            )

    entries, learned_count = _apply_correction_memory(
        entries=entries,
        correction_examples=correction_examples,
        low_confidence_threshold=low_confidence_threshold,
    )
    if learned_count:
        notes.append(f"{file_name}: correction memory refined {learned_count} entries")

    if entries:
        candidate_row_keys: set[str] = set()
        row_positions = {row.row_key: index for index, row in enumerate(template.rows)}
        for entry in entries:
            row_key = _normalise_text(entry.get("row_key"))
            if row_key not in row_positions:
                continue
            index = row_positions[row_key]
            candidate_row_keys.add(template.rows[index].row_key)
            confidence = _coerce_float(entry.get("confidence_score"))
            issues = list(entry.get("issues") or [])
            reviewer_note = _normalise_text(entry.get("reviewer_note")).lower()
            should_expand_neighbors = (
                bool(issues)
                or confidence is None
                or confidence < low_confidence_threshold
                or "source=banded_ocr" in reviewer_note
            )
            if should_expand_neighbors:
                for neighbor_index in range(max(0, index - 1), min(len(template.rows), index + 2)):
                    candidate_row_keys.add(template.rows[neighbor_index].row_key)
        rowwise_entries, rowwise_failures = _rowwise_body_entries(
            context=context,
            normalized=normalized,
            template=template,
            columns=columns,
            correction_examples=correction_examples,
            candidate_row_keys=candidate_row_keys,
        )
        corroborated_signatures = {
            (
                _normalise_text(entry.get("row_key")),
                _coerce_int(entry.get("column_index")) or 0,
                _coerce_int(entry.get("quantity")),
            )
            for entry in entries
            if _coerce_int(entry.get("quantity")) is not None
        }
        for entry in rowwise_entries:
            signature = (
                _normalise_text(entry.get("row_key")),
                _coerce_int(entry.get("column_index")) or 0,
                _coerce_int(entry.get("quantity")),
            )
            issues = list(entry.get("issues") or [])
            if signature not in corroborated_signatures and "Row OCR needs verification" not in issues:
                issues.append("Row OCR needs verification")
            entry["issues"] = issues
            entry["review_status"] = "needs_review" if issues else entry["review_status"]
        if rowwise_entries:
            entries = _merge_entries(entries, rowwise_entries)
            notes.append(
                f"{file_name}: row-wise body OCR refined {len(rowwise_entries)} draft entries across {len(candidate_row_keys)} candidate rows"
            )
        if rowwise_failures:
            notes.append(f"{file_name}: row-wise body OCR skipped {rowwise_failures} candidate rows with OCR errors")

    for entry in entries:
        entry["source_photo_id"] = source_photo_id
        entry["review_status"] = "needs_review" if entry["issues"] else entry["review_status"]
    return entries, notes, columns
