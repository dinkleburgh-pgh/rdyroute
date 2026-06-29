import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import ConfirmDialog from "../ConfirmDialog";
import { formatRunDate } from "../../utils/dates";
import {
  shortageSheetOcrDatasetExportUrl,
  shortageSheetOcrHeaderDatasetExportUrl,
  shortageSheetOcrHeaderMemoryExportUrl,
  shortageSheetOcrMemoryExportUrl,
  shortageSheetPhotoFileUrl,
  useApproveShortageSheetImport,
  useCreateShortageSheetImport,
  useDeleteShortageSheetImport,
  useCreateShortageSheetRow,
  useDeleteShortageSheetRow,
  useRejectShortageSheetImport,
  useShortageSheetImport,
  useShortageSheetImports,
  useShortageSheetOcrMemoryStatus,
  useShortageSheetTemplates,
  useUpdateShortageSheetColumn,
  useUpdateShortageSheetRow,
} from "../../api/hooks";
import { api, todayIso } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import type { AuthRole, ShortageSheetColumnDraft, ShortageSheetPhoto, ShortageSheetRowDraft, ShortageSheetRowReviewStatus, ShortageSheetTemplate as ShortageSheetTemplateDef } from "../../types";

interface ShortageImportPanelProps {
  defaultRunDate?: string;
  lockedRunDate?: boolean;
  title?: string;
  compact?: boolean;
}

type UploadPhase = "idle" | "preparing" | "uploading" | "processing" | "success" | "error";
type ConfirmState =
  | null
  | { kind: "rejectImport" }
  | { kind: "deleteImport"; description: string }
  | { kind: "deleteRow"; rowId: number; label: string };

function parseError(err: unknown): string {
  const maybe = err as {
    response?: { data?: { detail?: string | { message?: string; blockers?: string[] } } };
    message?: string;
  };
  const detail = maybe.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const blockers = Array.isArray(detail.blockers) ? detail.blockers.slice(0, 3).join("; ") : "";
    return [detail.message, blockers].filter(Boolean).join(" — ") || maybe.message || "Request failed";
  }
  return maybe.message || "Request failed";
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
      return "bg-emerald-950/60 text-emerald-300 ring-emerald-700/50";
    case "rejected":
      return "bg-red-950/60 text-red-300 ring-red-700/50";
    case "processing":
      return "bg-blue-950/60 text-blue-300 ring-blue-700/50";
    case "failed":
      return "bg-rose-950/60 text-rose-300 ring-rose-700/50";
    default:
      return "bg-amber-950/60 text-amber-300 ring-amber-700/50";
  }
}

function rowDisplayLabel(row: ShortageSheetRowDraft): string {
  const category = row.item_category.trim();
  const detail = row.item_detail.trim();
  if (category && detail) return `${category} · ${detail}`;
  return category || detail || "Unlabeled import";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function templateCategoryOptions(template: ShortageSheetTemplateDef | null): string[] {
  return uniqueStrings((template?.rows ?? []).map((row) => row.item_category)).sort((a, b) => a.localeCompare(b));
}

function templateDetailOptions(template: ShortageSheetTemplateDef | null, category: string): string[] {
  return uniqueStrings(
    (template?.rows ?? [])
      .filter((row) => row.item_category === category)
      .map((row) => row.item_detail),
  ).sort((a, b) => a.localeCompare(b));
}

function mergeCurrentOption(options: string[], currentValue: string): string[] {
  if (!currentValue || options.includes(currentValue)) return options;
  return [currentValue, ...options];
}

function formatColumnLabel(column: ShortageSheetColumnDraft): string {
  const parts = [`Column ${column.column_index}`];
  if (column.truck_number != null) parts.push(`Truck ${column.truck_number}`);
  if (column.route_number != null) parts.push(`Route ${column.route_number}`);
  return parts.join(" · ");
}

function InlineRowReview({
  row,
  disabled,
  expanded,
  onToggleExpanded,
  onSave,
  onDelete,
}: {
  row: ShortageSheetRowDraft;
  disabled: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSave: (payload: {
    rowId: number;
    quantity?: number | null;
    review_status?: ShortageSheetRowReviewStatus;
  }) => void;
  onDelete: (rowId: number) => void;
}) {
  const [quantity, setQuantity] = useState(row.quantity == null ? "" : String(row.quantity));

  useEffect(() => {
    setQuantity(row.quantity == null ? "" : String(row.quantity));
  }, [row.id, row.quantity]);

  const parsedQuantity = quantity.trim() ? Number(quantity) : null;
  const quantityChanged = (row.quantity == null ? "" : String(row.quantity)) !== quantity;
  const canAccept = quantity.trim().length > 0 && Number.isFinite(parsedQuantity);

  const saveQuantityOnly = () =>
    onSave({
      rowId: row.id,
      quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : null,
    });

  const saveWithStatus = (reviewStatus: ShortageSheetRowReviewStatus) =>
    onSave({
      rowId: row.id,
      quantity: Number.isFinite(parsedQuantity) ? parsedQuantity : null,
      review_status: reviewStatus,
    });

  return (
    <div className="px-3 py-2 text-sm text-slate-300">
      <div className="space-y-3 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">#{row.row_index + 1}</span>
              <span
                className={clsx(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                  statusBadgeClass(row.review_status),
                )}
              >
                {row.review_status.replace("_", " ")}
              </span>
              {row.confidence_score != null && (
                <span className="text-[11px] text-slate-500">{Math.round(row.confidence_score * 100)}%</span>
              )}
            </div>
            <p className="mt-1 break-words font-medium leading-5 text-slate-200">{rowDisplayLabel(row)}</p>
            <p className="mt-1 break-words text-[11px] leading-4 text-slate-500">{row.raw_text || "No raw text"}</p>
          </div>
        </div>
        <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Qty</p>
            <input
              className="input h-9 px-2 py-1 text-center text-sm"
              inputMode="numeric"
              placeholder="Qty"
              value={quantity}
              disabled={disabled}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quantityChanged && !disabled) {
                  saveQuantityOnly();
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost h-7 w-full px-2 py-1 text-[11px]"
              disabled={disabled || !quantityChanged}
              onClick={saveQuantityOnly}
            >
              Save qty
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !canAccept}
                onClick={() => saveWithStatus("accepted")}
              >
                Accept
              </button>
              <button
                type="button"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => saveWithStatus("rejected")}
              >
                Reject
              </button>
              <button type="button" className="btn-ghost h-7 px-2.5 py-1 text-[11px]" disabled={disabled} onClick={onToggleExpanded}>
                {expanded ? "Hide details" : "Edit details"}
              </button>
              <button
                type="button"
                className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-200 transition hover:border-red-400/60 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => onDelete(row.id)}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="hidden gap-2 md:grid md:grid-cols-[64px_minmax(0,1fr)_84px_164px]">
        <span className="pt-1 text-slate-500">#{row.row_index + 1}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-slate-200">{rowDisplayLabel(row)}</p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                statusBadgeClass(row.review_status),
              )}
            >
              {row.review_status.replace("_", " ")}
            </span>
            {row.confidence_score != null && (
              <span className="text-[11px] text-slate-500">{Math.round(row.confidence_score * 100)}%</span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-500">{row.raw_text || "No raw text"}</p>
        </div>
        <div className="space-y-1">
          <input
            className="input h-8 px-2 py-1 text-center text-sm"
            inputMode="numeric"
            placeholder="Qty"
            value={quantity}
            disabled={disabled}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && quantityChanged && !disabled) {
                saveQuantityOnly();
              }
            }}
          />
          <button
            type="button"
            className="btn-ghost h-7 w-full px-2 py-1 text-[11px]"
            disabled={disabled || !quantityChanged}
            onClick={saveQuantityOnly}
          >
            Save qty
          </button>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-1.5">
          <button
            type="button"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !canAccept}
            onClick={() => saveWithStatus("accepted")}
          >
            Accept
          </button>
          <button
            type="button"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => saveWithStatus("rejected")}
          >
            Reject
          </button>
          <button type="button" className="btn-ghost h-7 px-2 py-1 text-[11px]" disabled={disabled} onClick={onToggleExpanded}>
            {expanded ? "Hide details" : "Edit details"}
          </button>
          <button
            type="button"
            className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-200 transition hover:border-red-400/60 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onDelete(row.id)}
          >
            Remove
          </button>
        </div>
      </div>
      {row.issues.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 md:pl-[66px]">
          {row.issues.map((issue) => (
            <span key={`${row.id}-${issue}`} className="rounded-full bg-amber-950/60 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-800/50">
              {issue}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnDraftCard({
  column,
  rows,
  photos,
  disabled,
  createPending,
  template,
  fallbackInitials,
  onSave,
  onCreateRow,
  onRowSave,
  onRowDelete,
}: {
  column: ShortageSheetColumnDraft;
  rows: ShortageSheetRowDraft[];
  photos: ShortageSheetPhoto[];
  disabled: boolean;
  createPending: boolean;
  template: ShortageSheetTemplateDef | null;
  fallbackInitials: string;
  onSave: (payload: {
    column_index: number;
    truck_number?: number | null;
    route_number?: number | null;
    initials?: string;
    review_status?: ShortageSheetRowReviewStatus;
  }) => void;
  onCreateRow: (payload: {
    truck_number: number;
    source_column_index?: number | null;
    item_category: string;
    item_detail?: string;
    quantity?: number;
    initials?: string;
    raw_text?: string;
    review_status?: "needs_review" | "accepted" | "rejected";
    reviewer_note?: string;
    confidence_score?: number | null;
    source_photo_id?: string | null;
  }) => void;
  onRowSave: (payload: {
    rowId: number;
    truck_number?: number | null;
    source_column_index?: number | null;
    item_category?: string;
    item_detail?: string;
    quantity?: number | null;
    initials?: string;
    raw_text?: string;
    review_status?: ShortageSheetRowReviewStatus;
    reviewer_note?: string;
    source_photo_id?: string | null;
  }) => void;
  onRowDelete: (rowId: number) => void;
}) {
  const [form, setForm] = useState({
    truck_number: column.truck_number == null ? "" : String(column.truck_number),
    route_number: column.route_number == null ? "" : String(column.route_number),
    initials: column.initials,
    review_status: column.review_status as ShortageSheetRowReviewStatus,
  });
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [newRow, setNewRow] = useState({
    item_category: "",
    item_detail: "",
    quantity: "1",
  });
  const categoryOptions = mergeCurrentOption(templateCategoryOptions(template), newRow.item_category);
  const detailOptions = mergeCurrentOption(templateDetailOptions(template, newRow.item_category), newRow.item_detail);

  useEffect(() => {
    setForm({
      truck_number: column.truck_number == null ? "" : String(column.truck_number),
      route_number: column.route_number == null ? "" : String(column.route_number),
      initials: column.initials,
      review_status: column.review_status as ShortageSheetRowReviewStatus,
    });
    setExpandedRowId(null);
    setNewRow({
      item_category: "",
      item_detail: "",
      quantity: "1",
    });
  }, [column, fallbackInitials, photos]);

  useEffect(() => {
    const validCategoryOptions = templateCategoryOptions(template);
    if (!validCategoryOptions.length) return;
    setNewRow((current) => {
      const nextCategory = validCategoryOptions.includes(current.item_category)
        ? current.item_category
        : (current.item_category || validCategoryOptions[0] || "");
      const validDetailOptions = templateDetailOptions(template, nextCategory);
      const nextDetail = validDetailOptions.includes(current.item_detail)
        ? current.item_detail
        : (current.item_detail || validDetailOptions[0] || "");
      if (nextCategory === current.item_category && nextDetail === current.item_detail) {
        return current;
      }
      return {
        ...current,
        item_category: nextCategory,
        item_detail: nextDetail,
      };
    });
  }, [template]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-100">{formatColumnLabel(column)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {rows.length} imported row{rows.length !== 1 ? "s" : ""} attached to this column
          </p>
        </div>
        <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", statusBadgeClass(form.review_status))}>
          {form.review_status.replace("_", " ")}
        </span>
      </div>

      {column.issues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {column.issues.map((issue) => (
            <span key={issue} className="rounded-full bg-amber-950/60 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-800/50">
              {issue}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_160px]">
        <input className="input" placeholder="Truck" value={form.truck_number} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, truck_number: e.target.value }))} />
        <input className="input" placeholder="Route" value={form.route_number} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, route_number: e.target.value }))} />
        <input className="input" placeholder="Initials" value={form.initials} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, initials: e.target.value.toUpperCase() }))} />
        <select className="input" value={form.review_status} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, review_status: e.target.value as ShortageSheetRowReviewStatus }))}>
          <option value="needs_review">Needs review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add missing item</p>
          <p className="mt-1 text-xs text-slate-500">Add a shortage directly into this column when OCR missed it. Truck and initials come from the column above.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px]">
          <select
            className="input"
            value={newRow.item_category}
            disabled={disabled || createPending}
            onChange={(e) =>
              setNewRow((current) => {
                const nextCategory = e.target.value;
                const nextDetails = templateDetailOptions(template, nextCategory);
                return {
                  ...current,
                  item_category: nextCategory,
                  item_detail: nextDetails.includes(current.item_detail) ? current.item_detail : (nextDetails[0] || ""),
                };
              })
            }
          >
            <option value="">Select category</option>
            {categoryOptions.map((category) => <option key={`column-new-row-category-${column.column_index}-${category}`} value={category}>{category}</option>)}
          </select>
          <select className="input" value={newRow.item_detail} disabled={disabled || createPending || !newRow.item_category} onChange={(e) => setNewRow((current) => ({ ...current, item_detail: e.target.value }))}>
            <option value="">Select item</option>
            {detailOptions.map((detail) => <option key={`column-new-row-detail-${column.column_index}-${detail}`} value={detail}>{detail}</option>)}
          </select>
          <input className="input" placeholder="Qty" value={newRow.quantity} disabled={disabled || createPending} onChange={(e) => setNewRow((current) => ({ ...current, quantity: e.target.value }))} />
        </div>
        <button
          type="button"
          disabled={disabled || createPending || !form.truck_number.trim() || !form.initials.trim() || !newRow.item_category.trim()}
          onClick={() => {
            onCreateRow({
              truck_number: Number(form.truck_number),
              source_column_index: column.column_index,
              item_category: newRow.item_category,
              item_detail: newRow.item_detail,
              quantity: Number(newRow.quantity || "1"),
              initials: form.initials || fallbackInitials,
              review_status: "needs_review",
              raw_text: "",
              reviewer_note: "",
              source_photo_id: photos[0]?.id ?? null,
            });
            setNewRow({
              item_category: "",
              item_detail: "",
              quantity: "1",
            });
          }}
          className="btn-primary"
        >
          {createPending ? "Adding..." : "Add missing item"}
        </button>
      </div>

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
          <div className="hidden gap-2 border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid md:grid-cols-[64px_minmax(0,1fr)_84px_164px]">
            <span>Row</span>
            <span>Imported Item</span>
            <span>Qty</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-slate-800">
            {rows.map((row) => (
              <div key={`col-${column.column_index}-row-${row.id}`}>
                <InlineRowReview
                  row={row}
                  disabled={disabled}
                  expanded={expandedRowId === row.id}
                  onToggleExpanded={() => setExpandedRowId((current) => (current === row.id ? null : row.id))}
                  onSave={onRowSave}
                  onDelete={onRowDelete}
                />
                {expandedRowId === row.id && (
                  <div className="px-3 pb-3">
                    <DraftRowCard
                      row={row}
                      photos={photos}
                      disabled={disabled}
                      template={template}
                      onSave={onRowSave}
                      onDelete={onRowDelete}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onSave({
            column_index: column.column_index,
            truck_number: form.truck_number.trim() ? Number(form.truck_number) : null,
            route_number: form.route_number.trim() ? Number(form.route_number) : null,
            initials: form.initials,
            review_status: form.review_status,
          })
        }
        className="btn-primary"
      >
        Save column
      </button>
    </div>
  );
}

function DraftRowCard({
  row,
  photos,
  disabled,
  template,
  onSave,
  onDelete,
}: {
  row: ShortageSheetRowDraft;
  photos: ShortageSheetPhoto[];
  disabled: boolean;
  template: ShortageSheetTemplateDef | null;
  onSave: (payload: {
    rowId: number;
    truck_number?: number | null;
    source_column_index?: number | null;
    item_category?: string;
    item_detail?: string;
    quantity?: number | null;
    initials?: string;
    raw_text?: string;
    review_status?: ShortageSheetRowReviewStatus;
    reviewer_note?: string;
    source_photo_id?: string | null;
  }) => void;
  onDelete: (rowId: number) => void;
}) {
  const [form, setForm] = useState({
    truck_number: row.truck_number == null ? "" : String(row.truck_number),
    source_column_index: row.source_column_index == null ? "" : String(row.source_column_index),
    item_category: row.item_category,
    item_detail: row.item_detail,
    quantity: row.quantity == null ? "" : String(row.quantity),
    initials: row.initials,
    raw_text: row.raw_text,
    review_status: row.review_status,
    reviewer_note: row.reviewer_note,
    source_photo_id: row.source_photo_id ?? "",
  });
  const categoryOptions = mergeCurrentOption(templateCategoryOptions(template), form.item_category);
  const detailOptions = mergeCurrentOption(templateDetailOptions(template, form.item_category), form.item_detail);

  useEffect(() => {
    setForm({
      truck_number: row.truck_number == null ? "" : String(row.truck_number),
      source_column_index: row.source_column_index == null ? "" : String(row.source_column_index),
      item_category: row.item_category,
      item_detail: row.item_detail,
      quantity: row.quantity == null ? "" : String(row.quantity),
      initials: row.initials,
      raw_text: row.raw_text,
      review_status: row.review_status,
      reviewer_note: row.reviewer_note,
      source_photo_id: row.source_photo_id ?? "",
    });
  }, [row]);

  useEffect(() => {
    const validCategoryOptions = templateCategoryOptions(template);
    if (!validCategoryOptions.length) return;
    setForm((current) => {
      const nextCategory = validCategoryOptions.includes(current.item_category)
        ? current.item_category
        : (current.item_category || validCategoryOptions[0] || "");
      const validDetailOptions = templateDetailOptions(template, nextCategory);
      const nextDetail = validDetailOptions.includes(current.item_detail)
        ? current.item_detail
        : (current.item_detail || validDetailOptions[0] || "");
      if (nextCategory === current.item_category && nextDetail === current.item_detail) {
        return current;
      }
      return {
        ...current,
        item_category: nextCategory,
        item_detail: nextDetail,
      };
    });
  }, [template]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Row {row.row_index + 1}</span>
          {row.source_column_index != null && <span>Column {row.source_column_index}</span>}
          <span className={clsx("rounded-full px-2 py-0.5 ring-1", statusBadgeClass(form.review_status))}>
            {form.review_status.replace("_", " ")}
          </span>
          {row.confidence_score != null && <span>{Math.round(row.confidence_score * 100)}% confidence</span>}
        </div>
        <button type="button" disabled={disabled} onClick={() => onDelete(row.id)} className="btn-ghost text-xs">
          Delete
        </button>
      </div>

      {row.issues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {row.issues.map((issue) => (
            <span key={issue} className="rounded-full bg-amber-950/60 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-800/50">
              {issue}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_90px_90px]">
        <input className="input" placeholder="Truck" value={form.truck_number} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, truck_number: e.target.value }))} />
        <select
          className="input"
          value={form.item_category}
          disabled={disabled}
          onChange={(e) =>
            setForm((current) => {
              const nextCategory = e.target.value;
              const nextDetailOptions = templateDetailOptions(template, nextCategory);
              return {
                ...current,
                item_category: nextCategory,
                item_detail: nextDetailOptions.includes(current.item_detail) ? current.item_detail : (nextDetailOptions[0] || ""),
              };
            })
          }
        >
          <option value="">Select category</option>
          {categoryOptions.map((category) => <option key={`category-${row.id}-${category}`} value={category}>{category}</option>)}
        </select>
        <select className="input" value={form.item_detail} disabled={disabled || !form.item_category} onChange={(e) => setForm((c) => ({ ...c, item_detail: e.target.value }))}>
          <option value="">Select item</option>
          {detailOptions.map((detail) => <option key={`detail-${row.id}-${detail}`} value={detail}>{detail}</option>)}
        </select>
        <input className="input" placeholder="Qty" value={form.quantity} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, quantity: e.target.value }))} />
        <input className="input" placeholder="Initials" value={form.initials} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, initials: e.target.value.toUpperCase() }))} />
      </div>

      <div className="grid gap-2 md:grid-cols-[160px_180px_1fr]">
        <select className="input" value={form.review_status} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, review_status: e.target.value as ShortageSheetRowReviewStatus }))}>
          <option value="needs_review">Needs review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="input" value={form.source_column_index} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, source_column_index: e.target.value }))}>
          <option value="">No column mapping</option>
          {Array.from({ length: 16 }, (_, index) => {
            const columnIndex = index + 1;
            return <option key={`row-column-${row.id}-${columnIndex}`} value={String(columnIndex)}>Column {columnIndex}</option>;
          })}
        </select>
        <select className="input" value={form.source_photo_id} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, source_photo_id: e.target.value }))}>
          <option value="">Any photo</option>
          {photos.map((photo) => (
            <option key={photo.id} value={photo.id}>{photo.file_name}</option>
          ))}
        </select>
      </div>

      <textarea className="input min-h-[68px] w-full" placeholder="Raw extracted text" value={form.raw_text} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, raw_text: e.target.value }))} />
      <input className="input" placeholder="Reviewer note" value={form.reviewer_note} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, reviewer_note: e.target.value }))} />

      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onSave({
            rowId: row.id,
            truck_number: form.truck_number.trim() ? Number(form.truck_number) : null,
            source_column_index: form.source_column_index.trim() ? Number(form.source_column_index) : null,
            item_category: form.item_category,
            item_detail: form.item_detail,
            quantity: form.quantity.trim() ? Number(form.quantity) : null,
            initials: form.initials,
            raw_text: form.raw_text,
            review_status: form.review_status,
            reviewer_note: form.reviewer_note,
            source_photo_id: form.source_photo_id || null,
          })
        }
        className="btn-primary"
      >
        Save row
      </button>
    </div>
  );
}

export default function ShortageImportPanel({
  defaultRunDate,
  lockedRunDate = false,
  title = "Shortage Sheet Imports",
  compact = false,
}: ShortageImportPanelProps) {
  const toast = useToast();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("");
  const [freeRunDate, setFreeRunDate] = useState(defaultRunDate ?? "");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState("");
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [exportingMemory, setExportingMemory] = useState(false);
  const [exportingDataset, setExportingDataset] = useState(false);
  const [exportingHeaderMemory, setExportingHeaderMemory] = useState(false);
  const [exportingHeaderDataset, setExportingHeaderDataset] = useState(false);
  const [clearingHeaderMemory, setClearingHeaderMemory] = useState(false);

  useEffect(() => {
    if (!lockedRunDate) setFreeRunDate(defaultRunDate ?? "");
  }, [defaultRunDate, lockedRunDate]);

  const activeRunDate = lockedRunDate ? (defaultRunDate ?? todayIso()) : freeRunDate;
  const templatesQuery = useShortageSheetTemplates();
  const importsQuery = useShortageSheetImports({ runDate: activeRunDate || undefined, status: statusFilter || undefined });
  const imports = importsQuery.data ?? [];
  const detailQuery = useShortageSheetImport(selectedImportId);
  const selectedImport = detailQuery.data ?? null;
  const defaultTemplate = templatesQuery.data?.find((entry) => entry.id === "shortage_v1a") ?? null;
  const selectedTemplate = (selectedImport && templatesQuery.data?.find((entry) => entry.id === selectedImport.sheet_template_id)) || defaultTemplate;
  const adminRoles: AuthRole[] = ["admin", "fleet", "supervisor"];
  const canManageOcrMemory = !!user && adminRoles.includes(user.role);
  const ocrMemoryStatusQuery = useShortageSheetOcrMemoryStatus(canManageOcrMemory);

  useEffect(() => {
    if (!imports.length) {
      setSelectedImportId(null);
      return;
    }
    if (!selectedImportId || !imports.some((entry) => entry.id === selectedImportId)) {
      setSelectedImportId(imports[0].id);
    }
  }, [imports, selectedImportId]);

  const uploadMutation = useCreateShortageSheetImport();
  const createRowMutation = useCreateShortageSheetRow(selectedImportId);
  const updateRowMutation = useUpdateShortageSheetRow(selectedImportId);
  const updateColumnMutation = useUpdateShortageSheetColumn(selectedImportId);
  const deleteRowMutation = useDeleteShortageSheetRow(selectedImportId);
  const deleteImportMutation = useDeleteShortageSheetImport();
  const approveMutation = useApproveShortageSheetImport(selectedImportId);
  const rejectMutation = useRejectShortageSheetImport(selectedImportId);

  const pendingReviewCount = useMemo(
    () => selectedImport?.rows.filter((row) => row.review_status === "needs_review").length ?? 0,
    [selectedImport],
  );

  const totalUploadBytes = useMemo(
    () => uploadFiles.reduce((sum, file) => sum + file.size, 0),
    [uploadFiles],
  );

  const columnGroups = useMemo(() => {
    if (!selectedImport) return [];
    return selectedImport.header_columns.map((column) => ({
      column,
      rows: selectedImport.rows
        .filter((row) => row.source_column_index === column.column_index)
        .slice()
        .sort((a, b) => a.row_index - b.row_index),
    }));
  }, [selectedImport]);

  const orphanRows = useMemo(
    () =>
      selectedImport?.rows
        .filter((row) => row.source_column_index == null)
        .slice()
        .sort((a, b) => a.row_index - b.row_index) ?? [],
    [selectedImport],
  );

  async function handleUpload() {
    if (!uploadFiles.length) return;
    setUploadPhase("preparing");
    setUploadPercent(0);
    setUploadStatusText(`Preparing ${uploadFiles.length} file${uploadFiles.length !== 1 ? "s" : ""} for upload...`);
    try {
      const created = await uploadMutation.mutateAsync({
        run_date: activeRunDate || todayIso(),
        files: uploadFiles,
        onUploadProgress: ({ percent, loaded, total }) => {
          if (total && loaded >= total) {
            setUploadPhase("processing");
            setUploadPercent(100);
            setUploadStatusText("Upload complete. Server is processing the sheet, extracting rows, and building the review queue...");
            return;
          }
          setUploadPhase("uploading");
          setUploadPercent(percent);
          const loadedLabel = formatBytes(loaded);
          const totalLabel = total ? formatBytes(total) : "unknown size";
          setUploadStatusText(`Uploading shortage sheet photos... ${loadedLabel} of ${totalLabel}`);
        },
      });
      setUploadFiles([]);
      setUploadPhase("success");
      setUploadPercent(100);
      setUploadStatusText(`Import created. ${created.row_count} row${created.row_count !== 1 ? "s" : ""} ready for review from ${created.photo_count} photo${created.photo_count !== 1 ? "s" : ""}.`);
      setSelectedImportId(created.id);
      toast.success(`Uploaded ${created.photo_count} photo${created.photo_count !== 1 ? "s" : ""}.`);
    } catch (err) {
      setUploadPhase("error");
      setUploadStatusText(parseError(err));
      toast.error(parseError(err));
    }
  }

  async function handleApprove() {
    if (!selectedImportId) return;
    try {
      await approveMutation.mutateAsync();
      toast.success("Shortages imported.");
    } catch (err) {
      toast.error(parseError(err));
    }
  }

  async function handleReject() {
    if (!selectedImportId) return;
    setConfirmState({ kind: "rejectImport" });
  }

  async function handleDeleteImport() {
    if (!selectedImportId || !selectedImport) return;
    const description = selectedImport.status === "approved"
      ? "Delete this import record and source photos? This will not remove live shortages that were already imported."
      : "Delete this import and its source photos?";
    setConfirmState({ kind: "deleteImport", description });
  }

  function requestDeleteRow(row: ShortageSheetRowDraft) {
    setConfirmState({
      kind: "deleteRow",
      rowId: row.id,
      label: rowDisplayLabel(row),
    });
  }

  async function handleConfirmAction() {
    if (!confirmState) return;
    try {
      if (confirmState.kind === "rejectImport") {
        await rejectMutation.mutateAsync("");
        toast.info("Import rejected.");
        setConfirmState(null);
        return;
      }
      if (confirmState.kind === "deleteImport") {
        if (!selectedImportId) return;
        await deleteImportMutation.mutateAsync(selectedImportId);
        setSelectedImportId(null);
        toast.info("Import deleted.");
        setConfirmState(null);
        return;
      }
      await deleteRowMutation.mutateAsync(confirmState.rowId);
      toast.info("Draft row deleted.");
      setConfirmState(null);
    } catch (err) {
      toast.error(parseError(err));
    }
  }

  const confirmBusy = confirmState?.kind === "rejectImport"
    ? rejectMutation.isPending
    : confirmState?.kind === "deleteImport"
      ? deleteImportMutation.isPending
      : confirmState?.kind === "deleteRow"
        ? deleteRowMutation.isPending
        : false;

  async function handleDownloadOcrExport() {
    if (!canManageOcrMemory) return;
    setExportingMemory(true);
    try {
      const response = await api.get<Blob>(shortageSheetOcrMemoryExportUrl(), {
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "shortage-sheet-ocr-training-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      toast.success("OCR training export downloaded.");
    } catch (err) {
      toast.error(parseError(err));
    } finally {
      setExportingMemory(false);
    }
  }

  async function handleDownloadOcrDataset() {
    if (!canManageOcrMemory) return;
    setExportingDataset(true);
    try {
      const response = await api.get<Blob>(shortageSheetOcrDatasetExportUrl(), {
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "shortage-sheet-ocr-dataset.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      toast.success("OCR dataset ZIP downloaded.");
    } catch (err) {
      toast.error(parseError(err));
    } finally {
      setExportingDataset(false);
    }
  }

  async function handleDownloadHeaderOcrExport() {
    if (!canManageOcrMemory) return;
    setExportingHeaderMemory(true);
    try {
      const response = await api.get<Blob>(shortageSheetOcrHeaderMemoryExportUrl(), {
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "shortage-sheet-ocr-header-training-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      toast.success("Header OCR training export downloaded.");
    } catch (err) {
      toast.error(parseError(err));
    } finally {
      setExportingHeaderMemory(false);
    }
  }

  async function handleDownloadHeaderOcrDataset() {
    if (!canManageOcrMemory) return;
    setExportingHeaderDataset(true);
    try {
      const response = await api.get<Blob>(shortageSheetOcrHeaderDatasetExportUrl(), {
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "shortage-sheet-ocr-header-dataset.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      toast.success("Header OCR dataset ZIP downloaded.");
    } catch (err) {
      toast.error(parseError(err));
    } finally {
      setExportingHeaderDataset(false);
    }
  }

  async function handleClearHeaderMemory() {
    if (!canManageOcrMemory) return;
    setClearingHeaderMemory(true);
    try {
      await api.put("/settings/shortage_sheet_ocr_header_correction_memory", {
        value: {
          version: 1,
          examples: [],
          updated_at: new Date().toISOString(),
        },
      });
      await ocrMemoryStatusQuery.refetch();
      toast.success("Remembered headers cleared.");
    } catch (err) {
      toast.error(parseError(err));
    } finally {
      setClearingHeaderMemory(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
          <p className="text-xs text-slate-500">Upload shortage-sheet photos, review draft rows, then apply them to live shortages.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!lockedRunDate && <input type="date" className="input py-2 text-sm" value={freeRunDate} onChange={(e) => setFreeRunDate(e.target.value)} />}
          <select className="input py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="needs_review">Needs review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      <div className={clsx("grid gap-4", compact ? "xl:grid-cols-[340px_1fr]" : "xl:grid-cols-[360px_1fr]")}>
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upload photos</p>
              <p className="mt-1 text-xs text-slate-500">Multiple photos can belong to one sheet batch.</p>
              <p className="mt-2 text-xs text-slate-500">Template: <span className="font-medium text-slate-300">{defaultTemplate?.name ?? "Shortage Sheet v1A"}</span></p>
              <p className="text-[11px] text-slate-500">3x10 rows are locked to: {(defaultTemplate?.top_3x10_order ?? ["3x10 BLACK", "3x10 COPPER", "3x10 INDIGO", "3x10 ONYX"]).join(" -> ")}</p>
            </div>
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploadMutation.isPending}
                onChange={(e) => {
                  setUploadFiles(Array.from(e.target.files ?? []));
                  setUploadPhase("idle");
                  setUploadPercent(0);
                  setUploadStatusText("");
                }}
              />
              <p className="text-xs text-slate-500">Run date: <span className="font-medium text-slate-300">{activeRunDate || "All dates"}</span></p>
              {uploadFiles.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-400">
                  <li className="font-medium text-slate-300">
                    {uploadFiles.length} file{uploadFiles.length !== 1 ? "s" : ""} selected · {formatBytes(totalUploadBytes)}
                  </li>
                  {uploadFiles.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
                </ul>
              )}
            </div>
            {uploadPhase !== "idle" && (
              <div
                className={clsx(
                  "rounded-xl border p-3",
                  uploadPhase === "error"
                    ? "border-red-900/60 bg-red-950/30"
                    : uploadPhase === "success"
                    ? "border-emerald-900/60 bg-emerald-950/30"
                    : "border-blue-900/60 bg-blue-950/20",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p
                    className={clsx(
                      "text-sm font-medium",
                      uploadPhase === "error"
                        ? "text-red-200"
                        : uploadPhase === "success"
                        ? "text-emerald-200"
                        : "text-blue-200",
                    )}
                  >
                    {uploadPhase === "preparing" && "Preparing upload"}
                    {uploadPhase === "uploading" && "Uploading photos"}
                    {uploadPhase === "processing" && "Processing shortage sheet"}
                    {uploadPhase === "success" && "Import ready"}
                    {uploadPhase === "error" && "Upload failed"}
                  </p>
                  {(uploadPhase === "uploading" || uploadPhase === "processing" || uploadPhase === "success") && (
                    <span className="text-xs font-semibold text-slate-300">{uploadPercent}%</span>
                  )}
                </div>
                {(uploadPhase === "uploading" || uploadPhase === "processing" || uploadPhase === "success") && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={clsx(
                        "h-full rounded-full transition-all",
                        uploadPhase === "success" ? "bg-emerald-400" : "bg-blue-400",
                      )}
                      style={{ width: `${uploadPercent}%` }}
                    />
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-300">{uploadStatusText}</p>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                  <li>Uploading sends the original photo files to the backend.</li>
                  <li>Processing means the server is normalizing the image, calling Ollama, and creating draft rows.</li>
                  <li>HEIC files now upload, but messy sheets may still land in review with missing truck/initials fields.</li>
                </ul>
              </div>
            )}
            <button type="button" disabled={uploadMutation.isPending || uploadFiles.length === 0} onClick={handleUpload} className="btn-primary">
              {uploadPhase === "processing" ? "Processing..." : uploadMutation.isPending ? "Uploading..." : "Create import"}
            </button>
          </div>

          {canManageOcrMemory && (
            <div className="card space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">OCR correction memory</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Accepted review fixes are fed back into future OCR prompts and exact handwriting matches.
                  </p>
                </div>
              </div>
              {ocrMemoryStatusQuery.isLoading ? (
                <p className="text-xs text-slate-500">Loading OCR memory…</p>
              ) : ocrMemoryStatusQuery.isError ? (
                <p className="text-xs text-rose-300">Could not load OCR memory status.</p>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Row/item OCR training</p>
                        <p className="mt-1 text-xs text-slate-500">Learns shortage rows, quantities, and category matching.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={exportingMemory}
                          onClick={handleDownloadOcrExport}
                        >
                          {exportingMemory ? "Exporting..." : "Download training export"}
                        </button>
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={exportingDataset}
                          onClick={handleDownloadOcrDataset}
                        >
                          {exportingDataset ? "Building dataset..." : "Download crop dataset ZIP"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Verified examples</p>
                        <p className="mt-1 text-lg font-semibold text-slate-100">{ocrMemoryStatusQuery.data?.accepted_example_count ?? 0}</p>
                        <p className="text-xs text-slate-500">{ocrMemoryStatusQuery.data?.example_count ?? 0} total remembered corrections</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Model + export</p>
                        <p className="mt-1 text-sm font-medium text-slate-200">{ocrMemoryStatusQuery.data?.model_hint || "Not configured"}</p>
                        <p className="text-xs text-slate-500">
                          {ocrMemoryStatusQuery.data?.adapter_export_supported ? "Dataset ZIP includes full, row, quantity, and header variants plus autocontrast, threshold, and ±2° rotation augmentations." : "Export is not available."}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Header OCR training</p>
                        <p className="mt-1 text-xs text-slate-500">Separately validates truck, route, and initials so the top strip can be trained on its own.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={exportingHeaderMemory}
                          onClick={handleDownloadHeaderOcrExport}
                        >
                          {exportingHeaderMemory ? "Exporting..." : "Download header export"}
                        </button>
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={exportingHeaderDataset}
                          onClick={handleDownloadHeaderOcrDataset}
                        >
                          {exportingHeaderDataset ? "Building dataset..." : "Download header dataset ZIP"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs text-rose-300"
                          disabled={clearingHeaderMemory}
                          onClick={handleClearHeaderMemory}
                        >
                          {clearingHeaderMemory ? "Clearing..." : "Clear remembered headers"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Verified header examples</p>
                        <p className="mt-1 text-lg font-semibold text-slate-100">{ocrMemoryStatusQuery.data?.accepted_header_example_count ?? 0}</p>
                        <p className="text-xs text-slate-500">{ocrMemoryStatusQuery.data?.header_example_count ?? 0} total remembered header corrections</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Purpose</p>
                        <p className="mt-1 text-sm font-medium text-slate-200">Truck / route / initials</p>
                        <p className="text-xs text-slate-500">
                          {ocrMemoryStatusQuery.data?.header_adapter_export_supported ? "Header dataset ZIP contains dedicated top-strip crops for focused OCR tuning." : "Header export is not available."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Queue</p>
              {importsQuery.isFetching && <span className="text-[11px] text-slate-500">Refreshing...</span>}
            </div>
            {importsQuery.isError ? (
              <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{parseError(importsQuery.error)}</div>
            ) : imports.length === 0 ? (
              <p className="text-sm text-slate-500">No imports found for the current filter.</p>
            ) : (
              <div className="space-y-2">
                {imports.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedImportId(entry.id)}
                    className={clsx(
                      "w-full rounded-xl border p-3 text-left transition",
                      selectedImportId === entry.id ? "border-blue-500 bg-blue-950/20" : "border-slate-700 bg-slate-900/40 hover:border-slate-600",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-200">{formatRunDate(entry.run_date)}</span>
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", statusBadgeClass(entry.status))}>{entry.status.replace("_", " ")}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span>{entry.photo_count} photos</span>
                      <span>{entry.row_count} rows</span>
                      <span>{entry.needs_review_count} pending</span>
                      <span>{entry.sheet_template_id}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{entry.extraction_mode === "ollama" ? "Ollama-assisted" : "Manual"} · {entry.uploaded_by_username}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {!selectedImport ? (
            <div className="card p-6 text-sm text-slate-500">Select an import to review its rows and photos.</div>
          ) : detailQuery.isError ? (
            <div className="card rounded-xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-200">{parseError(detailQuery.error)}</div>
          ) : (
            <>
              <div className="card space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-slate-100">Import {formatRunDate(selectedImport.run_date)}</h4>
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", statusBadgeClass(selectedImport.status))}>{selectedImport.status.replace("_", " ")}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Uploaded by {selectedImport.uploaded_by_username} · {selectedImport.photo_count} photos · {selectedImport.row_count} rows</p>
                    <p className="mt-1 text-xs text-slate-500">Template: <span className="font-medium text-slate-300">{selectedTemplate?.name ?? selectedImport.sheet_template_id}</span></p>
                    <p className="text-[11px] text-slate-500">3x10 rows: {(selectedTemplate?.top_3x10_order ?? ["3x10 BLACK", "3x10 COPPER", "3x10 INDIGO", "3x10 ONYX"]).join(" -> ")}</p>
                    {selectedImport.error_message && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-300">{selectedImport.error_message}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={approveMutation.isPending || selectedImport.status === "approved" || selectedImport.status === "rejected"} onClick={handleApprove} className="btn-primary">
                      {approveMutation.isPending ? "Applying..." : "Approve and import"}
                    </button>
                    <button type="button" disabled={rejectMutation.isPending || selectedImport.status === "approved" || selectedImport.status === "rejected"} onClick={handleReject} className="btn-ghost">
                      Reject
                    </button>
                    <button type="button" disabled={deleteImportMutation.isPending} onClick={handleDeleteImport} className="btn-ghost">
                      {deleteImportMutation.isPending ? "Deleting..." : "Delete import"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                  <span className="rounded-full bg-slate-800 px-2 py-1">{pendingReviewCount} rows need review</span>
                  <span className="rounded-full bg-slate-800 px-2 py-1">{selectedImport.rows.filter((row) => row.review_status === "accepted").length} accepted</span>
                  <span className="rounded-full bg-slate-800 px-2 py-1">{selectedImport.rows.filter((row) => row.review_status === "rejected").length} rejected</span>
                  <span className="rounded-full bg-slate-800 px-2 py-1">{selectedImport.header_columns.filter((column) => column.review_status !== "accepted").length} columns need validation</span>
                </div>

                {selectedImport.photos.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {selectedImport.photos.map((photo) => (
                      <a key={photo.id} href={shortageSheetPhotoFileUrl(photo.id)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/60">
                        <img src={shortageSheetPhotoFileUrl(photo.id)} alt={photo.file_name} className="h-48 w-full object-cover" />
                        <div className="border-t border-slate-800 px-3 py-2 text-xs text-slate-400">{photo.file_name}</div>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {detailQuery.isLoading ? (
                  <div className="card p-6 text-sm text-slate-500">Loading draft rows...</div>
                ) : selectedImport.rows.length === 0 && selectedImport.header_columns.length === 0 ? (
                  <div className="card p-6 text-sm text-slate-500">No draft rows yet. Use a column card below to add the missing items.</div>
                ) : (
                  <>
                    <div className="card space-y-3 p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Column verification</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Validate each of the 16 sheet columns. Truck and Route are separate fields and must both be correct before approval.
                        </p>
                      </div>
                      <div className="grid gap-3 xl:grid-cols-2">
                        {columnGroups.map(({ column, rows }) => (
                          <ColumnDraftCard
                            key={`column-${column.column_index}`}
                            column={column}
                            rows={rows}
                            photos={selectedImport.photos}
                            disabled={updateColumnMutation.isPending || selectedImport.status === "approved" || selectedImport.status === "rejected"}
                            createPending={createRowMutation.isPending}
                            template={selectedTemplate}
                            fallbackInitials={user?.username?.slice(0, 3).toUpperCase() ?? ""}
                            onSave={async (payload) => {
                              try {
                                await updateColumnMutation.mutateAsync(payload);
                                toast.success(`Saved column ${column.column_index}.`);
                              } catch (err) {
                                toast.error(parseError(err));
                              }
                            }}
                            onCreateRow={async (payload) => {
                              try {
                                await createRowMutation.mutateAsync(payload);
                                toast.success("Draft row added.");
                              } catch (err) {
                                toast.error(parseError(err));
                              }
                            }}
                            onRowSave={async (payload) => {
                              try {
                                await updateRowMutation.mutateAsync(payload);
                                toast.success(`Saved row ${payload.rowId}.`);
                              } catch (err) {
                                toast.error(parseError(err));
                              }
                            }}
                            onRowDelete={async (rowId) => {
                              const targetRow = rows.find((row) => row.id === rowId);
                              if (targetRow) requestDeleteRow(targetRow);
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {orphanRows.length > 0 && (
                      <div className="card space-y-3 p-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rows without a mapped column</p>
                          <p className="mt-1 text-xs text-slate-500">
                            These rows were extracted without a stable column match. Review them manually and, if needed, assign them to the correct truck data.
                          </p>
                        </div>
                        <div className="space-y-3">
                          {orphanRows.map((row) => (
                            <DraftRowCard
                              key={row.id}
                              row={row}
                              photos={selectedImport.photos}
                              disabled={updateRowMutation.isPending || deleteRowMutation.isPending || selectedImport.status === "approved" || selectedImport.status === "rejected"}
                              template={selectedTemplate}
                              onSave={async (payload) => {
                                try {
                                  await updateRowMutation.mutateAsync(payload);
                                  toast.success(`Saved row ${row.row_index + 1}.`);
                                } catch (err) {
                                  toast.error(parseError(err));
                                }
                              }}
                              onDelete={async (rowId) => {
                                requestDeleteRow(row);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmState !== null}
        title={
          confirmState?.kind === "rejectImport"
            ? "Reject this import?"
            : confirmState?.kind === "deleteImport"
              ? "Delete shortage-sheet import?"
              : "Remove draft row?"
        }
        description={
          confirmState?.kind === "rejectImport"
            ? "No live shortages will be created from this import."
            : confirmState?.kind === "deleteImport"
              ? confirmState.description
              : confirmState?.kind === "deleteRow"
                ? `Remove “${confirmState.label}” from this draft import?`
                : ""
        }
        confirmLabel={
          confirmState?.kind === "rejectImport"
            ? "Reject import"
            : confirmState?.kind === "deleteImport"
              ? "Delete import"
              : "Remove row"
        }
        variant="danger"
        busy={confirmBusy}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          if (!confirmBusy) setConfirmState(null);
        }}
      />
    </div>
  );
}
