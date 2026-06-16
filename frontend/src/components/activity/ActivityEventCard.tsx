import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { format, parseISO } from "date-fns";
import type { ActivityEvent, ActivityEventFamily, TruckStatus } from "../../types";
import { STATUS_BG, STATUS_LABELS, STATUS_TEXT } from "../../constants/truckStatus";
import RoleBadge, { UserAvatar } from "../management/RoleBadge";

const FAMILY_BADGE: Record<ActivityEventFamily, string> = {
  state: "bg-blue-500/10 text-blue-300 ring-blue-500/20",
  batch: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20",
  coverage: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/20",
  setup: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
  recovery: "bg-rose-500/10 text-rose-300 ring-rose-500/20",
  system: "bg-slate-500/10 text-slate-300 ring-slate-500/20",
};

function isTruckStatus(value: string | null): value is TruckStatus {
  return !!value && value in STATUS_LABELS;
}

function StatusPill({ value }: { value: string | null }) {
  if (!value) return null;
  if (isTruckStatus(value)) {
    return (
      <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_BG[value], STATUS_TEXT[value])}>
        {STATUS_LABELS[value]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-700/70 px-2 py-0.5 text-xs font-semibold text-slate-200">
      {value}
    </span>
  );
}

function cleanContext(context: Record<string, unknown>) {
  const next = { ...context };
  delete next.related_truck_numbers_csv;
  return next;
}

function previewText(diff: Record<string, unknown>) {
  const fields = diff.fields as Record<string, { before: unknown; after: unknown }> | undefined;
  if (fields && Object.keys(fields).length > 0) {
    return Object.keys(fields)
      .slice(0, 4)
      .join(" • ");
  }
  const truckChanges = diff.truck_changes ?? diff.truck_state_changes;
  if (Array.isArray(truckChanges) && truckChanges.length > 0) {
    return `${truckChanges.length} truck change${truckChanges.length === 1 ? "" : "s"}`;
  }
  const removedSwaps = diff.removed_swaps;
  if (Array.isArray(removedSwaps) && removedSwaps.length > 0) {
    return `${removedSwaps.length} swap${removedSwaps.length === 1 ? "" : "s"} removed`;
  }
  if (typeof diff.seeded_count === "number") {
    return `${diff.seeded_count} auto-seeded`;
  }
  if (typeof diff.changed_count === "number") {
    return `${diff.changed_count} truck${diff.changed_count === 1 ? "" : "s"} changed`;
  }
  return "";
}

function renderPrettyValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fieldRowsFromDiff(diff: Record<string, unknown>) {
  const rows: { label: string; before: unknown; after: unknown }[] = [];
  const directFields = diff.fields as Record<string, { before: unknown; after: unknown }> | undefined;
  if (directFields) {
    for (const [label, change] of Object.entries(directFields)) {
      rows.push({ label, before: change.before, after: change.after });
    }
  }
  const nestedTruckState = diff.truck_state as Record<string, unknown> | undefined;
  const nestedFields = nestedTruckState?.fields as Record<string, { before: unknown; after: unknown }> | undefined;
  if (nestedFields) {
    for (const [label, change] of Object.entries(nestedFields)) {
      rows.push({ label, before: change.before, after: change.after });
    }
  }
  return rows;
}

export default function ActivityEventCard({
  event,
  compact = false,
  actions = null,
}: {
  event: ActivityEvent;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const diff = (event.diff_json ?? {}) as Record<string, unknown>;
  const context = useMemo(() => cleanContext((event.context_json ?? {}) as Record<string, unknown>), [event.context_json]);
  const preview = previewText(diff);
  const fieldRows = fieldRowsFromDiff(diff);
  const hasDetails = fieldRows.length > 0 || Object.keys(context).length > 0 || preview.length > 0;

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
      <div className={clsx("flex gap-3", compact ? "items-start" : "items-start justify-between")}>
        <div className="flex min-w-0 flex-1 gap-3">
          <UserAvatar
            name={event.actor_display_name || event.actor_username || "System"}
            username={event.actor_username || "system"}
            size={compact ? 34 : 38}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-100">
                {event.actor_display_name || event.actor_username || "System"}
              </p>
              {event.actor_role ? (
                <RoleBadge role={event.actor_role} />
              ) : (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-slate-700">
                  System
                </span>
              )}
              <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1", FAMILY_BADGE[event.event_family])}>
                {event.event_family}
              </span>
              {event.truck_number != null && (
                <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
                  Truck {event.truck_number}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-200">{event.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-500">{format(parseISO(event.occurred_at), compact ? "Pp" : "PPpp")}</p>
              {event.run_date && (
                <span className="text-xs text-slate-500">Run {event.run_date}</span>
              )}
              {(event.status_before || event.status_after) && (
                <div className="flex items-center gap-1.5">
                  <StatusPill value={event.status_before} />
                  {event.status_before && event.status_after && <span className="text-xs text-slate-500">→</span>}
                  <StatusPill value={event.status_after} />
                </div>
              )}
            </div>
          </div>
        </div>
        {!compact && actions}
      </div>

      {preview && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
          Changed: <span className="text-slate-200">{preview}</span>
        </div>
      )}

      {hasDetails && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-xs font-semibold text-blue-300 hover:text-blue-200"
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              {fieldRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Changed fields</p>
                  <div className="space-y-2">
                    {fieldRows.map((row) => (
                      <div key={row.label} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs sm:grid-cols-[140px_1fr_20px_1fr] sm:items-center">
                        <span className="font-semibold text-slate-300">{row.label}</span>
                        <span className="text-slate-500">{renderPrettyValue(row.before)}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-200">{renderPrettyValue(row.after)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(context).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Context</p>
                  <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-[11px] text-slate-300">
                    {JSON.stringify(context, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
