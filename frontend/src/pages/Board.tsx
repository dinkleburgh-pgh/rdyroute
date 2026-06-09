import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useAuditEntries,
  useAssignSpare,
  useBoard,
  useBulkUpdateStatus,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  useHolidayUnload,
  useReturnSpare,
  useRouteSwaps,
  useSettings,
  useShortages,
  useSpareAssignments,
  useUpdateTruck,
  useUpsertTruckState,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import { todayIso } from "../api/client";
import { shipDayNumber, workdayNumbers } from "../components/Clock";
import { format } from "date-fns";
import type { RouteSwap, SpareAssignment, TruckStatus, TruckWithState } from "../types";
import { effectiveStatus, getSwapHistory, recordSwapHistory } from "../utils/truckStatus";
import { LiveInProgress } from "../components/LiveInProgress";
import clsx from "clsx";
import {
  STATUS_LABELS,
  STATUS_BG,
  STATUS_TEXT,
  STATUS_BADGE_TEXT,
  STATUS_OPTIONS,
  FLEET_STATUS_OPTIONS,
  FLEET_RAIL_STATUSES,
  DustGarmentIcon,
} from "./board/constants";
import { useOutsideTimer, usePaperBayTimer, fmtCountdown } from "./board/useOutsideTimer";
import RouteCardPanel from "./board/RouteCardPanel";
import StartLoadModal from "./board/StartLoadModal";
import TruckDetailPanel from "./board/TruckDetailPanel";
import TruckDetailModal from "./board/TruckDetailModal";
import AnimateCard from "../components/AnimateCard";
import { motion } from "framer-motion";

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
  const [pendingOosTruck, setPendingOosTruck] = useState<TruckWithState | null>(null);
  const [holdAlertTruck, setHoldAlertTruck] = useState<TruckWithState | null>(null);
  const [oosAssignOpen, setOosAssignOpen] = useState<Set<number>>(new Set());
  const [oosCardSelects, setOosCardSelects] = useState<Record<number, string>>({});
  const [pendingOffLoadTruck, setPendingOffLoadTruck] = useState<TruckWithState | null>(null);
  const [pendingOffLoadRoute, setPendingOffLoadRoute] = useState<string>("");
  const [pendingOffLoadError, setPendingOffLoadError] = useState<string | null>(null);
  const [offCoverageTruck, setOffCoverageTruck] = useState<TruckWithState | null>(null);
  const [offCoverageLoadOn, setOffCoverageLoadOn] = useState<string>("");
  const [offCoverageError, setOffCoverageError] = useState<string | null>(null);
  const isArchive = runDate < todayIso();
  const isFuture  = runDate > todayIso();
  const isReadOnly = runDate !== todayIso();
  const { data, isLoading, error } = useBoard(runDate);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate, false);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const { data: settings } = useSettings();
  const upsert = useUpsertTruckState();
  const updateTruck = useUpdateTruck();
  const bulkUpdate = useBulkUpdateStatus();
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const assignSpare = useAssignSpare();
  const returnSpare = useReturnSpare();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor";
  const navigate = useNavigate();

  const { runDayNum, runUnloadsDay } = useMemo(() => {
    const [y, m, d] = runDate.split("-").map(Number);
    const wd = workdayNumbers(new Date(y, m - 1, d));
    return { runDayNum: wd.loadDay, runUnloadsDay: wd.unloadsDay };
  }, [runDate]);

  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);

  // Holiday "extra" day is the previous ship day (Mon=1 wraps to Fri=5)
  const loadDay2 = runDayNum === 1 ? 5 : runDayNum - 1;
  const unloadsDay2 = runUnloadsDay === 1 ? 5 : runUnloadsDay - 1;
  // Trucks off on loadDay OR the day after are both in the Day-minus-1 catch-up batch.
  const loadNextDay = runDayNum === 5 ? 1 : runDayNum + 1;

  const batchingDisabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "batching_disabled")?.value === true,
    [settings],
  );

  const outsideTimerEnabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "outside_timer_enabled")?.value === true,
    [settings],
  );

  const paperBayEnabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "paper_bay_enabled")?.value === true,
    [settings],
  );

  const outsideTimerMinutes = useMemo(() => {
    const v = (settings ?? []).find((s) => s.key === "outside_timer_minutes")?.value;
    return typeof v === "number" && v > 0 ? v : undefined;
  }, [settings]);

  const paperBayTimerMinutes = useMemo(() => {
    const v = (settings ?? []).find((s) => s.key === "paper_bay_timer_minutes")?.value;
    return typeof v === "number" && v > 0 ? v : undefined;
  }, [settings]);

  // --- Outside timer ---
  const { countdowns: outsideCountdowns, start: startOutsideTimer, cancel: cancelOutsideTimer } =
    useOutsideTimer(runDate, data, upsert, outsideTimerMinutes);
  const outsideTimers = outsideCountdowns;

  // --- Paper Bay timer ---
  const { countdowns: paperBayCountdowns, start: startPaperBayTimer, cancel: cancelPaperBayTimer } =
    usePaperBayTimer(runDate, data, upsert, cancelOutsideTimer, paperBayTimerMinutes);
  const paperBayTimers = paperBayCountdowns;

  const inProgressTruck = useMemo(
    () => (data ?? []).find((t) => t.state?.status === "in_progress"),
    [data],
  );

  const coveringSpareByRoute = useMemo(
    () => new Map<number, number>(spareAssignments.map((a) => [a.covering_route_truck, a.spare_truck_number])),
    [spareAssignments],
  );

  // Unified: OOS route truck number → {truckNumber, status} of the covering truck
  // Combines spare assignments (SpareAssignment rows) and route swaps.
  const coveringTruckByRoute = useMemo(() => {
    const m = new Map<number, { num: number; status: TruckStatus | undefined }>();
    for (const a of spareAssignments) {
      const st = (data ?? []).find((t) => t.truck_number === a.spare_truck_number);
      m.set(a.covering_route_truck, {
        num: a.spare_truck_number,
        status: (st?.state?.status as TruckStatus | undefined),
      });
    }
    for (const s of routeSwaps) {
      if (!m.has(s.route_truck)) {
        const st = (data ?? []).find((t) => t.truck_number === s.load_on_truck);
        m.set(s.route_truck, {
          num: s.load_on_truck,
          status: st ? effectiveStatus(st, runDayNum, holidayLoad) : undefined,
        });
      }
    }
    return m;
  }, [spareAssignments, routeSwaps, data, runDayNum, holidayLoad]);

  const truckStatusByNumber = useMemo(
    () => new Map<number, TruckStatus>((data ?? []).map((t) => [t.truck_number, effectiveStatus(t, runDayNum, holidayLoad)])),
    [data, runDayNum, holidayLoad],
  );

  async function startLoad(t: TruckWithState) {
    if (t.state?.priority_hold) return;
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

  async function finalizeOffTruckAsLoaded(mode: "route" | "special") {
    if (!pendingOffLoadTruck) return;
    const truck = pendingOffLoadTruck;
    setPendingOffLoadError(null);
    try {
      let note: string;
      if (mode === "route") {
        const routeTruck = parseInt(pendingOffLoadRoute, 10);
        if (!Number.isFinite(routeTruck)) {
          setPendingOffLoadError("Pick a route truck first.");
          return;
        }
        note = `Ran Special — Rt #${routeTruck}`;
      } else {
        note = "Ran Special";
      }
      const prev = (truck.state?.off_note ?? "").trim();
      const nextNote = prev ? `${prev} | ${note}` : note;
      await upsert.mutateAsync({
        truck_number: truck.truck_number,
        run_date: runDate,
        status: "loaded",
        wearers: truck.state?.wearers ?? 0,
        off_note: nextNote,
      });
      setPendingOffLoadTruck(null);
      setPendingOffLoadRoute("");
      setPendingOffLoadError(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setPendingOffLoadError(e?.response?.data?.detail ?? "Failed to set loaded status.");
    }
  }

  // Derive filter directly from URL so sidebar nav always takes effect
  const filter = (params.get("status") as TruckStatus | "hold" | null) ?? "all";

  function setFilter(value: TruckStatus | "hold" | "all") {
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
      if (fleetMode && t.truck_type === "Spare" && t.state?.status !== "oos") {
        // In fleet mode, spares covering an OOS route count in their real
        // lifecycle bucket (e.g. "unloaded"). Idle spares with no OOS
        // assignment go in the "spare" bucket so the spare rail shows
        // available trucks. Active non-OOS spares also use lifecycle bucket.
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
        const isOosCoverage = coveredRoute != null && truckStatusByNumber.get(coveredRoute) === "oos";
        const s = effectiveStatus(t, runDayNum, holidayLoad);
        const isIdle = s === "dirty" || s === "off" || s === "unloaded";
        if (!isOosCoverage && isIdle) {
          c.spare = (c.spare ?? 0) + 1;
        } else {
          c[s] = (c[s] ?? 0) + 1;
        }
      } else if (!fleetMode && t.truck_type === "Spare") {
        // In non-fleet mode, a spare counts in lifecycle buckets only when it
        // is actively covering an OOS route — same predicate as `filtered`
        // below. This keeps the filter dropdown count and the rendered card
        // list in lockstep (was previously divergent for route-swap spares,
        // which made the page look like it "wasn't updating").
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
        if (coveredRoute != null && truckStatusByNumber.get(coveredRoute) === "oos") {
          const s = effectiveStatus(t, runDayNum, holidayLoad);
          c[s] = (c[s] ?? 0) + 1;
        }
      } else {
        const loadDayEff = effectiveStatus(t, runDayNum, holidayLoad);
        let s = loadDayEff;
        // Non-fleet board: re-evaluate auto-off trucks against unloadsDay so
        // dirty/unloaded trucks that ran today but don't load tomorrow count
        // in their real status bucket rather than "off".
        if (!fleetMode && s === "off") {
          const raw = (t.state?.status ?? "dirty") as TruckStatus;
          if (raw === "dirty" || raw === "unloaded") {
          s = effectiveStatus(t, runUnloadsDay, holidayUnload);
          }
        }
        c[s] = (c[s] ?? 0) + 1;
        // Also count in "off" when scheduled off for load day but shown in
        // an unload-context bucket (off = not loading tomorrow).
        if (!fleetMode && loadDayEff === "off" && s !== "off") {
          c.off = (c.off ?? 0) + 1;
        }
      }
    });

    return c;
  }, [data, runDayNum, runUnloadsDay, holidayLoad, fleetMode, truckStatusByNumber]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (fleetMode) {
      if (fleetFilters.has("all")) return data;
      return data.filter((t) => {
        if (t.truck_type === "Spare" && t.state?.status !== "oos") {
          const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
          const isOosCoverage = coveredRoute != null && truckStatusByNumber.get(coveredRoute) === "oos";
          const s = effectiveStatus(t, runDayNum, holidayLoad);
          if (isOosCoverage) {
            // This spare is covering an OOS route — it matches its real
            // lifecycle status (unloaded, loaded, in_progress, etc.)
            return fleetFilters.has(s);
          }
          const isIdle = s === "dirty" || s === "off" || s === "unloaded";
          // Idle spares match the "spare" filter; active spares match their lifecycle filter
          return isIdle ? fleetFilters.has("spare") : fleetFilters.has(s);
        }
        return fleetFilters.has(effectiveStatus(t, runDayNum, holidayLoad));
      });
    }
    if (filter === "all") return data;
    if (filter === "hold") return data.filter((t) => t.state?.priority_hold === true);
    return data.filter((t) => {
      const loadDayEff = effectiveStatus(t, runDayNum, holidayLoad);
      // For the "off" filter use load-day effectiveStatus directly so trucks
      // scheduled off tomorrow appear here even if they still need unloading today.
      if (filter === "off") {
        if (loadDayEff !== "off") return false;
        if (t.truck_type === "Spare") {
          const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
          if (coveredRoute == null) return false;
          return truckStatusByNumber.get(coveredRoute) === "oos";
        }
        return true;
      }
      // "spare" is a truck type, not a raw status — effectiveStatus never returns it.
      // Match Spare-type trucks (both idle and covering OOS routes).
      if (filter === "spare") {
        if (t.truck_type !== "Spare") return false;
        return true;
      }
      // For all other filters, re-evaluate auto-off trucks against unloadsDay
      // so they surface under their real workflow status.
      let s = loadDayEff;
      if (s === "off") {
        const raw = (t.state?.status ?? "dirty") as TruckStatus;
        if (raw === "dirty" || raw === "unloaded") {
          s = effectiveStatus(t, runUnloadsDay, holidayLoad);
        }
      }
      // In dirty view, also include unfinished trucks (rendered as a sub-section)
      const matchStatus = filter === "dirty" ? (s === "dirty" || s === "unfinished") : s === filter;
      if (!matchStatus) return false;
      if (t.truck_type === "Spare") {
        // Show a spare card in a lifecycle-status filter only when it is
        // actively covering an OOS route (the spare represents that route),
        // or when the filter is "dirty" and the spare has dirty status,
        // or when the filter is "unloaded" and the spare is unloaded.
        // Idle spares and spares assigned to non-OOS routes are hidden from
        // other lifecycle filters (loaded, etc.) — the route
        // truck's own card already represents the route.
        if (filter === "dirty" && (t.state?.status === "dirty" || t.state == null)) return true;
        if (filter === "unloaded" && t.state?.status === "unloaded") return true;
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
        if (coveredRoute == null) return false;
        return truckStatusByNumber.get(coveredRoute) === "oos";
      }
      return true;
    });
  }, [data, filter, fleetMode, fleetFilters, runDayNum, holidayLoad, truckStatusByNumber]);

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

          {multiSelect && (
            <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400">{selectedTrucks.size} selected</p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-sky-400 hover:bg-slate-800"
                    onClick={() => setSelectedTrucks(new Set(filtered.map((t) => t.truck_number)))}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                    onClick={() => setSelectedTrucks(new Set())}
                  >
                    None
                  </button>
                </div>
              </div>
              {selectedTrucks.size > 0 && (
                <>
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
                </>
              )}
            </div>
          )}

        </aside>
      )}

      {/* ── Main content ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className={fleetMode ? "flex-1 min-w-0 space-y-4 overflow-y-auto p-3" : "space-y-4 p-3 md:p-6"}>
      {/* ── Page header ── */}
      {(() => {
        type HeaderCfg = { label: string; accent: string; sub: string };
        const fleet: HeaderCfg   = { label: "Fleet",       accent: "text-sky-400",       sub: "bg-sky-400/10 border-sky-400/20" };
        const headers: Record<string, HeaderCfg> = {
          all:         { label: "Truck Board",  accent: "text-slate-300",     sub: "bg-slate-700/20 border-slate-600/20" },
          dirty:       { label: "Dirty",        accent: "text-red-400",       sub: "bg-red-400/10 border-red-400/20" },
          shop:        { label: "Shop",         accent: "text-violet-400",    sub: "bg-violet-400/10 border-violet-400/20" },
          in_progress: { label: "In Progress",  accent: "text-amber-400",     sub: "bg-amber-400/10 border-amber-400/20" },
          unloaded:    { label: "Unloaded",     accent: "text-emerald-400",   sub: "bg-emerald-400/10 border-emerald-400/20" },
          loaded:      { label: "Loaded",       accent: "text-blue-400",      sub: "bg-blue-400/10 border-blue-400/20" },
          off:         { label: "Off",          accent: "text-slate-400",     sub: "bg-slate-400/10 border-slate-400/20" },
          oos:         { label: "",               accent: "text-slate-400",     sub: "bg-slate-400/10 border-slate-400/20" },
          spare:       { label: "",               accent: "text-cyan-400",      sub: "bg-cyan-400/10 border-cyan-400/20" },
        };
        const cfg = fleetMode ? fleet : (headers[filter] ?? headers.all);
        return cfg.label ? (
          <div className="mb-2 text-center">
            <h2 className={clsx("text-2xl font-black uppercase tracking-widest", cfg.accent)}>
              {cfg.label}
            </h2>
          </div>
        ) : null;
      })()}

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
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
          : filter === "off" || filter === "dirty" || filter === "unloaded"
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          : "grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
      )}>
        {(() => {
          type SentinelHeader = { __header: "dirty" | "unfinished" | "coverages" | "holdForLoading" | "outOfService" | "spareCoverages" | "idleSpares" | "unloadedRunning" | "unloadedSpare" | "unloadedOff"; count: number };
          type GridRow = TruckWithState | SentinelHeader;
          const rows: GridRow[] = [];
          if (!fleetMode && filter === "dirty") {
            const dirtyRows = filtered.filter((t) => effectiveStatus(t, runDayNum, holidayLoad) === "dirty");
            const unfinishedRows = filtered.filter((t) => effectiveStatus(t, runDayNum, holidayLoad) === "unfinished");
            const dirtyRouteRows = dirtyRows.filter((t) => t.truck_type !== "Spare" && t.route_swap_route == null && t.state?.oos_spare_route == null);
            const dirtyCoverageRows = dirtyRows.filter((t) => t.truck_type === "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null);
            rows.push(
              ...(dirtyCoverageRows.length > 0 ? [{ __header: "coverages", count: dirtyCoverageRows.length } as SentinelHeader, ...dirtyCoverageRows] : []),
              { __header: "dirty", count: dirtyRouteRows.length },
              ...dirtyRouteRows,
              { __header: "unfinished", count: unfinishedRows.length },
              ...unfinishedRows,
            );
          } else if (!fleetMode && filter === "spare") {
            const coveringSpares = filtered.filter((t) =>
              t.route_swap_route != null || t.state?.oos_spare_route != null
            );
            const idleSpares = filtered.filter((t) =>
              t.route_swap_route == null && t.state?.oos_spare_route == null
            );
            if (coveringSpares.length > 0) {
              rows.push(
                { __header: "spareCoverages", count: coveringSpares.length } as SentinelHeader,
                ...coveringSpares,
              );
            }
            if (idleSpares.length > 0) {
              rows.push(
                { __header: "idleSpares", count: idleSpares.length } as SentinelHeader,
                ...idleSpares,
              );
            }
          } else if (!fleetMode && filter === "unloaded") {
            const runningRows = filtered.filter((t) =>
              t.truck_type !== "Spare" &&
              effectiveStatus(t, runDayNum, holidayLoad) !== "off"
            );
            const offRows = filtered.filter((t) =>
              t.truck_type !== "Spare" &&
              effectiveStatus(t, runDayNum, holidayLoad) === "off"
            );
            const spareRows = filtered.filter((t) => t.truck_type === "Spare");
            if (spareRows.length > 0) {
              rows.push(
                { __header: "unloadedSpare", count: spareRows.length } as SentinelHeader,
                ...spareRows,
              );
            }
            if (runningRows.length > 0) {
              rows.push(
                { __header: "unloadedRunning", count: runningRows.length } as SentinelHeader,
                ...runningRows,
              );
            }
            if (offRows.length > 0) {
              rows.push(
                { __header: "unloadedOff", count: offRows.length } as SentinelHeader,
                ...offRows,
              );
            }
          } else if (!fleetMode && filter === "oos") {
            const holdRows = (data ?? []).filter((t) =>
              t.state?.priority_hold === true &&
              t.state?.status === "unloaded"
            );
            if (holdRows.length > 0) {
              rows.push(
                { __header: "holdForLoading", count: holdRows.length } as SentinelHeader,
                ...holdRows,
              );
            }
            rows.push(
              { __header: "outOfService", count: filtered.length } as SentinelHeader,
              ...filtered,
            );
          } else {
            rows.push(...filtered);
          }
          return rows.map((row, index) => {
            if ("__header" in row) {
              if (row.__header === "coverages") {
                return (
                  <div key={`header-${row.__header}`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-violet-400">
                      Spares / Coverages
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "holdForLoading") {
                return (
                  <div key={`header-holdForLoading`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-red-400">
                      Hold for Loading
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "outOfService") {
                return (
                  <div key={`header-outOfService`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-slate-400">
                      Out of Service
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "spareCoverages") {
                return (
                  <div key={`header-spareCoverages`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-violet-400">
                      Coverage
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "idleSpares") {
                return (
                  <div key={`header-idleSpares`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-cyan-400">
                      Spare
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "unloadedRunning") {
                return (
                  <div key={`header-unloadedRunning`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-emerald-400">
                      Day {runDayNum}
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "unloadedSpare") {
                return (
                  <div key={`header-unloadedSpare`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-cyan-400">
                      Spare
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              if (row.__header === "unloadedOff") {
                return (
                  <div key={`header-unloadedOff`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                    <span className="text-4xl font-black uppercase tracking-widest text-slate-400">
                      Off
                    </span>
                    <span className="text-sm font-medium text-slate-500">
                      {row.count} truck{row.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              }
              // Skip the dirty header — the page already has a "Dirty" heading.
              // Only render the Unfinished sub-section header.
              if (row.__header !== "unfinished") return null;
              return (
                <div key={`header-${row.__header}`} className="col-span-full my-2 flex flex-col items-center justify-center gap-1">
                  <span className="text-4xl font-black uppercase tracking-widest text-status-unfinished">
                    Unfinished
                  </span>
                  <span className="text-sm font-medium text-slate-500">
                    {row.count === 0 ? "none" : `${row.count} truck${row.count !== 1 ? "s" : ""}`}
                  </span>
                </div>
              );
            }
            const t = row;
            const status = effectiveStatus(t, runDayNum, holidayLoad);
            // Day chips — only visible during holiday mode, only for load/unload views
            const isUnloadView = filter === "dirty" || filter === "unloaded";
            const isLoadView = filter === "loaded";
            let chipDay: number | undefined;
            let chipIsExtra = false;
            if (isUnloadView && holidayUnload) {
              chipDay = (t.scheduled_off_days ?? []).includes(runUnloadsDay) ? unloadsDay2 : runUnloadsDay;
              chipIsExtra = chipDay === unloadsDay2;
            } else if (isLoadView && holidayLoad) {
              const offDaysLoad = t.scheduled_off_days ?? [];
              chipDay = (offDaysLoad.includes(runDayNum) || offDaysLoad.includes(loadNextDay)) ? loadDay2 : runDayNum;
              chipIsExtra = chipDay === loadDay2;
            }
            // Off filter: color the number by the truck's unload-context status (e.g. green
            // for unloaded, orange for dirty) instead of the muted "off" grey.
            const numberColor =
              status === "loaded"
                ? "text-sky-300"
                : !fleetMode && status === "off" && (filter === "off" || filter === "unloaded")
                ? STATUS_TEXT[effectiveStatus(t, runUnloadsDay, holidayLoad)]
                : fleetMode || filter === "unloaded"
                ? STATUS_TEXT[status]
                : "hover:text-blue-300";

            return (
            <AnimateCard key={t.truck_number} delay={index * 0.02} className={clsx("card cursor-pointer", fleetMode ? "p-4 flex flex-col gap-2 min-h-[10rem]" : ["space-y-2 min-h-[7.5rem]", filter === "off" || filter === "dirty" || filter === "unloaded" ? "p-5" : "p-4"],               fleetMode && status === "oos" && !selectedTrucks.has(t.truck_number) && "opacity-50 grayscale",
              fleetMode && t.state?.priority_hold && "animate-priority-glow border-2 border-red-500/30 bg-gradient-to-br from-slate-900 via-red-950/10 to-slate-900", !fleetMode && (filter === "oos" ? oosAssignOpen.has(t.truck_number) : detailNum === t.truck_number) && "ring-2 ring-blue-500", "hover:ring-2 hover:ring-blue-500 transition-shadow", fleetMode && multiSelect && selectedTrucks.has(t.truck_number) && "ring-2 ring-blue-400")}
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
                if (filter === "dirty" && !fleetMode && t.state?.status !== "oos") {
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
                  if (t.state?.priority_hold) {
                    setHoldAlertTruck(t);
                    return;
                  }
                  // Off+unloaded trucks need coverage assignment before loading.
                  // Route the click through the off-load modal instead of StartLoadModal.
                  if (effectiveStatus(t, runDayNum, holidayLoad) === "off") {
                    // Skip coverage prompt if a swap already exists for this route.
                    const alreadyCovered = routeSwaps.some((s) => s.route_truck === t.truck_number);
                    if (alreadyCovered) {
                      setConfirmTruck(t);
                    } else {
                      setOffCoverageTruck(t);
                      setOffCoverageLoadOn("");
                      setOffCoverageError(null);
                    }
                  } else {
                    setConfirmTruck(t);
                  }
                } else if (filter === "oos" && !fleetMode) {
                  if (t.state?.priority_hold) {
                    setHoldAlertTruck(t);
                    return;
                  }
                  setOosAssignOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(t.truck_number)) next.delete(t.truck_number);
                    else next.add(t.truck_number);
                    return next;
                  });
                } else {
                  setDetailNum(detailNum === t.truck_number ? null : t.truck_number);
                }
              }}
            >
              <div className="flex w-full flex-col gap-1">
                <div className="flex w-full items-start justify-between gap-2">
                  {/* Non-fleet: spare/swap covering truck shows which route it runs */}
                  {!fleetMode && (t.state?.oos_spare_route != null || t.route_swap_route != null) ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={clsx(
                        "font-extrabold tracking-tight tabular-nums leading-none",
                        filter === "off" || filter === "dirty" || filter === "unloaded" ? "text-5xl" : "text-4xl",
                        numberColor,
                      )}>
                        {t.truck_number}
                      </span>
                      <span className="inline-flex items-center gap-1 self-start rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                        Cov. #{t.state?.oos_spare_route ?? t.route_swap_route}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <span className={clsx(
                        "font-extrabold tracking-tight tabular-nums leading-none",
                        fleetMode ? "text-5xl" : filter === "off" || filter === "dirty" || filter === "unloaded" ? "text-5xl" : "text-4xl",
                        numberColor,
                      )}>
                        {t.truck_number}
                      </span>
                    </div>
                  )}
                  <span className="flex min-h-[2.25rem] flex-col items-end justify-start gap-0.5">
                    <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
                      {STATUS_LABELS[status]}
                    </span>
                    {t.state?.priority_hold && (
                      <span className="badge bg-red-700 text-white">Hold</span>
                    )}
                    {/* Fleet OOS: Cov badge + covering truck's raw status below OOS */}
                    {fleetMode && status === "oos" && (() => {
                      const cov = coveringTruckByRoute.get(t.truck_number);
                      if (!cov) return <span className="text-[10px] font-semibold text-amber-400">Needs assignment</span>;
                      const coveringTruck = data?.find((d) => d.truck_number === cov.num);
                      const rawStatus = coveringTruck?.state?.status
                        ? (coveringTruck.state.status as TruckStatus)
                        : cov.status;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDetailNum(cov.num); }}
                            className="inline-flex items-center gap-1 rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-sky-400"
                          >
                            Cov. #{cov.num}
                          </button>
                          {rawStatus && (
                            <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white", rawStatus === "dirty" && "bg-red-600", rawStatus === "unloaded" && "bg-green-600", rawStatus === "loaded" && "bg-blue-600", rawStatus === "in_progress" && "bg-amber-500", rawStatus === "off" && "bg-slate-500", rawStatus === "oos" && "bg-slate-600", rawStatus === "shop" && "bg-purple-600", rawStatus === "spare" && "bg-cyan-700", rawStatus === "unfinished" && "bg-fuchsia-600")}>
                              {STATUS_LABELS[rawStatus]}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    {(fleetMode || filter === "off" || filter === "unloaded") && status === "off" && (t.state?.status === "dirty" || t.state?.status === "unloaded") && (
                      <span className={clsx("badge", STATUS_BG[t.state.status as TruckStatus], STATUS_BADGE_TEXT[t.state.status as TruckStatus])}>
                        {STATUS_LABELS[t.state.status as TruckStatus]}
                      </span>
                    )}
                    {t.truck_type === "Dust" && t.state?.has_dust_garment && (
                      <span
                        className="inline-flex items-center justify-center rounded-full border border-amber-500/60 bg-amber-950/70 p-0.5"
                        title="Garments assigned"
                      >
                        <DustGarmentIcon className="h-3.5 w-3.5 text-amber-300" />
                      </span>
                    )}
                  </span>
                </div>
                {fleetMode && (
                  <div className="text-xs text-slate-400 space-y-0.5">
                    <div>
                      {t.truck_type}
                      {t.truck_type === "Uniform" && t.uniform_size != null && ` · ${t.uniform_size}ft`}
                      {t.state?.batch_id != null ? ` · Batch ${t.state.batch_id}` : ""}
                    </div>
                    {(() => {
                      // Show single coverage badge — never duplicate
                      if (status === "oos") {
                        // Cov badge + covering status now shown in the right-side status column
                        return null;
                      }
                      const cr = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
                      if (cr != null) {
                        return (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDetailNum(cr); }}
                            className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40 transition-colors hover:bg-sky-800/60 hover:ring-sky-400/60 cursor-pointer"
                          >
                            Cov. #{cr}
                          </button>
                        );
                      }
                      return null;
                    })()}
                    {t.state?.off_note?.toLowerCase().includes("ran special") && (
                      <span className="text-amber-300 font-medium">Ran Special</span>
                    )}
                  </div>
                )}
                {!fleetMode && filter === "dirty" && t.state?.status !== "oos" && (
                  <span className="flex w-full items-center justify-center gap-1 rounded bg-blue-600/20 px-2 py-1 text-xs font-semibold text-blue-300">
                    {batchingDisabled ? "Mark Unloaded" : "Assign to Batch →"}
                  </span>
                )}
              </div>
              {!fleetMode && filter === "unloaded" && (
                <div className="text-xs text-slate-400">
                  {t.truck_type}{t.state?.batch_id != null ? ` · Batch ${t.state.batch_id}` : ""}
                </div>
              )}
              {filter === "loaded" ? (
                <>
                  <div className="text-xs text-slate-400">
                    {t.truck_type}{t.state?.batch_id != null ? ` · Batch ${t.state.batch_id}` : ""}
                  </div>
                  {t.state?.load_finish_time && (
                    <div className="mt-auto pt-1 text-xs text-slate-500">
                      Done {format(new Date(t.state.load_finish_time * 1000), "h:mm a")}
                    </div>
                  )}
                </>
              ) : t.state?.batch_id != null && !fleetMode && filter !== "unloaded" && (
                <div className="text-xs text-slate-400">Batch {t.state.batch_id}</div>
              )}

              {chipDay != null && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    chipIsExtra ? "bg-amber-900/60 text-amber-300" : "bg-blue-900/60 text-blue-300",
                  )}>
                    Day {chipDay}
                  </span>
                </div>
              )}

              {/* OOS view: inline assignment panel */}
              {!fleetMode && filter === "oos" && status === "oos" && (() => {
                const cov = coveringTruckByRoute.get(t.truck_number);
                const spareAsgn = spareAssignments.find((a) => a.covering_route_truck === t.truck_number);
                const swap = routeSwaps.find((s) => s.route_truck === t.truck_number);
                const isOpen = oosAssignOpen.has(t.truck_number);

                if (cov) {
                  // Covered — show covering truck + remove
                  return (
                    <div
                      className="mt-1 border-t border-slate-700 pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-400">Covered by</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                            #{cov.num}
                          </span>
                          {cov.status && (
                            <span className={clsx("badge text-[10px] py-0", STATUS_BG[cov.status], STATUS_BADGE_TEXT[cov.status])}>
                              {STATUS_LABELS[cov.status]}
                            </span>
                          )}
                        </div>
                        <button
                          className="rounded px-2 py-1 text-xs text-red-400 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                          disabled={returnSpare.isPending || deleteSwap.isPending}
                          onClick={() => {
                            if (spareAsgn) returnSpare.mutate(spareAsgn.id);
                            else if (swap) deleteSwap.mutate({ id: swap.id, runDate });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                }

                if (!isOpen) {
                  // Not covered, collapsed — show tap hint
                  return (
                    <div className="mt-1 border-t border-slate-700 pt-2 text-center">
                      <span className="text-[11px] font-semibold text-blue-400">Tap to assign →</span>
                    </div>
                  );
                }

                // Not covered, expanded — show picker
                const sorted = [...(data ?? [])].sort((a, b) => a.truck_number - b.truck_number);
                const lastUsedNums = getSwapHistory(t.truck_number);
                const lastUsed = lastUsedNums.map((n) => sorted.find((x) => x.truck_number === n)).filter(Boolean) as typeof sorted;
                const spareTrucks = sorted.filter((x) => x.truck_type === "Spare");
                const offTrucks   = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, runDayNum, holidayLoad) === "off");
                const otherTrucks = sorted.filter((x) => {
                  if (x.truck_type === "Spare") return false;
                  const s = effectiveStatus(x, runDayNum, holidayLoad);
                  return s !== "off" && s !== "oos";
                });

                return (
                  <div
                    className="mt-1 space-y-2 border-t border-slate-700 pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex gap-1.5">
                      <select
                        className="input flex-1 text-xs"
                        value={oosCardSelects[t.truck_number] ?? ""}
                        onChange={(e) => setOosCardSelects((p) => ({ ...p, [t.truck_number]: e.target.value }))}
                      >
                        <option value="">— assign truck —</option>
                        {lastUsed.length > 0 && (
                          <optgroup label="Last Used">
                            {lastUsed.map((x) => (
                              <option key={x.truck_number} value={x.truck_number}>
                                #{x.truck_number} — {x.truck_type === "Spare" ? "Spare" : (x.state?.status ?? "dirty")}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {spareTrucks.length > 0 && (
                          <optgroup label="Spare Trucks">
                            {spareTrucks.map((x) => (
                              <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Spare</option>
                            ))}
                          </optgroup>
                        )}
                        {offTrucks.length > 0 && (
                          <optgroup label={`Off — Day ${runDayNum}`}>
                            {offTrucks.map((x) => (
                              <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Off</option>
                            ))}
                          </optgroup>
                        )}
                        {otherTrucks.length > 0 && (
                          <optgroup label="Other">
                            {otherTrucks.map((x) => (
                              <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} ({x.state?.status ?? "dirty"})</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <button
                        className="rounded-lg bg-green-700 px-3 text-xs font-semibold disabled:opacity-50"
                        disabled={
                          !oosCardSelects[t.truck_number] ||
                          assignSpare.isPending || createSwap.isPending
                        }
                        onClick={async () => {
                          const pickedNum = Number(oosCardSelects[t.truck_number]);
                          const picked = (data ?? []).find((x) => x.truck_number === pickedNum);
                          if (picked?.truck_type === "Spare") {
                            await assignSpare.mutateAsync({
                              run_date: runDate,
                              spare_truck_number: pickedNum,
                              covering_route_truck: t.truck_number,
                            });
                          } else {
                            await createSwap.mutateAsync({
                              run_date: runDate,
                              route_truck: t.truck_number,
                              load_on_truck: pickedNum,
                              two_way: false,
                            });
                          }
                          recordSwapHistory(t.truck_number, pickedNum);
                          setOosCardSelects((p) => { const n = { ...p }; delete n[t.truck_number]; return n; });
                          setOosAssignOpen((prev) => { const next = new Set(prev); next.delete(t.truck_number); return next; });
                        }}
                      >
                        {assignSpare.isPending || createSwap.isPending ? "…" : "Assign"}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {fleetMode && (
                <div className="mt-auto flex flex-col gap-2">
                  {!multiSelect && !isReadOnly && status !== "oos" && (
                    <select
                       className="input min-h-[2.5rem] text-xs md:min-h-0"
                      value={status}
                      disabled={upsert.isPending}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const next = e.target.value as TruckStatus | "__outside__" | "__paperbay__" | "__unload_hold__" | "__clear_hold__";
                        if (status === "off" && next === "loaded") {
                          setPendingOffLoadTruck(t);
                          setPendingOffLoadRoute("");
                          setPendingOffLoadError(null);
                          e.currentTarget.value = status;
                          return;
                        }
                        if (next === "__unload_hold__") {
                          e.currentTarget.value = status;
                          upsert.mutate({
                            truck_number: t.truck_number,
                            run_date: runDate,
                            priority_hold: true,
                            wearers: t.state?.wearers ?? 0,
                          });
                          return;
                        }
                        if (next === "__clear_hold__") {
                          e.currentTarget.value = status;
                          upsert.mutate({
                            truck_number: t.truck_number,
                            run_date: runDate,
                            priority_hold: false,
                            wearers: t.state?.wearers ?? 0,
                          });
                          return;
                        }
                        if (next === "__outside__") {
                          e.currentTarget.value = status;
                          startOutsideTimer(t.truck_number);
                          return;
                        }
                        if (next === "__paperbay__") {
                          e.currentTarget.value = status;
                          startPaperBayTimer(t.truck_number);
                          return;
                        }
                        if (next === "oos") {
                          setPendingOosTruck(t);
                          e.currentTarget.value = status; // revert visual selection
                        } else {
                          upsert.mutate({
                            truck_number: t.truck_number,
                            run_date: runDate,
                            status: next,
                            wearers: t.state?.wearers ?? 0,
                          });
                        }
                      }}
                    >
                      {status === "off" && (
                        <option value="off" disabled hidden>
                          Off (scheduled)
                        </option>
                      )}
                      {!t.state?.priority_hold && (
                        <option value="__unload_hold__">🚩 Unload &amp; Hold</option>
                      )}
                      {t.state?.priority_hold && (
                        <option value="__clear_hold__">🔓 Clear Hold</option>
                      )}
                      {outsideTimerEnabled && !outsideTimers.has(t.truck_number) && !paperBayTimers.has(t.truck_number) && (
                        <option value="__outside__">⏱ Outside (20 min)</option>
                      )}
                      {paperBayEnabled && !paperBayTimers.has(t.truck_number) && !outsideTimers.has(t.truck_number) && (
                        <option value="__paperbay__">📄 Paper Bay (25 min)</option>
                      )}
                      {FLEET_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}
                  {status === "oos" && (
                    <p className="text-xs text-slate-500 italic">Tap to remove OOS</p>
                  )}
                  {outsideTimerEnabled && outsideTimers.has(t.truck_number) && (
                    <div
                      className="flex items-center gap-1.5 rounded-lg border border-orange-700/50 bg-orange-950/70 px-2 py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-xs font-bold text-orange-300">
                        ⏱ Outside {fmtCountdown(outsideCountdowns.get(t.truck_number) ?? 0)}
                      </span>
                      <button
                        type="button"
                        className="ml-auto rounded px-2 py-1 text-xs font-semibold text-orange-500 transition-colors hover:text-orange-300 active:bg-orange-900/40"
                        onClick={() => cancelOutsideTimer(t.truck_number)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {paperBayEnabled && paperBayTimers.has(t.truck_number) && (
                    <div
                      className="flex items-center gap-1.5 rounded-lg border border-violet-700/50 bg-violet-950/70 px-2 py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-xs font-bold text-violet-300">
                        📄 Paper Bay {fmtCountdown(paperBayCountdowns.get(t.truck_number) ?? 0)}
                      </span>
                      <button
                        type="button"
                        className="ml-auto rounded px-2 py-1 text-xs font-semibold text-violet-500 transition-colors hover:text-violet-300 active:bg-violet-900/40"
                        onClick={() => cancelPaperBayTimer(t.truck_number)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </AnimateCard>
          );
          });
        })()}
        {!isLoading && filtered.length === 0 && (
          <p className="col-span-full text-slate-500">No trucks match this filter.</p>
        )}
      </div>
      )}

      {offCoverageTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setOffCoverageTruck(null); setOffCoverageLoadOn(""); setOffCoverageError(null); }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold">
              Route #{offCoverageTruck.truck_number} is off tomorrow
            </h3>
            <p className="mb-4 text-sm text-slate-400">
              This route is not scheduled for the next load day. Assign the truck or spare
              that will cover it so the load can proceed. Coverage is required.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Covering truck (required)</label>
                <select
                  className="input"
                  value={offCoverageLoadOn}
                  onChange={(e) => setOffCoverageLoadOn(e.target.value)}
                >
                  <option value="">— pick covering truck —</option>
                  <optgroup label="Spares">
                    {(data ?? [])
                      .filter((x) => x.truck_type === "Spare")
                      .sort((a, b) => a.truck_number - b.truck_number)
                      .map((x) => (
                        <option key={x.truck_number} value={x.truck_number}>
                          #{x.truck_number} — Spare
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Route trucks">
                    {(data ?? [])
                      .filter((x) => x.truck_type !== "Spare" && x.truck_number !== offCoverageTruck.truck_number)
                      .sort((a, b) => a.truck_number - b.truck_number)
                      .map((x) => (
                        <option key={x.truck_number} value={x.truck_number}>
                          #{x.truck_number} ({effectiveStatus(x, runDayNum, holidayLoad)})
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
              {offCoverageError && (
                <p className="text-sm text-red-400">{offCoverageError}</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => { setOffCoverageTruck(null); setOffCoverageLoadOn(""); setOffCoverageError(null); }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60 transition-colors"
                disabled={createSwap.isPending || offCoverageLoadOn === ""}
                onClick={async () => {
                  const loadOnNum = parseInt(offCoverageLoadOn, 10);
                  if (!Number.isFinite(loadOnNum)) {
                    setOffCoverageError("Select a covering truck first.");
                    return;
                  }
                  try {
                    await createSwap.mutateAsync({
                      run_date: runDate,
                      route_truck: offCoverageTruck.truck_number,
                      load_on_truck: loadOnNum,
                      two_way: false,
                    });
                    const t = offCoverageTruck;
                    setOffCoverageTruck(null);
                    setOffCoverageLoadOn("");
                    setOffCoverageError(null);
                    setConfirmTruck(t);
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { detail?: string } } };
                    setOffCoverageError(e?.response?.data?.detail ?? "Failed to create coverage.");
                  }
                }}
              >
                {createSwap.isPending ? "Saving…" : "Assign Coverage & Start Loading"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingOosTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPendingOosTruck(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold">Mark Truck #{pendingOosTruck.truck_number} as OOS?</h3>
            <p className="mb-4 text-sm text-slate-400">
              Out of Service means this truck is unavailable for today's run and needs coverage.
              This is not a routine status change.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setPendingOosTruck(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
                onClick={() => {
                  updateTruck.mutate({
                    truck_number: pendingOosTruck.truck_number,
                    is_oos: true,
                  });
                  upsert.mutate({
                    truck_number: pendingOosTruck.truck_number,
                    run_date: runDate,
                    status: "oos",
                    wearers: pendingOosTruck.state?.wearers ?? 0,
                  });
                  setPendingOosTruck(null);
                }}
              >
                Confirm OOS
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingOffLoadTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setPendingOffLoadTruck(null);
            setPendingOffLoadRoute("");
            setPendingOffLoadError(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold">
              Truck #{pendingOffLoadTruck.truck_number} is off-schedule
            </h3>
            <p className="mb-4 text-sm text-slate-400">
              This truck is not scheduled today. Select the route it ran, or just mark it
              as <span className="font-semibold text-amber-300">Ran Special</span> if no specific
              route applies. Either way the truck will be marked Loaded and the note saved.
            </p>

            <div className="space-y-3">
              <div>
                <label className="label">Route it ran (optional)</label>
                <select
                  className="input"
                  value={pendingOffLoadRoute}
                  onChange={(e) => setPendingOffLoadRoute(e.target.value)}
                >
                  <option value="">- pick route truck -</option>
                  {(data ?? [])
                    .filter((x) => x.truck_type !== "Spare" && x.truck_number !== pendingOffLoadTruck.truck_number)
                    .sort((a, b) => a.truck_number - b.truck_number)
                    .map((x) => (
                      <option key={x.truck_number} value={x.truck_number}>
                        #{x.truck_number} ({effectiveStatus(x, runDayNum, holidayLoad)})
                      </option>
                    ))}
                </select>
              </div>

              {pendingOffLoadError && (
                <p className="text-sm text-red-400">{pendingOffLoadError}</p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => {
                  setPendingOffLoadTruck(null);
                  setPendingOffLoadRoute("");
                  setPendingOffLoadError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
                disabled={upsert.isPending}
                onClick={() => finalizeOffTruckAsLoaded("special")}
              >
                Ran Special (no route)
              </button>
              <button
                className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors disabled:opacity-60"
                disabled={upsert.isPending || pendingOffLoadRoute === ""}
                onClick={() => finalizeOffTruckAsLoaded("route")}
              >
                Save with Route
              </button>
            </div>
          </div>
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
      {holdAlertTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setHoldAlertTruck(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-900/60 text-sm">&#x1f512;</span>
              <h3 className="text-base font-semibold">Truck #{holdAlertTruck.truck_number} is on Hold</h3>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              This truck has been flagged as "Do Not Load". Check with a Fleet Supervisor before proceeding.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-md bg-slate-700 px-4 py-1.5 text-sm font-semibold text-slate-300 hover:bg-slate-600 transition"
                onClick={() => {
                  setHoldAlertTruck(null);
                  navigate(`/fleet?truck=${holdAlertTruck.truck_number}`);
                }}
              >
                View Details
              </button>
              <button
                className="btn-ghost"
                onClick={() => setHoldAlertTruck(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      </motion.div>
    </div>
  );
}
