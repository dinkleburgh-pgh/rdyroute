"""
Router: /shorts/imports

Shortage-sheet photo import workflow with optional Ollama-assisted extraction
and mandatory human review before live shortages are created.
"""

from __future__ import annotations

import asyncio
import io
import json
import mimetypes
import re
import shutil
import uuid
import zipfile
from datetime import datetime, timezone, date
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from database import get_db, settings
from models import AppSetting, Shortage, ShortageSheetImport, ShortageSheetPhoto, ShortageSheetRowDraft, User
from routers.auth import require_admin, require_shorts_access
from shortage_sheet_ocr import extract_shortage_rows_with_llm, preprocess_sheet_image
from shortage_sheet_template import SHORTAGE_V1A_TEMPLATE, shortage_template_payload
from schemas import (
    ShortageSheetColumnDraftOut,
    ShortageSheetColumnDraftUpdate,
    ShortageSheetImportDetailOut,
    ShortageSheetImportOut,
    ShortageSheetImportReject,
    ShortageSheetOllamaProbeIn,
    ShortageSheetOcrMemoryStatusOut,
    ShortageSheetPhotoOut,
    ShortageSheetRowDraftCreate,
    ShortageSheetRowDraftOut,
    ShortageSheetRowDraftUpdate,
    ShortageSheetOllamaStatusOut,
    ShortageSheetTemplateOut,
)
from ws_manager import manager

router = APIRouter(prefix="/shorts/imports", tags=["shorts-imports"])

_PHOTO_ROOT = Path(
    settings.shortage_sheet_photos_dir
    or (
        "/app/.data/shortage_sheet_photos"
        if Path("/app/.data").exists()
        else "./.data/shortage_sheet_photos"
    )
).resolve()
_MAX_PHOTO_BYTES = 10 * 1024 * 1024
_ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"}
_IMPORT_EDITABLE_STATUSES = {"processing", "needs_review", "failed"}
_HEADER_COLUMN_COUNT = 16
_OLLAMA_BASE_URL_KEY = "ollama_base_url"
_OLLAMA_MODEL_KEY = "shortage_sheet_ollama_model"
_OLLAMA_TIMEOUT_KEY = "shortage_sheet_ollama_timeout_seconds"
_OLLAMA_THRESHOLD_KEY = "shortage_sheet_llm_low_confidence_threshold"
_OLLAMA_IMAGE_SIDE_KEY = "shortage_sheet_preprocess_max_image_side"
_OCR_CORRECTION_MEMORY_KEY = "shortage_sheet_ocr_correction_memory"
_OCR_HEADER_CORRECTION_MEMORY_KEY = "shortage_sheet_ocr_header_correction_memory"
_OCR_CORRECTION_MEMORY_LIMIT = 600
_OCR_PROMPT_EXAMPLE_LIMIT = 18


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalise_text(value: object) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def _coerce_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return max(1, int(value))
    text = _normalise_text(value)
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    return max(1, int(digits))


def _coerce_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if score < 0:
        return 0.0
    if score > 1:
        return 1.0
    return score


def _app_setting_value(db: Session, key: str) -> object | None:
    row = db.get(AppSetting, key)
    return None if row is None else row.value


def _upsert_app_setting(db: Session, key: str, value: object) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value)
        db.add(row)
        return
    row.value = value


def _coerce_runtime_int(value: object, default: int, *, minimum: int = 1) -> int:
    parsed = _coerce_int(value)
    if parsed is None:
        return default
    return max(minimum, parsed)


def _coerce_runtime_threshold(value: object, default: float) -> float:
    parsed = _coerce_float(value)
    if parsed is None:
        return default
    return parsed


def _runtime_ollama_config(db: Session) -> dict[str, object]:
    base_url = _normalise_text(_app_setting_value(db, _OLLAMA_BASE_URL_KEY) or settings.ollama_base_url)
    model = _normalise_text(_app_setting_value(db, _OLLAMA_MODEL_KEY) or settings.shortage_sheet_ollama_model)
    timeout_seconds = _coerce_runtime_int(
        _app_setting_value(db, _OLLAMA_TIMEOUT_KEY),
        settings.shortage_sheet_ollama_timeout_seconds,
    )
    low_confidence_threshold = _coerce_runtime_threshold(
        _app_setting_value(db, _OLLAMA_THRESHOLD_KEY),
        settings.shortage_sheet_llm_low_confidence_threshold,
    )
    preprocess_max_image_side = _coerce_runtime_int(
        _app_setting_value(db, _OLLAMA_IMAGE_SIDE_KEY),
        settings.shortage_sheet_preprocess_max_image_side,
        minimum=600,
    )
    return _ollama_config_from_values(
        base_url=base_url,
        model=model,
        timeout_seconds=timeout_seconds,
        low_confidence_threshold=low_confidence_threshold,
        preprocess_max_image_side=preprocess_max_image_side,
    )


def _ollama_config_from_values(
    *,
    base_url: object,
    model: object,
    timeout_seconds: object,
    low_confidence_threshold: object,
    preprocess_max_image_side: object,
) -> dict[str, object]:
    base_url_text = _normalise_text(base_url).rstrip("/")
    model_text = _normalise_text(model)
    timeout_seconds_int = _coerce_runtime_int(timeout_seconds, settings.shortage_sheet_ollama_timeout_seconds)
    low_confidence_threshold_float = _coerce_runtime_threshold(
        low_confidence_threshold,
        settings.shortage_sheet_llm_low_confidence_threshold,
    )
    preprocess_max_image_side_int = _coerce_runtime_int(
        preprocess_max_image_side,
        settings.shortage_sheet_preprocess_max_image_side,
        minimum=600,
    )
    return {
        "configured": bool(base_url_text and model_text),
        "base_url": base_url_text,
        "model": model_text,
        "timeout_seconds": timeout_seconds_int,
        "low_confidence_threshold": low_confidence_threshold_float,
        "preprocess_max_image_side": preprocess_max_image_side_int,
    }


def _probe_ollama(config: dict[str, object]) -> dict[str, object]:
    base_url = str(config["base_url"])
    model = str(config["model"])
    timeout_seconds = int(config["timeout_seconds"])
    payload = {
        "configured": bool(config["configured"]),
        "reachable": False,
        "model_available": False,
        "base_url": base_url,
        "model": model,
        "timeout_seconds": timeout_seconds,
        "low_confidence_threshold": float(config["low_confidence_threshold"]),
        "preprocess_max_image_side": int(config["preprocess_max_image_side"]),
        "available_models": [],
        "error": None,
    }
    if not payload["configured"]:
        payload["error"] = "Set both Ollama base URL and model to enable shortage-sheet OCR."
        return payload

    try:
        with urllib_request.urlopen(f"{base_url}/api/tags", timeout=timeout_seconds) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib_error.URLError, TimeoutError, ValueError) as exc:
        payload["error"] = str(exc)
        return payload

    models = body.get("models", []) if isinstance(body, dict) else []
    available_models: list[str] = []
    if isinstance(models, list):
        for item in models:
            if not isinstance(item, dict):
                continue
            name = _normalise_text(item.get("name"))
            if name:
                available_models.append(name)
    payload["reachable"] = True
    payload["available_models"] = available_models
    payload["model_available"] = model in available_models
    if not payload["model_available"]:
        payload["error"] = f"Model '{model}' is not installed on the configured Ollama host."
    return payload


def _tracked_item_category_map(db: Session) -> dict[str, str]:
    categories: dict[str, str] = {
        _normalise_text(row.item_detail).lower(): row.item_category
        for row in SHORTAGE_V1A_TEMPLATE.rows
    }
    tracked = db.get(AppSetting, "tracked_items_map")
    raw_value = tracked.value if tracked else None
    if isinstance(raw_value, dict):
        for label, meta in raw_value.items():
            if not isinstance(label, str):
                continue
            category = ""
            if isinstance(meta, dict):
                category = _normalise_text(meta.get("category"))
            if category:
                categories[_normalise_text(label).lower()] = category
    return categories


def _parse_row_key_from_note(note: str) -> str:
    match = re.search(r"sheet_row=([a-z0-9_]+)", _normalise_text(note).lower())
    return match.group(1) if match else ""


def _row_key_from_item_fields(item_category: str, item_detail: str) -> str:
    normalized_category = _normalise_text(item_category).lower()
    normalized_detail = _normalise_text(item_detail).lower()
    for template_row in SHORTAGE_V1A_TEMPLATE.rows:
        if (
            _normalise_text(template_row.item_category).lower() == normalized_category
            and _normalise_text(template_row.item_detail).lower() == normalized_detail
        ):
            return template_row.row_key
    return ""


def _load_ocr_correction_memory(db: Session) -> list[dict[str, object]]:
    raw = _app_setting_value(db, _OCR_CORRECTION_MEMORY_KEY)
    if isinstance(raw, dict):
        raw = raw.get("examples")
    if not isinstance(raw, list):
        return []
    memory: list[dict[str, object]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        normalized = {
            "id": _normalise_text(entry.get("id")) or uuid.uuid4().hex,
            "template_id": _normalise_text(entry.get("template_id")) or SHORTAGE_V1A_TEMPLATE.template_id,
            "row_key": _normalise_text(entry.get("row_key")).lower(),
            "item_category": _normalise_text(entry.get("item_category")),
            "item_detail": _normalise_text(entry.get("item_detail")),
            "quantity": _coerce_int(entry.get("quantity")),
            "raw_text": _normalise_text(entry.get("raw_text")),
            "source_column_index": _coerce_int(entry.get("source_column_index")),
            "source_photo_id": _normalise_text(entry.get("source_photo_id")) or None,
            "truck_number": _coerce_int(entry.get("truck_number")),
            "initials": _normalise_text(entry.get("initials")).upper()[:20],
            "reviewed_by_username": _normalise_text(entry.get("reviewed_by_username")),
            "reviewed_at": _normalise_text(entry.get("reviewed_at")),
            "review_status": _normalise_text(entry.get("review_status")).lower() or "accepted",
            "reviewer_note": _normalise_text(entry.get("reviewer_note")),
        }
        if not normalized["item_category"] or normalized["quantity"] is None:
            continue
        memory.append(normalized)
    return memory


def _store_ocr_correction_memory(db: Session, examples: list[dict[str, object]]) -> None:
    trimmed = examples[:_OCR_CORRECTION_MEMORY_LIMIT]
    payload = {
        "version": 1,
        "examples": trimmed,
        "updated_at": _now_utc().isoformat(),
    }
    _upsert_app_setting(db, _OCR_CORRECTION_MEMORY_KEY, payload)


def _dedupe_ocr_correction_examples(examples: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: list[dict[str, object]] = []
    seen: set[tuple[object, ...]] = set()
    for entry in sorted(
        examples,
        key=lambda item: _normalise_text(item.get("reviewed_at")),
        reverse=True,
    ):
        fingerprint = (
            _normalise_text(entry.get("template_id")),
            _normalise_text(entry.get("row_key")),
            _normalise_text(entry.get("item_category")).lower(),
            _normalise_text(entry.get("item_detail")).lower(),
            _coerce_int(entry.get("quantity")),
            _normalise_text(entry.get("raw_text")).lower(),
            _coerce_int(entry.get("source_column_index")),
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(entry)
    return deduped


def _build_ocr_correction_example(
    *,
    sheet_import: ShortageSheetImport,
    row: ShortageSheetRowDraft,
    reviewed_by_username: str,
) -> dict[str, object] | None:
    if row.review_status != "accepted":
        return None
    if row.quantity is None or not row.item_category:
        return None
    row_key = _parse_row_key_from_note(row.reviewer_note) or _row_key_from_item_fields(row.item_category, row.item_detail)
    reviewed_at = _now_utc().isoformat()
    return {
        "id": uuid.uuid4().hex,
        "template_id": sheet_import.sheet_template_id or SHORTAGE_V1A_TEMPLATE.template_id,
        "row_key": row_key,
        "item_category": row.item_category,
        "item_detail": row.item_detail,
        "quantity": row.quantity,
        "raw_text": _normalise_text(row.raw_text),
        "source_column_index": row.source_column_index,
        "source_photo_id": row.source_photo_id,
        "truck_number": row.truck_number,
        "initials": row.initials,
        "reviewed_by_username": reviewed_by_username,
        "reviewed_at": reviewed_at,
        "review_status": row.review_status,
        "reviewer_note": row.reviewer_note,
        "run_date": str(sheet_import.run_date),
    }


def _remember_ocr_correction_example(
    *,
    db: Session,
    sheet_import: ShortageSheetImport,
    row: ShortageSheetRowDraft,
    reviewed_by_username: str,
) -> None:
    example = _build_ocr_correction_example(
        sheet_import=sheet_import,
        row=row,
        reviewed_by_username=reviewed_by_username,
    )
    if example is None:
        return
    memory = _load_ocr_correction_memory(db)
    memory.append(example)
    _store_ocr_correction_memory(db, _dedupe_ocr_correction_examples(memory))


def _remember_import_ocr_corrections(
    *,
    db: Session,
    sheet_import: ShortageSheetImport,
    reviewed_by_username: str,
) -> None:
    memory = _load_ocr_correction_memory(db)
    for row in sheet_import.rows:
        example = _build_ocr_correction_example(
            sheet_import=sheet_import,
            row=row,
            reviewed_by_username=reviewed_by_username,
        )
        if example is not None:
            memory.append(example)
    _store_ocr_correction_memory(db, _dedupe_ocr_correction_examples(memory))


def _load_or_seed_ocr_correction_memory(db: Session) -> list[dict[str, object]]:
    memory = _load_ocr_correction_memory(db)
    if memory:
        return memory
    approved_imports = db.scalars(
        select(ShortageSheetImport)
        .options(selectinload(ShortageSheetImport.rows))
        .where(ShortageSheetImport.status == "approved")
        .order_by(ShortageSheetImport.reviewed_at.desc(), ShortageSheetImport.created_at.desc())
        .limit(25)
    ).all()
    for sheet_import in approved_imports:
        for row in sheet_import.rows:
            example = _build_ocr_correction_example(
                sheet_import=sheet_import,
                row=row,
                reviewed_by_username=sheet_import.reviewed_by_username or sheet_import.applied_by_username or "system",
            )
            if example is not None:
                memory.append(example)
    deduped = _dedupe_ocr_correction_examples(memory)
    if deduped:
        _store_ocr_correction_memory(db, deduped)
    return deduped


def _load_header_ocr_correction_memory(db: Session) -> list[dict[str, object]]:
    raw = _app_setting_value(db, _OCR_HEADER_CORRECTION_MEMORY_KEY)
    if isinstance(raw, dict):
        raw = raw.get("examples")
    if not isinstance(raw, list):
        return []
    memory: list[dict[str, object]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        normalized = {
            "id": _normalise_text(entry.get("id")) or uuid.uuid4().hex,
            "template_id": _normalise_text(entry.get("template_id")) or SHORTAGE_V1A_TEMPLATE.template_id,
            "column_index": _coerce_int(entry.get("column_index")),
            "truck_number": _coerce_int(entry.get("truck_number")),
            "route_number": _coerce_int(entry.get("route_number")),
            "initials": _normalise_text(entry.get("initials")).upper()[:20],
            "source_photo_id": _normalise_text(entry.get("source_photo_id")) or None,
            "reviewed_by_username": _normalise_text(entry.get("reviewed_by_username")),
            "reviewed_at": _normalise_text(entry.get("reviewed_at")),
            "review_status": _normalise_text(entry.get("review_status")).lower() or "accepted",
            "reviewer_note": _normalise_text(entry.get("reviewer_note")),
            "run_date": _normalise_text(entry.get("run_date")),
        }
        if normalized["column_index"] is None:
            continue
        if normalized["truck_number"] is None and normalized["route_number"] is None and not normalized["initials"]:
            continue
        memory.append(normalized)
    return memory


def _store_header_ocr_correction_memory(db: Session, examples: list[dict[str, object]]) -> None:
    trimmed = examples[:_OCR_CORRECTION_MEMORY_LIMIT]
    payload = {
        "version": 1,
        "examples": trimmed,
        "updated_at": _now_utc().isoformat(),
    }
    _upsert_app_setting(db, _OCR_HEADER_CORRECTION_MEMORY_KEY, payload)


def _dedupe_header_ocr_correction_examples(examples: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: list[dict[str, object]] = []
    seen: set[tuple[object, ...]] = set()
    for entry in sorted(
        examples,
        key=lambda item: _normalise_text(item.get("reviewed_at")),
        reverse=True,
    ):
        fingerprint = (
            _normalise_text(entry.get("template_id")),
            _coerce_int(entry.get("column_index")),
            _coerce_int(entry.get("truck_number")),
            _coerce_int(entry.get("route_number")),
            _normalise_text(entry.get("initials")).upper(),
            _normalise_text(entry.get("source_photo_id")),
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(entry)
    return deduped


def _build_header_ocr_correction_example(
    *,
    sheet_import: ShortageSheetImport,
    column: dict[str, object],
    reviewed_by_username: str,
) -> dict[str, object] | None:
    review_status = _normalise_text(column.get("review_status")).lower()
    if review_status != "accepted":
        return None
    source_photo_id = _normalise_text(column.get("source_photo_id")) or None
    column_index = _coerce_int(column.get("column_index"))
    truck_number = _coerce_int(column.get("truck_number"))
    route_number = _coerce_int(column.get("route_number"))
    initials = _normalise_text(column.get("initials")).upper()[:20]
    if column_index is None:
        return None
    if truck_number is None and route_number is None and not initials:
        return None
    reviewed_at = _now_utc().isoformat()
    return {
        "id": uuid.uuid4().hex,
        "template_id": sheet_import.sheet_template_id or SHORTAGE_V1A_TEMPLATE.template_id,
        "column_index": column_index,
        "truck_number": truck_number,
        "route_number": route_number,
        "initials": initials,
        "source_photo_id": source_photo_id,
        "reviewed_by_username": reviewed_by_username,
        "reviewed_at": reviewed_at,
        "review_status": review_status,
        "reviewer_note": _normalise_text(column.get("reviewer_note")),
        "run_date": str(sheet_import.run_date),
    }


def _remember_header_ocr_correction_example(
    *,
    db: Session,
    sheet_import: ShortageSheetImport,
    column: dict[str, object],
    reviewed_by_username: str,
) -> None:
    example = _build_header_ocr_correction_example(
        sheet_import=sheet_import,
        column=column,
        reviewed_by_username=reviewed_by_username,
    )
    if example is None:
        return
    memory = _load_header_ocr_correction_memory(db)
    memory.append(example)
    _store_header_ocr_correction_memory(db, _dedupe_header_ocr_correction_examples(memory))


def _remember_import_header_ocr_corrections(
    *,
    db: Session,
    sheet_import: ShortageSheetImport,
    reviewed_by_username: str,
) -> None:
    memory = _load_header_ocr_correction_memory(db)
    for column in _normalized_header_columns(sheet_import.header_columns):
        example = _build_header_ocr_correction_example(
            sheet_import=sheet_import,
            column=column,
            reviewed_by_username=reviewed_by_username,
        )
        if example is not None:
            memory.append(example)
    _store_header_ocr_correction_memory(db, _dedupe_header_ocr_correction_examples(memory))


def _load_or_seed_header_ocr_correction_memory(db: Session) -> list[dict[str, object]]:
    raw = _app_setting_value(db, _OCR_HEADER_CORRECTION_MEMORY_KEY)
    memory = _load_header_ocr_correction_memory(db)
    if raw is not None:
        return memory
    imports = db.scalars(
        select(ShortageSheetImport)
        .where(ShortageSheetImport.status.in_(["approved", "needs_review"]))
        .order_by(ShortageSheetImport.reviewed_at.desc(), ShortageSheetImport.created_at.desc())
        .limit(25)
    ).all()
    for sheet_import in imports:
        for column in _normalized_header_columns(sheet_import.header_columns):
            example = _build_header_ocr_correction_example(
                sheet_import=sheet_import,
                column=column,
                reviewed_by_username=sheet_import.reviewed_by_username or sheet_import.applied_by_username or "system",
            )
            if example is not None:
                memory.append(example)
    deduped = _dedupe_header_ocr_correction_examples(memory)
    if deduped:
        _store_header_ocr_correction_memory(db, deduped)
    return deduped


def _ocr_memory_status_payload(db: Session) -> dict[str, object]:
    memory = _load_or_seed_ocr_correction_memory(db)
    header_memory = _load_or_seed_header_ocr_correction_memory(db)
    template_ids = sorted(
        {
            str(entry.get("template_id") or SHORTAGE_V1A_TEMPLATE.template_id)
            for entry in [*memory, *header_memory]
        }
    )
    accepted_count = sum(1 for entry in memory if _normalise_text(entry.get("review_status")).lower() == "accepted")
    accepted_header_count = sum(
        1 for entry in header_memory if _normalise_text(entry.get("review_status")).lower() == "accepted"
    )
    last_reviewed_at = next(
        (
            _normalise_text(entry.get("reviewed_at"))
            for entry in sorted(memory, key=lambda item: _normalise_text(item.get("reviewed_at")), reverse=True)
            if _normalise_text(entry.get("reviewed_at"))
        ),
        "",
    )
    last_header_reviewed_at = next(
        (
            _normalise_text(entry.get("reviewed_at"))
            for entry in sorted(header_memory, key=lambda item: _normalise_text(item.get("reviewed_at")), reverse=True)
            if _normalise_text(entry.get("reviewed_at"))
        ),
        "",
    )
    return {
        "example_count": len(memory),
        "accepted_example_count": accepted_count,
        "header_example_count": len(header_memory),
        "accepted_header_example_count": accepted_header_count,
        "template_ids": template_ids,
        "last_reviewed_at": last_reviewed_at or None,
        "last_header_reviewed_at": last_header_reviewed_at or None,
        "model_hint": _normalise_text(_app_setting_value(db, _OLLAMA_MODEL_KEY) or settings.shortage_sheet_ollama_model),
        "adapter_export_supported": True,
        "header_adapter_export_supported": True,
    }


def _ocr_training_export_payload(db: Session) -> dict[str, object]:
    memory = _load_or_seed_ocr_correction_memory(db)
    structured_examples = sorted(
        memory,
        key=lambda item: _normalise_text(item.get("reviewed_at")),
        reverse=True,
    )
    jsonl_records = [
        {
            "template_id": str(entry.get("template_id") or SHORTAGE_V1A_TEMPLATE.template_id),
            "row_key": _normalise_text(entry.get("row_key")),
            "raw_text": _normalise_text(entry.get("raw_text")),
            "source_column_index": _coerce_int(entry.get("source_column_index")),
            "target": {
                "item_category": _normalise_text(entry.get("item_category")),
                "item_detail": _normalise_text(entry.get("item_detail")),
                "quantity": _coerce_int(entry.get("quantity")),
            },
            "meta": {
                "reviewed_at": _normalise_text(entry.get("reviewed_at")),
                "reviewed_by_username": _normalise_text(entry.get("reviewed_by_username")),
                "source_photo_id": _normalise_text(entry.get("source_photo_id")),
            },
        }
        for entry in structured_examples
    ]
    return {
        "format_version": 1,
        "generated_at": _now_utc().isoformat(),
        "model_hint": _normalise_text(_app_setting_value(db, _OLLAMA_MODEL_KEY) or settings.shortage_sheet_ollama_model),
        "ollama_adapter_note": (
            "Ollama can import fine-tuned adapters via Modelfile ADAPTER after external fine-tuning. "
            "This export is a reviewed correction dataset, not an adapter by itself."
        ),
        "examples": structured_examples,
        "jsonl_records": jsonl_records,
    }


def _header_ocr_training_export_payload(db: Session) -> dict[str, object]:
    memory = _load_or_seed_header_ocr_correction_memory(db)
    structured_examples = sorted(
        memory,
        key=lambda item: _normalise_text(item.get("reviewed_at")),
        reverse=True,
    )
    jsonl_records = [
        {
            "template_id": str(entry.get("template_id") or SHORTAGE_V1A_TEMPLATE.template_id),
            "column_index": _coerce_int(entry.get("column_index")),
            "target": {
                "truck_number": _coerce_int(entry.get("truck_number")),
                "route_number": _coerce_int(entry.get("route_number")),
                "initials": _normalise_text(entry.get("initials")).upper()[:20],
            },
            "meta": {
                "reviewed_at": _normalise_text(entry.get("reviewed_at")),
                "reviewed_by_username": _normalise_text(entry.get("reviewed_by_username")),
                "source_photo_id": _normalise_text(entry.get("source_photo_id")),
                "reviewer_note": _normalise_text(entry.get("reviewer_note")),
            },
        }
        for entry in structured_examples
    ]
    return {
        "format_version": 1,
        "generated_at": _now_utc().isoformat(),
        "model_hint": _normalise_text(_app_setting_value(db, _OLLAMA_MODEL_KEY) or settings.shortage_sheet_ollama_model),
        "ollama_adapter_note": (
            "This export is a reviewed header dataset for truck, route, and initials recognition."
        ),
        "examples": structured_examples,
        "jsonl_records": jsonl_records,
    }


def _fractional_crop(image: Image.Image, *, left: float, top: float, right: float, bottom: float) -> Image.Image:
    width, height = image.size
    left_px = max(0, int(width * left))
    top_px = max(0, int(height * top))
    right_px = min(width, int(width * right))
    bottom_px = min(height, int(height * bottom))
    if right_px <= left_px:
        right_px = min(width, left_px + 1)
    if bottom_px <= top_px:
        bottom_px = min(height, top_px + 1)
    return image.crop((left_px, top_px, right_px, bottom_px))


def _column_fraction_bounds(column_index: int) -> tuple[float, float]:
    grid_left = 0.18
    grid_right = 0.995
    column_width = (grid_right - grid_left) / _HEADER_COLUMN_COUNT
    left = max(0.0, grid_left + (column_index - 1) * column_width - 0.004)
    right = min(1.0, grid_left + column_index * column_width + 0.004)
    return left, right


def _row_fraction_bounds(template_row_index: int, template_row_count: int) -> tuple[float, float]:
    body_top = 0.102
    body_bottom = 0.892
    row_height = (body_bottom - body_top) / max(1, template_row_count)
    top = max(0.0, body_top + template_row_index * row_height - 0.004)
    bottom = min(1.0, body_top + (template_row_index + 1) * row_height + 0.004)
    return top, bottom


def _image_to_png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _png_bytes_to_image(content: bytes) -> Image.Image:
    with Image.open(io.BytesIO(content)) as image:
        return image.convert("L").copy()


def _threshold_image(image: Image.Image, threshold: int = 180) -> Image.Image:
    return image.point(lambda value: 255 if value >= threshold else 0, mode="L")


def _rotate_image(image: Image.Image, degrees: float) -> Image.Image:
    return image.rotate(
        degrees,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=255,
    )


def _augment_training_variant_bytes(base_bytes: bytes) -> dict[str, bytes]:
    image = _png_bytes_to_image(base_bytes)
    auto = ImageOps.autocontrast(image)
    sharpened = auto.filter(ImageFilter.SHARPEN)
    return {
        "base": base_bytes,
        "autocontrast": _image_to_png_bytes(auto),
        "threshold": _image_to_png_bytes(_threshold_image(auto)),
        "rotate_neg2": _image_to_png_bytes(_rotate_image(sharpened, -2.0)),
        "rotate_pos2": _image_to_png_bytes(_rotate_image(sharpened, 2.0)),
    }


def _build_training_crop_variants(
    *,
    content: bytes,
    template_row_index: int,
    column_index: int,
) -> dict[str, bytes]:
    normalized = preprocess_sheet_image(content, max_side=max(settings.shortage_sheet_preprocess_max_image_side, 1800))
    with Image.open(io.BytesIO(normalized)) as image:
        image = image.convert("L")
        header_left, header_right = _column_fraction_bounds(column_index)
        row_top, row_bottom = _row_fraction_bounds(template_row_index, len(SHORTAGE_V1A_TEMPLATE.rows))

        header_strip = _fractional_crop(
            image,
            left=max(0.0, header_left - 0.015),
            top=0.0,
            right=min(1.0, header_right + 0.015),
            bottom=0.095,
        )
        label_strip = _fractional_crop(
            image,
            left=0.0,
            top=row_top,
            right=0.31,
            bottom=row_bottom,
        )
        cell_strip = _fractional_crop(
            image,
            left=max(0.16, header_left - 0.01),
            top=row_top,
            right=min(1.0, header_right + 0.01),
            bottom=row_bottom,
        )

        row_width = label_strip.width + 8 + cell_strip.width
        row_height = max(label_strip.height, cell_strip.height)
        row_panel = Image.new("L", (row_width, row_height), color=255)
        row_panel.paste(label_strip, (0, max(0, (row_height - label_strip.height) // 2)))
        row_panel.paste(cell_strip, (label_strip.width + 8, max(0, (row_height - cell_strip.height) // 2)))

        canvas_width = max(header_strip.width, row_panel.width)
        canvas_height = header_strip.height + 10 + row_panel.height
        canvas = Image.new("L", (canvas_width, canvas_height), color=255)
        canvas.paste(header_strip, ((canvas_width - header_strip.width) // 2, 0))
        canvas.paste(row_panel, ((canvas_width - row_panel.width) // 2, header_strip.height + 10))
        return {
            "full": _image_to_png_bytes(canvas),
            "row": _image_to_png_bytes(row_panel),
            "cell": _image_to_png_bytes(cell_strip),
            "header": _image_to_png_bytes(header_strip),
        }


def _build_header_training_crop(
    *,
    content: bytes,
    column_index: int,
) -> bytes:
    normalized = preprocess_sheet_image(content, max_side=max(settings.shortage_sheet_preprocess_max_image_side, 1800))
    with Image.open(io.BytesIO(normalized)) as image:
        image = image.convert("L")
        header_left, header_right = _column_fraction_bounds(column_index)
        header_strip = _fractional_crop(
            image,
            left=max(0.0, header_left - 0.015),
            top=0.0,
            right=min(1.0, header_right + 0.015),
            bottom=0.095,
        )
        return _image_to_png_bytes(header_strip)


def _shortage_sheet_training_dataset_zip(db: Session) -> io.BytesIO:
    approved_imports = db.scalars(
        select(ShortageSheetImport)
        .options(
            selectinload(ShortageSheetImport.photos),
            selectinload(ShortageSheetImport.rows),
        )
        .where(ShortageSheetImport.status == "approved")
        .order_by(ShortageSheetImport.reviewed_at.desc(), ShortageSheetImport.created_at.desc())
    ).all()

    dataset_records_full: list[dict[str, object]] = []
    dataset_records_row: list[dict[str, object]] = []
    dataset_records_cell: list[dict[str, object]] = []
    dataset_records_header: list[dict[str, object]] = []
    manifest_examples: list[dict[str, object]] = []
    image_counter = 0
    buf = io.BytesIO()
    augmentation_names = ["base", "autocontrast", "threshold", "rotate_neg2", "rotate_pos2"]

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for sheet_import in approved_imports:
            column_lookup = _column_lookup(sheet_import)
            photo_lookup = {photo.id: photo for photo in sheet_import.photos}
            for row in sheet_import.rows:
                if row.review_status != "accepted":
                    continue
                example = _build_ocr_correction_example(
                    sheet_import=sheet_import,
                    row=row,
                    reviewed_by_username=sheet_import.reviewed_by_username or sheet_import.applied_by_username or "system",
                )
                if example is None:
                    continue
                row_key = _normalise_text(example.get("row_key")).lower()
                source_photo_id = _normalise_text(example.get("source_photo_id"))
                source_column_index = _coerce_int(example.get("source_column_index"))
                if not row_key or not source_photo_id or source_column_index is None:
                    continue
                photo = photo_lookup.get(source_photo_id)
                if photo is None:
                    continue
                photo_path = Path(photo.stored_path)
                if not photo_path.is_file():
                    continue
                try:
                    template_row_index = SHORTAGE_V1A_TEMPLATE.row_keys.index(row_key)
                except ValueError:
                    continue
                try:
                    crop_variants = _build_training_crop_variants(
                        content=photo_path.read_bytes(),
                        template_row_index=template_row_index,
                        column_index=source_column_index,
                    )
                except Exception:
                    continue

                image_counter += 1
                image_base = f"sample_{image_counter:04d}"
                variant_augmented_images: dict[str, dict[str, str]] = {}
                for variant, base_bytes in crop_variants.items():
                    augmented_bytes = _augment_training_variant_bytes(base_bytes)
                    variant_augmented_images[variant] = {}
                    for augmentation, image_bytes in augmented_bytes.items():
                        image_name = f"images/{variant}/{augmentation}/{image_base}.png"
                        zf.writestr(image_name, image_bytes)
                        variant_augmented_images[variant][augmentation] = image_name

                column = column_lookup.get(source_column_index, {})
                assistant_payload = {
                    "row_key": row_key,
                    "truck_number": _coerce_int(column.get("truck_number")) or example.get("truck_number"),
                    "route_number": _coerce_int(column.get("route_number")),
                    "initials": _normalise_text(column.get("initials") or example.get("initials")).upper()[:20],
                    "item_category": _normalise_text(example.get("item_category")),
                    "item_detail": _normalise_text(example.get("item_detail")),
                    "quantity": _coerce_int(example.get("quantity")),
                    "raw_text": _normalise_text(example.get("raw_text")),
                }
                for augmentation in augmentation_names:
                    dataset_records_full.append(
                        {
                            "id": f"{sheet_import.id}:{row.id}:full:{augmentation}",
                            "image": variant_augmented_images["full"][augmentation],
                            "augmentation": augmentation,
                            "conversations": [
                                {
                                    "role": "user",
                                    "content": (
                                        "<image>\n"
                                        "This crop comes from a shortage sheet. "
                                        "The top strip shows the truck/route/initials header for one column. "
                                        "The lower strip shows the printed shortage row label and the handwritten quantity cell. "
                                        "Return JSON with row_key, truck_number, route_number, initials, item_category, item_detail, quantity, and raw_text."
                                    ),
                                },
                                {
                                    "role": "assistant",
                                    "content": json.dumps(assistant_payload, ensure_ascii=False),
                                },
                            ],
                        }
                    )
                    dataset_records_row.append(
                        {
                            "id": f"{sheet_import.id}:{row.id}:row:{augmentation}",
                            "image": variant_augmented_images["row"][augmentation],
                            "augmentation": augmentation,
                            "conversations": [
                                {
                                    "role": "user",
                                    "content": (
                                        "<image>\n"
                                        "This crop shows the printed shortage row label beside the handwritten shortage quantity. "
                                        "Return JSON with row_key, item_category, item_detail, quantity, and raw_text."
                                    ),
                                },
                                {
                                    "role": "assistant",
                                    "content": json.dumps(
                                        {
                                            "row_key": assistant_payload["row_key"],
                                            "item_category": assistant_payload["item_category"],
                                            "item_detail": assistant_payload["item_detail"],
                                            "quantity": assistant_payload["quantity"],
                                            "raw_text": assistant_payload["raw_text"],
                                        },
                                        ensure_ascii=False,
                                    ),
                                },
                            ],
                        }
                    )
                    dataset_records_cell.append(
                        {
                            "id": f"{sheet_import.id}:{row.id}:cell:{augmentation}",
                            "image": variant_augmented_images["cell"][augmentation],
                            "augmentation": augmentation,
                            "conversations": [
                                {
                                    "role": "user",
                                    "content": (
                                        "<image>\n"
                                        "This crop shows only the handwritten shortage quantity from one shortage-sheet cell. "
                                        "Return JSON with quantity and raw_text."
                                    ),
                                },
                                {
                                    "role": "assistant",
                                    "content": json.dumps(
                                        {
                                            "quantity": assistant_payload["quantity"],
                                            "raw_text": assistant_payload["raw_text"],
                                        },
                                        ensure_ascii=False,
                                    ),
                                },
                            ],
                        }
                    )
                    dataset_records_header.append(
                        {
                            "id": f"{sheet_import.id}:{row.id}:header:{augmentation}",
                            "image": variant_augmented_images["header"][augmentation],
                            "augmentation": augmentation,
                            "conversations": [
                                {
                                    "role": "user",
                                    "content": (
                                        "<image>\n"
                                        "This crop shows one shortage-sheet column header with handwritten truck, route, and initials. "
                                        "Return JSON with truck_number, route_number, and initials."
                                    ),
                                },
                                {
                                    "role": "assistant",
                                    "content": json.dumps(
                                        {
                                            "truck_number": assistant_payload["truck_number"],
                                            "route_number": assistant_payload["route_number"],
                                            "initials": assistant_payload["initials"],
                                        },
                                        ensure_ascii=False,
                                    ),
                                },
                            ],
                        }
                    )
                manifest_examples.append(
                    {
                        **assistant_payload,
                        "import_id": sheet_import.id,
                        "row_id": row.id,
                        "run_date": str(sheet_import.run_date),
                        "images": variant_augmented_images,
                    }
                )

        zf.writestr(
            "dataset_full.jsonl",
            "\n".join(json.dumps(record, ensure_ascii=False) for record in dataset_records_full),
        )
        zf.writestr(
            "dataset_row.jsonl",
            "\n".join(json.dumps(record, ensure_ascii=False) for record in dataset_records_row),
        )
        zf.writestr(
            "dataset_quantity.jsonl",
            "\n".join(json.dumps(record, ensure_ascii=False) for record in dataset_records_cell),
        )
        zf.writestr(
            "dataset_header.jsonl",
            "\n".join(json.dumps(record, ensure_ascii=False) for record in dataset_records_header),
        )
        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format_version": 1,
                    "generated_at": _now_utc().isoformat(),
                    "record_count": len(dataset_records_full),
                    "variant_record_counts": {
                        "full": len(dataset_records_full),
                        "row": len(dataset_records_row),
                        "quantity": len(dataset_records_cell),
                        "header": len(dataset_records_header),
                    },
                    "augmentations": augmentation_names,
                    "template_id": SHORTAGE_V1A_TEMPLATE.template_id,
                    "model_hint": _normalise_text(_app_setting_value(db, _OLLAMA_MODEL_KEY) or settings.shortage_sheet_ollama_model),
                    "notes": [
                        "dataset_full.jsonl uses header + row context for full structured extraction.",
                        "dataset_row.jsonl uses row label + cell context for row-specific extraction.",
                        "dataset_quantity.jsonl uses cell-only crops for handwritten quantity recognition.",
                        "dataset_header.jsonl uses header-only crops for truck/route/initials recognition.",
                        "Each dataset includes base, autocontrast, threshold, and ±2 degree rotation augmentations.",
                    ],
                    "examples": manifest_examples,
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

    buf.seek(0)
    return buf


def _header_ocr_training_dataset_zip(db: Session) -> io.BytesIO:
    imports = db.scalars(
        select(ShortageSheetImport)
        .options(selectinload(ShortageSheetImport.photos))
        .where(ShortageSheetImport.status.in_(["approved", "needs_review"]))
        .order_by(ShortageSheetImport.reviewed_at.desc(), ShortageSheetImport.created_at.desc())
    ).all()

    dataset_records_header: list[dict[str, object]] = []
    manifest_examples: list[dict[str, object]] = []
    image_counter = 0
    buf = io.BytesIO()
    augmentation_names = ["base", "autocontrast", "threshold", "rotate_neg2", "rotate_pos2"]

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for sheet_import in imports:
            photo_lookup = {photo.id: photo for photo in sheet_import.photos}
            for column in _normalized_header_columns(sheet_import.header_columns):
                example = _build_header_ocr_correction_example(
                    sheet_import=sheet_import,
                    column=column,
                    reviewed_by_username=sheet_import.reviewed_by_username or sheet_import.applied_by_username or "system",
                )
                if example is None:
                    continue
                source_photo_id = _normalise_text(example.get("source_photo_id"))
                column_index = _coerce_int(example.get("column_index"))
                if not source_photo_id or column_index is None:
                    continue
                photo = photo_lookup.get(source_photo_id)
                if photo is None:
                    continue
                photo_path = Path(photo.stored_path)
                if not photo_path.is_file():
                    continue
                try:
                    header_bytes = _build_header_training_crop(
                        content=photo_path.read_bytes(),
                        column_index=column_index,
                    )
                except Exception:
                    continue

                image_counter += 1
                image_base = f"header_{image_counter:04d}"
                augmented = _augment_training_variant_bytes(header_bytes)
                image_paths: dict[str, str] = {}
                for augmentation, image_bytes in augmented.items():
                    image_name = f"images/header/{augmentation}/{image_base}.png"
                    zf.writestr(image_name, image_bytes)
                    image_paths[augmentation] = image_name

                assistant_payload = {
                    "truck_number": _coerce_int(example.get("truck_number")),
                    "route_number": _coerce_int(example.get("route_number")),
                    "initials": _normalise_text(example.get("initials")).upper()[:20],
                }
                for augmentation in augmentation_names:
                    dataset_records_header.append(
                        {
                            "id": f"{sheet_import.id}:header:{column_index}:{augmentation}",
                            "image": image_paths[augmentation],
                            "augmentation": augmentation,
                            "conversations": [
                                {
                                    "role": "user",
                                    "content": (
                                        "<image>\n"
                                        "This crop shows one shortage-sheet column header with handwritten truck, route, and initials. "
                                        "Return JSON with truck_number, route_number, and initials."
                                    ),
                                },
                                {
                                    "role": "assistant",
                                    "content": json.dumps(assistant_payload, ensure_ascii=False),
                                },
                            ],
                        }
                    )
                manifest_examples.append(
                    {
                        **assistant_payload,
                        "import_id": sheet_import.id,
                        "run_date": str(sheet_import.run_date),
                        "column_index": column_index,
                        "source_photo_id": source_photo_id,
                        "images": image_paths,
                    }
                )

        zf.writestr(
            "dataset_header.jsonl",
            "\n".join(json.dumps(record, ensure_ascii=False) for record in dataset_records_header),
        )
        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format_version": 1,
                    "generated_at": _now_utc().isoformat(),
                    "record_count": len(dataset_records_header),
                    "augmentations": augmentation_names,
                    "template_id": SHORTAGE_V1A_TEMPLATE.template_id,
                    "model_hint": _normalise_text(_app_setting_value(db, _OLLAMA_MODEL_KEY) or settings.shortage_sheet_ollama_model),
                    "notes": [
                        "dataset_header.jsonl uses header-only crops for truck/route/initials recognition.",
                        "This dataset is built from separately validated header columns, independent of shortage rows.",
                    ],
                    "examples": manifest_examples,
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

    buf.seek(0)
    return buf


def _derive_row_fields(raw: dict[str, object], category_map: dict[str, str]) -> dict[str, object]:
    source_column_index = _coerce_int(raw.get("source_column_index"))
    truck_number = _coerce_int(raw.get("truck_number"))
    item_category = _normalise_text(raw.get("item_category"))
    item_detail = _normalise_text(raw.get("item_detail") or raw.get("item") or raw.get("label"))
    initials = _normalise_text(raw.get("initials")).upper()[:20]
    quantity = _coerce_int(raw.get("quantity"))
    raw_text = _normalise_text(raw.get("raw_text") or raw.get("source_text") or raw.get("text"))
    reviewer_note = _normalise_text(raw.get("reviewer_note"))
    default_review_status = "needs_review"
    review_status = _normalise_text(raw.get("review_status")).lower() or default_review_status
    if review_status not in {"needs_review", "accepted", "rejected"}:
        review_status = default_review_status
    confidence_score = _coerce_float(raw.get("confidence_score") or raw.get("confidence"))
    source_photo_id = _normalise_text(raw.get("source_photo_id")) or None

    if not item_category and item_detail:
        item_category = category_map.get(item_detail.lower(), "")

    issues = _draft_issues(
        truck_number=truck_number,
        item_category=item_category,
        quantity=quantity,
        initials=initials,
    )
    for issue in _preserved_row_review_issues_values(
        reviewer_note=reviewer_note,
        quantity=quantity,
        raw_text=raw_text,
    ):
        if issue not in issues:
            issues.append(issue)
    if review_status != "rejected" and issues:
        review_status = "needs_review"

    return {
        "truck_number": truck_number,
        "source_column_index": source_column_index,
        "item_category": item_category,
        "item_detail": item_detail,
        "quantity": quantity,
        "initials": initials,
        "raw_text": raw_text,
        "confidence_score": confidence_score,
        "issues": issues,
        "review_status": review_status,
        "reviewer_note": reviewer_note,
        "source_photo_id": source_photo_id,
    }


def _draft_issues(
    *,
    truck_number: int | None,
    item_category: str,
    quantity: int | None,
    initials: str,
) -> list[str]:
    issues: list[str] = []
    if truck_number is None:
        issues.append("Missing truck number")
    if not item_category:
        issues.append("Missing item category")
    if quantity is None or quantity < 1:
        issues.append("Missing quantity")
    if not initials:
        issues.append("Missing initials")
    return issues


def _header_column_issues(*, truck_number: int | None, route_number: int | None, initials: str) -> list[str]:
    issues: list[str] = []
    if truck_number is None:
        issues.append("Missing truck number")
    if route_number is None:
        issues.append("Missing route number")
    if not initials:
        issues.append("Missing initials")
    return issues


def _header_columns_from_extraction(columns: list[HeaderColumn], *, source_photo_id: str | None = None) -> list[dict[str, object]]:
    column_lookup = {column.column_index: column for column in columns}
    results: list[dict[str, object]] = []
    for column_index in range(1, _HEADER_COLUMN_COUNT + 1):
        column = column_lookup.get(column_index)
        truck_number = column.truck_number if column else None
        route_number = column.route_number if column else None
        initials = column.initials if column else ""
        issues = _header_column_issues(truck_number=truck_number, route_number=route_number, initials=initials)
        results.append(
            {
                "column_index": column_index,
                "truck_number": truck_number,
                "route_number": route_number,
                "initials": initials,
                "confidence_score": column.confidence if column else None,
                "issues": issues,
                "review_status": "needs_review" if issues else "accepted",
                "reviewer_note": "",
                "source_photo_id": source_photo_id,
            }
        )
    return results


def _normalized_header_columns(raw_columns: object) -> list[dict[str, object]]:
    default_columns = _header_columns_from_extraction([], source_photo_id=None)
    normalized: list[dict[str, object]] = []
    if isinstance(raw_columns, list):
        for raw in raw_columns:
            if not isinstance(raw, dict):
                continue
            column_index = _coerce_int(raw.get("column_index"))
            if column_index is None:
                continue
            truck_number = _coerce_int(raw.get("truck_number"))
            route_number = _coerce_int(raw.get("route_number"))
            initials = _normalise_text(raw.get("initials")).upper()[:20]
            issues = _header_column_issues(truck_number=truck_number, route_number=route_number, initials=initials)
            review_status = _normalise_text(raw.get("review_status")).lower() or ("needs_review" if issues else "accepted")
            if review_status not in {"needs_review", "accepted", "rejected"}:
                review_status = "needs_review" if issues else "accepted"
            reviewer_note = _normalise_text(raw.get("reviewer_note"))
            normalized.append(
                {
                    "column_index": column_index,
                    "truck_number": truck_number,
                    "route_number": route_number,
                    "initials": initials,
                    "confidence_score": _coerce_float(raw.get("confidence_score") or raw.get("confidence")),
                    "issues": issues,
                    "review_status": review_status,
                    "reviewer_note": reviewer_note,
                    "source_photo_id": _normalise_text(raw.get("source_photo_id")) or None,
                }
            )
    existing = {int(column["column_index"]): column for column in normalized}
    result: list[dict[str, object]] = []
    for column_index in range(1, _HEADER_COLUMN_COUNT + 1):
        result.append(existing.get(column_index, default_columns[column_index - 1]))
    return result


def _column_lookup(sheet_import: ShortageSheetImport) -> dict[int, dict[str, object]]:
    return {
        int(column.get("column_index")): column
        for column in _normalized_header_columns(sheet_import.header_columns)
        if isinstance(column, dict) and _coerce_int(column.get("column_index")) is not None
    }


def _recompute_row_issues(row: ShortageSheetRowDraft) -> list[str]:
    return _draft_issues(
        truck_number=row.truck_number,
        item_category=row.item_category,
        quantity=row.quantity,
        initials=row.initials,
    )


def _preserved_row_review_issues_values(
    *,
    reviewer_note: str,
    quantity: int | None,
    raw_text: str,
) -> list[str]:
    issues: list[str] = []
    reviewer_note_normalized = _normalise_text(reviewer_note).lower()
    if "source=rowwise_ocr" in reviewer_note_normalized or "source=body_ocr" in reviewer_note_normalized:
        issues.append("OCR row needs verification")
    if "source=banded_ocr" in reviewer_note_normalized:
        issues.append("Banded OCR needs verification")
    if quantity is None and _normalise_text(raw_text):
        issues.append("Unclear handwritten quantity")
    return issues


def _preserved_row_review_issues(row: ShortageSheetRowDraft) -> list[str]:
    return _preserved_row_review_issues_values(
        reviewer_note=row.reviewer_note,
        quantity=row.quantity,
        raw_text=row.raw_text,
    )


def _row_is_ocr_origin(reviewer_note: str) -> bool:
    note = _normalise_text(reviewer_note).lower()
    return "source=rowwise_ocr" in note or "source=body_ocr" in note or "source=banded_ocr" in note


def _row_has_human_review_marker(reviewer_note: str) -> bool:
    return "reviewed=human" in _normalise_text(reviewer_note).lower()


def _append_human_review_marker(reviewer_note: str, username: str) -> str:
    note = _normalise_text(reviewer_note)
    if _row_has_human_review_marker(note):
        return note
    marker = f"reviewed=human; reviewed_by={_normalise_text(username).lower() or 'user'}"
    return f"{note}; {marker}".strip("; ")


def _effective_row_confidence(row: ShortageSheetRowDraft) -> float | None:
    if row.confidence_score is None:
        return None
    if _row_is_ocr_origin(row.reviewer_note) and not _row_has_human_review_marker(row.reviewer_note):
        return None
    return row.confidence_score


def _sync_row_from_header_lookup(row: ShortageSheetRowDraft, lookup: dict[int, dict[str, object]]) -> None:
    if _row_is_ocr_origin(row.reviewer_note) and not _row_has_human_review_marker(row.reviewer_note) and row.review_status != "rejected":
        row.review_status = "needs_review"
    if row.source_column_index is None:
        row.issues = _recompute_row_issues(row) + [
            issue for issue in _preserved_row_review_issues(row) if issue not in _recompute_row_issues(row)
        ]
        row.review_status = "needs_review" if row.issues and row.review_status != "rejected" else row.review_status
        return
    column = lookup.get(row.source_column_index)
    if column is None:
        row.issues = _recompute_row_issues(row) + [
            issue for issue in _preserved_row_review_issues(row) if issue not in _recompute_row_issues(row)
        ]
        row.review_status = "needs_review" if row.issues and row.review_status != "rejected" else row.review_status
        return
    row.truck_number = _coerce_int(column.get("truck_number"))
    row.initials = _normalise_text(column.get("initials")).upper()[:20]
    base_issues = _recompute_row_issues(row)
    preserved_issues = _preserved_row_review_issues(row)
    row.issues = base_issues + [issue for issue in preserved_issues if issue not in base_issues]
    if row.review_status != "rejected":
        row.review_status = "needs_review" if row.issues or row.review_status != "accepted" else "accepted"


def _sync_rows_from_header_columns(sheet_import: ShortageSheetImport) -> None:
    lookup = _column_lookup(sheet_import)
    for row in sheet_import.rows:
        _sync_row_from_header_lookup(row, lookup)


def _refresh_import_runtime_state(sheet_import: ShortageSheetImport) -> None:
    _sync_rows_from_header_columns(sheet_import)


def _header_columns_with_row_state(sheet_import: ShortageSheetImport) -> list[dict[str, object]]:
    columns = _normalized_header_columns(sheet_import.header_columns)
    rows_by_column: dict[int, list[ShortageSheetRowDraft]] = {}
    for row in sheet_import.rows:
        if row.source_column_index is None or row.review_status == "rejected":
            continue
        rows_by_column.setdefault(int(row.source_column_index), []).append(row)
    for column in columns:
        column_index = _coerce_int(column.get("column_index"))
        if column_index is None:
            continue
        column_rows = rows_by_column.get(column_index, [])
        if any(row.review_status == "needs_review" for row in column_rows):
            issues = list(column.get("issues") or [])
            if "Attached rows need review" not in issues:
                issues.append("Attached rows need review")
            column["issues"] = issues
            if _normalise_text(column.get("review_status")).lower() != "rejected":
                column["review_status"] = "needs_review"
    return columns


def _header_column_blockers(sheet_import: ShortageSheetImport) -> list[str]:
    columns = _column_lookup(sheet_import)
    blockers: list[str] = []
    active_column_indexes = sorted(
        {
            int(row.source_column_index)
            for row in sheet_import.rows
            if row.source_column_index is not None and row.review_status != "rejected"
        }
    )
    for column_index in active_column_indexes:
        column = columns.get(column_index)
        if column is None:
            blockers.append(f"Column {column_index}: Missing column data")
            continue
        issues = _header_column_issues(
            truck_number=_coerce_int(column.get("truck_number")),
            route_number=_coerce_int(column.get("route_number")),
            initials=_normalise_text(column.get("initials")).upper()[:20],
        )
        review_status = _normalise_text(column.get("review_status")).lower()
        if review_status == "rejected":
            blockers.append(f"Column {column_index}: Rejected")
            continue
        if review_status == "needs_review":
            blockers.append(f"Column {column_index}: Needs review")
        blockers.extend(f"Column {column_index}: {issue}" for issue in issues)
    return blockers


def _ensure_import_editable(sheet_import: ShortageSheetImport) -> None:
    if sheet_import.status not in _IMPORT_EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Import is already {sheet_import.status}",
        )


def _template_catalog() -> list[ShortageSheetTemplateOut]:
    return [ShortageSheetTemplateOut.model_validate(shortage_template_payload(SHORTAGE_V1A_TEMPLATE))]


def _serialize_import(sheet_import: ShortageSheetImport) -> dict[str, object]:
    _refresh_import_runtime_state(sheet_import)
    row_count = len(sheet_import.rows)
    photo_count = len(sheet_import.photos)
    needs_review_count = sum(1 for row in sheet_import.rows if row.review_status == "needs_review")
    return {
        "id": sheet_import.id,
        "run_date": sheet_import.run_date,
        "status": sheet_import.status,
        "extraction_mode": sheet_import.extraction_mode,
        "sheet_template_id": sheet_import.sheet_template_id,
        "uploaded_by_user_id": sheet_import.uploaded_by_user_id,
        "uploaded_by_username": sheet_import.uploaded_by_username,
        "reviewed_by_username": sheet_import.reviewed_by_username,
        "applied_by_username": sheet_import.applied_by_username,
        "error_message": sheet_import.error_message,
        "created_at": sheet_import.created_at,
        "updated_at": sheet_import.updated_at,
        "reviewed_at": sheet_import.reviewed_at,
        "applied_at": sheet_import.applied_at,
        "photo_count": photo_count,
        "row_count": row_count,
        "needs_review_count": needs_review_count,
    }


def _serialize_import_detail(sheet_import: ShortageSheetImport) -> ShortageSheetImportDetailOut:
    payload = _serialize_import(sheet_import)
    payload["photos"] = [ShortageSheetPhotoOut.model_validate(photo).model_dump() for photo in sheet_import.photos]
    payload["header_columns"] = [
        ShortageSheetColumnDraftOut.model_validate(column).model_dump()
        for column in _header_columns_with_row_state(sheet_import)
    ]
    serialized_rows: list[dict[str, object]] = []
    for row in sheet_import.rows:
        row_payload = ShortageSheetRowDraftOut.model_validate(row).model_dump()
        if _row_is_ocr_origin(row.reviewer_note) and not _row_has_human_review_marker(row.reviewer_note) and row_payload["review_status"] != "rejected":
            row_payload["review_status"] = "needs_review"
        row_payload["confidence_score"] = _effective_row_confidence(row)
        serialized_rows.append(row_payload)
    payload["rows"] = serialized_rows
    return ShortageSheetImportDetailOut.model_validate(payload)


def _get_import_or_404(import_id: str, db: Session) -> ShortageSheetImport:
    sheet_import = db.scalar(
        select(ShortageSheetImport)
        .options(
            selectinload(ShortageSheetImport.photos),
            selectinload(ShortageSheetImport.rows),
        )
        .where(ShortageSheetImport.id == import_id)
    )
    if sheet_import is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shortage-sheet import not found")
    return sheet_import


@router.get("/templates", response_model=list[ShortageSheetTemplateOut])
def list_shortage_sheet_templates(
    _user: User = Depends(require_shorts_access),
):
    return _template_catalog()


@router.get("/ollama/health", response_model=ShortageSheetOllamaStatusOut)
def get_shortage_sheet_ollama_status(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return ShortageSheetOllamaStatusOut.model_validate(_probe_ollama(_runtime_ollama_config(db)))


@router.post("/ollama/test", response_model=ShortageSheetOllamaStatusOut)
def test_shortage_sheet_ollama_status(
    payload: ShortageSheetOllamaProbeIn,
    _user: User = Depends(require_admin),
):
    config = _ollama_config_from_values(
        base_url=payload.base_url,
        model=payload.model,
        timeout_seconds=payload.timeout_seconds,
        low_confidence_threshold=payload.low_confidence_threshold,
        preprocess_max_image_side=payload.preprocess_max_image_side,
    )
    return ShortageSheetOllamaStatusOut.model_validate(_probe_ollama(config))


@router.get("/ocr-memory/status", response_model=ShortageSheetOcrMemoryStatusOut)
def get_shortage_sheet_ocr_memory_status(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    return ShortageSheetOcrMemoryStatusOut.model_validate(_ocr_memory_status_payload(db))


@router.get("/ocr-memory/export")
def export_shortage_sheet_ocr_memory(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    payload = _ocr_training_export_payload(db)
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": 'attachment; filename="shortage-sheet-ocr-training-export.json"'},
    )


@router.get("/ocr-memory/header-export")
def export_shortage_sheet_header_ocr_memory(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    payload = _header_ocr_training_export_payload(db)
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": 'attachment; filename="shortage-sheet-ocr-header-training-export.json"'},
    )


@router.get("/ocr-memory/dataset.zip")
def export_shortage_sheet_ocr_dataset(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    payload = _shortage_sheet_training_dataset_zip(db)
    return StreamingResponse(
        payload,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="shortage-sheet-ocr-dataset.zip"'},
    )


@router.get("/ocr-memory/header-dataset.zip")
def export_shortage_sheet_header_ocr_dataset(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    payload = _header_ocr_training_dataset_zip(db)
    return StreamingResponse(
        payload,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="shortage-sheet-ocr-header-dataset.zip"'},
    )


@router.get("", response_model=list[ShortageSheetImportOut])
def list_shortage_sheet_imports(
    run_date: date | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    query = (
        select(ShortageSheetImport)
        .options(
            selectinload(ShortageSheetImport.photos),
            selectinload(ShortageSheetImport.rows),
        )
        .order_by(ShortageSheetImport.created_at.desc())
    )
    if run_date is not None:
        query = query.where(ShortageSheetImport.run_date == run_date)
    if status_filter:
        query = query.where(ShortageSheetImport.status == status_filter)
    rows = db.scalars(query).all()
    return [ShortageSheetImportOut.model_validate(_serialize_import(row)) for row in rows]


@router.post("", response_model=ShortageSheetImportDetailOut, status_code=status.HTTP_201_CREATED)
async def create_shortage_sheet_import(
    run_date: date = Form(...),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shorts_access),
):
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one photo is required")

    uploads: list[tuple[UploadFile, bytes, str]] = []
    for file in files:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file upload")
        if len(content) > _MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{file.filename or 'file'} exceeds {_MAX_PHOTO_BYTES // (1024 * 1024)} MB limit",
            )
        mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
        if mime not in _ALLOWED_PHOTO_MIME:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=f"Unsupported mime: {mime}")
        uploads.append((file, content, mime))

    ollama_config = _runtime_ollama_config(db)
    import_id = uuid.uuid4().hex
    sheet_import = ShortageSheetImport(
        id=import_id,
        run_date=run_date,
        status="processing",
        extraction_mode="ollama" if bool(ollama_config["configured"]) else "manual",
        sheet_template_id=SHORTAGE_V1A_TEMPLATE.template_id,
        uploaded_by_user_id=current_user.id,
        uploaded_by_username=current_user.username,
    )
    db.add(sheet_import)

    day_dir = _PHOTO_ROOT / run_date.isoformat() / import_id
    day_dir.mkdir(parents=True, exist_ok=True)

    photo_rows: list[ShortageSheetPhoto] = []
    for upload_file, content, mime in uploads:
        photo_id = uuid.uuid4().hex
        ext = Path(upload_file.filename or "").suffix.lower() or mimetypes.guess_extension(mime) or ".bin"
        dest = day_dir / f"{photo_id}{ext}"
        dest.write_bytes(content)
        photo_rows.append(
            ShortageSheetPhoto(
                id=photo_id,
                import_id=import_id,
                file_name=upload_file.filename or f"{photo_id}{ext}",
                stored_path=str(dest),
                mime_type=mime,
                size_bytes=len(content),
            )
        )

    db.add_all(photo_rows)
    db.flush()

    errors: list[str] = []
    next_row_index = 0
    created_rows: list[ShortageSheetRowDraft] = []
    correction_examples = _load_or_seed_ocr_correction_memory(db)
    header_correction_examples = _load_or_seed_header_ocr_correction_memory(db)

    if bool(ollama_config["configured"]):
        content_by_photo_id = {photo.id: uploads[index][1] for index, photo in enumerate(photo_rows)}
        for photo in photo_rows:
            try:
                # The LLM/OCR pipeline makes several sequential blocking HTTP
                # calls to Ollama (up to timeout_seconds each). Run it in a
                # worker thread so a single photo upload doesn't stall the event
                # loop — and thus the board, chat, and websockets — for every
                # other connected client. DB work stays on the main thread
                # (the SQLAlchemy session is not thread-safe to share).
                extracted_rows, extraction_notes, extracted_columns = await asyncio.to_thread(
                    extract_shortage_rows_with_llm,
                    content=content_by_photo_id[photo.id],
                    file_name=photo.file_name,
                    source_photo_id=photo.id,
                    base_url=str(ollama_config["base_url"]),
                    model=str(ollama_config["model"]),
                    timeout_seconds=int(ollama_config["timeout_seconds"]),
                    low_confidence_threshold=float(ollama_config["low_confidence_threshold"]),
                    preprocess_max_image_side=int(ollama_config["preprocess_max_image_side"]),
                    template=SHORTAGE_V1A_TEMPLATE,
                    correction_examples=correction_examples,
                    header_correction_examples=header_correction_examples,
                )
            except UnidentifiedImageError:
                extracted_rows = []
                extraction_notes = [
                    f"{photo.file_name}: this image format could not be decoded for OCR on the server. "
                    "Upload JPG/PNG or add rows manually."
                ]
                extracted_columns = []
            except Exception as exc:
                extracted_rows = []
                extraction_notes = [f"{photo.file_name}: OCR extraction failed ({exc})"]
                extracted_columns = []
            if not sheet_import.header_columns and extracted_columns:
                sheet_import.header_columns = _header_columns_from_extraction(extracted_columns, source_photo_id=photo.id)
            errors.extend(extraction_notes)
            for raw_row in extracted_rows:
                row = ShortageSheetRowDraft(
                    import_id=import_id,
                    source_photo_id=photo.id,
                    source_column_index=_coerce_int(raw_row.get("column_index")),
                    row_index=next_row_index,
                    truck_number=raw_row["truck_number"],
                    item_category=str(raw_row["item_category"]),
                    item_detail=str(raw_row["item_detail"]),
                    quantity=raw_row["quantity"],
                    initials=str(raw_row["initials"]),
                    raw_text=str(raw_row["raw_text"]),
                    confidence_score=raw_row["confidence_score"],
                    issues=list(raw_row["issues"]),
                    review_status=str(raw_row["review_status"]),
                    reviewer_note=str(raw_row["reviewer_note"]),
                )
                sheet_import.rows.append(row)
                created_rows.append(row)
                next_row_index += 1
        if next_row_index == 0 and not errors:
            errors.append("No shortage entries were detected from the uploaded photos.")

    if not sheet_import.header_columns:
        source_photo_id = photo_rows[0].id if photo_rows else None
        sheet_import.header_columns = _header_columns_from_extraction([], source_photo_id=source_photo_id)
    lookup = _column_lookup(sheet_import)
    for row in created_rows:
        _sync_row_from_header_lookup(row, lookup)
    _sync_rows_from_header_columns(sheet_import)

    sheet_import.status = "needs_review"
    sheet_import.error_message = "\n".join(errors)
    db.commit()
    db.refresh(sheet_import)
    return _serialize_import_detail(_get_import_or_404(import_id, db))


@router.get("/{import_id}", response_model=ShortageSheetImportDetailOut)
def get_shortage_sheet_import(
    import_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    return _serialize_import_detail(_get_import_or_404(import_id, db))


@router.get("/photos/{photo_id}/file")
def download_shortage_sheet_photo(
    photo_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    row = db.get(ShortageSheetPhoto, photo_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    path = Path(row.stored_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored file missing")
    return FileResponse(path, media_type=row.mime_type, filename=row.file_name)


@router.post("/{import_id}/rows", response_model=ShortageSheetRowDraftOut, status_code=status.HTTP_201_CREATED)
def create_shortage_sheet_row(
    import_id: str,
    payload: ShortageSheetRowDraftCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    sheet_import = _get_import_or_404(import_id, db)
    _ensure_import_editable(sheet_import)

    category_map = _tracked_item_category_map(db)
    normalized = _derive_row_fields(payload.model_dump(), category_map)
    row = ShortageSheetRowDraft(
        import_id=import_id,
        source_photo_id=normalized["source_photo_id"],
        source_column_index=normalized["source_column_index"],
        row_index=max((draft.row_index for draft in sheet_import.rows), default=-1) + 1,
        truck_number=normalized["truck_number"],
        item_category=str(normalized["item_category"]),
        item_detail=str(normalized["item_detail"]),
        quantity=normalized["quantity"],
        initials=str(normalized["initials"]),
        raw_text=str(normalized["raw_text"]),
        confidence_score=normalized["confidence_score"],
        issues=list(normalized["issues"]),
        review_status=str(normalized["review_status"]),
        reviewer_note=str(normalized["reviewer_note"]),
    )
    db.add(row)
    db.flush()
    _sync_row_from_header_lookup(row, _column_lookup(sheet_import))
    _sync_rows_from_header_columns(sheet_import)
    _remember_ocr_correction_example(
        db=db,
        sheet_import=sheet_import,
        row=row,
        reviewed_by_username=_user.username,
    )
    sheet_import.status = "needs_review"
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{import_id}/rows/{row_id}", response_model=ShortageSheetRowDraftOut)
def update_shortage_sheet_row(
    import_id: str,
    row_id: int,
    payload: ShortageSheetRowDraftUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    sheet_import = _get_import_or_404(import_id, db)
    _ensure_import_editable(sheet_import)

    row = db.get(ShortageSheetRowDraft, row_id)
    if row is None or row.import_id != import_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft row not found")

    current = {
        "truck_number": row.truck_number,
        "source_column_index": row.source_column_index,
        "item_category": row.item_category,
        "item_detail": row.item_detail,
        "quantity": row.quantity,
        "initials": row.initials,
        "raw_text": row.raw_text,
        "review_status": row.review_status,
        "reviewer_note": row.reviewer_note,
        "confidence_score": row.confidence_score,
        "source_photo_id": row.source_photo_id,
    }
    current.update(payload.model_dump(exclude_unset=True))
    if payload.model_dump(exclude_unset=True):
        current["reviewer_note"] = _append_human_review_marker(
            _normalise_text(current.get("reviewer_note")),
            _user.username,
        )
    normalized = _derive_row_fields(current, _tracked_item_category_map(db))

    row.source_photo_id = normalized["source_photo_id"]
    row.source_column_index = _coerce_int(current.get("source_column_index"))
    row.truck_number = normalized["truck_number"]
    row.item_category = str(normalized["item_category"])
    row.item_detail = str(normalized["item_detail"])
    row.quantity = normalized["quantity"]
    row.initials = str(normalized["initials"])
    row.raw_text = str(normalized["raw_text"])
    row.confidence_score = normalized["confidence_score"]
    row.issues = list(normalized["issues"])
    row.review_status = str(normalized["review_status"])
    row.reviewer_note = str(normalized["reviewer_note"])
    _sync_row_from_header_lookup(row, _column_lookup(sheet_import))
    _sync_rows_from_header_columns(sheet_import)
    _remember_ocr_correction_example(
        db=db,
        sheet_import=sheet_import,
        row=row,
        reviewed_by_username=_user.username,
    )
    sheet_import.status = "needs_review"
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{import_id}/columns/{column_index}", response_model=ShortageSheetImportDetailOut)
def update_shortage_sheet_column(
    import_id: str,
    column_index: int,
    payload: ShortageSheetColumnDraftUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    if column_index < 1 or column_index > _HEADER_COLUMN_COUNT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Column index out of range")
    sheet_import = _get_import_or_404(import_id, db)
    _ensure_import_editable(sheet_import)

    columns = _normalized_header_columns(sheet_import.header_columns)
    current = columns[column_index - 1]
    changes = payload.model_dump(exclude_unset=True)
    if "truck_number" in changes:
        current["truck_number"] = _coerce_int(changes.get("truck_number"))
    if "route_number" in changes:
        current["route_number"] = _coerce_int(changes.get("route_number"))
    if "initials" in changes:
        current["initials"] = _normalise_text(changes.get("initials")).upper()[:20]
    if "source_photo_id" in changes:
        current["source_photo_id"] = _normalise_text(changes.get("source_photo_id")) or None
    if "reviewer_note" in changes:
        current["reviewer_note"] = _normalise_text(changes.get("reviewer_note"))
    if changes:
        current["reviewer_note"] = _append_human_review_marker(
            _normalise_text(current.get("reviewer_note")),
            _user.username,
        )
    current["issues"] = _header_column_issues(
        truck_number=_coerce_int(current.get("truck_number")),
        route_number=_coerce_int(current.get("route_number")),
        initials=_normalise_text(current.get("initials")).upper()[:20],
    )
    requested_status = _normalise_text(changes.get("review_status")).lower() if "review_status" in changes else ""
    if requested_status in {"needs_review", "accepted", "rejected"}:
        current["review_status"] = requested_status
    else:
        current["review_status"] = "needs_review" if current["issues"] else "accepted"
    if current["review_status"] == "accepted" and current["issues"]:
        current["review_status"] = "needs_review"

    columns[column_index - 1] = current
    sheet_import.header_columns = columns
    _sync_rows_from_header_columns(sheet_import)
    _remember_header_ocr_correction_example(
        db=db,
        sheet_import=sheet_import,
        column=current,
        reviewed_by_username=_user.username,
    )
    sheet_import.status = "needs_review"
    db.commit()
    return _serialize_import_detail(_get_import_or_404(import_id, db))


@router.delete("/{import_id}/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shortage_sheet_row(
    import_id: str,
    row_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    sheet_import = _get_import_or_404(import_id, db)
    _ensure_import_editable(sheet_import)
    row = db.get(ShortageSheetRowDraft, row_id)
    if row is None or row.import_id != import_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft row not found")
    db.delete(row)
    sheet_import.status = "needs_review"
    db.commit()


@router.delete("/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shortage_sheet_import(
    import_id: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_shorts_access),
):
    sheet_import = _get_import_or_404(import_id, db)

    photo_paths = [Path(photo.stored_path) for photo in sheet_import.photos]
    import_dirs = {path.parent for path in photo_paths}

    db.delete(sheet_import)
    db.commit()

    for path in photo_paths:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
    for directory in sorted(import_dirs, key=lambda item: len(str(item)), reverse=True):
        try:
            if directory.exists():
                shutil.rmtree(directory)
        except Exception:
            pass


@router.post("/{import_id}/approve", response_model=ShortageSheetImportDetailOut)
async def approve_shortage_sheet_import(
    import_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shorts_access),
):
    sheet_import = _get_import_or_404(import_id, db)
    _ensure_import_editable(sheet_import)

    live_rows: list[Shortage] = []
    blockers: list[str] = _header_column_blockers(sheet_import)
    for row in sheet_import.rows:
        if row.review_status == "rejected":
            continue
        issues = _draft_issues(
            truck_number=row.truck_number,
            item_category=row.item_category,
            quantity=row.quantity,
            initials=row.initials,
        )
        if issues or row.review_status == "needs_review":
            prefix = f"Row {row.id}"
            blockers.extend(f"{prefix}: {issue}" for issue in issues or ["Needs review"])
            continue
        live_rows.append(
            Shortage(
                truck_number=row.truck_number or 0,
                run_date=sheet_import.run_date,
                item_category=row.item_category,
                item_detail=row.item_detail,
                quantity=row.quantity or 1,
                initials=row.initials,
            )
        )

    if blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Resolve or reject all incomplete draft rows before import.", "blockers": blockers},
        )
    if not live_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No accepted draft rows are available to import",
        )

    db.add_all(live_rows)
    now = _now_utc()
    _remember_import_ocr_corrections(
        db=db,
        sheet_import=sheet_import,
        reviewed_by_username=current_user.username,
    )
    _remember_import_header_ocr_corrections(
        db=db,
        sheet_import=sheet_import,
        reviewed_by_username=current_user.username,
    )
    sheet_import.status = "approved"
    sheet_import.reviewed_by_username = current_user.username
    sheet_import.applied_by_username = current_user.username
    sheet_import.reviewed_at = now
    sheet_import.applied_at = now
    sheet_import.error_message = ""
    db.commit()
    await manager.broadcast({"type": "shortage_updated", "run_date": str(sheet_import.run_date)})
    return _serialize_import_detail(_get_import_or_404(import_id, db))


@router.post("/{import_id}/reject", response_model=ShortageSheetImportDetailOut)
def reject_shortage_sheet_import(
    import_id: str,
    payload: ShortageSheetImportReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shorts_access),
):
    sheet_import = _get_import_or_404(import_id, db)
    _ensure_import_editable(sheet_import)
    sheet_import.status = "rejected"
    sheet_import.reviewed_by_username = current_user.username
    sheet_import.reviewed_at = _now_utc()
    sheet_import.error_message = _normalise_text(payload.reason)
    db.commit()
    return _serialize_import_detail(_get_import_or_404(import_id, db))
