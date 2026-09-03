/**
 * Shared helpers and constants for the Management (Settings) panels.
 * Extracted from Settings.tsx so panel components can live in their own files.
 */
import type { ReactNode } from "react";
import type { TruckStatus } from "../../types";
import { STATUS_COLORS, STATUS_LABELS } from "../../constants/truckStatus";

// ---------------------------------------------------------------------------
// Value coercion helpers (settings come back as `unknown`)
// ---------------------------------------------------------------------------

export function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return fallback;
}

// ---------------------------------------------------------------------------
// Shared layout components
// ---------------------------------------------------------------------------

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-slate-800 py-3 sm:grid-cols-[260px_1fr] sm:items-center">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SaveButton({
  dirty,
  saving,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="mt-4 flex gap-2">
      <button className="btn-primary" disabled={!dirty || saving} onClick={onSave}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button className="btn-ghost" disabled={!dirty || saving} onClick={onRevert}>
        Revert
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

// The canonical palette, not a private copy — this map had drifted (Unfinished
// showed Dirty-red, Spare purple) and "reset to defaults" wrote the wrong hexes.
export const DEFAULT_BADGE_COLORS: Record<TruckStatus, string> = STATUS_COLORS;

export { STATUS_LABELS };
