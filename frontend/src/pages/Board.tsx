import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useAuditEntries,
  useAssignSpare,
  useBoard,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  useHolidayUnload,
  useReturnSpare,
  useRouteSwapLog,
  useRouteSwaps,
  useSettings,
  useShortages,
  useSpareAssignments,
  useUpdateTruck,
  useUpsertTruckState,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import { useCollapseState } from "../utils/useCollapseState";
import OffDaySchedulePanel from "../components/management/OffDaySchedulePanel";
import { todayIso } from "../api/client";
import { shipDayNumber, workdayNumbers } from "../components/Clock";
import { format } from "date-fns";
import type { RouteSwap, SpareAssignment, TruckStatus, TruckWithState } from "../types";
import { buildHistoricalCoverageFallback, effectiveStatus, effectiveWorkflowStatus, getCoverageRouteNumber, getSwapHistory, isScheduledOff, recordSwapHistory } from "../utils/truckStatus";
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
import FleetMobileActionSheet from "./board/FleetMobileActionSheet";
import FleetUtilityBar from "./board/FleetUtilityBar";
import PageHeader from "../components/PageHeader";
import { motion } from "framer-motion";
import { CalendarDays, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export default function Board({ fleetMode = false }: { fleetMode?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const [runDate, setRunDate] = useState(todayIso());
  const [detailNum, setDetailNum] = useState<number | null>(null);
  const [mobileActionTruck, setMobileActionTruck] = useState<TruckWithState | null>(null);
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
  const [spareCoverageTruck, setSpareCoverageTruck] = useState<TruckWithState | null>(null);
  const [spareCoverageRoute, setSpareCoverageRoute] = useState<string>("");
  const [spareCoverageError, setSpareCoverageError] = useState<string | null>(null);
  const [offScheduleDialogOpen, setOffScheduleDialogOpen] = useState(false);
  const isArchive = runDate < todayIso();
  const isFuture  = runDate > todayIso();
  const isReadOnly = runDate !== todayIso();
  const { data, isLoading, error } = useBoard(runDate);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate, false);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const { data: swapLog = [] } = useRouteSwapLog(60);
  const { data: settings } = useSettings();
  const upsert = useUpsertTruckState();
  const updateTruck = useUpdateTruck();
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

  const arrivedTrackingEnabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "arrived_tracking_enabled")?.value === true,
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

  function triggerOutsideTimer(truckNumber: number) {
    cancelPaperBayTimer(truckNumber);
    startOutsideTimer(truckNumber);
  }

  function triggerPaperBayTimer(truckNumber: number) {
    startPaperBayTimer(truckNumber);
  }
  const paperBayTimers = paperBayCountdowns;

  function markArrived(truck: TruckWithState) {
    upsert.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      arrived_at: Date.now() / 1000,
      wearers: truck.state?.wearers ?? 0,
    });
  }

  function clearArrived(truck: TruckWithState) {
    upsert.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      arrived_at: null,
      wearers: truck.state?.wearers ?? 0,
    });
  }

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
    // Read-only fallback: a route truck that's STILL is_oos but has no live
    // assignment today (e.g. nobody has re-confirmed the swap yet this shift)
    // is still represented by whoever covered it most recently — it didn't
    // suddenly become dirty just because today's coverage record lapsed. Never
    // writes a new assignment; only fills the display gap until the swap is
    // re-confirmed or the truck is returned to service. Shared with the
    // sidebar's Live Status counts so the two always agree.
    const fallback = buildHistoricalCoverageFallback(data ?? [], swapLog, runDate);
    for (const [route, truckNum] of fallback) {
      if (m.has(route)) continue;
      const st = (data ?? []).find((d) => d.truck_number === truckNum);
      m.set(route, {
        num: truckNum,
        status: st ? effectiveStatus(st, runDayNum, holidayLoad) : undefined,
      });
    }
    return m;
  }, [spareAssignments, routeSwaps, swapLog, data, runDate, runDayNum, holidayLoad]);

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
        needs_checked: true,
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
        // Mirror `filtered`'s spare inclusion rules exactly so the count badge
        // always matches the rendered card list (was previously divergent: this
        // required the covered route's OWN effectiveStatus to read literally
        // "oos", which never happens for an is_oos truck whose raw status is
        // "dirty" -- see effectiveStatus's intentional dirty-stays-dirty rule --
        // so a covering spare like this was silently dropped from every bucket).
        const rawSpareStatus = t.state?.status;
        if (rawSpareStatus === "dirty" || rawSpareStatus === "unfinished" || t.state == null) {
          c.dirty = (c.dirty ?? 0) + 1;
        } else if (rawSpareStatus === "unloaded") {
          c.unloaded = (c.unloaded ?? 0) + 1;
        } else {
          const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
          if (coveredRoute != null && coveringTruckByRoute.has(coveredRoute)) {
            const s = effectiveStatus(t, runDayNum, holidayLoad);
            c[s] = (c[s] ?? 0) + 1;
          }
        }
      } else {
        const loadDayEff = effectiveStatus(t, runDayNum, holidayLoad);
        // Only force "oos" once a covering truck is actually assigned (live or
        // historical fallback) -- matches the Dirty/etc. filter's exclusion
        // rule below and the sidebar's Live Status counts, so a still-dirty,
        // not-yet-covered OOS truck keeps counting as Dirty everywhere.
        const isCoveredOos = t.truck_type !== "Spare" && t.is_oos && coveringTruckByRoute.has(t.truck_number);
        const s = isCoveredOos ? "oos" : effectiveWorkflowStatus(t, runDayNum, holidayLoad, runUnloadsDay, holidayUnload);
        c[s] = (c[s] ?? 0) + 1;
        // Also count in "off" when scheduled off for load day but shown in
        // an unload-context bucket (off = not loading tomorrow).
        if (!fleetMode && loadDayEff === "off" && s !== "off") {
          c.off = (c.off ?? 0) + 1;
        }
      }
    });

    return c;
  }, [data, runDayNum, runUnloadsDay, holidayLoad, fleetMode, truckStatusByNumber, coveringTruckByRoute]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (fleetMode) {
      if (fleetFilters.has("all")) return data;
      return data.filter((t) => {
        if (t.truck_type === "Spare" && t.state?.status !== "oos") {
          const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
          const isOosCoverage = coveredRoute != null && truckStatusByNumber.get(coveredRoute) === "oos";
          const s = effectiveStatus(t, runUnloadsDay, holidayUnload);
          if (isOosCoverage) {
            return fleetFilters.has(s);
          }
          const isIdle = s === "dirty" || s === "off" || s === "unloaded";
          return isIdle ? fleetFilters.has("spare") : fleetFilters.has(s);
        }
        return fleetFilters.has(t.is_oos ? "oos" : effectiveStatus(t, runUnloadsDay, holidayUnload));
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
      // OOS filter: is_oos is authoritative — a route truck flagged out of
      // service belongs here even when its physical workflow status reads
      // "dirty" (effectiveWorkflowStatus would otherwise exclude it).
      if (filter === "oos") {
        if (t.truck_type === "Spare") return false;
        return t.is_oos || effectiveStatus(t, runDayNum, holidayLoad) === "oos";
      }
      // An is_oos route truck with a covering truck assigned is represented by
      // that covering truck's card instead (matches the sidebar's Live Status
      // counts), so exclude it here to avoid a duplicate. But an is_oos truck
      // with NO coverage yet is still physically sitting there — if it's dirty,
      // someone still has to unload it, so it must stay in the normal workflow
      // (Dirty, etc.) until it's covered or unloaded, not disappear the moment
      // it's flagged OOS.
      if (t.truck_type !== "Spare" && t.is_oos && coveringTruckByRoute.has(t.truck_number)) return false;
      // For all other filters, re-evaluate auto-off trucks against unloadsDay
      // so they surface under their real workflow status.
      const s = effectiveWorkflowStatus(t, runDayNum, holidayLoad, runUnloadsDay, holidayUnload);
      // In dirty view, also include unfinished trucks (rendered as a sub-section)
      const matchStatus = filter === "dirty" ? (s === "dirty" || s === "unfinished") : s === filter;
      if (!matchStatus) return false;
      if (t.truck_type === "Spare") {
        // Show a spare card in a lifecycle-status filter when it is
        // actively covering an OOS or OFF route (the spare represents that
        // route since the route truck is hidden from lifecycle filters),
        // or when the filter is "dirty" and the spare has dirty status,
        // or when the filter is "unloaded" and the spare is unloaded.
        if (filter === "dirty" && (t.state?.status === "dirty" || t.state?.status === "unfinished" || t.state == null)) return true;
        if (filter === "unloaded" && t.state?.status === "unloaded") return true;
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
        if (coveredRoute == null) return false;
        const coveredStatus = truckStatusByNumber.get(coveredRoute);
        return coveredStatus === "oos";
      }
      return true;
    });
  }, [data, filter, fleetMode, fleetFilters, runDayNum, runUnloadsDay, holidayLoad, holidayUnload, truckStatusByNumber]);



  // Live lookup so the open detail modal reflects refreshed board data.
  const detailTruck = useMemo(
    () =>
      detailNum == null
        ? null
        : (data ?? []).find((t) => t.truck_number === detailNum) ?? null,
    [data, detailNum],
  );

  function toggleBulkEdit() {
    if (multiSelect) setSelectedTrucks(new Set());
    setMultiSelect((value) => !value);
  }

  function formatArrivedAt(ts: number | null | undefined) {
    if (!ts) return "";
    return format(new Date(ts * 1000), "h:mm a");
  }

  function selectAllFilteredTrucks() {
    setSelectedTrucks(new Set(filtered.map((truck) => truck.truck_number)));
  }

  function clearSelectedTrucks() {
    setSelectedTrucks(new Set());
  }

  function applyBulkEdit() {
    selectedTrucks.forEach((num) => {
      const truck = data?.find((item) => item.truck_number === num);
      upsert.mutate({
        truck_number: num,
        run_date: runDate,
        status: bulkStatus,
        wearers: truck?.state?.wearers ?? 0,
        ...(bulkStatus === "loaded" ? { load_finish_time: Date.now() / 1000 } : {}),
      });
    });
    setSelectedTrucks(new Set());
  }

  return (
    <div className={fleetMode ? "h-full" : ""}>

      {/* ── Main content ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className={fleetMode ? "space-y-4 overflow-y-auto p-3 md:p-4" : "space-y-4 p-3 md:p-6"}>
      {fleetMode && (
        <FleetUtilityBar
          runDate={runDate}
          onRunDateChange={setRunDate}
          isArchive={isArchive}
          isFuture={isFuture}
          isReadOnly={isReadOnly}
          multiSelect={multiSelect}
          selectedCount={selectedTrucks.size}
          filteredCount={filtered.length}
          counts={counts}
          fleetFilters={fleetFilters}
          bulkStatus={bulkStatus}
          isApplying={upsert.isPending}
          onToggleBulkEdit={toggleBulkEdit}
          onToggleFilter={toggleFleetFilter}
          onBulkStatusChange={setBulkStatus}
          onSelectAll={selectAllFilteredTrucks}
          onSelectNone={clearSelectedTrucks}
          onApplyBulk={applyBulkEdit}
        />
      )}
      {/* ── Page header ── */}
      {(() => {
        type HeaderCfg = { title: string; subtitle: string };
        const fleet: HeaderCfg = {
          title: "Fleet",
          subtitle: `Review ${filtered.length} visible truck${filtered.length === 1 ? "" : "s"} and update current-day fleet state.`,
        };
        const headers: Record<string, HeaderCfg> = {
          all: {
            title: "Truck Board",
            subtitle: `View ${filtered.length} truck${filtered.length === 1 ? "" : "s"} across the full board.`,
          },
          dirty: {
            title: "Dirty",
            subtitle: `Review ${filtered.length} truck${filtered.length === 1 ? "" : "s"} still needing unload attention.`,
          },
          shop: {
            title: "Shop",
            subtitle: `Track ${filtered.length} truck${filtered.length === 1 ? "" : "s"} currently assigned to shop status.`,
          },
          in_progress: {
            title: "In Progress",
            subtitle: `Monitor ${filtered.length} truck${filtered.length === 1 ? "" : "s"} actively moving through workflow.`,
          },
          unloaded: {
            title: "Unloaded",
            subtitle: `Review ${filtered.length} truck${filtered.length === 1 ? "" : "s"} ready for the next loading step.`,
          },
          loaded: {
            title: "Loaded",
            subtitle: `Confirm ${filtered.length} truck${filtered.length === 1 ? "" : "s"} completed for the day.`,
          },
          off: {
            title: "Off",
            subtitle: `Check ${filtered.length} truck${filtered.length === 1 ? "" : "s"} scheduled off the route board.`,
          },
          oos: {
            title: "Requests / OOS",
            subtitle: `Manage holds, requests, and out-of-service trucks from one board view.`,
          },
          spare: {
            title: "Spares / Coverages",
            subtitle: `Review spare assignments, coverages, and idle backup trucks.`,
          },
        };
        const cfg = fleetMode ? fleet : (headers[filter] ?? headers.all);
        return (
          <PageHeader
            eyebrow={fleetMode ? "Operations" : "Board"}
            title={cfg.title}
            subtitle={cfg.subtitle}
            actions={
              filter === "off" && !fleetMode ? (
                <button
                  type="button"
                  onClick={() => setOffScheduleDialogOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800"
                >
                  <CalendarDays className="h-4 w-4 text-slate-400" />
                  View Schedule
                </button>
              ) : undefined
            }
          />
        );
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
      <>
      <div className={clsx(
        "grid gap-3",
        fleetMode
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
          : filter === "off" || filter === "dirty" || filter === "unloaded"
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          : "grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
      )}>
        {(() => {
          type SentinelHeader = { __header: "dirty" | "unfinished" | "coverages" | "needsChecked" | "holdForLoading" | "outOfService" | "spareCoverages" | "idleSpares" | "unloadedRunning" | "unloadedSpare" | "unloadedOff"; count: number };
          type GridRow = TruckWithState | SentinelHeader;
          const rows: GridRow[] = [];
          let unloadedRunningRows: TruckWithState[] = [];
          let unloadedSpareRows: TruckWithState[] = [];
          let unloadedOffRows: TruckWithState[] = [];
          let priorityRows: TruckWithState[] = [];
          let dirtyCoverageRows: TruckWithState[] = [];
          let needsCheckedRows: TruckWithState[] = [];
          let dirtyRouteRows: TruckWithState[] = [];
          let unfinishedRows: TruckWithState[] = [];
          let coveringSpares: TruckWithState[] = [];
          let idleSpares: TruckWithState[] = [];
          let holdRows: TruckWithState[] = [];
          let outOfServiceRows: TruckWithState[] = [];
          if (!fleetMode && filter === "dirty") {
            const dirtyRows = filtered.filter(
              (t) => effectiveWorkflowStatus(t, runDayNum, holidayLoad, runUnloadsDay, holidayUnload) === "dirty",
            );
            unfinishedRows = filtered.filter(
              (t) => effectiveWorkflowStatus(t, runDayNum, holidayLoad, runUnloadsDay, holidayUnload) === "unfinished" && t.state?.priority_hold !== true && t.state?.needs_checked !== true,
            );
            priorityRows = filtered.filter((t) => t.state?.priority_hold === true);
            dirtyRouteRows = dirtyRows.filter((t) => t.truck_type !== "Spare" && t.route_swap_route == null && t.state?.oos_spare_route == null && t.state?.priority_hold !== true && t.state?.needs_checked !== true);
            dirtyCoverageRows = dirtyRows.filter((t) => (t.truck_type === "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) && t.state?.priority_hold !== true && t.state?.needs_checked !== true);
            needsCheckedRows = filtered.filter((t) => t.state?.needs_checked === true && t.state?.priority_hold !== true);
          } else if (!fleetMode && filter === "spare") {
            coveringSpares = filtered.filter((t) =>
              t.route_swap_route != null || t.state?.oos_spare_route != null
            );
            idleSpares = filtered.filter((t) =>
              t.route_swap_route == null && t.state?.oos_spare_route == null
            );
          } else if (!fleetMode && filter === "oos") {
            holdRows = (data ?? []).filter((t) =>
              t.state?.priority_hold === true &&
              t.state?.status === "unloaded"
            );
            outOfServiceRows = filtered;
          } else if (!fleetMode && filter === "unloaded") {
            const isCoveredSpare = (truck: TruckWithState) =>
              truck.truck_type === "Spare" &&
              (truck.route_swap_route != null || truck.state?.oos_spare_route != null);

            unloadedRunningRows = filtered.filter((t) =>
              (t.truck_type !== "Spare" &&
                effectiveStatus(t, runDayNum, holidayLoad) !== "off") ||
              isCoveredSpare(t)
            );
            unloadedOffRows = filtered.filter((t) =>
              t.truck_type !== "Spare" &&
              effectiveStatus(t, runDayNum, holidayLoad) === "off"
            );
            unloadedSpareRows = filtered.filter((t) =>
              t.truck_type === "Spare" && !isCoveredSpare(t)
            );
          } else {
            rows.push(...filtered);
          }
          const renderTruckCard = (truck: TruckWithState, index: number) => {
            // Fleet mode uses unloads-day status directly. Non-fleet uses
            // effectiveWorkflowStatus so that dirty trucks scheduled off for the
            // load day still show their real dirty/unloaded colour rather than
            // being greyed out — they're still active in today's unload workflow.
            const status = fleetMode
              ? effectiveStatus(truck, runUnloadsDay, holidayUnload)
              : effectiveWorkflowStatus(truck, runDayNum, holidayLoad, runUnloadsDay, holidayUnload);
            // Display status: a route truck flagged is_oos reads as OOS even
            // when its physical workflow status is still "dirty" — keeps the
            // fleet grid and the OOS board in sync with the Route Card /
            // live-status OOS counts.
            const displayStatus: TruckStatus =
              (fleetMode || filter === "oos") && truck.truck_type !== "Spare" && truck.is_oos
                ? "oos"
                : status;
            // The Unloaded board is part of the LOAD workflow (unloaded trucks
            // are ready to load), so it uses load-day chips — only the Dirty
            // board is the unload workflow.
            const isUnloadView = filter === "dirty";
            const isLoadView = filter === "loaded" || filter === "unloaded";
            let chipDay: number | undefined;
            let chipIsExtra = false;
            if (isUnloadView && holidayUnload) {
              chipDay = isScheduledOff(truck, runUnloadsDay) ? unloadsDay2 : runUnloadsDay;
              chipIsExtra = chipDay === unloadsDay2;
            } else if (isLoadView && holidayLoad) {
              chipDay = (isScheduledOff(truck, runDayNum) || isScheduledOff(truck, loadNextDay)) ? loadDay2 : runDayNum;
              chipIsExtra = chipDay === loadDay2;
            }
            // Fleet board: the big number is greyed out for trucks off the LOAD
            // day (done for tomorrow); U Off trucks (off only the unload day) keep
            // their real workflow-status colour instead of the grey "off" tint.
            const isLoadOff =
              !holidayLoad &&
              truck.truck_type !== "Spare" &&
              isScheduledOff(truck, runDayNum) &&
              status !== "off" &&
              !getCoverageRouteNumber(truck) &&
              !truck.state?.needs_checked;
            const numberColor = fleetMode
              ? displayStatus === "oos"
                ? STATUS_TEXT["oos"]
                : isLoadOff
                ? STATUS_TEXT["off"]
                : status === "loaded"
                ? "text-sky-300"
                : STATUS_TEXT[status === "off" ? ((truck.state?.status ?? "dirty") as TruckStatus) : status]
              : status === "loaded"
                ? "text-sky-300"
                : status === "off" && (filter === "off" || filter === "unloaded")
                ? STATUS_TEXT[effectiveStatus(truck, runUnloadsDay, holidayLoad)]
                : filter === "unloaded"
                ? STATUS_TEXT[status]
                : filter === "dirty" && truck.state?.priority_hold
                ? "text-amber-300"
                : "hover:text-blue-300";
            const coverageRoute = truck.state?.oos_spare_route ?? truck.route_swap_route ?? null;
            const showCoverageBadge = !fleetMode && coverageRoute != null;
            // Reverse lookup: this truck's own route is being covered by another
            // truck (route swap / OOS). Show it so the covered card isn't blank.
            const coveredBy = coverageRoute == null ? coveringTruckByRoute.get(truck.truck_number) : undefined;
            // In the OOS filter the "Covered by …" assignment row already shows
            // the covering truck, so suppress the duplicate ← Cov. badge there.
            const showCoveredByBadge = !fleetMode && coveredBy != null && filter !== "oos";

            return (
              <AnimateCard
                key={truck.truck_number}
                delay={index * 0.02}
                className={clsx(
                  "card cursor-pointer",
                  fleetMode ? "p-2 flex flex-col gap-1 min-h-[4.5rem] md:p-4 md:gap-2 md:min-h-[10rem]" : ["space-y-2 min-h-[7.5rem]", filter === "off" || filter === "dirty" || filter === "unloaded" ? "p-5" : "p-4"],
                  fleetMode && displayStatus === "oos" && !selectedTrucks.has(truck.truck_number) && "opacity-50 grayscale",
                  fleetMode && truck.state?.priority_hold && "animate-priority-glow border-2 border-red-500/30 bg-gradient-to-br from-slate-900 via-red-950/10 to-slate-900",
                  !fleetMode && filter === "dirty" && truck.state?.priority_hold && "animate-priority-glow border-2 border-red-500/30 bg-gradient-to-br from-slate-900 via-red-950/10 to-slate-900",
                  !fleetMode && (filter === "oos" ? oosAssignOpen.has(truck.truck_number) : detailNum === truck.truck_number) && "ring-2 ring-blue-500",
                  "hover:ring-2 hover:ring-blue-500 transition-shadow",
                  fleetMode && multiSelect && selectedTrucks.has(truck.truck_number) && "ring-2 ring-blue-400",
                )}
                onClick={() => {
                  if (multiSelect) {
                    setSelectedTrucks((prev) => {
                      const next = new Set(prev);
                      if (next.has(truck.truck_number)) next.delete(truck.truck_number);
                      else next.add(truck.truck_number);
                      return next;
                    });
                    return;
                  }
                  if (filter === "dirty" && !fleetMode && truck.state?.status !== "oos") {
                    if (batchingDisabled) {
                      upsert.mutate({
                        truck_number: truck.truck_number,
                        run_date: runDate,
                        status: "unloaded",
                        wearers: truck.state?.wearers ?? 0,
                      });
                    } else {
                      navigate(`/batches?truck=${truck.truck_number}&run_date=${runDate}`);
                    }
                  } else if (filter === "unloaded" && !fleetMode) {
                    if (truck.state?.priority_hold) {
                      setHoldAlertTruck(truck);
                      return;
                    }
                    if (
                      truck.truck_type === "Spare" &&
                      truck.route_swap_route == null &&
                      truck.state?.oos_spare_route == null
                    ) {
                      // A spare only loads to cover a route — make them pick one first.
                      setSpareCoverageTruck(truck);
                      setSpareCoverageRoute("");
                      setSpareCoverageError(null);
                    } else if (effectiveStatus(truck, runDayNum, holidayLoad) === "off") {
                      const alreadyCovered = routeSwaps.some((s) => s.route_truck === truck.truck_number);
                      if (alreadyCovered) {
                        setConfirmTruck(truck);
                      } else {
                        setOffCoverageTruck(truck);
                        setOffCoverageLoadOn("");
                        setOffCoverageError(null);
                      }
                    } else {
                      setConfirmTruck(truck);
                    }
                  } else if (filter === "oos" && !fleetMode) {
                    if (truck.state?.priority_hold) {
                      setHoldAlertTruck(truck);
                      return;
                    }
                    setOosAssignOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(truck.truck_number)) next.delete(truck.truck_number);
                      else next.add(truck.truck_number);
                      return next;
                    });
                  } else if (fleetMode) {
                    setMobileActionTruck(truck);
                  } else {
                    setDetailNum(detailNum === truck.truck_number ? null : truck.truck_number);
                  }
                }}
              >
                <div className="flex w-full flex-col gap-0.5 md:gap-1">
                  <div className="flex w-full min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 min-h-[2.5rem] flex-col justify-between gap-0.5 md:min-h-[4.5rem]">
                      {!fleetMode && showCoverageBadge ? (
                        /* Covering truck — paired headline: route → covering truck. */
                        <div className="flex items-center gap-1 md:gap-1.5">
                          <span className="flex flex-col items-center leading-none">
                            <span className="text-lg font-extrabold tracking-tight tabular-nums text-[#7cc4ff] md:text-3xl">{coverageRoute}</span>
                            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#5b87b3] md:text-[10px]">route</span>
                          </span>
                          <span className="text-base font-bold text-[#7cc4ff] md:text-2xl">→</span>
                          <span className="flex flex-col items-center leading-none">
                            <span className={clsx("text-lg font-extrabold tracking-tight tabular-nums md:text-3xl", numberColor)}>{truck.truck_number}</span>
                            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 md:text-[10px]">truck</span>
                          </span>
                        </div>
                      ) : (
                        <span
                          className={clsx(
                            "font-extrabold tracking-tight tabular-nums leading-none",
                            fleetMode ? "text-2xl md:text-5xl" : filter === "off" || filter === "dirty" || filter === "unloaded" ? "text-5xl" : "text-4xl",
                            numberColor,
                          )}
                        >
                          {truck.truck_number}
                        </span>
                      )}
                      {!fleetMode && showCoveredByBadge && (
                        <span className="flex min-h-[1.5rem] min-w-0 items-center">
                          <span className="inline-flex max-w-full items-center self-start truncate rounded-full bg-amber-900/40 px-2 py-1 text-[11px] font-bold text-amber-300 ring-1 ring-amber-700/40">
                            ← Cov. #{coveredBy!.num}
                          </span>
                        </span>
                      )}
                    </div>
                    <span className="flex min-h-[1.5rem] shrink-0 flex-col items-end justify-start gap-0.5 md:min-h-[2.25rem]">
                      {/* 1. Status chip — show underlying dirty/unloaded for off trucks */}
                      {displayStatus === "oos" ? (
                        <span className={clsx("badge", STATUS_BG["oos"], STATUS_BADGE_TEXT["oos"])}>
                          {STATUS_LABELS["oos"]}
                        </span>
                      ) : status === "off" && (truck.state?.status === "dirty" || truck.state?.status === "unloaded") ? (
                        <span className={clsx("badge", STATUS_BG[truck.state.status as TruckStatus], STATUS_BADGE_TEXT[truck.state.status as TruckStatus])}>
                          {STATUS_LABELS[truck.state.status as TruckStatus]}
                        </span>
                      ) : (
                        <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
                          {STATUS_LABELS[status]}
                        </span>
                      )}
                      {/* 2. U Off chip — route trucks only; spares are always off unless assigned */}
                      {fleetMode && status === "off" && truck.truck_type !== "Spare" && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked && (
                        <span className="badge bg-slate-600 text-slate-200">U Off</span>
                      )}
                      {!fleetMode && !holidayUnload && truck.truck_type !== "Spare" && isScheduledOff(truck, runUnloadsDay) && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked && (
                        <span className="badge bg-slate-700 text-slate-300">U Off</span>
                      )}
                      {/* 3. L Off chip — route trucks only */}
                      {!holidayLoad && truck.truck_type !== "Spare" && isScheduledOff(truck, runDayNum) && status !== "off" && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked && (
                        <span className="badge bg-slate-600 text-slate-200">L Off</span>
                      )}
                      {/* 4. OOS coverage (fleet) */}
                      {fleetMode && displayStatus === "oos" && (() => {
                        const cov = coveringTruckByRoute.get(truck.truck_number);
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
                              className="inline-flex items-center gap-1 rounded-full bg-sky-500 px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-sky-400"
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
                      {/* 5. Priority hold / REQUEST */}
                      {!fleetMode && filter === "dirty" && truck.state?.priority_hold && (
                        <motion.span
                          animate={{ opacity: [1, 0.6, 1] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                          className="badge bg-amber-500 font-bold text-black"
                        >
                          REQUEST
                        </motion.span>
                      )}
                      {truck.state?.priority_hold && (fleetMode || filter !== "dirty") && (
                        <span className="badge bg-red-700 text-white">Hold</span>
                      )}
                      {/* 6. Needs Checked */}
                      {truck.state?.needs_checked && (
                        <span className="badge bg-amber-700 text-white">Needs Checked</span>
                      )}
                      {/* 7. Dust garment */}
                      {truck.truck_type === "Dust" && truck.state?.has_dust_garment && (
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
                    <div className="text-[10px] text-slate-400 space-y-0.5 md:text-xs">
                      <div>
                        {truck.truck_type}
                        {truck.truck_type === "Uniform" && truck.uniform_size != null && ` · ${truck.uniform_size}ft`}
                        {truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
                      </div>
                      {(() => {
                        if (status === "oos") {
                          return null;
                        }
                        const coverageRoute = truck.route_swap_route ?? truck.state?.oos_spare_route ?? null;
                        if (coverageRoute != null) {
                          return (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDetailNum(coverageRoute); }}
                              className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2 py-0.5 text-[10px] font-bold text-sky-300 ring-1 ring-sky-700/40 transition-colors hover:bg-sky-800/60 hover:ring-sky-400/60 cursor-pointer md:px-3 md:py-1 md:text-sm"
                            >
                              → Cov. #{coverageRoute}
                            </button>
                          );
                        }
                        return null;
                      })()}
                      {truck.state?.off_note?.toLowerCase().includes("ran special") && (
                        isAdmin && !isReadOnly ? (
                          <button
                            type="button"
                            title="Clear Ran Special flag"
                            onClick={(e) => {
                              e.stopPropagation();
                              upsert.mutate({ truck_number: truck.truck_number, run_date: runDate, off_note: "", needs_checked: false, state_source: "workflow" });
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-700/40 transition-colors hover:bg-red-900/50 hover:text-red-300 hover:ring-red-700/40"
                          >
                            Ran Special ✕
                          </button>
                        ) : (
                          <span className="text-amber-300 font-medium">Ran Special</span>
                        )
                      )}
                      {truck.state?.needs_checked && !truck.state?.off_note?.toLowerCase().includes("ran special") && (
                        isAdmin && !isReadOnly ? (
                          <button
                            type="button"
                            title="Clear Needs Checked flag"
                            onClick={(e) => {
                              e.stopPropagation();
                              upsert.mutate({ truck_number: truck.truck_number, run_date: runDate, needs_checked: false, state_source: "workflow" });
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-700/40 transition-colors hover:bg-red-900/50 hover:text-red-300 hover:ring-red-700/40"
                          >
                            Needs Checked ✕
                          </button>
                        ) : (
                          <span className="text-amber-300 font-medium">Needs Checked</span>
                        )
                      )}
                      {fleetMode && arrivedTrackingEnabled && truck.state?.arrived_at && (
                        <span className="inline-flex items-center rounded-full border border-emerald-700/50 bg-emerald-950/70 px-2 py-0.5 text-[10px] font-bold text-emerald-300 md:hidden">
                          📍 Arrived {formatArrivedAt(truck.state.arrived_at)}
                        </span>
                      )}
                      {(outsideTimers.has(truck.truck_number) || paperBayTimers.has(truck.truck_number)) && (
                        <div className={clsx("flex flex-wrap gap-1 pt-1", fleetMode && "md:hidden")}>
                          {outsideTimerEnabled && outsideTimers.has(truck.truck_number) && (
                            <span className="inline-flex items-center rounded-full border border-orange-700/50 bg-orange-950/70 px-2 py-0.5 text-[10px] font-bold text-orange-300">
                              ⏱ Outside {fmtCountdown(outsideCountdowns.get(truck.truck_number) ?? 0)}
                            </span>
                          )}
                          {paperBayEnabled && paperBayTimers.has(truck.truck_number) && (
                            <span className="inline-flex items-center rounded-full border border-violet-700/50 bg-violet-950/70 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                              📄 Paper Bay {fmtCountdown(paperBayCountdowns.get(truck.truck_number) ?? 0)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {!fleetMode && filter === "dirty" && truck.state?.status !== "oos" && (
                    <span className={clsx("flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors", truck.state?.priority_hold ? "bg-amber-600/20 text-amber-300" : "bg-blue-600/20 text-blue-300")}>
                      {batchingDisabled ? "Mark Unloaded" : "Assign to Batch →"}
                    </span>
                  )}
                </div>
                {!fleetMode && filter === "unloaded" && (
                  <div className="text-xs text-slate-400">
                    {truck.truck_type}{truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
                  </div>
                )}
                {filter === "loaded" ? (
                  <>
                    <div className="text-xs text-slate-400">
                      {truck.truck_type}{truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
                    </div>
                    {truck.state?.load_finish_time && (
                      <div className="mt-auto pt-1 text-xs text-slate-500">
                        Done {format(new Date(truck.state.load_finish_time * 1000), "h:mm a")}
                      </div>
                    )}
                  </>
                ) : truck.state?.batch_id != null && !fleetMode && filter !== "unloaded" && (
                  <div className="text-xs text-slate-400">Batch {truck.state.batch_id}</div>
                )}

                {/* Spares have no scheduled day, so a day chip only makes sense
                    when they're covering a route (they run that route's day). */}
                {chipDay != null && !(truck.truck_type === "Spare" && coverageRoute == null) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        chipIsExtra ? "bg-amber-900/60 text-amber-300" : "bg-blue-900/60 text-blue-300",
                      )}
                    >
                      Day {chipDay}
                    </span>
                  </div>
                )}

                {!fleetMode && filter === "oos" && displayStatus === "oos" && (() => {
                  const cov = coveringTruckByRoute.get(truck.truck_number);
                  const spareAsgn = spareAssignments.find((a) => a.covering_route_truck === truck.truck_number);
                  const swap = routeSwaps.find((s) => s.route_truck === truck.truck_number);
                  const isOpen = oosAssignOpen.has(truck.truck_number);

                  if (cov) {
                    return (
                      <div
                        className="mt-1 border-t border-slate-700 pt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="text-xs text-slate-400">Covered by</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2.5 py-0.5 text-sm font-bold text-sky-300 ring-1 ring-sky-700/40">
                              #{cov.num}
                            </span>
                            {cov.status && (
                              <span className={clsx("badge text-[10px] py-0", STATUS_BG[cov.status], STATUS_BADGE_TEXT[cov.status])}>
                                {STATUS_LABELS[cov.status]}
                              </span>
                            )}
                          </div>
                          <button
                            className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-red-400 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
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
                    return (
                      <div className="mt-1 border-t border-slate-700 pt-2 text-center">
                        <span className="text-[11px] font-semibold text-blue-400">Tap to assign →</span>
                      </div>
                    );
                  }

                  const sorted = [...(data ?? [])].sort((a, b) => a.truck_number - b.truck_number);
                  const lastUsedNums = getSwapHistory(truck.truck_number);
                  const lastUsed = lastUsedNums.map((n) => sorted.find((x) => x.truck_number === n)).filter(Boolean) as typeof sorted;
                  const spareTrucks = sorted.filter((x) => x.truck_type === "Spare");
                  const offTrucks = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, runDayNum, holidayLoad) === "off");
                  const otherTrucks = sorted.filter((x) => {
                    if (x.truck_type === "Spare") return false;
                    const nextStatus = effectiveStatus(x, runDayNum, holidayLoad);
                    return nextStatus !== "off" && nextStatus !== "oos";
                  });

                  return (
                    <div
                      className="mt-1 space-y-2 border-t border-slate-700 pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex gap-1.5">
                        <select
                          className="input flex-1 text-xs"
                          value={oosCardSelects[truck.truck_number] ?? ""}
                          onChange={(e) => setOosCardSelects((p) => ({ ...p, [truck.truck_number]: e.target.value }))}
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
                            !oosCardSelects[truck.truck_number] ||
                            assignSpare.isPending || createSwap.isPending
                          }
                          onClick={async () => {
                            const pickedNum = Number(oosCardSelects[truck.truck_number]);
                            const picked = (data ?? []).find((x) => x.truck_number === pickedNum);
                            if (picked?.truck_type === "Spare") {
                              await assignSpare.mutateAsync({
                                run_date: runDate,
                                spare_truck_number: pickedNum,
                                covering_route_truck: truck.truck_number,
                              });
                            } else {
                              await createSwap.mutateAsync({
                                run_date: runDate,
                                route_truck: truck.truck_number,
                                load_on_truck: pickedNum,
                                two_way: false,
                              });
                            }
                            recordSwapHistory(truck.truck_number, pickedNum);
                            setOosCardSelects((p) => { const next = { ...p }; delete next[truck.truck_number]; return next; });
                            setOosAssignOpen((prev) => { const next = new Set(prev); next.delete(truck.truck_number); return next; });
                          }}
                        >
                          {assignSpare.isPending || createSwap.isPending ? "…" : "Assign"}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {fleetMode && (
                  <div className="mt-auto hidden md:flex md:flex-col md:gap-2">
                    {outsideTimerEnabled && outsideTimers.has(truck.truck_number) && (
                      <div
                        className="flex items-center gap-1.5 rounded-lg border border-orange-700/50 bg-orange-950/70 px-2 py-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs font-bold text-orange-300">
                          ⏱ Outside {fmtCountdown(outsideCountdowns.get(truck.truck_number) ?? 0)}
                        </span>
                        <button
                          type="button"
                          className="ml-auto rounded px-2 py-1 text-xs font-semibold text-orange-500 transition-colors hover:text-orange-300 active:bg-orange-900/40"
                          onClick={() => cancelOutsideTimer(truck.truck_number)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {paperBayEnabled && paperBayTimers.has(truck.truck_number) && (
                      <div
                        className="flex items-center gap-1.5 rounded-lg border border-violet-700/50 bg-violet-950/70 px-2 py-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs font-bold text-violet-300">
                          📄 Paper Bay {fmtCountdown(paperBayCountdowns.get(truck.truck_number) ?? 0)}
                        </span>
                        <button
                          type="button"
                          className="ml-auto rounded px-2 py-1 text-xs font-semibold text-violet-500 transition-colors hover:text-violet-300 active:bg-violet-900/40"
                          onClick={() => cancelPaperBayTimer(truck.truck_number)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {arrivedTrackingEnabled && truck.state?.arrived_at && (
                      <div
                        className="flex items-center gap-1.5 rounded-lg border border-emerald-700/50 bg-emerald-950/70 px-2 py-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs font-bold text-emerald-300">
                          📍 Arrived {formatArrivedAt(truck.state.arrived_at)}
                        </span>
                        <button
                          type="button"
                          className="ml-auto rounded px-2 py-1 text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-200 active:bg-emerald-900/40"
                          onClick={() => clearArrived(truck)}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </AnimateCard>
            );
          };

          const CollapsibleSection = ({ sectionKey, title, titleClassName, sectionRows }: { sectionKey: string; title: string; titleClassName: string; sectionRows: TruckWithState[] }) => {
            const initOpen = useRef(
              localStorage.getItem(`readyroutev2_collapse_board-${sectionKey}`) !== "false"
            ).current;
            if (sectionRows.length === 0) return null;
            return (
              <details
                key={sectionKey}
                open={initOpen ? true : undefined}
                onToggle={(e) => {
                  const val = (e.target as HTMLDetailsElement).open;
                  try { localStorage.setItem(`readyroutev2_collapse_board-${sectionKey}`, String(val)); } catch { }
                }}
                className="group col-span-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-900/80 px-4 py-3">
                  <div className="min-w-0">
                    <div className={clsx("text-xl font-black uppercase tracking-[0.3em] sm:text-2xl", titleClassName)}>
                      {title}
                    </div>
                    <div className="text-xs font-medium text-slate-500">
                      {sectionRows.length} truck{sectionRows.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span className="text-lg text-slate-500 transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <div className="border-t border-slate-800/80 p-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {sectionRows.map((truck, sectionIndex) => renderTruckCard(truck, sectionIndex))}
                  </div>
                </div>
              </details>
            );
          };

          if (!fleetMode && filter === "unloaded") {
            return [
              <CollapsibleSection key="unloaded-running" sectionKey="unloaded-running" title={`Day ${runDayNum}`} titleClassName="text-emerald-400" sectionRows={unloadedRunningRows} />,
              <CollapsibleSection key="unloaded-spare" sectionKey="unloaded-spare" title="Spare" titleClassName="text-cyan-400" sectionRows={unloadedSpareRows} />,
              <CollapsibleSection key="unloaded-off" sectionKey="unloaded-off" title="Off" titleClassName="text-slate-400" sectionRows={unloadedOffRows} />,
            ];
          }

          if (!fleetMode && filter === "dirty") {
            return [
              <CollapsibleSection key="dirty-requests" sectionKey="dirty-requests" title="Requests" titleClassName="text-amber-400" sectionRows={priorityRows} />,
              <CollapsibleSection key="dirty-coverages" sectionKey="dirty-coverages" title="Spares / Coverages" titleClassName="text-violet-400" sectionRows={dirtyCoverageRows} />,
              <CollapsibleSection key="dirty-needs-checked" sectionKey="dirty-needs-checked" title="Needs Checked" titleClassName="text-amber-400" sectionRows={needsCheckedRows} />,
              <CollapsibleSection key="dirty-dirty" sectionKey="dirty-dirty" title="Dirty" titleClassName="text-red-400" sectionRows={dirtyRouteRows} />,
              <CollapsibleSection key="dirty-unfinished" sectionKey="dirty-unfinished" title="Unfinished" titleClassName="text-status-unfinished" sectionRows={unfinishedRows} />,
            ];
          }

          if (!fleetMode && filter === "oos") {
            return [
              <CollapsibleSection key="oos-hold" sectionKey="oos-hold" title="Requests" titleClassName="text-amber-400" sectionRows={holdRows} />,
              <CollapsibleSection key="oos-out" sectionKey="oos-out" title="Out of Service" titleClassName="text-slate-400" sectionRows={outOfServiceRows} />,
            ];
          }

          if (!fleetMode && filter === "spare") {
            return [
              <CollapsibleSection key="spare-cov" sectionKey="spare-cov" title="Coverage" titleClassName="text-violet-400" sectionRows={coveringSpares} />,
              <CollapsibleSection key="spare-idle" sectionKey="spare-idle" title="Idle Spare" titleClassName="text-cyan-400" sectionRows={idleSpares} />,
            ];
          }

          return rows.map((row, index) => {
            return renderTruckCard(row as TruckWithState, index);
          });
        })()}
        {!isLoading && filtered.length === 0 && (
          <p className="col-span-full text-slate-500">No trucks match this filter.</p>
        )}
      </div>

    </>
    )} {/* end filter !== "in_progress" */}

      {offScheduleDialogOpen && (
        <OffBoardScheduleDialog onClose={() => setOffScheduleDialogOpen(false)} />
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

      {spareCoverageTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { setSpareCoverageTruck(null); setSpareCoverageRoute(""); setSpareCoverageError(null); }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold">
              Spare #{spareCoverageTruck.truck_number} — which route is it covering?
            </h3>
            <p className="mb-4 text-sm text-slate-400">
              A spare only loads to cover another truck's route. Pick the route it's running
              so the load can proceed. Coverage is required.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Route to cover (required)</label>
                <select
                  className="input"
                  value={spareCoverageRoute}
                  onChange={(e) => setSpareCoverageRoute(e.target.value)}
                >
                  <option value="">— pick route —</option>
                  {(data ?? [])
                    .filter((x) =>
                      x.truck_type !== "Spare" &&
                      x.truck_number !== spareCoverageTruck.truck_number &&
                      !routeSwaps.some((s) => s.route_truck === x.truck_number) &&
                      !spareAssignments.some((a) => a.covering_route_truck === x.truck_number && !a.returned)
                    )
                    .sort((a, b) => a.truck_number - b.truck_number)
                    .map((x) => (
                      <option key={x.truck_number} value={x.truck_number}>
                        #{x.truck_number} ({effectiveStatus(x, runDayNum, holidayLoad)})
                      </option>
                    ))}
                </select>
              </div>
              {spareCoverageError && (
                <p className="text-sm text-red-400">{spareCoverageError}</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => { setSpareCoverageTruck(null); setSpareCoverageRoute(""); setSpareCoverageError(null); }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60 transition-colors"
                disabled={assignSpare.isPending || spareCoverageRoute === ""}
                onClick={async () => {
                  const routeNum = parseInt(spareCoverageRoute, 10);
                  if (!Number.isFinite(routeNum)) {
                    setSpareCoverageError("Pick a route to cover first.");
                    return;
                  }
                  try {
                    // Spare cover → SpareAssignment (the canonical spare path),
                    // matching the OOS-card assign flow above.
                    await assignSpare.mutateAsync({
                      run_date: runDate,
                      spare_truck_number: spareCoverageTruck.truck_number,
                      covering_route_truck: routeNum,
                    });
                    const t = spareCoverageTruck;
                    setSpareCoverageTruck(null);
                    setSpareCoverageRoute("");
                    setSpareCoverageError(null);
                    setConfirmTruck(t);
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { detail?: string } } };
                    setSpareCoverageError(e?.response?.data?.detail ?? "Failed to assign coverage.");
                  }
                }}
              >
                {assignSpare.isPending ? "Saving…" : "Assign Route & Start Loading"}
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
                  // Dev behavior: marking OOS moves the truck straight to
                  // "unloaded" so its route counts as done on the unload board
                  // (the route still runs — it gets covered). The is_oos flag is
                  // kept, so the board still shows it as OOS and coverage works.
                  // (Future: replace this with a notice telling unload to unload it.)
                  upsert.mutate({
                    truck_number: pendingOosTruck.truck_number,
                    run_date: runDate,
                    status: "unloaded",
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

      {mobileActionTruck && fleetMode && (
        <FleetMobileActionSheet
          truck={mobileActionTruck}
          runDate={runDate}
          onClose={() => setMobileActionTruck(null)}
          onManageTruck={() => {
            setDetailNum(mobileActionTruck.truck_number);
            setMobileActionTruck(null);
          }}
          arrivedEnabled={arrivedTrackingEnabled}
          arrivedAt={mobileActionTruck.state?.arrived_at}
          needsChecked={mobileActionTruck.state?.needs_checked === true}
          outsideEnabled={outsideTimerEnabled}
          outsideActive={outsideTimers.has(mobileActionTruck.truck_number)}
          outsideMinutes={outsideTimerMinutes ?? 20}
          outsideRemainingSeconds={outsideCountdowns.get(mobileActionTruck.truck_number)}
          paperBayEnabled={paperBayEnabled}
            paperBayActive={paperBayTimers.has(mobileActionTruck.truck_number)}
            paperBayMinutes={paperBayTimerMinutes ?? 25}
            paperBayRemainingSeconds={paperBayCountdowns.get(mobileActionTruck.truck_number)}
          onOutside={() => triggerOutsideTimer(mobileActionTruck.truck_number)}
          onCancelOutside={() => cancelOutsideTimer(mobileActionTruck.truck_number)}
          onPaperBay={() => triggerPaperBayTimer(mobileActionTruck.truck_number)}
          onCancelPaperBay={() => cancelPaperBayTimer(mobileActionTruck.truck_number)}
          onArrived={() => markArrived(mobileActionTruck)}
          onClearArrived={() => clearArrived(mobileActionTruck)}
        />
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

function OffBoardScheduleDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Fleet Schedule"
        className="w-full max-w-5xl rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Fleet Schedule</h3>
            <p className="mt-1 text-sm text-slate-400">
              Review route truck run and off days without leaving the off board.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close schedule dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto">
          <OffDaySchedulePanel />
        </div>
      </div>
    </div>
  );
}
