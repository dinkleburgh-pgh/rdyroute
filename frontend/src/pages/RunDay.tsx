/**
 * Day Overview — the whole shift on one screen.
 *
 * Layout (from the 2026-09-29 redesign):
 *   pulse row   two STACKED meters (unload / load), a Needs-attention box and
 *               the shift notes (amber only when there is text);
 *   two lanes   Unload and Load side by side from lg up — Load used to sit
 *               below the fold on a 30-truck fleet. One lane at a time on a
 *               phone, behind a tab switch.
 * Inside a lane trucks are grouped by what they need: Working cards stay big,
 * Ready cards are shorter, Done and Off collapse to chips. Visual mass tracks
 * the work left. The old amber/sky callout boxes are group headers now.
 *
 * Every derivation below (coverage maps, substitution of a covering spare for
 * its OOS route, the context-based counters, prev-day carriers…) is the same
 * one the sidebar, Board and Unload pages use — only the rendering changed.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Clock } from "lucide-react";
import {
  useAssignSpare,
  useBatchSummary,
  useBoard,
  useDailyNotes,
  useHolidayLoad,
  useHolidayUnload,
  useSetDailyNotes,
  useLoadDayOverride,
  useUnloadsDayOverride,
  useTruckNotes,
  useOpenSpareAssignments,
  usePrevDayCarriers,
  usePrevDaySplitHelpers,
  usePrevOperatingDay,
  useRouteSwapLog,
  useSettings,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import { useLoadTimerVisible } from "../hooks/useLoadTimerVisible";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { TruckNote, TruckStatus, TruckWithState } from "../types";
import {
  buildCoverageList,
  buildHistoricalCoverageFallback,
  buildOperationalDayContext,
  buildPrevDayCoverage,
  countLoaded,
  countUnloadedFromContext,
  effectiveStatus,
  garmentIsLoaded,
  getCoverageRouteNumber,
  getSwapHistory,
  isScheduledOff,
  previousWorkday,
  recordSwapHistory,
  resolvePrevRunDate,
  takenOverRouteNumber,
} from "../utils/truckStatus";
import { resolveNoCap, resolveWearerCap } from "../utils/batchCapacity";
import { truckTypeLabel } from "../utils/truckType";
import { formatRunDate } from "../utils/dates";
import { errorDetail } from "../api/errors";
import PageStatus, { pageStatusFor } from "../components/PageStatus";
import PageHeader from "../components/PageHeader";
import CoverageCards from "../components/CoverageCards";
import { DoneChip, OffChip, ReadyCard, WorkingCard, type CardBadge } from "./runday/cards";
import { BatchTile, GroupHeader, LaneHeader, Meter, MobileLaneSwitch, PulseCard } from "./runday/parts";

const UNLOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, unfinished: 1, shop: 2, in_progress: 3, unloaded: 4, loaded: 5, oos: 6, off: 7,
};
const LOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, unfinished: 1, unloaded: 2, shop: 3, in_progress: 4, loaded: 5, oos: 6, off: 7,
};

/** One truck's slot in a lane, already resolved to what the card shows. */
type LaneCard = {
  key: number;
  number: number;
  /** Stripe + number colour. */
  status: TruckStatus;
  /** Overrides the status word — "Unloading" on a dirty truck the dock is on. */
  label?: string;
  sub: string;
  group: "working" | "ready" | "done" | "off";
  badge?: CardBadge;
  notes?: TruckNote[];
  sinceSec?: number | null;
  emphasis?: boolean;
  /** Off-group chips: U OFF / L OFF / OOS. */
  chipTag?: string;
};

function weekdayShort(iso: string | null): string {
  if (!iso) return "prev day";
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* private mode — the toggle still works for this visit */
  }
}

const BTN = "min-h-[36px] rounded-lg border px-3 text-xs font-semibold transition-colors";

export default function RunDay() {
  const runDate = todayIso();
  const boardQuery = useBoard(runDate);
  const { data: board = [] } = boardQuery;
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const { data: allNotes = [] } = useTruckNotes({ activeOnly: true });
  const today = todayIso();
  const notesByTruck = useMemo(() => {
    const map = new Map<number, TruckNote[]>();
    for (const n of allNotes) {
      if (!n.is_active) continue;
      if (n.note_type === "one_off" && n.expires_on && n.expires_on < today) continue;
      const arr = map.get(n.truck_number) ?? [];
      arr.push(n);
      map.set(n.truck_number, arr);
    }
    return map;
  }, [allNotes, today]);
  // Notes that apply to a truck on a given workday: always-on, one-offs, and
  // the ones pinned to that day number.
  const notesFor = (truckNumber: number, dayNum: number): TruckNote[] | undefined => {
    const list = (notesByTruck.get(truckNumber) ?? []).filter(
      (n) => n.note_type === "constant" || n.note_type === "one_off" || n.workday_num === dayNum,
    );
    return list.length > 0 ? list : undefined;
  };
  const { loadDay: computedLoadDay, unloadsDay: computedUnloadsDay } = workdayNumbers();
  const { data: loadDayOverride }    = useLoadDayOverride(runDate);
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const loadDay    = loadDayOverride    ?? computedLoadDay;
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;

  const [unloadCollapsed, setUnloadCollapsed] = useState(() => readFlag("runday:unloadCollapsed"));
  const [loadCollapsed, setLoadCollapsed] = useState(() => readFlag("runday:loadCollapsed"));
  // "Collapse done" hides the Done and Off chip rows in both lanes; the group
  // headers stay so the counts do.
  const [collapseDone, setCollapseDone] = useState(() => readFlag("runday:collapseDone"));
  // Phone: one lane at a time.
  const [mobileLane, setMobileLane] = useState<"unload" | "load">(() =>
    readFlag("runday:mobileLoad") ? "load" : "unload",
  );
  function pickMobileLane(lane: "unload" | "load") {
    setMobileLane(lane);
    writeFlag("runday:mobileLoad", lane === "load");
  }

  // Shift notes — inline on the page, editable by supervisors+
  const { user } = useAuth();
  // A loading card's "· N min" is the load timer by another name, so it
  // follows the Operations switch. Unloading minutes are not the load timer.
  const showLoadTimer = useLoadTimerVisible();
  const canEditNotes = ["admin", "fleet", "supervisor", "lead", "atl"].includes(user?.role ?? "");
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  const setDailyNotesMutation = useSetDailyNotes();
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  // Shift Notes can be toggled off in Operations settings (default on).
  const { data: settings = [] } = useSettings();
  const shiftNotesEnabled = settings.find((s) => s.key === "shift_notes_enabled")?.value !== false;
  const showNotesCard = shiftNotesEnabled && (Boolean(dailyNotes) || canEditNotes);

  // Batches (unload lane) — the Report's read, one tile per batch.
  const batchingDisabled = settings.some((s) => s.key === "batching_disabled" && s.value === true);
  const { data: batches = [] } = useBatchSummary(runDate);
  const cap = useMemo(() => resolveWearerCap(settings), [settings]);
  const noCap = resolveNoCap(settings);
  const batchWearers = batches.reduce((s, b) => s + b.total_wearers, 0);
  const batchesUsed = batches.filter((b) => b.trucks.length > 0).length;

  const { data: swapLog = [] } = useRouteSwapLog(60);
  const { data: openSpareAssignments = [] } = useOpenSpareAssignments();

  // Map from route truck number → the truck covering its route today.
  // Includes spare-type trucks (via oos_spare_route or route_swap_route) AND
  // non-spare trucks assigned via a route swap.  Spares are hidden from the
  // grid; non-spare covering trucks still render their own card.
  //
  // Also folds in the read-only historical fallback: an is_oos route truck
  // with no LIVE coverage today (nobody has re-confirmed the swap yet this
  // shift) is still represented by whoever covered it most recently, per the
  // route-swap log — it didn't suddenly become dirty just because today's
  // coverage record lapsed. Matches Board.tsx/the sidebar so all three agree.
  const coveringTruckMap = useMemo(() => {
    const boardByNum = new Map(board.map((t) => [t.truck_number, t]));
    const m = new Map<number, TruckWithState>(
      board
        .filter((t) => t.route_swap_route != null || t.state?.oos_spare_route != null)
        .map((t) => [(t.route_swap_route ?? t.state!.oos_spare_route) as number, t]),
    );
    const fallback = buildHistoricalCoverageFallback(board, openSpareAssignments, swapLog, runDate);
    for (const [route, truckNum] of fallback) {
      if (m.has(route)) continue;
      const cover = boardByNum.get(truckNum);
      if (cover) m.set(route, cover);
    }
    return m;
  }, [board, swapLog, openSpareAssignments, runDate]);

  /**
   * TODAY's coverage only — no historical fallback. The fallback exists so the
   * UNLOAD side can show who covered a route yesterday (that's what's being
   * unloaded), but on the LOAD side it made a stale pairing look like a live
   * assignment: an OOS truck nobody has covered yet today rendered "#4 ⇄ #57"
   * from last shift's swap log instead of asking to be assigned.
   */
  const liveCoveringTruckMap = useMemo(
    () =>
      new Map<number, TruckWithState>(
        board
          .filter((t) => t.route_swap_route != null || t.state?.oos_spare_route != null)
          .map((t) => [(t.route_swap_route ?? t.state!.oos_spare_route) as number, t]),
      ),
    [board],
  );

  // Route trucks running today that are OOS with nobody covering them yet.
  const needsAssignment = useMemo(
    () =>
      board
        .filter(
          (t) =>
            t.truck_type !== "Spare" &&
            t.is_active &&
            (t.is_oos || t.state?.status === "oos") &&
            !liveCoveringTruckMap.has(t.truck_number) &&
            (holidayLoad || !isScheduledOff(t, loadDay)),
        )
        .sort((a, b) => a.truck_number - b.truck_number),
    [board, liveCoveringTruckMap, holidayLoad, loadDay],
  );

  // Inline assignment for the Needs-assignment rows (mirrors the Route Swaps
  // modal: a spare covering an OOS route is a SpareAssignment).
  const assignSpare = useAssignSpare();
  const [assignFor, setAssignFor] = useState<Record<number, string>>({});
  const [assignError, setAssignError] = useState<string | null>(null);

  const assignOptions = useMemo(() => {
    const sorted = [...board].sort((a, b) => a.truck_number - b.truck_number);
    const covering = new Set(
      board
        .filter((t) => t.route_swap_route != null || t.state?.oos_spare_route != null)
        .map((t) => t.truck_number),
    );
    const free = (t: TruckWithState) => !covering.has(t.truck_number);
    return {
      spares: sorted.filter((t) => t.truck_type === "Spare" && free(t)),
      // Schedule-based, matching RouteSwapModal — a scheduled-off truck is the
      // natural candidate to carry a route tomorrow.
      offToday: sorted.filter(
        (t) =>
          t.truck_type !== "Spare" && free(t) &&
          !(t.is_oos || t.state?.status === "oos") &&
          !holidayLoad && isScheduledOff(t, loadDay),
      ),
      routes: sorted.filter(
        (t) =>
          t.truck_type !== "Spare" && free(t) &&
          !(t.is_oos || t.state?.status === "oos") &&
          (holidayLoad || !isScheduledOff(t, loadDay)),
      ),
    };
  }, [board, holidayLoad, loadDay]);

  async function assignCoverage(routeTruck: number, coveringTruck: number) {
    setAssignError(null);
    try {
      await assignSpare.mutateAsync({
        run_date: runDate,
        spare_truck_number: coveringTruck,
        covering_route_truck: routeTruck,
      });
      recordSwapHistory(routeTruck, coveringTruck);
      setAssignFor((p) => { const n = { ...p }; delete n[routeTruck]; return n; });
    } catch (err: unknown) {
      const detail = errorDetail(err);
      setAssignError(detail ?? `Could not assign #${coveringTruck} to route #${routeTruck}.`);
      setAssignFor((p) => { const n = { ...p }; delete n[routeTruck]; return n; });
    }
  }

  // The status a card actually displays, used for sorting so the order matches
  // the visible badge:
  //  - an OOS route that's covered reflects its covering truck's status, and
  //  - an "off" truck that physically came back dirty/unloaded shows that
  //    underlying badge (a dirty truck still needs unloading even if it's off
  //    the next load day), so sort it by that — keeping dirty trucks at the top.
  function displayStatusFor(t: TruckWithState, dayNum: number, holiday: boolean, role: "load" | "unload" = "load"): TruckStatus {
    // Load side sorts on TODAY's coverage only — an unassigned OOS route sorts
    // as OOS (it needs assignment), not as whoever covered it last shift.
    const map = role === "unload" ? coveringTruckMap : liveCoveringTruckMap;
    const covRaw = t.state?.status === "oos" ? map.get(t.truck_number) : undefined;
    // Unload side: only a SPARE cover stands in. A route-truck carrier's
    // same-day coverage describes TOMORROW's load — the covered truck ran
    // its route today and sorts/displays by its own physical state.
    const cov = role === "unload" && covRaw?.truck_type !== "Spare" ? undefined : covRaw;
    const base = cov ?? t;
    const eff = effectiveStatus(base, dayNum, holiday);
    if (eff === "off" && (base.state?.status === "dirty" || base.state?.status === "unloaded")) {
      return base.state.status as TruckStatus;
    }
    return eff;
  }

  // Prev-day split helpers: they ran carrying a route's overflow yesterday and
  // are extra unload slots today. Declared before the grids that consume them.
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);

  const unloadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            // Prev-day split helpers ran carrying overflow — extra unload cards.
            prevSplitHelpers.has(t.truck_number) ||
            ((t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
            (holidayUnload || !isScheduledOff(t, unloadsDay))),
        )
        .sort((a, b) => {
          // Clamp loaded→unloaded in unload sort: from this section's POV,
          // "loaded" is just a downstream state of "unloaded".
          const sa = displayStatusFor(a, unloadsDay, holidayUnload, "unload");
          const sb = displayStatusFor(b, unloadsDay, holidayUnload, "unload");
          const ka: TruckStatus = sa === "loaded" ? "unloaded" : sa;
          const kb: TruckStatus = sb === "loaded" ? "unloaded" : sb;
          const oa = UNLOAD_SORT[ka] ?? 9;
          const ob = UNLOAD_SORT[kb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, unloadsDay, holidayUnload, coveringTruckMap, prevSplitHelpers],
  );

  const loadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            // Split helpers carry a route's overflow tonight — extra load cards.
            t.route_split_route != null ||
            ((t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
            (holidayLoad || !isScheduledOff(t, loadDay))),
        )
        .sort((a, b) => {
          const sa = displayStatusFor(a, loadDay, holidayLoad);
          const sb = displayStatusFor(b, loadDay, holidayLoad);
          const oa = LOAD_SORT[sa] ?? 9;
          const ob = LOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, loadDay, holidayLoad, coveringTruckMap],
  );

  // Unload active trucks = exactly the routes running on unloadsDay per Fleet Schedule.
  // Uses buildOperationalDayContext (same as loadContext) so the count is consistent:
  // one entry per running route (covering spare replaces its OOS route truck).
  const unloadContext = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload ?? false, false, "unload", prevSplitHelpers),
    [board, unloadsDay, holidayUnload, prevSplitHelpers],
  );
  const unloadActiveTrucks = unloadContext.activeTrucks;
  const unloadTotal = unloadActiveTrucks.length;
  // Shared counter so pure day-init seeds count as pending, not done —
  // same rule as the sidebar and Load page unload bars. Prev-day carriers
  // credit a covered route once its carrier is unloaded.
  const prevDayCarriers = usePrevDayCarriers(runDate, board);
  const unloadDone = useMemo(
    () => countUnloadedFromContext(unloadContext, prevDayCarriers),
    [unloadContext, prevDayCarriers],
  );
  const unloadSpareCount = unloadActiveTrucks.filter((t) => t.truck_type === "Spare").length;

  // On holiday, two days' worth of routes run in one shift.
  // Unload catches up on the PREVIOUS ship day; load gets ahead on the NEXT
  // ship day. So unload's second day is unloadsDay-1, load's is loadDay+1
  // (matches the sidebar/board "Day N + N+1" load label).
  const unloadsDay2 = previousWorkday(unloadsDay);
  const loadNextDay = loadDay === 5 ? 1 : loadDay + 1;
  const unloadDayLabel = holidayUnload ? `Day ${unloadsDay2} + ${unloadsDay}` : `Day ${unloadsDay}`;
  const loadDayLabel = holidayLoad ? `Day ${loadDay} + ${loadNextDay}` : `Day ${loadDay}`;

  const loadContext = useMemo(
    () => buildOperationalDayContext(board, loadDay, holidayLoad, false),
    [board, loadDay, holidayLoad],
  );
  const loadTotal = loadContext.activeTrucks.length;
  const loadDone = useMemo(
    () => countLoaded(board, loadDay, holidayLoad, unloadsDay, holidayUnload),
    [board, loadDay, unloadsDay, holidayLoad, holidayUnload],
  );
  const loadSpareCount = loadContext.activeTrucks.filter((t) => t.truck_type === "Spare").length;

  // The previous OPERATING run date — from the server (max run_date < today) so
  // a mid-week plant closure doesn't blank out coverage; falls back to the
  // weekday step. Monday's unload is Friday's load.
  const { data: prevOp } = usePrevOperatingDay(runDate);
  const prevRunDate = useMemo(() => resolvePrevRunDate(runDate, prevOp), [runDate, prevOp]);

  // Previous load-day coverage (shown with the Unload lane as a reminder):
  // the trucks being unloaded today were loaded on the prior run day, so surface
  // who covered which route then. Uses the shared buildPrevDayCoverage (same as
  // the Unload page and Note Cards) — coverage from the ACTUAL previous run day
  // only, so a swap from last week can't stick around on days with no coverage.
  const prevCoverage = useMemo(() => buildPrevDayCoverage(swapLog, prevRunDate), [swapLog, prevRunDate]);
  const prevEntries = useMemo(
    () => buildCoverageList({ role: "unload", board: [], prevCoverage }),
    [prevCoverage],
  );
  // Today's live coverages (shown with the Load lane) — the same normalised
  // list every other surface renders, so the cards read identically.
  const todayEntries = useMemo(
    () => buildCoverageList({ role: "load", board, prevCoverage }),
    [board, prevCoverage],
  );

  // Lookups so the Unload lane can show each route's covering truck from the
  // PREVIOUS load day (what's being unloaded today was covered then).
  const boardByNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);
  // Split entries excluded: the route ran itself, so nothing substitutes.
  const prevCoverByRoute = useMemo(
    () => new Map(prevCoverage.items.filter((c) => !c.isSplit).map((c) => [c.route, c.loadOn])),
    [prevCoverage],
  );
  // Covering spares from the previous load day — rendered in place of the route
  // they covered, so drop their standalone card from the unload grid. Split
  // helpers are NOT covers — they keep their own card (they ran too).
  const prevSpareCoverNums = useMemo(() => {
    const s = new Set<number>();
    for (const c of prevCoverage.items) {
      if (!c.isSplit && boardByNum.get(c.loadOn)?.truck_type === "Spare") s.add(c.loadOn);
    }
    return s;
  }, [prevCoverage, boardByNum]);

  // ---- lane cards --------------------------------------------------------
  // Resolve every truck to what its card shows, then group. The substitution
  // rules are unchanged from the tile grid this replaced; what is new is the
  // grouping, the sub-line, and the dock's "unloading now" marker surfacing as
  // an amber Working card with elapsed minutes.
  const isBeingUnloaded = (t: TruckWithState) =>
    t.state?.unloading_started_at != null && (t.state.status === "dirty" || t.state.status === "unfinished");

  const unloadCards = useMemo<LaneCard[]>(
    () =>
      unloadTrucks
        // UNLOAD side: a takeover describes where the NEXT load rides —
        // it doesn't change who ran today. Route-truck carriers therefore
        // render AS THEMSELVES here (their own route ran), and only true
        // Spares (no route of their own) render in place of the route
        // they cover.
        .filter((t) =>
          !(t.truck_type === "Spare" && getCoverageRouteNumber(t) != null) &&
          !prevSpareCoverNums.has(t.truck_number),
        )
        .map((t) => {
          // Unload reflects the PREVIOUS load day: prefer who covered this
          // route then (if known), falling back to today's coverage.
          const prevCoverNum = prevCoverByRoute.get(t.truck_number);
          const prevCover = prevCoverNum != null ? boardByNum.get(prevCoverNum) : undefined;
          const todayCover = coveringTruckMap.get(t.truck_number);
          const coveringTruck = prevCover ?? todayCover;
          // Only a SPARE cover substitutes on the unload side — a
          // route-truck carrier ran its own route today and renders its
          // own card, so the covered route's truck keeps its slot too.
          const spareCover = coveringTruck?.truck_type === "Spare" ? coveringTruck : undefined;
          const displayTruck = spareCover ?? t;
          const ownRaw = effectiveStatus(displayTruck, unloadsDay, holidayUnload);
          // A non-spare cover's status substitutes ONLY when it covered the
          // PREVIOUS load day (the covered truck genuinely didn't run and
          // its cover's unload progress is its progress). A cover entered
          // TODAY describes tomorrow's load — the covered truck ran today
          // and must show its own pending state.
          const raw = !spareCover && prevCover
            ? effectiveStatus(prevCover, unloadsDay, holidayUnload)
            : ownRaw;
          // The unload lifecycle ends at "Unloaded": anything downstream
          // (loaded, loading) is done from this lane's point of view.
          const status: TruckStatus = raw === "loaded" || raw === "in_progress" ? "unloaded" : raw;
          const truckUnloadDay = holidayUnload
            ? isScheduledOff(t, unloadsDay) ? unloadsDay2 : unloadsDay
            : unloadsDay;
          const isExtraDay = truckUnloadDay === unloadsDay2;
          const underlying = displayTruck.state?.status;
          const shown: TruckStatus =
            status === "off" && (underlying === "dirty" || underlying === "unloaded") ? underlying : status;
          const unloading = status !== "unloaded" && isBeingUnloaded(displayTruck);
          const group: LaneCard["group"] =
            shown === "unloaded" ? "done" : shown === "off" || shown === "oos" ? "off" : "working";
          const sub = [truckTypeLabel(displayTruck.truck_type)];
          if (spareCover) sub.push(`covers #${t.truck_number}`);
          else if (coveringTruck) sub.push(`covered by #${coveringTruck.truck_number}`);
          else if (displayTruck.route_split_route != null) sub.push(`split with #${displayTruck.route_split_route}`);
          else if (displayTruck.route_swap_route != null && displayTruck.truck_type !== "Spare") sub.push(`covers #${displayTruck.route_swap_route}`);
          if (status === "off" && shown !== "off" && displayTruck.truck_type !== "Spare") sub.push("U Off");
          const st = displayTruck.state;
          const badge: CardBadge | undefined = st?.needs_checked
            ? { label: "Check", tone: "amber" }
            : isExtraDay
              ? { label: `Day ${truckUnloadDay}`, tone: "amber" }
              : displayTruck.truck_type === "Dust" && st?.has_dust_garment
                ? { label: "Garments", tone: garmentIsLoaded(displayTruck) ? "sky" : "amber" }
                : undefined;
          return {
            key: displayTruck.truck_number,
            number: displayTruck.truck_number,
            status: unloading ? "in_progress" : shown,
            label: unloading ? "Unloading" : undefined,
            sub: sub.join(" · "),
            group,
            badge,
            notes: group === "working" ? notesFor(displayTruck.truck_number, truckUnloadDay) : undefined,
            sinceSec: unloading ? st!.unloading_started_at : null,
            emphasis: unloading,
            chipTag: shown === "oos" ? "OOS" : shown === "off" ? "U OFF" : undefined,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unloadTrucks, prevSpareCoverNums, prevCoverByRoute, boardByNum, coveringTruckMap, unloadsDay, unloadsDay2, holidayUnload, notesByTruck],
  );

  const loadCards = useMemo<LaneCard[]>(
    () =>
      loadTrucks
        // Covering trucks (ANY type carrying a takeover) are rendered in
        // place of the route they cover — drop the standalone card.
        .filter((t) => takenOverRouteNumber(t) == null)
        .map((t) => {
          // TODAY's coverage only — an unassigned OOS route keeps its own
          // card (and shows up under Needs assignment) instead of wearing a
          // stale pairing.
          const coveringTruck = liveCoveringTruckMap.get(t.truck_number);
          // Once a truck takes over an OOS route (any type), show the
          // cover's card instead of the empty OOS truck.
          const spareCover =
            coveringTruck && takenOverRouteNumber(coveringTruck) === t.truck_number
              ? coveringTruck
              : coveringTruck?.truck_type === "Spare" ? coveringTruck : undefined;
          const displayTruck = spareCover ?? t;
          const status = !spareCover && coveringTruck
            ? effectiveStatus(coveringTruck, loadDay, holidayLoad)
            : effectiveStatus(displayTruck, loadDay, holidayLoad);
          const truckLoadDay = holidayLoad
            ? isScheduledOff(t, loadDay) ? loadNextDay : loadDay
            : loadDay;
          const isExtraDay = truckLoadDay === loadNextDay;
          const underlying = displayTruck.state?.status;
          const shown: TruckStatus =
            status === "off" && (underlying === "dirty" || underlying === "unloaded") ? underlying : status;
          const group: LaneCard["group"] =
            shown === "loaded" ? "done" : shown === "unloaded" ? "ready" : shown === "off" || shown === "oos" ? "off" : "working";
          const unloading = group === "working" && isBeingUnloaded(displayTruck);
          const loading = shown === "in_progress";
          const sub = [truckTypeLabel(displayTruck.truck_type)];
          if (spareCover) sub.push(`covers #${t.truck_number}`);
          else if (coveringTruck) sub.push(`covered by #${coveringTruck.truck_number}`);
          else if (displayTruck.route_split_route != null) sub.push(`split with #${displayTruck.route_split_route}`);
          else if (displayTruck.route_swap_route != null && displayTruck.truck_type !== "Spare") sub.push(`covers #${displayTruck.route_swap_route}`);
          if (status === "off" && shown !== "off" && displayTruck.truck_type !== "Spare") sub.push("L Off");
          const st = displayTruck.state;
          const badge: CardBadge | undefined = st?.needs_checked
            ? { label: "Check", tone: "amber" }
            : st?.priority_hold
              ? { label: "Hold", tone: "amber" }
              : isExtraDay
                ? { label: `Day ${truckLoadDay}`, tone: "amber" }
                : group === "ready" && st?.staged_at != null
                  ? { label: "Staged", tone: "amber" }
                  : displayTruck.truck_type === "Dust" && st?.has_dust_garment
                    ? { label: "Garments", tone: garmentIsLoaded(displayTruck) ? "sky" : "amber" }
                    : undefined;
          return {
            key: displayTruck.truck_number,
            number: displayTruck.truck_number,
            status: unloading ? "in_progress" : shown,
            label: unloading ? "Unloading" : undefined,
            sub: sub.join(" · "),
            group,
            badge,
            notes: group === "working" || group === "ready" ? notesFor(displayTruck.truck_number, truckLoadDay) : undefined,
            sinceSec: unloading ? st!.unloading_started_at : loading && showLoadTimer ? st?.load_start_time ?? null : null,
            emphasis: unloading || loading,
            chipTag: shown === "oos" ? "OOS" : shown === "off" ? "L OFF" : undefined,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadTrucks, liveCoveringTruckMap, loadDay, loadNextDay, holidayLoad, notesByTruck, showLoadTimer],
  );

  const unloadWorking = unloadCards.filter((c) => c.group === "working");
  const unloadDoneCards = unloadCards.filter((c) => c.group === "done");
  const unloadOff = unloadCards.filter((c) => c.group === "off");
  const loadWorking = loadCards.filter((c) => c.group === "working");
  // A truck actively LOADING is the lane's live work, not "not ready" — it
  // gets its own group. (A dirty truck the dock is on keeps its "Unloading"
  // label and stays in Not ready: it really isn't ready to load yet.)
  const loadLoadingCards = loadWorking.filter((c) => c.status === "in_progress" && c.label !== "Unloading");
  const loadNotReadyCards = loadWorking.filter((c) => !(c.status === "in_progress" && c.label !== "Unloading"));
  const loadReady = loadCards.filter((c) => c.group === "ready");
  const loadDoneCards = loadCards.filter((c) => c.group === "done");
  const loadOff = loadCards.filter((c) => c.group === "off");

  // Meter segments. Totals come from the shared context counters (what the
  // sidebar shows); the in-between slices come from the cards; the remainder
  // absorbs any difference so the bar never overflows.
  const unloadingNow = unloadWorking.filter((c) => c.label === "Unloading").length;
  const unloadToGo = Math.max(0, unloadTotal - unloadDone - unloadingNow);
  const unloadLeft = Math.max(0, unloadTotal - unloadDone);
  const loadLoading = loadWorking.filter((c) => c.status === "in_progress" && c.label !== "Unloading").length;
  const loadReadyCount = loadReady.length;
  const loadNotReady = Math.max(0, loadTotal - loadDone - loadLoading - loadReadyCount);
  const loadLeft = Math.max(0, loadTotal - loadDone);

  // Needs attention — counted over the trucks that actually appear in a lane.
  const laneNums = useMemo(
    () => new Set([...unloadCards, ...loadCards].map((c) => c.number)),
    [unloadCards, loadCards],
  );
  const truckOf = (n: number) => boardByNum.get(n);

  // Loading / dead-connection gate — never render the fake empty day.
  const pageGate = pageStatusFor(boardQuery);
  if (pageGate) return <PageStatus {...pageGate} />;

  const notesCard = showNotesCard && (
    <PulseCard amber={Boolean(dailyNotes) || notesEditing} className="col-span-2 lg:col-span-2">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
        <span className={clsx("text-[11px] font-bold uppercase tracking-[0.08em]", dailyNotes ? "text-amber-400" : "text-ink-muted")}>
          Shift notes
        </span>
        {canEditNotes && !notesEditing && (
          <button
            type="button"
            onClick={() => { setNotesDraft(dailyNotes); setNotesEditing(true); }}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-track hover:text-ink-soft lg:hidden"
          >
            Edit
          </button>
        )}
      </div>
      {notesEditing ? (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-amber-500 focus:outline-none"
            rows={3}
            placeholder="Add shift handoff notes for the next team…"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={setDailyNotesMutation.isPending}
              onClick={async () => {
                await setDailyNotesMutation.mutateAsync({ runDate, notes: notesDraft });
                setNotesEditing(false);
              }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setNotesEditing(false)}
              className="rounded-lg bg-track px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : dailyNotes ? (
        <p className="line-clamp-2 whitespace-pre-wrap text-[13px] leading-snug text-amber-100/90 lg:line-clamp-3" title={dailyNotes}>
          {dailyNotes}
        </p>
      ) : (
        <p className="text-xs italic text-ink-muted">No shift notes for today.</p>
      )}
    </PulseCard>
  );

  return (
    <>
      <PageHeader
        title="Day Overview"
        titleBadge={
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            <span className={clsx("h-1.5 w-1.5 rounded-full bg-emerald-500", boardQuery.isFetching && "animate-pulse")} aria-hidden />
            Live · 5s
          </span>
        }
        meta={<span>{formatRunDate(runDate)}</span>}
        actions={
          <>
            <button
              type="button"
              aria-pressed={collapseDone}
              onClick={() => setCollapseDone((c) => { writeFlag("runday:collapseDone", !c); return !c; })}
              className={clsx(BTN, "border-hairline bg-surface text-ink-soft hover:bg-surface-2")}
            >
              {collapseDone ? "Show done" : "Collapse done"}
            </button>
            {shiftNotesEnabled && canEditNotes && (
              <button
                type="button"
                onClick={() => { setNotesDraft(dailyNotes); setNotesEditing(true); }}
                className={clsx(BTN, "hidden border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 lg:inline-flex lg:items-center")}
              >
                Edit shift notes
              </button>
            )}
          </>
        }
      />
      <div className="space-y-3 p-3 sm:p-4 lg:space-y-4 lg:p-6">

        {/* ---------------- pulse row ----------------
            The meters live INSIDE their lanes, and the old "Needs attention"
            block is gone (its one real action — assigning an uncovered OOS
            route — lives inline in the Load lane with the actual dropdowns).
            Only the shift notes remain up here. */}
        {notesCard && (
          <div className="grid grid-cols-2 gap-2 lg:gap-3">{notesCard}</div>
        )}

        <MobileLaneSwitch lane={mobileLane} onChange={pickMobileLane} unloadLeft={unloadLeft} loadLeft={loadLeft} />

        {/* ---------------- lanes ---------------- */}
        <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-4">

          {/* UNLOAD */}
          <section
            aria-label="Unload lane"
            className={clsx(
              "flex-col gap-3 rounded-xl border border-hairline bg-surface-3 px-3 pb-4 pt-3 sm:px-4",
              mobileLane === "unload" ? "flex" : "hidden lg:flex",
            )}
          >
            <LaneHeader
              title="Unload"
              day={unloadDayLabel}
              summary={
                <>
                  <b className="font-mono text-ink">{unloadDone}/{unloadTotal}</b> done · {unloadLeft} left
                  {unloadSpareCount > 0 && ` · ${unloadSpareCount} spare${unloadSpareCount === 1 ? "" : "s"}`}
                </>
              }
              collapsed={unloadCollapsed}
              onToggle={() => setUnloadCollapsed((c) => { writeFlag("runday:unloadCollapsed", !c); return !c; })}
            />
            <div style={{ display: "grid", gridTemplateRows: unloadCollapsed ? "0fr" : "1fr", transition: "grid-template-rows 220ms ease" }}>
              <div className="flex flex-col gap-3 overflow-hidden">

                <Meter
                  label="Unload"
                  day={unloadDayLabel}
                  done={unloadDone}
                  total={unloadTotal}
                  segments={[
                    { value: unloadDone, className: "bg-st-unloaded" },
                    { value: unloadingNow, className: "bg-st-inprogress" },
                    { value: unloadToGo, className: "bg-st-dirty" },
                  ]}
                  legend={[
                    { value: unloadDone, label: "unloaded", className: "text-green-400" },
                    { value: unloadingNow, label: "unloading", className: "text-amber-400" },
                    { value: unloadToGo, label: "to go", className: "text-red-400" },
                  ]}
                  trailing={unloadSpareCount > 0 ? `${unloadSpareCount} spare${unloadSpareCount === 1 ? "" : "s"}` : undefined}
                />

                {/* Previous load-day coverage: what is being unloaded today was covered then. */}
                {prevEntries.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeader label={`Covered ${weekdayShort(prevCoverage.date)}`} count={prevEntries.length} />
                    <CoverageCards entries={prevEntries} size="sm" truckOf={truckOf} showPrevBadge={false} />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <GroupHeader label="Working" count={unloadWorking.length} />
                  {unloadWorking.length === 0 ? (
                    <p className="py-2 text-center text-sm text-ink-faint">Nothing left to unload.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {unloadWorking.map((c) => (
                        <WorkingCard key={c.key} number={c.number} status={c.status} label={c.label} sub={c.sub} badge={c.badge} notes={c.notes} sinceSec={c.sinceSec} emphasis={c.emphasis} />
                      ))}
                    </div>
                  )}
                </div>

                {!batchingDisabled && batches.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeader
                      label="Batches"
                      count={`${batchesUsed}/${batches.length}`}
                      extra={`· ${batchWearers.toLocaleString()} wearers`}
                    />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {batches.map((b) => (
                        <BatchTile key={b.batch_number} batch={b} cap={cap} noCap={noCap} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <GroupHeader label="Unloaded" count={unloadDoneCards.length} extra={collapseDone && unloadDoneCards.length > 0 ? "· hidden" : undefined} />
                  {!collapseDone && unloadDoneCards.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {unloadDoneCards.map((c) => <DoneChip key={c.key} number={c.number} tone="unloaded" />)}
                    </div>
                  )}
                </div>

                {unloadOff.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeader label="Off · OOS" count={unloadOff.length} extra={collapseDone ? "· hidden" : undefined} />
                    {!collapseDone && (
                      <div className="flex flex-wrap gap-1.5">
                        {unloadOff.map((c) => <OffChip key={c.key} number={c.number} tag={c.chipTag ?? "OFF"} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* LOAD */}
          <section
            id="assign"
            aria-label="Load lane"
            className={clsx(
              "scroll-mt-16 flex-col gap-3 rounded-xl border border-hairline bg-surface-3 px-3 pb-4 pt-3 sm:px-4",
              mobileLane === "load" ? "flex" : "hidden lg:flex",
            )}
          >
            <LaneHeader
              title="Load"
              day={loadDayLabel}
              summary={
                <>
                  <b className="font-mono text-ink">{loadDone}/{loadTotal}</b> done · {loadLeft} left
                  {loadSpareCount > 0 && ` · ${loadSpareCount} spare${loadSpareCount === 1 ? "" : "s"}`}
                </>
              }
              collapsed={loadCollapsed}
              onToggle={() => setLoadCollapsed((c) => { writeFlag("runday:loadCollapsed", !c); return !c; })}
            />
            <div style={{ display: "grid", gridTemplateRows: loadCollapsed ? "0fr" : "1fr", transition: "grid-template-rows 220ms ease" }}>
              <div className="flex flex-col gap-3 overflow-hidden">

                <Meter
                  label="Load"
                  day={loadDayLabel}
                  done={loadDone}
                  total={loadTotal}
                  segments={[
                    { value: loadDone, className: "bg-st-loaded" },
                    { value: loadReadyCount, className: "bg-st-unloaded" },
                    { value: loadLoading, className: "bg-st-inprogress" },
                    { value: loadNotReady, className: "bg-st-dirty" },
                  ]}
                  legend={[
                    { value: loadDone, label: "loaded", className: "text-blue-300" },
                    { value: loadReadyCount, label: "ready", className: "text-green-400" },
                    { value: loadLoading, label: "loading", className: "text-amber-400" },
                    { value: loadNotReady, label: "not ready", className: "text-red-400" },
                  ]}
                  trailing={loadSpareCount > 0 ? `${loadSpareCount} spare${loadSpareCount === 1 ? "" : "s"}` : undefined}
                />

                {/* OOS routes with nobody covering them yet — shown until coverage
                    is actually recorded for TODAY. Action rows, not a callout. */}
                {needsAssignment.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/[0.06] px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-400">Needs assignment</span>
                      <span className="rounded-pill bg-amber-500/25 px-1.5 text-[10px] font-bold text-amber-200">{needsAssignment.length}</span>
                      <span className="text-[10px] text-ink-muted">OOS with nobody covering the route tonight</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {needsAssignment.map((t) => {
                        const notSelf = (x: TruckWithState) => x.truck_number !== t.truck_number;
                        const pool = new Map<number, string>();
                        for (const x of assignOptions.spares) pool.set(x.truck_number, `#${x.truck_number} — Spare`);
                        for (const x of assignOptions.offToday) pool.set(x.truck_number, `#${x.truck_number} — Off`);
                        for (const x of assignOptions.routes.filter(notSelf)) pool.set(x.truck_number, `#${x.truck_number}`);
                        const recent = getSwapHistory(t.truck_number).filter((n) => pool.has(n));
                        const selectId = `assign-${t.truck_number}`;
                        return (
                          <div key={t.truck_number} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-500/30 bg-surface px-2.5">
                            <span className="font-mono text-[15px] font-semibold text-amber-300">#{t.truck_number}</span>
                            <span className="text-[9px] font-bold text-amber-400">OOS</span>
                            <label htmlFor={selectId} className="sr-only">Assign a truck to route {t.truck_number}</label>
                            <select
                              id={selectId}
                              className="input min-w-0 flex-1 py-1 text-xs"
                              value={assignFor[t.truck_number] ?? ""}
                              disabled={assignSpare.isPending}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAssignFor((p) => ({ ...p, [t.truck_number]: val }));
                                if (val) assignCoverage(t.truck_number, parseInt(val, 10));
                              }}
                            >
                              <option value="">— Assign truck —</option>
                              {recent.length > 0 && (
                                <optgroup label="★ Recently used">
                                  {recent.map((n) => <option key={n} value={n}>{pool.get(n)}</option>)}
                                </optgroup>
                              )}
                              {assignOptions.spares.length > 0 && (
                                <optgroup label="Spare trucks">
                                  {assignOptions.spares.map((x) => (
                                    <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Spare</option>
                                  ))}
                                </optgroup>
                              )}
                              {assignOptions.offToday.length > 0 && (
                                <optgroup label={`Off — Day ${loadDay}`}>
                                  {assignOptions.offToday.map((x) => (
                                    <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Off</option>
                                  ))}
                                </optgroup>
                              )}
                              {assignOptions.routes.filter(notSelf).length > 0 && (
                                <optgroup label="Route trucks">
                                  {assignOptions.routes.filter(notSelf).map((x) => (
                                    <option key={x.truck_number} value={x.truck_number}>#{x.truck_number}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    {assignError && <p className="text-[11px] text-red-300">{assignError}</p>}
                  </div>
                )}

                {/* Today's live coverages — who is covering which route on this load day. */}
                {todayEntries.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeader label="Routes covered" count={todayEntries.length} />
                    <CoverageCards entries={todayEntries} size="sm" truckOf={truckOf} />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <GroupHeader label="Ready to load" count={loadReady.length} />
                  {loadReady.length === 0 ? (
                    <p className="py-2 text-center text-sm text-ink-faint">Nothing ready.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {loadReady.map((c) => (
                        <ReadyCard key={c.key} number={c.number} sub={c.sub} badge={c.badge} notes={c.notes} />
                      ))}
                    </div>
                  )}
                </div>

                {loadLoadingCards.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeader label="Loading" count={loadLoadingCards.length} />
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {loadLoadingCards.map((c) => (
                        <WorkingCard key={c.key} number={c.number} status={c.status} label={c.label} sub={c.sub} badge={c.badge} notes={c.notes} sinceSec={c.sinceSec} emphasis={c.emphasis} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <GroupHeader label="Not ready" count={loadNotReadyCards.length} />
                  {loadNotReadyCards.length === 0 ? (
                    <p className="py-2 text-center text-sm text-ink-faint">Everything is unloaded.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {loadNotReadyCards.map((c) => (
                        <WorkingCard key={c.key} number={c.number} status={c.status} label={c.label} sub={c.sub} badge={c.badge} notes={c.notes} sinceSec={c.sinceSec} emphasis={c.emphasis} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <GroupHeader label="Loaded" count={loadDoneCards.length} extra={collapseDone && loadDoneCards.length > 0 ? "· hidden" : undefined} />
                  {!collapseDone && loadDoneCards.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {loadDoneCards.map((c) => <DoneChip key={c.key} number={c.number} tone="loaded" />)}
                    </div>
                  )}
                </div>

                {loadOff.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <GroupHeader label="Off · OOS" count={loadOff.length} extra={collapseDone ? "· hidden" : undefined} />
                    {!collapseDone && (
                      <div className="flex flex-wrap gap-1.5">
                        {loadOff.map((c) => <OffChip key={c.key} number={c.number} tag={c.chipTag ?? "OFF"} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
