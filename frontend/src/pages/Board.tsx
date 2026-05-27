import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useAuditEntries,
  useAssignSpare,
  useBoard,
  useBulkUpdateStatus,
  useHolidayMode,
  useReturnSpare,
  useSettings,
  useShortages,
  useSpareAssignments,
  useUpdateTruck,
  useUpsertTruckState,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import { todayIso } from "../api/client";
import { shipDayNumber, workdayNumbers } from "../components/Clock";
import type { SpareAssignment, TruckStatus, TruckWithState } from "../types";
import { LiveInProgress } from "../components/LiveInProgress";
import clsx from "clsx";

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  shop: "Shop",
  in_progress: "In Progress",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};

const STATUS_BG: Record<TruckStatus, string> = {
  dirty: "bg-status-dirty",
  shop: "bg-status-shop",
  in_progress: "bg-status-inprogress",
  unloaded: "bg-status-unloaded",
  loaded: "bg-status-loaded",
  off: "bg-status-off",
  oos: "bg-status-oos",
  spare: "bg-status-spare",
};

const STATUS_TEXT: Record<TruckStatus, string> = {
  dirty: "text-status-dirty",
  shop: "text-status-shop",
  in_progress: "text-status-inprogress",
  unloaded: "text-status-unloaded",
  loaded: "text-status-loaded",
  off: "text-status-off",
  oos: "text-status-oos",
  spare: "text-white",
};

// Override badge text-white for statuses where the bg needs dark text.
// Computed from relative luminance so it stays correct if colors change.
function _needsDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.179; // equal-contrast threshold between black and white text
}
const _STATUS_COLORS: Record<TruckStatus, string> = {
  dirty: "#dc2626", shop: "#7400ff", in_progress: "#f59e0b",
  unloaded: "#16a34a", loaded: "#2563eb", off: "#6b7280",
  oos: "#475569", spare: "#0e7490",
};
const STATUS_BADGE_TEXT: Partial<Record<TruckStatus, string>> = Object.fromEntries(
  (Object.entries(_STATUS_COLORS) as [TruckStatus, string][])
    .filter(([, hex]) => _needsDarkText(hex))
    .map(([s]) => [s, "!text-black"]),
);

// 'spare' is a truck *type* and 'off' is set elsewhere — neither is offered as a status.
const STATUS_OPTIONS: TruckStatus[] = [
  "dirty",
  "shop",
  "unloaded",
  "loaded",
  "oos",
];
// Fleet dropdown: 'off' is schedule-managed; 'in_progress' is managed by load workflow.
const FLEET_STATUS_OPTIONS: TruckStatus[] = ["dirty", "shop", "unloaded", "loaded", "oos", "spare"];
// All statuses shown in the fleet filter rail (ordered for display).
const FLEET_RAIL_STATUSES: TruckStatus[] = ["dirty", "shop", "in_progress", "unloaded", "loaded", "off", "oos", "spare"];

/** V1 parity: trucks scheduled off for the load day show as "off" unless actively in a workflow state. Spares are never auto-off. In holiday mode, the scheduled-off check is skipped. */
function effectiveStatus(t: TruckWithState, loadDayNum: number, holidayMode = false): TruckStatus {
  const raw = (t.state?.status ?? "dirty") as TruckStatus;
  if (
    !holidayMode &&
    t.truck_type !== "Spare" &&
    t.scheduled_off_days.includes(loadDayNum) &&
    (raw === "dirty" || raw === "unloaded")
  )
    return "off";
  return raw;
}

// ---------------------------------------------------------------------------
// Route Card panel (fleet mode only)
// ---------------------------------------------------------------------------

function RouteCardPanel({ data, runDate }: { data: TruckWithState[]; runDate: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [selectedSpare, setSelectedSpare] = useState<number | "">("");

  const { data: assignments = [] } = useSpareAssignments(runDate, false);
  const assignSpare = useAssignSpare();
  const returnSpare = useReturnSpare();

  const oosRoutes = useMemo(
    () => data.filter((t) => (t.state?.status ?? "dirty") === "oos"),
    [data],
  );

  const assignmentByRoute = useMemo(
    () => new Map<number, SpareAssignment>(assignments.map((a) => [a.covering_route_truck, a])),
    [assignments],
  );

  const availableSpares = useMemo(
    () => data.filter((t) => t.truck_type === "Spare" && (t.state?.status ?? "dirty") !== "spare"),
    [data],
  );

  const unassignedCount = oosRoutes.filter((t) => !assignmentByRoute.has(t.truck_number)).length;

  if (oosRoutes.length === 0) return null;

  async function handleAssign() {
    if (selectedRoute == null || selectedSpare === "") return;
    await assignSpare.mutateAsync({
      run_date: runDate,
      spare_truck_number: Number(selectedSpare),
      covering_route_truck: selectedRoute,
    });
    setSelectedRoute(null);
    setSelectedSpare("");
  }

  return (
    <>
      <div className="card p-4">
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setCollapsed((c) => !c)}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">Route Card</span>
            {unassignedCount > 0 && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                {unassignedCount} need{unassignedCount === 1 ? "s" : ""} assignment
              </span>
            )}
            {unassignedCount === 0 && (
              <span className="rounded-full bg-green-700 px-2 py-0.5 text-xs font-bold text-white">
                All covered
              </span>
            )}
          </div>
          <span className="text-slate-400 text-sm">{collapsed ? "▶" : "▼"}</span>
        </button>

        {!collapsed && (
          <div className="mt-3 space-y-2">
            {oosRoutes.map((t) => {
              const assignment = assignmentByRoute.get(t.truck_number);
              return (
                <div
                  key={t.truck_number}
                  className={clsx(
                    "rounded-lg bg-slate-800 px-3 py-2",
                    selectedRoute === t.truck_number && "ring-2 ring-blue-500",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">#{t.truck_number}</span>
                      <span className={clsx("badge", STATUS_BG["oos"])}>OOS</span>
                      {assignment ? (
                        <span className="text-xs font-medium text-green-400">
                          Spare #{assignment.spare_truck_number}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-400">Needs assignment</span>
                      )}
                    </div>
                    {assignment ? (
                      <button
                        className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300"
                        disabled={returnSpare.isPending}
                        onClick={() => returnSpare.mutate(assignment.id)}
                      >
                        Unassign
                      </button>
                    ) : (
                      <button
                        className="rounded bg-blue-700 px-2 py-1 text-xs font-medium hover:bg-blue-600"
                        onClick={() => {
                          setSelectedRoute((curr) => (curr === t.truck_number ? null : t.truck_number));
                          setSelectedSpare("");
                        }}
                      >
                        {selectedRoute === t.truck_number ? "Close" : "Assign"}
                      </button>
                    )}
                  </div>

                  {!assignment && selectedRoute === t.truck_number && (
                    <div className="mt-2 border-t border-slate-700 pt-2">
                      <label className="label">Pick spare truck</label>
                      <div className="flex gap-2">
                        <select
                          className="input flex-1"
                          value={selectedSpare}
                          onChange={(e) => setSelectedSpare(e.target.value === "" ? "" : Number(e.target.value))}
                        >
                          <option value="">Select spare</option>
                          {availableSpares.map((s) => (
                            <option key={s.truck_number} value={s.truck_number}>
                              Truck #{s.truck_number}
                            </option>
                          ))}
                        </select>
                        <button
                          className="rounded-lg bg-green-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                          disabled={selectedSpare === "" || assignSpare.isPending}
                          onClick={handleAssign}
                        >
                          {assignSpare.isPending ? "Assigning..." : "Assign"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export default function Board({ fleetMode = false }: { fleetMode?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const [runDate, setRunDate] = useState(todayIso());
  const [detailNum, setDetailNum] = useState<number | null>(null);
  const [confirmTruck, setConfirmTruck] = useState<TruckWithState | null>(null);
  const [fleetFilters, setFleetFilters] = useState<Set<TruckStatus | "all">>(new Set(["all"]));
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedTrucks, setSelectedTrucks] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TruckStatus>("dirty");
  const isArchive = runDate < todayIso();
  const isFuture  = runDate > todayIso();
  const isReadOnly = runDate !== todayIso();
  const { data, isLoading, error } = useBoard(runDate);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate, false);
  const { data: settings } = useSettings();
  const upsert = useUpsertTruckState();
  const bulkUpdate = useBulkUpdateStatus();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor";
  const navigate = useNavigate();

  const runDayNum = useMemo(() => {
    const [y, m, d] = runDate.split("-").map(Number);
    return workdayNumbers(new Date(y, m - 1, d)).loadDay;
  }, [runDate]);

  const { data: holidayMode = false } = useHolidayMode(runDate);

  const batchingDisabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "batching_disabled")?.value === true,
    [settings],
  );

  const skipBatchingDisabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "skip_batching_disabled")?.value === true,
    [settings],
  );

  const inProgressTruck = useMemo(
    () => (data ?? []).find((t) => t.state?.status === "in_progress"),
    [data],
  );

  const coveringSpareByRoute = useMemo(
    () => new Map<number, number>(spareAssignments.map((a) => [a.covering_route_truck, a.spare_truck_number])),
    [spareAssignments],
  );

  const truckStatusByNumber = useMemo(
    () => new Map<number, TruckStatus>((data ?? []).map((t) => [t.truck_number, (t.state?.status ?? "dirty") as TruckStatus])),
    [data],
  );

  async function startLoad(t: TruckWithState) {
    await upsert.mutateAsync({
      truck_number: t.truck_number,
      run_date: runDate,
      status: "in_progress",
      wearers: t.state?.wearers ?? 0,
      load_start_time: Date.now() / 1000,
      load_finish_time: null,
      load_duration_seconds: null,
    });
  }

  // Derive filter directly from URL so sidebar nav always takes effect
  const filter = (params.get("status") as TruckStatus | null) ?? "all";

  function setFilter(value: TruckStatus | "all") {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setParams(next, { replace: true });
  }

  function toggleFleetFilter(s: TruckStatus | "all") {
    if (s === "all") { setFleetFilters(new Set(["all"])); return; }
    if (!multiSelect) {
      setFleetFilters(prev => (prev.has(s) && prev.size === 1) ? new Set(["all"]) : new Set([s]));
    } else {
      setFleetFilters(prev => {
        const next = new Set(prev) as Set<TruckStatus | "all">;
        next.delete("all");
        if (next.has(s)) { next.delete(s); if (next.size === 0) next.add("all"); }
        else next.add(s);
        return next;
      });
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: 0 };
    (data ?? []).forEach((t) => {
      c.total += 1;
      // In fleet mode, spare-type trucks count in the "spare" bucket unless
      // manually set OOS — those go into the oos bucket.
      if (fleetMode && t.truck_type === "Spare" && t.state?.status !== "oos") {
        c.spare = (c.spare ?? 0) + 1;
      } else {
        const s = effectiveStatus(t, runDayNum, holidayMode);
        c[s] = (c[s] ?? 0) + 1;
      }
    });

    // Covered OOS routes appear in workflow tabs based on the covering truck state.
    if (!fleetMode) {
      coveringSpareByRoute.forEach((spareTruck, routeTruck) => {
        if (truckStatusByNumber.get(routeTruck) !== "oos") return;
        const spareStatus = truckStatusByNumber.get(spareTruck) ?? "dirty";
        if (spareStatus === "dirty" || spareStatus === "unloaded") {
          c[spareStatus] = (c[spareStatus] ?? 0) + 1;
        }
      });
    }

    return c;
  }, [data, runDayNum, holidayMode, fleetMode, coveringSpareByRoute, truckStatusByNumber]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (fleetMode) {
      if (fleetFilters.has("all")) return data;
      return data.filter((t) => {
        // "spare" rail button matches spare-type trucks that are NOT manually OOS
        if (fleetFilters.has("spare") && t.truck_type === "Spare" && t.state?.status !== "oos") return true;
        // spare-type trucks that are OOS match by effectiveStatus like regular trucks
        if (t.truck_type === "Spare" && t.state?.status !== "oos") return false;
        return fleetFilters.has(effectiveStatus(t, runDayNum, holidayMode));
      });
    }
    if (filter === "all") return data;
    return data.filter((t) => {
      if (effectiveStatus(t, runDayNum, holidayMode) === filter) {
        if (filter === "unloaded" && t.truck_type === "Spare" && !t.state?.oos_spare_route && !t.route_swap_route) return false;
        return true;
      }

      // Covered OOS routes should appear in the workflow tab matching the covering truck.
      if (
        (filter === "dirty" || filter === "unloaded") &&
        (t.state?.status ?? "dirty") === "oos"
      ) {
        const spareTruck = coveringSpareByRoute.get(t.truck_number);
        if (spareTruck == null) return false;
        const spareStatus = truckStatusByNumber.get(spareTruck) ?? "dirty";
        return spareStatus === filter;
      }

      return false;
    });
  }, [data, filter, fleetMode, fleetFilters, runDayNum, holidayMode, coveringSpareByRoute, truckStatusByNumber]);

  // Live lookup so the open detail modal reflects refreshed board data.
  const detailTruck = useMemo(
    () =>
      detailNum == null
        ? null
        : (data ?? []).find((t) => t.truck_number === detailNum) ?? null,
    [data, detailNum],
  );

  return (
    <div className={fleetMode ? "flex flex-col md:flex-row h-full" : ""}>

      {/* ── Fleet filter rail ── */}
      {fleetMode && (
        <aside className="flex flex-col gap-1.5 border-b border-slate-800 p-2 md:w-36 md:shrink-0 md:gap-0.5 md:border-b-0 md:border-r md:overflow-y-auto md:pt-3">
          {/* Date row — always visible */}
          <div className="flex items-center gap-2 md:mb-3 md:block">
            <input
              className="input flex-1 text-xs md:w-full"
              type="date"
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
            />
            {!isReadOnly && (
              <button
                type="button"
                onClick={() => {
                  if (multiSelect) setSelectedTrucks(new Set());
                  setMultiSelect(v => !v);
                }}
                className={clsx(
                  "shrink-0 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors md:mb-2 md:w-full",
                  multiSelect ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                )}
              >
                {multiSelect ? "✓ Multi" : "Multi"}
              </button>
            )}
            {isArchive && (
              <p className="shrink-0 text-xs font-semibold text-amber-400 md:mt-1 md:text-center">Archive</p>
            )}
            {isFuture && (
              <p className="shrink-0 text-xs font-semibold text-sky-400 md:mt-1 md:text-center">Future</p>
            )}
          </div>
          {/* Filter pills — horizontal scroll on mobile, vertical list on desktop */}
          <div className="flex gap-1 overflow-x-auto pb-0.5 md:flex-col md:gap-0.5 md:overflow-x-visible md:pb-0">
          <button
            type="button"
            onClick={() => toggleFleetFilter("all")}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold transition-colors md:justify-between",
              fleetFilters.has("all") ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800",
            )}
          >
            <span>All</span>
            <span className="tabular-nums">{counts.total}</span>
          </button>
          {FLEET_RAIL_STATUSES.map((s) => {
            const active = !fleetFilters.has("all") && fleetFilters.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleFleetFilter(s)}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 py-1.5 text-xs transition-colors md:justify-between",
                  active ? "bg-slate-700 font-semibold text-white" : "font-medium text-slate-400 hover:bg-slate-800",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className={clsx("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_BG[s])} />
                  {STATUS_LABELS[s]}
                </span>
                <span className="tabular-nums">{counts[s] ?? 0}</span>
              </button>
            );
          })}
          </div>

          {multiSelect && selectedTrucks.size > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
              <p className="text-xs font-semibold text-slate-400">{selectedTrucks.size} selected</p>
              <select
                className="input w-full text-xs"
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as TruckStatus)}
              >
                {FLEET_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={upsert.isPending}
                onClick={() => {
                  selectedTrucks.forEach((num) => {
                    const truck = data?.find((t) => t.truck_number === num);
                    upsert.mutate({
                      truck_number: num,
                      run_date: runDate,
                      status: bulkStatus,
                      wearers: truck?.state?.wearers ?? 0,
                    });
                  });
                  setSelectedTrucks(new Set());
                }}
                className="w-full rounded-md bg-blue-600 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                Apply to All
              </button>
              <button
                type="button"
                onClick={() => setSelectedTrucks(new Set())}
                className="w-full rounded py-1 text-xs text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            </div>
          )}

        </aside>
      )}

      {/* ── Main content ── */}
      <div className={fleetMode ? "flex-1 min-w-0 space-y-4 overflow-y-auto p-3" : "space-y-4 p-3 md:p-6"}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{fleetMode ? "Fleet" : "Truck Board"}</h2>
          <p className="text-sm text-slate-400">
            {counts.total ?? 0} trucks tracked for {runDate}
          </p>
        </div>
        <div className="flex items-end gap-3">
          {!fleetMode && (
            <div>
              <label className="label">Run date</label>
              <input
                className="input"
                type="date"
                max={todayIso()}
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
              />
            </div>
          )}
          {!fleetMode && (
            <div>
              <label className="label">Filter</label>
              <select
                className="input"
                value={filter}
                onChange={(e) => setFilter(e.target.value as TruckStatus | "all")}
              >
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]} ({counts[s] ?? 0})
                  </option>
                ))}
                <option value="off">Off ({counts["off"] ?? 0})</option>
              </select>
            </div>
          )}
          {!fleetMode && isAdmin && !isReadOnly && (
            <button
              type="button"
              onClick={() => {
                setMultiSelect((v) => !v);
                setSelectedTrucks(new Set());
              }}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                multiSelect
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700",
              )}
            >
              {multiSelect ? "✓ Bulk" : "Bulk change"}
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {error && (
        <p className="text-red-400">Failed to load board. Is the backend running?</p>
      )}

      {fleetMode && data && <RouteCardPanel data={data} runDate={runDate} />}

      {filter === "in_progress" && (
        <LiveInProgress runDate={runDate} />
      )}

      {filter === "loaded" && !fleetMode && (
        <div className="flex justify-end">
          <a
            href={counts["unloaded"] ? `/board?status=unloaded` : undefined}
            className={clsx(
              "rounded-md border px-4 py-2 text-sm font-semibold transition-colors",
              counts["unloaded"]
                ? "border-blue-500/60 bg-blue-950/40 text-blue-300 hover:bg-blue-900/40"
                : "cursor-not-allowed border-slate-700 bg-slate-800/40 text-slate-600",
            )}
            aria-disabled={!counts["unloaded"]}
            onClick={(e) => { if (!counts["unloaded"]) e.preventDefault(); }}
          >
            View Unloaded Trucks{counts["unloaded"] ? ` (${counts["unloaded"]})` : ""}
          </a>
        </div>
      )}

      {filter !== "in_progress" && (
      <div className={clsx(
        "grid gap-3",
        fleetMode
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"
          : filter === "off" || filter === "dirty" || filter === "unloaded"
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          : "grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
      )}>
        {filtered.map((t) => {
          const status = effectiveStatus(t, runDayNum, holidayMode);
          return (
            <div key={t.truck_number} className={clsx("card space-y-2 cursor-pointer", fleetMode ? "p-3" : filter === "off" || filter === "dirty" || filter === "unloaded" ? "p-5" : "p-4", fleetMode && status === "oos" && !selectedTrucks.has(t.truck_number) && "opacity-50 grayscale", !fleetMode && detailNum === t.truck_number && "ring-2 ring-blue-500", "hover:ring-2 hover:ring-blue-500 transition-shadow", fleetMode && multiSelect && selectedTrucks.has(t.truck_number) && "ring-2 ring-blue-400")}
              onClick={() => {
                if (multiSelect) {
                  setSelectedTrucks((prev) => {
                    const next = new Set(prev);
                    if (next.has(t.truck_number)) next.delete(t.truck_number);
                    else next.add(t.truck_number);
                    return next;
                  });
                  return;
                }
                if (filter === "dirty" && !fleetMode) {
                  if (batchingDisabled) {
                    upsert.mutate({
                      truck_number: t.truck_number,
                      run_date: runDate,
                      status: "unloaded",
                      wearers: t.state?.wearers ?? 0,
                    });
                  } else {
                    navigate(`/batches?truck=${t.truck_number}&run_date=${runDate}`);
                  }
                } else if (filter === "unloaded" && !fleetMode) {
                  setConfirmTruck(t);
                } else {
                  setDetailNum(detailNum === t.truck_number ? null : t.truck_number);
                }
              }}
            >
              <div className="flex w-full flex-col gap-1">
                <div className="flex w-full items-start justify-between">
                  {!fleetMode && t.state?.oos_spare_route != null ? (
                    <div className="flex flex-col leading-none gap-0.5">
                      <span className="text-3xl font-extrabold tabular-nums tracking-tight text-sky-300">
                        Rt {t.state.oos_spare_route}
                      </span>
                      <span className="text-xl font-bold tabular-nums text-slate-400">
                        → #{t.truck_number}
                      </span>
                    </div>
                  ) : (
                    <span className={clsx(
                      "font-extrabold tracking-tight tabular-nums leading-none",
                      fleetMode ? "text-3xl" : filter === "off" || filter === "dirty" || filter === "unloaded" ? "text-5xl" : "text-4xl",
                      fleetMode ? STATUS_TEXT[status] : (filter === "unloaded" ? "hover:text-green-300" : "hover:text-blue-300"),
                    )}>
                      #{t.truck_number}
                    </span>
                  )}
                  <span className="flex h-9 flex-col items-end justify-start gap-0.5">
                    {fleetMode && status === "off" && (t.state?.status === "dirty" || t.state?.status === "unloaded") && (
                      <span className={clsx("badge", STATUS_BG[t.state.status as TruckStatus], STATUS_BADGE_TEXT[t.state.status as TruckStatus])}>
                        {STATUS_LABELS[t.state.status as TruckStatus]}
                      </span>
                    )}
                    <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
                      {STATUS_LABELS[status]}
                    </span>
                  </span>
                </div>
                {!fleetMode && filter === "dirty" && (
                  <span className="flex w-full items-center justify-center gap-1 rounded bg-blue-600/20 px-2 py-1 text-xs font-semibold text-blue-300">
                    {batchingDisabled ? "Mark Unloaded" : "Assign to Batch →"}
                  </span>
                )}
              </div>
              {!fleetMode && filter === "unloaded" && (
                <>
                  {!batchingDisabled && !skipBatchingDisabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmTruck(t);
                      }}
                      className="flex w-full items-center justify-center gap-1 rounded bg-amber-600/20 px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-600/30"
                    >
                      Skip Batching →
                    </button>
                  )}
                  <div className="text-xs text-slate-400">
                    {t.truck_type}{t.state?.batch_id != null ? ` · Batch ${t.state.batch_id}` : ""}
                  </div>
                </>
              )}
              {t.state?.batch_id != null && !fleetMode && filter !== "unloaded" && (
                <div className="text-xs text-slate-400">Batch {t.state.batch_id}</div>
              )}

              {fleetMode && (
                <div className="text-xs text-slate-400">
                  {t.truck_type}
                  {t.state?.oos_spare_route != null ? ` · Covering #${t.state.oos_spare_route}` : ""}
                  {t.route_swap_route != null ? ` · Swap Route #${t.route_swap_route}` : ""}
                  {t.state?.batch_id != null ? ` · Batch ${t.state.batch_id}` : ""}
                </div>
              )}
              {fleetMode && !multiSelect && !isReadOnly && status !== "oos" && (
                <select
                  className="input text-xs"
                  value={status}
                  disabled={upsert.isPending}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    upsert.mutate({
                      truck_number: t.truck_number,
                      run_date: runDate,
                      status: e.target.value as TruckStatus,
                      wearers: t.state?.wearers ?? 0,
                    })
                  }
                >
                  {FLEET_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
              {fleetMode && status === "oos" && (
                <p className="text-xs text-slate-500 italic">Tap to remove OOS</p>
              )}
            </div>
          );
        })}
        {!isLoading && filtered.length === 0 && (
          <p className="col-span-full text-slate-500">No trucks match this filter.</p>
        )}
      </div>
      )}

      {detailTruck && fleetMode && (
        <TruckDetailModal
          truck={detailTruck}
          runDate={runDate}
          fleetMode={fleetMode}
          readOnly={isReadOnly}
          onClose={() => setDetailNum(null)}
        />
      )}

      {detailTruck && !fleetMode && (
        <TruckDetailPanel
          truck={detailTruck}
          runDate={runDate}
          onClose={() => setDetailNum(null)}
        />
      )}

      {confirmTruck && (
        <StartLoadModal
          truck={confirmTruck}
          blockedBy={inProgressTruck ?? null}
          busy={upsert.isPending}
          onConfirm={async () => {
            await startLoad(confirmTruck);
            setConfirmTruck(null);
            navigate("/board?status=in_progress");
          }}
          onClose={() => setConfirmTruck(null)}
        />
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Start Load confirmation dialog
// ---------------------------------------------------------------------------

function StartLoadModal({
  truck,
  blockedBy,
  busy,
  onConfirm,
  onClose,
}: {
  truck: TruckWithState;
  blockedBy: TruckWithState | null;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const isBlocked = blockedBy !== null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header stripe */}
        <div className={clsx(
          "px-6 py-5",
          isBlocked ? "bg-amber-950/60" : "bg-slate-800",
        )}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {isBlocked ? "Blocked" : "Start Loading"}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-slate-100">
            Truck #{truck.truck_number}
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">{truck.truck_type}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {isBlocked ? (
            <div className="flex items-start gap-3 rounded-lg bg-amber-950/40 border border-amber-700/40 px-4 py-3">
              <span className="mt-0.5 text-amber-400 text-lg leading-none">⚠</span>
              <div>
                <p className="text-sm font-medium text-amber-300">
                  Truck #{blockedBy!.truck_number} is already loading
                </p>
                <p className="text-xs text-amber-500 mt-0.5">
                  Finish or cancel the current load before starting another.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Mark this truck as <span className="font-semibold text-slate-200">In Progress</span> and begin the load timer?
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition"
              onClick={onClose}
            >
              Cancel
            </button>
            {!isBlocked && (
              <button
                className="flex-1 rounded-lg bg-green-700 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50 transition"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? "Starting…" : "Start Loading"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Truck detail panel (inline V1-style, non-fleet)
// ---------------------------------------------------------------------------

function TruckDetailPanel({
  truck,
  runDate,
  onClose,
}: {
  truck: TruckWithState;
  runDate: string;
  onClose: () => void;
}) {
  const { data: shorts } = useShortages(runDate, truck.truck_number);
  const { data: audits } = useAuditEntries(runDate);
  const truckAudits = (audits ?? []).filter(
    (a) => a.truck_number === truck.truck_number,
  );
  const status = (truck.state?.status ?? "dirty") as TruckStatus;

  function fmtDuration(sec: number | null | undefined) {
    if (!sec) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function fmtTime(ts: number | null | undefined) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString();
  }

  const stats: { label: string; value: React.ReactNode }[] = [
    { label: "Route", value: `Route #${truck.truck_number}` },
    { label: "Batch", value: truck.state?.batch_id ?? "—" },
    { label: "Wearers", value: truck.state?.wearers ?? 0 },
    { label: "Type", value: truck.truck_type },
    { label: "Duration", value: fmtDuration(truck.state?.load_duration_seconds) },
    { label: "Started", value: fmtTime(truck.state?.load_start_time) },
    { label: "Finished", value: fmtTime(truck.state?.load_finish_time) },
    { label: "Status", value: STATUS_LABELS[status] ?? status },
  ];

  return (
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      {/* Header */}
      <div className="relative flex items-center justify-center px-6 py-5 border-b border-slate-800">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {truck.truck_type} · {truck.is_active ? "Active" : "Inactive"}
            {truck.is_persistent_spare ? " · Persistent spare" : ""}
          </p>
          <h2 className="mt-0.5 text-4xl font-black uppercase tracking-widest text-white">
            TRUCK #{truck.truck_number}
          </h2>
        </div>
        <button
          className="absolute right-6 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-4">
        {stats.map(({ label, value }, i) => (
          <div
            key={label}
            className="border-b border-r border-slate-800 px-5 py-4 last:border-r-0 [&:nth-child(2n)]:md:border-r [&:nth-child(4n)]:md:border-r-0"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-base font-semibold text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="space-y-4 px-6 py-5">
        {(truck.state?.off_note || truck.state?.shop_note) && (
          <div className="rounded-md bg-slate-950/60 border border-slate-800 px-4 py-3 text-sm space-y-1">
            {truck.state?.off_note && (
              <p>
                <span className="font-semibold text-amber-300">OFF note:</span>{" "}
                {truck.state.off_note}
              </p>
            )}
            {truck.state?.shop_note && (
              <p>
                <span className="font-semibold text-purple-300">SHOP note:</span>{" "}
                {truck.state.shop_note}
              </p>
            )}
          </div>
        )}

        {(shorts ?? []).length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Shortages ({(shorts ?? []).length})
            </h4>
            <ul className="divide-y divide-slate-800 text-sm">
              {(shorts ?? []).map((s) => (
                <li key={s.id} className="py-1.5">
                  <span className="font-medium">{s.item_category}</span>
                  {s.item_detail && (
                    <span className="text-slate-400"> — {s.item_detail}</span>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    qty {s.quantity} · {s.initials || "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {truckAudits.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Audit entries ({truckAudits.length})
            </h4>
            <ul className="divide-y divide-slate-800 text-sm">
              {truckAudits.map((a) => (
                <li key={a.id} className="py-1.5">
                  <span className="font-medium">{a.item_label}</span>{" "}
                  <span className="text-xs text-slate-500">qty {a.quantity}</span>
                  {a.warn_on_next_load && (
                    <span className="badge ml-2 bg-amber-700/70">Warn</span>
                  )}
                  {a.note && <p className="text-xs text-slate-400">{a.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Truck detail modal
// ---------------------------------------------------------------------------

function TruckDetailModal({
  truck,
  runDate,
  fleetMode,
  readOnly = false,
  onClose,
}: {
  truck: TruckWithState;
  runDate: string;
  fleetMode: boolean;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { data: shorts } = useShortages(runDate, truck.truck_number);
  const { data: audits } = useAuditEntries(runDate);
  const truckAudits = (audits ?? []).filter(
    (a) => a.truck_number === truck.truck_number,
  );
  const status = (truck.state?.status ?? "dirty") as TruckStatus;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div>
            <h3 className="text-xl font-semibold">Truck #{truck.truck_number}</h3>
            <p className="text-xs text-slate-400">
              {truck.truck_type} · {truck.is_active ? "Active" : "Inactive"}
              {truck.is_persistent_spare ? " · Persistent spare" : ""}
            </p>
            {readOnly && (
              <p className="mt-0.5 text-xs font-semibold text-amber-400">Archive — read only</p>
            )}
          </div>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          {!readOnly && <StatusEditor truck={truck} runDate={runDate} status={status} />}

          {fleetMode && !readOnly && (
            <FleetTruckEditor truck={truck} runDate={runDate} />
          )}

          <section className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Wearers" value={truck.state?.wearers ?? 0} />
            <Stat label="Batch" value={truck.state?.batch_id ?? "—"} />
            <Stat label="Load day" value={truck.state?.load_day_num ?? "—"} />
            <Stat
              label="Load duration"
              value={
                truck.state?.load_duration_seconds
                  ? `${Math.round(truck.state.load_duration_seconds / 60)} min`
                  : "—"
              }
            />
            <Stat
              label="OOS covers route"
              value={truck.state?.oos_spare_route ?? "—"}
            />
          </section>

          {(truck.state?.off_note || truck.state?.shop_note) && (
            <section className="rounded-md bg-slate-950/60 p-3 text-sm">
              {truck.state?.off_note && (
                <p>
                  <span className="font-semibold text-amber-300">OFF note:</span>{" "}
                  {truck.state.off_note}
                </p>
              )}
              {truck.state?.shop_note && (
                <p>
                  <span className="font-semibold text-purple-300">SHOP note:</span>{" "}
                  {truck.state.shop_note}
                </p>
              )}
            </section>
          )}

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Shortages today ({(shorts ?? []).length})
            </h4>
            {(shorts ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No shortages recorded.</p>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm">
                {(shorts ?? []).map((s) => (
                  <li key={s.id} className="py-1.5">
                    <span className="font-medium">{s.item_category}</span>
                    {s.item_detail && (
                      <span className="text-slate-400"> — {s.item_detail}</span>
                    )}
                    <span className="ml-2 text-xs text-slate-500">
                      qty {s.quantity} · {s.initials || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Audit entries today ({truckAudits.length})
            </h4>
            {truckAudits.length === 0 ? (
              <p className="text-sm text-slate-500">No audit entries.</p>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm">
                {truckAudits.map((a) => (
                  <li key={a.id} className="py-1.5">
                    <span className="font-medium">{a.item_label}</span>{" "}
                    <span className="text-xs text-slate-500">qty {a.quantity}</span>
                    {a.warn_on_next_load && (
                      <span className="badge ml-2 bg-amber-700/70">Warn</span>
                    )}
                    {a.note && (
                      <p className="text-xs text-slate-400">{a.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// Days numbered 1-5 (Mon=1 … Fri=5) matching the off_schedule_defaults convention.
const DAY_LABELS: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" };

function FleetTruckEditor({ truck, runDate }: { truck: TruckWithState; runDate: string }) {
  const update = useUpdateTruck();
  const upsertState = useUpsertTruckState();
  const offDays: number[] = truck.scheduled_off_days ?? [];
  const [editingOffDays, setEditingOffDays] = useState(false);
  const [pendingOffDays, setPendingOffDays] = useState<number[]>([]);
  const isOos = (truck.state?.status ?? "dirty") === "oos";

  function toggleOos(checked: boolean) {
    upsertState.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      status: checked ? "oos" : "dirty",
      wearers: truck.state?.wearers ?? 0,
    });
  }

  function openOffDayEditor() {
    setPendingOffDays([...offDays]);
    setEditingOffDays(true);
  }

  function cancelOffDayEdit() {
    setEditingOffDays(false);
    setPendingOffDays([]);
  }

  function togglePendingOffDay(day: number) {
    setPendingOffDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...new Set([...prev, day])].sort((a, b) => a - b),
    );
  }

  function saveOffDays() {
    update.mutate(
      { truck_number: truck.truck_number, scheduled_off_days: pendingOffDays },
      { onSuccess: () => { setEditingOffDays(false); setPendingOffDays([]); } },
    );
  }

  function togglePersistentSpare(checked: boolean) {
    update.mutate({
      truck_number: truck.truck_number,
      is_persistent_spare: checked,
    });
    upsertState.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      status: checked ? "spare" : "dirty",
    });
  }

  return (
    <section className="rounded-md border border-slate-700 bg-slate-950/40 p-3 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Fleet settings
      </p>

      {/* Persistent spare */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Persistent spare</p>
          <p className="text-xs text-slate-500">
            This truck permanently covers a route as a spare — not part of the normal load cycle.
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={truck.is_persistent_spare}
            disabled={update.isPending}
            onChange={(e) => togglePersistentSpare(e.target.checked)}
          />
          <div className="h-6 w-11 rounded-full bg-slate-700 peer-checked:bg-indigo-600 peer-disabled:opacity-50 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Out of Service */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Out of Service (OOS)</p>
          <p className="text-xs text-slate-500">
            Truck is unavailable for today's run and needs coverage.
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={isOos}
            disabled={upsertState.isPending}
            onChange={(e) => toggleOos(e.target.checked)}
          />
          <div className="h-6 w-11 rounded-full bg-slate-700 peer-checked:bg-red-600 peer-disabled:opacity-50 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Scheduled off days — hidden for spare trucks */}
      {!truck.is_persistent_spare && truck.truck_type !== "Spare" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-200">Scheduled off days</p>
            {!editingOffDays && (
              <button
                type="button"
                onClick={openOffDayEditor}
                className="rounded px-2 py-1 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
              >
                Edit schedule
              </button>
            )}
          </div>

          {editingOffDays ? (
            <>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(DAY_LABELS) as [string, string][]).map(([dayStr, label]) => {
                  const day = Number(dayStr);
                  const active = pendingOffDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={update.isPending}
                      onClick={() => togglePendingOffDay(day)}
                      className={clsx(
                        "flex flex-col items-center rounded-md px-3 py-1.5 text-sm font-medium transition leading-tight",
                        active
                          ? "bg-red-800 text-red-100"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                      )}
                    >
                      <span>{label}</span>
                      <span className="text-xs opacity-70">Day {day}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {pendingOffDays.length === 0
                  ? "Runs every day."
                  : `Off on ${pendingOffDays.map((d) => `Day ${d} (${DAY_LABELS[d] ?? d})`).join(", ")}.`}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={saveOffDays}
                  disabled={update.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition"
                >
                  {update.isPending ? "Saving…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={cancelOffDayEdit}
                  disabled={update.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              {offDays.length === 0
                ? "Runs every day."
                : `Off on ${offDays.map((d) => `Day ${d} (${DAY_LABELS[d] ?? d})`).join(", ")}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-slate-950/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-medium text-slate-100">{value}</p>
    </div>
  );
}

/**
 * Single place where a truck's status can be changed manually. Lives inside
 * the truck-detail modal (the "fleet management" view for a single truck).
 * The tile grid intentionally omits this control to keep status changes
 * deliberate rather than accidental from a filtered status board.
 */
function StatusEditor({
  truck,
  runDate,
  status,
}: {
  truck: TruckWithState;
  runDate: string;
  status: TruckStatus;
}) {
  const upsert = useUpsertTruckState();
  return (
    <section className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
      <label className="label">Status</label>
      <div className="flex items-center gap-2">
        <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
          {STATUS_LABELS[status]}
        </span>
        <select
          className="input flex-1"
          value={status}
          disabled={upsert.isPending}
          onChange={(e) =>
            upsert.mutate({
              truck_number: truck.truck_number,
              run_date: runDate,
              status: e.target.value as TruckStatus,
              wearers: truck.state?.wearers ?? 0,
            })
          }
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
        Manual override — workflow pages drive normal transitions.
      </p>
    </section>
  );
}
