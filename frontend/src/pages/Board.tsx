import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  useAuditEntries,
  useAssignSpare,
  useBoard,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  useHolidayUnload,
  useReturnSpare,
  useOpenSpareAssignments,
  useCoverageForRole,
  usePrevOperatingDay,
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
import CollapsibleCoverage from "../components/CollapsibleCoverage";
import { QuietTile } from "../components/workflow/QuietTile";
import { todayIso } from "../api/client";
import { shipDayNumber, workdayNumbers } from "../components/Clock";
import type { RouteSwap, SpareAssignment, TruckStatus, TruckWithState } from "../types";
import { buildHistoricalCoverageFallback, buildPrevDayCoverage, effectiveStatus, effectiveWorkflowStatus, getCoverageRouteNumber, getSwapHistory, isScheduledOff, previousRunDate, previousWorkday, recordSwapHistory, resolvePrevRunDate, takenOverRouteNumber } from "../utils/truckStatus";
import { LiveInProgress } from "../components/LiveInProgress";
import clsx from "clsx";
import { FLEET_RAIL_STATUSES, statusStampFields } from "./board/constants";
import { useOutsideTimer, usePaperBayTimer } from "./board/useOutsideTimer";
import RouteCardPanel from "./board/RouteCardPanel";
import CrossloadNoticeBar from "../components/CrossloadNoticeBar";
import StartLoadModal from "./board/StartLoadModal";
import TruckDetailPanel from "./board/TruckDetailPanel";
import TruckDetailModal from "./board/TruckDetailModal";
import FleetMobileActionSheet from "./board/FleetMobileActionSheet";
import FleetUtilityBar from "./board/FleetUtilityBar";
import PageHeader, { Sep, Stat } from "../components/PageHeader";
import { motion } from "framer-motion";
import { ArrowLeftRight, CalendarDays } from "lucide-react";
import { errorDetail } from "../api/errors";
import Modal from "../components/Modal";
import PageStatus from "../components/PageStatus";
import CollapsibleSection from "./board/CollapsibleSection";
import OffBoardScheduleDialog from "./board/OffBoardScheduleDialog";
import BoardDialogs from "./board/BoardDialogs";
import OosAssignPanel from "./board/OosAssignPanel";
import StatusTile from "./board/StatusTile";
import FleetCard from "./board/FleetCard";
import EmptyState from "../components/EmptyState";

// A collapsible board section (Dirty/Unloaded/OOS/Spare sub-groups). Defined at
// MODULE scope, not inside Board's render — otherwise React sees a brand-new
// component type on every render and unmounts/remounts every truck card under
// it (replaying entrance animations and re-reading localStorage) on every 5s
// poll, websocket push, and 1s timer tick. renderTruckCard is passed in as a
// prop since it closes over Board's render state.

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export default function Board({ fleetMode = false }: { fleetMode?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const [runDate, setRunDate] = useState(todayIso());
  const [detailNum, setDetailNum] = useState<number | null>(null);
  const [mobileActionTruck, setMobileActionTruck] = useState<TruckWithState | null>(null);
  const [confirmTruck, setConfirmTruck] = useState<TruckWithState | null>(null);
  const [fleetFilters, setFleetFilters] = useState<Set<TruckStatus | "all" | "Uniform" | "Dust">>(new Set(["all"]));
  // Fleet card size — S/M/L density so the whole fleet can be made to fit
  // whatever screen the board lives on. Sticks per device.
  const [cardSize, setCardSize] = useState<"s" | "m" | "l">(() => {
    try {
      const v = localStorage.getItem("rr-fleet-card-size");
      return v === "s" || v === "l" ? v : "m";
    } catch { return "m"; }
  });
  function pickCardSize(v: "s" | "m" | "l") {
    setCardSize(v);
    try { localStorage.setItem("rr-fleet-card-size", v); } catch { /* private mode */ }
  }
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedTrucks, setSelectedTrucks] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TruckStatus>("dirty");
  const [pendingOosTruck, setPendingOosTruck] = useState<TruckWithState | null>(null);
  const [holdAlertTruck, setHoldAlertTruck] = useState<TruckWithState | null>(null);
  const [oosAssignOpen, setOosAssignOpen] = useState<Set<number>>(new Set());
  const [oosCardSelects, setOosCardSelects] = useState<Record<number, string>>({});
  // Trucks whose "Remove from OOS" has been armed — a second tap confirms, so
  // an accidental tap can't drop a truck out of service.
  const [confirmRemoveOos, setConfirmRemoveOos] = useState<Set<number>>(new Set());
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
  const [prevCovOpen, setPrevCovOpen] = useState(false);
  const [prevCovRoute, setPrevCovRoute] = useState("");
  const [prevCovTruck, setPrevCovTruck] = useState("");
  const [prevCovError, setPrevCovError] = useState<string | null>(null);
  const isArchive = runDate < todayIso();
  const isFuture  = runDate > todayIso();
  const isReadOnly = runDate !== todayIso();
  const { data, isLoading, error, refetch } = useBoard(runDate);
  // Fleet is the master view — all of today's coverage (spares + one-way/two-way
  // swaps + splits) AND the previous-day coverage, via the shared selector.
  const fleetCoverage = useCoverageForRole("fleet", runDate, data ?? []);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate, false);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const { data: swapLog = [] } = useRouteSwapLog(60);
  const { data: openSpareAssignments = [] } = useOpenSpareAssignments();
  // Who physically carried whose freight on the previous run day. A truck sits
  // in the Dirty bucket BECAUSE it ran yesterday, so yesterday's carriers are
  // the coverage on this board — today's assignment fields say nothing about
  // what a dirty truck actually brought back. Uses the backend's resolved
  // previous OPERATING day (not previousRunDate below, which only skips
  // weekends and loses coverage across a mid-week holiday).
  const { data: prevOp } = usePrevOperatingDay(runDate);
  const prevDayCoverage = useMemo(
    () => buildPrevDayCoverage(swapLog, resolvePrevRunDate(runDate, prevOp)),
    [swapLog, runDate, prevOp],
  );
  /** Did this truck carry coverage freight — today's assignment or yesterday's run? */
  const isCoverageTruck = (t: TruckWithState) =>
    t.truck_type === "Spare" ||
    t.route_swap_route != null ||
    t.state?.oos_spare_route != null ||
    prevDayCoverage.byCover.has(t.truck_number) ||
    prevDayCoverage.splitHelpers.has(t.truck_number);
  // Previous operating day — for the "Previous Day Coverage" setter modal.
  const prevRunDate = useMemo(() => previousRunDate(runDate), [runDate]);
  const { data: prevSwaps = [] } = useRouteSwaps(prevRunDate);
  const { data: prevSpares = [] } = useSpareAssignments(prevRunDate, false);
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

  // "Remove from OOS" on the OOS live-status card: return the truck to service.
  // Clears the persistent OOS flag, resets today's status to dirty, and frees
  // whatever was covering its route — the cover is no longer needed once the
  // truck is back. Mirrors FleetTruckEditor's OOS toggle-off plus coverage
  // teardown. (Just clearing coverage is a separate action — "Reassign".)
  const returnFromOos = (truck: TruckWithState) => {
    const spareAsgn = spareAssignments.find((a) => a.covering_route_truck === truck.truck_number);
    const swap = routeSwaps.find((s) => s.route_truck === truck.truck_number);
    if (spareAsgn) returnSpare.mutate(spareAsgn.id);
    if (swap) deleteSwap.mutate({ id: swap.id, runDate });
    updateTruck.mutate({ truck_number: truck.truck_number, is_oos: false });
    upsert.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      status: "dirty",
      wearers: truck.state?.wearers ?? 0,
    });
  };
  const oosActionPending =
    returnSpare.isPending || deleteSwap.isPending || updateTruck.isPending || upsert.isPending;
  const disarmRemoveOos = (n: number) =>
    setConfirmRemoveOos((p) => { const next = new Set(p); next.delete(n); return next; });
  // "Remove from OOS" control with a two-tap confirm. First tap arms it and
  // swaps in Cancel / Confirm; Confirm runs returnFromOos. compact = smaller
  // padding for the tighter uncovered / picker layouts.
  const renderRemoveFromOos = (truck: TruckWithState, compact = false) => {
    const pad = compact ? "px-2 py-1 text-[11px]" : "px-2 py-1.5 text-xs";
    if (!confirmRemoveOos.has(truck.truck_number)) {
      return (
        <button
          className={clsx("w-full rounded-lg border border-red-700/50 bg-red-950/40 font-semibold text-red-300 hover:bg-red-900/40 disabled:opacity-40", pad)}
          disabled={oosActionPending}
          onClick={(e) => { e.stopPropagation(); setConfirmRemoveOos((p) => new Set(p).add(truck.truck_number)); }}
        >
          Remove from OOS
        </button>
      );
    }
    return (
      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          className={clsx("flex-1 rounded-lg border border-hairline bg-surface-2 font-semibold text-ink-soft hover:bg-track", pad)}
          onClick={() => disarmRemoveOos(truck.truck_number)}
        >
          Cancel
        </button>
        <button
          className={clsx("flex-1 rounded-lg border border-red-600 bg-red-700 font-semibold text-white hover:bg-red-600 disabled:opacity-40", pad)}
          disabled={oosActionPending}
          onClick={() => { returnFromOos(truck); disarmRemoveOos(truck.truck_number); }}
        >
          Confirm
        </button>
      </div>
    );
  };

  const { runDayNum, runUnloadsDay } = useMemo(() => {
    const [y, m, d] = runDate.split("-").map(Number);
    const wd = workdayNumbers(new Date(y, m - 1, d));
    return { runDayNum: wd.loadDay, runUnloadsDay: wd.unloadsDay };
  }, [runDate]);

  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);

  // Holiday "extra" day is the previous ship day (Mon=1 wraps to Fri=5)
  const loadDay2 = previousWorkday(runDayNum);
  const unloadsDay2 = previousWorkday(runUnloadsDay);
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

  // Routes physically taken over (any truck's oos_spare_route or a covering
  // Spare) — the covered truck is represented by its carrier on lifecycle
  // filters, regardless of its own is_oos flag.
  const takenOverRoutes = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      const r = takenOverRouteNumber(t);
      if (r != null) s.add(r);
    }
    return s;
  }, [data]);

  // Unified: OOS route truck number → {truckNumber, status} of the covering truck
  // Combines spare assignments (SpareAssignment rows) and route swaps.
  // Coverage recorded LIVE for today — spare assignments + route swaps only,
  // NO historical fallback. A truck covers a route today only if today's record
  // says so. This is what drives the per-card coverage badge; the fallback
  // (below) is for OOS-route status continuity, not for tagging a truck that's
  // running its own route today as still covering yesterday's OOS route.
  const liveCoveringTruckByRoute = useMemo(() => {
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

  const coveringTruckByRoute = useMemo(() => {
    const m = new Map(liveCoveringTruckByRoute);
    // Read-only fallback: a route truck that's STILL is_oos but has no live
    // assignment today (e.g. nobody has re-confirmed the swap yet this shift)
    // is still represented by whoever covered it most recently — it didn't
    // suddenly become dirty just because today's coverage record lapsed. Never
    // writes a new assignment; only fills the display gap until the swap is
    // re-confirmed or the truck is returned to service. Shared with the
    // sidebar's Live Status counts so the two always agree.
    const fallback = buildHistoricalCoverageFallback(data ?? [], openSpareAssignments, swapLog, runDate);
    for (const [route, truckNum] of fallback) {
      if (m.has(route)) continue;
      const st = (data ?? []).find((d) => d.truck_number === truckNum);
      m.set(route, {
        num: truckNum,
        status: st ? effectiveStatus(st, runDayNum, holidayLoad) : undefined,
      });
    }
    return m;
  }, [liveCoveringTruckByRoute, swapLog, openSpareAssignments, data, runDate, runDayNum, holidayLoad]);

  const truckStatusByNumber = useMemo(
    () => new Map<number, TruckStatus>((data ?? []).map((t) => [t.truck_number, effectiveStatus(t, runDayNum, holidayLoad)])),
    [data, runDayNum, holidayLoad],
  );

  // Reverse of the LIVE coverage map (route -> covering truck) so a covering
  // truck's OWN card can show which route it covers today. Built from live
  // coverage only — the historical fallback must not tag a truck that's running
  // its own route today as still covering a route it only covered on a past day
  // (that surfaced stale "95 → 92" / "69 → 64" pairs on the loaded board).
  const coveringRouteByTruckNum = useMemo(() => {
    const m = new Map<number, number>();
    for (const [route, cover] of liveCoveringTruckByRoute) m.set(cover.num, route);
    return m;
  }, [liveCoveringTruckByRoute]);

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
            setPendingOffLoadError(errorDetail(err) ?? "Failed to set loaded status.");
    }
  }

  // Derive filter directly from URL so sidebar nav always takes effect
  const filter = (params.get("status") as TruckStatus | "hold" | null) ?? "all";

  // ?truck=N — where notification toasts and web-push land (the server's push
  // URLs are /fleet?truck=N). Scroll that truck's card into view and ring it
  // briefly, then drop the param so a later refresh isn't stuck on it.
  const focusTruck = (() => {
    const raw = params.get("truck");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  })();
  const [highlightTruck, setHighlightTruck] = useState<number | null>(null);
  useEffect(() => {
    if (focusTruck == null) return;
    setHighlightTruck(focusTruck);
    const scrollTimer = window.setTimeout(() => {
      document
        .getElementById(`truck-card-${focusTruck}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    const clearTimer = window.setTimeout(() => setHighlightTruck(null), 6000);
    const next = new URLSearchParams(params);
    next.delete("truck");
    setParams(next, { replace: true });
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTruck]);

  function setFilter(value: TruckStatus | "hold" | "all") {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setParams(next, { replace: true });
  }

  function toggleFleetFilter(s: TruckStatus | "all" | "Uniform" | "Dust") {
    if (s === "all") { setFleetFilters(new Set(["all"])); return; }
    if (!multiSelect) {
      setFleetFilters(prev => (prev.has(s) && prev.size === 1) ? new Set(["all"]) : new Set([s]));
    } else {
      setFleetFilters(prev => {
        const next = new Set(prev) as Set<TruckStatus | "all" | "Uniform" | "Dust">;
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
      if (t.truck_type === "Uniform") c.Uniform = (c.Uniform ?? 0) + 1;
      else if (t.truck_type === "Dust") c.Dust = (c.Dust ?? 0) + 1;
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
        // Truck-TYPE filters (Uniform / Dust) match purely on truck_type.
        if (fleetFilters.has("Uniform") && t.truck_type === "Uniform") return true;
        if (fleetFilters.has("Dust") && t.truck_type === "Dust") return true;
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
        // Loaded-ahead-while-off: a non-carrier truck loaded but scheduled off
        // the load day lives HERE, not on tonight's Loaded board (the sidebar
        // bucket counts it under Off the same way).
        if (t.truck_type !== "Spare" && getCoverageRouteNumber(t) == null && t.route_split_route == null &&
            !holidayLoad && isScheduledOff(t, runDayNum) && t.state?.status === "loaded") return true;
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
      // A taken-over route (any truck carrying oos_spare_route for it) is
      // represented by its carrier's card even when the covered truck's
      // is_oos flag was cleared — both rendering painted identical "4 → 50"
      // pair cards twice on the Loaded board. EXCEPT when this truck is
      // itself a carrier (mutual/two-way takeover data): dropping both sides
      // of a mutual pair would hide two running trucks from every board.
      if (t.truck_type !== "Spare" && takenOverRoutes.has(t.truck_number) && takenOverRouteNumber(t) == null) return false;
      // For all other filters, re-evaluate auto-off trucks against unloadsDay
      // so they surface under their real workflow status.
      const s = effectiveWorkflowStatus(t, runDayNum, holidayLoad, runUnloadsDay, holidayUnload);
      // Loaded-ahead-while-off: a non-carrier truck loaded but scheduled off
      // the load day belongs to the Off view, not tonight's Loaded board
      // (keeps the grid lock-step with the sidebar bucket clamp).
      const offLoadedAhead =
        t.truck_type !== "Spare" && getCoverageRouteNumber(t) == null && t.route_split_route == null &&
        !holidayLoad && isScheduledOff(t, runDayNum) && s === "loaded";
      if (offLoadedAhead) return false; // shown in the Off view instead
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
        // A SPLIT helper carries a real load tonight — it belongs in every
        // lifecycle view (loaded/in_progress) like a covering spare, even
        // though the route it helps is running normally (not OOS).
        if (t.route_split_route != null) return true;
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
        // A spare with LIVE coverage fields belongs on a lifecycle board in
        // its own workflow status — regardless of WHY the route needed
        // covering. Requiring the covered truck to read "oos" hid loaded
        // coverage of dirty/crossloaded routes entirely: spare 17 covering
        // dirty 58 was loaded for the night yet appeared on no board while
        // the progress bar counted it. buildRouteStatusCounts applies the
        // same rule, keeping the drill and the sidebar in lockstep.
        return coveredRoute != null;
      }
      return true;
    });
  }, [data, filter, fleetMode, fleetFilters, runDayNum, runUnloadsDay, holidayLoad, holidayUnload, truckStatusByNumber, takenOverRoutes, coveringTruckByRoute]);



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
        ...statusStampFields(bulkStatus),
      });
    });
    setSelectedTrucks(new Set());
  }

  return (
    <div className={fleetMode ? "h-full" : ""}>

      {/* ── Main content ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className={fleetMode ? "space-y-4 overflow-y-auto p-3 md:p-4" : "space-y-4 p-3 md:p-6"}>
      {/* ── Page header (above the bulk-edit bar) ── */}
      {(() => {
        const titles: Record<string, string> = {
          all: "Truck Board",
          dirty: "Dirty",
          shop: "Shop",
          in_progress: "Loading",
          unloaded: "Unloaded",
          loaded: "Loaded",
          off: "Off",
          oos: "Requests / OOS",
          spare: "Spares / Coverages",
        };
        // The mixed boards (oos/spare) blend statuses, so a raw count would
        // mislead — they get no meta at all.
        const showCount = fleetMode || !["oos", "spare"].includes(filter);
        return (
          <PageHeader
            title={fleetMode ? "Fleet" : (titles[filter] ?? "Truck Board")}
            meta={
              showCount ? (
                <>
                  <Stat value={filtered.length} label={filtered.length === 1 ? "truck" : "trucks"} />
                  {fleetMode && (
                    <>
                      <Sep />
                      <Stat value={counts["dirty"] ?? 0} tone="dirty" />
                      <Stat value={counts["unloaded"] ?? 0} tone="unloaded" />
                      <Stat value={counts["loaded"] ?? 0} tone="loaded" />
                    </>
                  )}
                </>
              ) : undefined
            }
            actions={
              filter === "off" ? (
                <button
                  type="button"
                  onClick={() => setOffScheduleDialogOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-hairline bg-surface/60 px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-hairline hover:bg-surface-2"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-ink-muted" />
                  View Schedule
                </button>
              ) : undefined
            }
          />
        );
      })()}

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
      {/* Master coverage overview — the same big ROUTE → TRUCK cards as Load
          and Unload, split into two blocks the way those pages split them:
          today's coverage in the sky frame (Load's "Coverage today"), the
          previous day's in the amber frame (Unload's prev-coverage banner).
          One mixed block made a stale pairing look current. */}
      {fleetMode && (
        <CollapsibleCoverage
          entries={fleetCoverage.filter((e) => !e.prev)}
          title="Coverage today"
          storageKey="rr-fleet-coverage-open"
          tone="sky"
          statusOf={(n) => data?.find((t) => t.truck_number === n)?.state?.status ?? null}
        />
      )}
      {fleetMode && (
        <CollapsibleCoverage
          entries={fleetCoverage.filter((e) => e.prev)}
          title="Previous day coverage"
          storageKey="rr-fleet-prev-coverage-open"
          tone="amber"
          showPrevBadge={false}
        />
      )}
      {/* Previous Day Coverage — directly below the bulk-edit section */}
      {fleetMode && (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setPrevCovOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-hairline bg-surface/60 px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-hairline hover:bg-surface-2"
          >
            <ArrowLeftRight className="h-4 w-4 text-ink-muted" />
            Previous Day Coverage
          </button>
        </div>
      )}

      {isLoading && <p className="text-ink-muted">Loading…</p>}
      {error && (
        <p className="text-red-400">Failed to load board. Is the backend running?</p>
      )}

      {fleetMode && data && !isReadOnly && <CrossloadNoticeBar board={data} />}

      {fleetMode && data && <RouteCardPanel data={data} runDate={runDate} />}

      {filter === "in_progress" && (
        <LiveInProgress runDate={runDate} />
      )}

      {filter === "loaded" && !fleetMode && (
        <div className="flex justify-end">
          <Link
            to="/board?status=unloaded"
            className={clsx(
              "rounded-md border px-4 py-2 text-sm font-semibold transition-colors",
              counts["unloaded"]
                ? "border-blue-500/60 bg-blue-950/40 text-blue-300 hover:bg-blue-900/40"
                : "cursor-not-allowed border-hairline bg-surface-2/40 text-ink-faint",
            )}
            aria-disabled={!counts["unloaded"]}
            onClick={(e) => { if (!counts["unloaded"]) e.preventDefault(); }}
          >
            View Unloaded Trucks{counts["unloaded"] ? ` (${counts["unloaded"]})` : ""}
          </Link>
        </div>
      )}

      {filter !== "in_progress" && (
      <>
      {fleetMode && (
        <div className="-mt-1 flex items-center justify-end gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Card size</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-hairline text-[11px] font-semibold">
            {(["s", "m", "l"] as const).map((v, i) => (
              <button
                key={v}
                type="button"
                onClick={() => pickCardSize(v)}
                title={v === "s" ? "Small — fit the most trucks" : v === "l" ? "Large — read from across the room" : "Medium"}
                className={clsx(
                  "px-2.5 py-1 uppercase transition-colors",
                  i > 0 && "border-l border-hairline",
                  cardSize === v ? "bg-track text-white" : "bg-surface-3/50 text-ink-muted hover:text-ink-soft",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={clsx(
        "grid",
        fleetMode && cardSize === "s" ? "gap-2" : "gap-3",
        fleetMode
          ? cardSize === "s"
            ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]"
            : cardSize === "l"
            ? "grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
          : filter === "off"
          ? "gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          : filter === "dirty" || filter === "unloaded"
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          : "grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
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
            // Both halves read the SAME predicate rather than one spelling it
            // out and the other negating it by hand — that duplication is how
            // the two drifted apart in the first place.
            const isPlainDirty = (t: TruckWithState) =>
              t.state?.priority_hold !== true && t.state?.needs_checked !== true;
            dirtyRouteRows = dirtyRows.filter((t) => !isCoverageTruck(t) && isPlainDirty(t));
            dirtyCoverageRows = dirtyRows.filter((t) => isCoverageTruck(t) && isPlainDirty(t));
            needsCheckedRows = filtered.filter((t) => t.state?.needs_checked === true && t.state?.priority_hold !== true);
          } else if (!fleetMode && filter === "spare") {
            // A split helper has a real job tonight — it belongs with the
            // assigned spares, not the idle ones.
            coveringSpares = filtered.filter((t) =>
              t.route_swap_route != null || t.route_split_route != null || t.state?.oos_spare_route != null
            );
            idleSpares = filtered.filter((t) =>
              t.route_swap_route == null && t.route_split_route == null && t.state?.oos_spare_route == null
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
          // One click policy for every card/tile on this page — extracted so
          // the quiet tiles and the fleet cards cannot drift apart.
          const handleTruckClick = (truck: TruckWithState) => {
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
                    // An "unfinished" truck was already batched/worked — clicking
                    // it should FINISH the unload (mark unloaded), not send it back
                    // through batch assignment. (Same as the Unload page's
                    // "Finish unload" action.)
                    if (truck.state?.status === "unfinished" || batchingDisabled) {
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
                      truck.route_split_route == null &&
                      truck.state?.oos_spare_route == null
                    ) {
                      // A spare only loads to cover a route — make them pick one
                      // first. A SPLIT assignment already gives it a job.
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
                    // Archive dates skip the action sheet: every control on it
                    // mutates run_date = the viewed date, so on a past date a
                    // stray tap would rewrite history (and Arrived would stamp
                    // TODAY's clock onto an old row). Go straight to the
                    // read-only detail modal instead.
                    if (isReadOnly) setDetailNum(truck.truck_number);
                    else setMobileActionTruck(truck);
                  } else {
                    setDetailNum(detailNum === truck.truck_number ? null : truck.truck_number);
                  }
          };
          // The OOS page's whole job, extracted so the quiet tiles can carry
          // it: covered display / tap-to-assign / the picker itself.
          const renderOosAssignBlock = (truck: TruckWithState) => (
            <OosAssignPanel
              truck={truck}
              runDate={runDate}
              runDayNum={runDayNum}
              board={data ?? []}
              coveringTruckByRoute={coveringTruckByRoute}
              oosAssignOpen={oosAssignOpen}
              setOosAssignOpen={setOosAssignOpen}
              oosCardSelects={oosCardSelects}
              setOosCardSelects={setOosCardSelects}
              renderRemoveFromOos={renderRemoveFromOos}
              oosActionPending={oosActionPending}
            />
          );
          /* Unload-style quiet tile for the live-status drill pages
             (Dirty / Unloaded / Spare / Off / OOS). Same visual language as
             the Unload board: mono number carrying the status colour, a
             matching dot, one sub line, the ROUTE → TRUCK pair face for
             coverage. Fleet mode and the Loaded page keep the big cards. */
          const renderStatusTile = (truck: TruckWithState) => (
            <StatusTile
              key={truck.truck_number}
              truck={truck}
              filter={filter}
              runDayNum={runDayNum}
              runUnloadsDay={runUnloadsDay}
              holidayLoad={holidayLoad}
              holidayUnload={holidayUnload}
              unloadsDay2={unloadsDay2}
              loadDay2={loadDay2}
              loadNextDay={loadNextDay}
              coveringRouteByTruckNum={coveringRouteByTruckNum}
              coveringTruckByRoute={coveringTruckByRoute}
              highlightTruck={highlightTruck}
              isReadOnly={isReadOnly}
              onClick={handleTruckClick}
              oosAssignBlock={renderOosAssignBlock}
            />
          );

          // The card's context bag — everything FleetCard reads from this page.
          const fleetCardCtx = {
            fleetMode, filter, runDate, runDayNum, runUnloadsDay, holidayLoad, holidayUnload,
            unloadsDay2, loadDay2, loadNextDay, cardSize, isReadOnly, isAdmin, batchingDisabled,
            multiSelect, selectedTrucks, detailNum, setDetailNum, highlightTruck, oosAssignOpen,
            coveringTruckByRoute, coveringRouteByTruckNum, data, arrivedTrackingEnabled,
            outsideTimerEnabled, paperBayEnabled, outsideTimers, paperBayTimers,
            outsideCountdowns, paperBayCountdowns, cancelOutsideTimer, cancelPaperBayTimer,
            clearArrived, handleTruckClick, renderOosAssignBlock,
          };
          const renderTruckCard = (truck: TruckWithState, index: number) => (
            <FleetCard key={truck.truck_number} truck={truck} index={index} {...fleetCardCtx} />
          );


          if (!fleetMode && filter === "unloaded") {
            return [
              <CollapsibleSection key="unloaded-running" sectionKey="unloaded-running" title={`Day ${runDayNum}`} titleClassName="text-emerald-400" sectionRows={unloadedRunningRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="unloaded-spare" sectionKey="unloaded-spare" title="Spare" titleClassName="text-cyan-400" sectionRows={unloadedSpareRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="unloaded-off" sectionKey="unloaded-off" title="Off" titleClassName="text-ink-muted" sectionRows={unloadedOffRows} renderTruckCard={renderStatusTile} tileGrid />,
            ];
          }

          if (!fleetMode && filter === "dirty") {
            return [
              <CollapsibleSection key="dirty-requests" sectionKey="dirty-requests" title="Requests" titleClassName="text-amber-400" sectionRows={priorityRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="dirty-coverages" sectionKey="dirty-coverages" title="Spares / Coverages" titleClassName="text-violet-400" sectionRows={dirtyCoverageRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="dirty-needs-checked" sectionKey="dirty-needs-checked" title="Needs Checked" titleClassName="text-amber-400" sectionRows={needsCheckedRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="dirty-dirty" sectionKey="dirty-dirty" title="Dirty" titleClassName="text-red-400" sectionRows={dirtyRouteRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="dirty-unfinished" sectionKey="dirty-unfinished" title="Unfinished" titleClassName="text-status-unfinished" sectionRows={unfinishedRows} renderTruckCard={renderStatusTile} tileGrid />,
            ];
          }

          if (!fleetMode && filter === "oos") {
            return [
              <CollapsibleSection key="oos-hold" sectionKey="oos-hold" title="Requests" titleClassName="text-amber-400" sectionRows={holdRows} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="oos-out" sectionKey="oos-out" title="Out of Service" titleClassName="text-ink-muted" sectionRows={outOfServiceRows} renderTruckCard={renderStatusTile} tileGrid="oos" />,
            ];
          }

          if (!fleetMode && filter === "spare") {
            return [
              <CollapsibleSection key="spare-cov" sectionKey="spare-cov" title="Coverage" titleClassName="text-violet-400" sectionRows={coveringSpares} renderTruckCard={renderStatusTile} tileGrid />,
              <CollapsibleSection key="spare-idle" sectionKey="spare-idle" title="Idle Spare" titleClassName="text-cyan-400" sectionRows={idleSpares} renderTruckCard={renderStatusTile} tileGrid />,
            ];
          }

          if (!fleetMode && filter === "off") {
            return rows.map((row) => renderStatusTile(row as TruckWithState));
          }
          return rows.map((row, index) => {
            return renderTruckCard(row as TruckWithState, index);
          });
        })()}
        {!isLoading && filtered.length === 0 && (
          <EmptyState className="col-span-full">No trucks match this filter.</EmptyState>
        )}
      </div>

    </>
    )} {/* end filter !== "in_progress" */}

      {offScheduleDialogOpen && (
        <OffBoardScheduleDialog onClose={() => setOffScheduleDialogOpen(false)} />
      )}

      <BoardDialogs
        runDate={runDate}
        runDayNum={runDayNum}
        inProgressTruck={inProgressTruck ?? null}
        offCoverageTruck={offCoverageTruck}
        setOffCoverageTruck={setOffCoverageTruck}
        offCoverageLoadOn={offCoverageLoadOn}
        setOffCoverageLoadOn={setOffCoverageLoadOn}
        offCoverageError={offCoverageError}
        setOffCoverageError={setOffCoverageError}
        spareCoverageTruck={spareCoverageTruck}
        setSpareCoverageTruck={setSpareCoverageTruck}
        spareCoverageRoute={spareCoverageRoute}
        setSpareCoverageRoute={setSpareCoverageRoute}
        spareCoverageError={spareCoverageError}
        setSpareCoverageError={setSpareCoverageError}
        prevCovOpen={prevCovOpen}
        setPrevCovOpen={setPrevCovOpen}
        prevCovRoute={prevCovRoute}
        setPrevCovRoute={setPrevCovRoute}
        prevCovTruck={prevCovTruck}
        setPrevCovTruck={setPrevCovTruck}
        prevCovError={prevCovError}
        setPrevCovError={setPrevCovError}
        pendingOosTruck={pendingOosTruck}
        setPendingOosTruck={setPendingOosTruck}
        pendingOffLoadTruck={pendingOffLoadTruck}
        setPendingOffLoadTruck={setPendingOffLoadTruck}
        pendingOffLoadRoute={pendingOffLoadRoute}
        setPendingOffLoadRoute={setPendingOffLoadRoute}
        pendingOffLoadError={pendingOffLoadError}
        setPendingOffLoadError={setPendingOffLoadError}
        confirmTruck={confirmTruck}
        setConfirmTruck={setConfirmTruck}
        holdAlertTruck={holdAlertTruck}
        setHoldAlertTruck={setHoldAlertTruck}
        finalizeOffTruckAsLoaded={finalizeOffTruckAsLoaded}
        startLoad={startLoad}
      />

      {mobileActionTruck && fleetMode && (() => {
        // The LIVE row, not the snapshot taken on tap. The sheet's flag
        // switches keep it open after a write, so every prop derived from the
        // truck has to come from the refreshed board — passing only `truck`
        // fresh left the switches showing their old position while the write
        // had already landed.
        const live = data?.find((t) => t.truck_number === mobileActionTruck.truck_number) ?? mobileActionTruck;
        return (
        <FleetMobileActionSheet
          truck={live}
          runDate={runDate}
          onClose={() => setMobileActionTruck(null)}
          onManageTruck={() => {
            setDetailNum(mobileActionTruck.truck_number);
            setMobileActionTruck(null);
          }}
          arrivedEnabled={arrivedTrackingEnabled}
          arrivedAt={live.state?.arrived_at}
          needsChecked={live.state?.needs_checked === true}
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
          onArrived={() => markArrived(live)}
          onClearArrived={() => clearArrived(live)}
        />
        );
      })()}

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

      </motion.div>
    </div>
  );
}

