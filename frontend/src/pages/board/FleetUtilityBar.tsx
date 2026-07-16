import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TruckStatus } from "../../types";
import {
  FLEET_RAIL_STATUSES,
  FLEET_STATUS_OPTIONS,
  FLEET_TYPE_FILTERS,
  FLEET_TYPE_FILTER_BG,
  STATUS_BG,
  STATUS_LABELS,
  type FleetFilterValue,
} from "./constants";

interface FleetUtilityBarProps {
  runDate: string;
  onRunDateChange: (value: string) => void;
  isArchive: boolean;
  isFuture: boolean;
  isReadOnly: boolean;
  multiSelect: boolean;
  selectedCount: number;
  filteredCount: number;
  counts: Record<string, number>;
  fleetFilters: Set<FleetFilterValue>;
  bulkStatus: TruckStatus;
  isApplying: boolean;
  onToggleBulkEdit: () => void;
  onToggleFilter: (value: FleetFilterValue) => void;
  onBulkStatusChange: (value: TruckStatus) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onApplyBulk: () => void;
}

function formatFilterSummary(
  fleetFilters: Set<FleetFilterValue>,
  counts: Record<string, number>,
  filteredCount: number,
): string {
  if (fleetFilters.has("all")) return `All · ${counts.total ?? 0}`;
  const active: FleetFilterValue[] = [
    ...FLEET_RAIL_STATUSES.filter((status) => fleetFilters.has(status)),
    ...FLEET_TYPE_FILTERS.filter((t) => fleetFilters.has(t)),
  ];
  if (active.length === 1) {
    const key = active[0];
    const label = (STATUS_LABELS as Record<string, string>)[key] ?? key;
    return `${label} · ${counts[key] ?? 0}`;
  }
  return `${active.length} filters · ${filteredCount}`;
}

export default function FleetUtilityBar({
  runDate,
  onRunDateChange,
  isArchive,
  isFuture,
  isReadOnly,
  multiSelect,
  selectedCount,
  filteredCount,
  counts,
  fleetFilters,
  bulkStatus,
  isApplying,
  onToggleBulkEdit,
  onToggleFilter,
  onBulkStatusChange,
  onSelectAll,
  onSelectNone,
  onApplyBulk,
}: FleetUtilityBarProps) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filterMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setFilterMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterMenuOpen]);

  const filterSummary = useMemo(
    () => formatFilterSummary(fleetFilters, counts, filteredCount),
    [fleetFilters, counts, filteredCount],
  );

  const statePill = isArchive ? "Archive" : isFuture ? "Future" : null;

  function handleFilterClick(value: FleetFilterValue) {
    onToggleFilter(value);
    if (!multiSelect || value === "all") setFilterMenuOpen(false);
  }

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-2.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <input
            className="input min-w-0 flex-1 text-xs [color-scheme:dark]"
            type="date"
            value={runDate}
            onChange={(event) => onRunDateChange(event.target.value)}
          />
          {statePill && (
            <span
              className={clsx(
                "shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                isArchive
                  ? "border-amber-500/30 bg-amber-950/40 text-amber-300"
                  : "border-sky-500/30 bg-sky-950/40 text-sky-300",
              )}
            >
              {statePill}
            </span>
          )}
        </div>

        <div ref={menuRef} className="relative min-w-[10.5rem] flex-1">
          <button
            type="button"
            onClick={() => setFilterMenuOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2 text-left text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-900"
            aria-haspopup="menu"
            aria-expanded={filterMenuOpen}
          >
            <span className="truncate">{filterSummary}</span>
            {filterMenuOpen ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
            )}
          </button>

          {filterMenuOpen && (
            <div className="absolute left-0 right-0 z-20 mt-2 rounded-xl border border-slate-700/80 bg-slate-950/95 p-1 shadow-2xl backdrop-blur">
              <button
                type="button"
                onClick={() => handleFilterClick("all")}
                className={clsx(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors",
                  fleetFilters.has("all")
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-900",
                )}
              >
                <span className="font-medium">All</span>
                <span className="tabular-nums text-slate-400">{counts.total ?? 0}</span>
              </button>

              {FLEET_RAIL_STATUSES.map((status) => {
                const active = !fleetFilters.has("all") && fleetFilters.has(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleFilterClick(status)}
                    className={clsx(
                      "mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors",
                      active
                        ? "bg-slate-800 text-white"
                        : "text-slate-300 hover:bg-slate-900",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", STATUS_BG[status])} />
                      <span className="truncate">{STATUS_LABELS[status]}</span>
                    </span>
                    <span className="tabular-nums text-slate-400">{counts[status] ?? 0}</span>
                  </button>
                );
              })}

              {/* Truck-type filters */}
              <div className="my-1 border-t border-slate-800" />
              {FLEET_TYPE_FILTERS.map((typeKey) => {
                const active = !fleetFilters.has("all") && fleetFilters.has(typeKey);
                return (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => handleFilterClick(typeKey)}
                    className={clsx(
                      "mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors",
                      active
                        ? "bg-slate-800 text-white"
                        : "text-slate-300 hover:bg-slate-900",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", FLEET_TYPE_FILTER_BG[typeKey])} />
                      <span className="truncate">{typeKey}</span>
                    </span>
                    <span className="tabular-nums text-slate-400">{counts[typeKey] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!isReadOnly && (
          <button
            type="button"
            onClick={onToggleBulkEdit}
            className={clsx(
              "shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
              multiSelect
                ? "border-blue-400/60 bg-blue-600 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.3)]"
                : "border-slate-700/70 bg-slate-950/50 text-slate-200 hover:border-slate-600 hover:bg-slate-900",
            )}
          >
            {multiSelect ? `Bulk Edit · ${selectedCount}` : "Bulk Edit"}
          </button>
        )}
      </div>

      {multiSelect && !isReadOnly && (
        <div className="mt-2.5 rounded-lg border border-slate-800/80 bg-slate-950/45 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-300">{selectedCount} selected</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-sky-400 transition-colors hover:bg-slate-900"
                onClick={onSelectAll}
              >
                All
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
                onClick={onSelectNone}
              >
                None
              </button>
            </div>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select
              className="input w-full text-xs"
              value={bulkStatus}
              onChange={(event) => onBulkStatusChange(event.target.value as TruckStatus)}
            >
              {FLEET_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={selectedCount === 0 || isApplying}
              onClick={onApplyBulk}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply to All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
