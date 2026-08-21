import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { formatEasternTime } from "../utils/dates";
import { formatDuration, useElapsed } from "../components/LiveInProgress";
import { useAssignBatch, useBoard, useBatchSummary, useCoverageForRole, useHolidayLoad, useHolidayUnload, useLoadDayOverride, usePrevDayCarriers, usePrevDaySplitHelpers, usePrevOperatingDay, useRouteSwapLog, useSettings, useUnloadDayTemplate,
  useUnloadsDayOverride, useUpsertTruckState } from "../api/hooks";
import CoverageCards from "../components/CoverageCards";
import WorkflowDayNotes from "../components/WorkflowDayNotes";
import PreBatchBanner from "../components/PreBatchBanner";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import {
  buildOperationalDayContext,
  buildPrevDayCoverage,
  carrierCountsAsUnloaded,
  countLoaded,
  countUnloadedFromContext,
  getCoverageRouteNumber,
  loadNeedFor,
  resolvePrevRunDate,
  type LoadNeed,
} from "../utils/truckStatus";
import CoverageTag from "../components/CoverageTag";
import OverbatchedChip from "../components/OverbatchedChip";
import { capacityColor, capacityPct } from "../utils/batchCapacity";
import LoadWorkflowCard from "../components/WorkflowCard";
import PageHeader from "../components/PageHeader";
import type { TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import { motion } from "framer-motion";
import { ArrowLeftRight, MapPin } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { truckTypeLabel } from "../utils/truckType";

/**
 * Unload workflow (V1 parity):
 *   dirty → unloaded (single click; the in_progress step is reserved for LOAD).
 *
 * Two layouts, per-device toggle ("unload:style"):
 *   cards (default) — the Load page's look: full-width stat cards, progress
 *     bars, big WorkflowCard truck cards, batch cards. The stat cards are
 *     unload-specific (route / coverage / hold), not the Load page's split by
 *     truck type.
 *   list — the classic compact horizontal rows with inline actions.
 *
 * COVERAGE on this page is always PREVIOUS-day (the route a truck actually
 * carried on the prior load day — i.e. what's being unloaded now), never
 * tonight's assignment. The truck membership/counting logic (allTrucks/dirty/
 * unloaded/toGo/unloadCtx) is unchanged.
 */
export default function Unload() {
  const runDate = todayIso();
  const { unloadsDay: computedUnloadsDay, loadDay: computedLoadDay } = workdayNumbers();
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const { data: loadDayOverride } = useLoadDayOverride(runDate);
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;
  const loadDay = loadDayOverride ?? computedLoadDay;
  const { data: holidayUnload } = useHolidayUnload(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data } = useBoard(runDate);
  const { data: batches } = useBatchSummary(runDate);
  const { data: settings } = useSettings();
  // Previous-day coverage: the loads being unloaded today were covered on the
  // prior run day. Resolve who covered which route from the route-swap log so
  // returning trucks are unloaded as the right route. Shared with Day Overview.
  const { data: prevOp } = usePrevOperatingDay(runDate);
  const prevRunDate = useMemo(() => resolvePrevRunDate(runDate, prevOp), [runDate, prevOp]);
  const { data: prevSwapLog = [] } = useRouteSwapLog(14);
  const prevCoverage = useMemo(() => buildPrevDayCoverage(prevSwapLog, prevRunDate), [prevSwapLog, prevRunDate]);
  // route → the truck that carried it on the previous load day. Defined here (up
  // from the progress-bar block) so the dirty/unloaded memos can sync a covered
  // route's card to its carrier's unload (decision: two synced cards).
  const prevDayCarriers = usePrevDayCarriers(runDate, data ?? []);
  // A covered route's freight rode on its carrier — once the carrier is unloaded
  // the route IS unloaded, so its card flips to done in lock-step with the count
  // (same predicate the count uses). Two-way routes have no carrier (excluded),
  // so they never sync — each unloads itself.
  const carrierDone = (t: TruckWithState): boolean => {
    const c = prevDayCarriers.get(t.truck_number);
    return !!c && c.truck_number !== t.truck_number && carrierCountsAsUnloaded(c);
  };
  // Has this truck's unload already happened? Mirrors the `unloaded` memo
  // below, so tapping a truck that is sitting in the Unloaded-today section
  // never restarts its unload clock. Durable state only, so it reads the same
  // on every device and survives a reload.
  const isUnloadDone = (t: TruckWithState): boolean => {
    const s = t.state?.status;
    return s === "unloaded" || s === "in_progress" || s === "loaded" || carrierDone(t);
  };
  // Previous-day coverage chips, via the shared selector (same normalization as
  // Load/Fleet/Report) — what's being unloaded under coverage today.
  const unloadCoverage = useCoverageForRole("unload", runDate, data ?? []);
  // Route this truck carried on the PREVIOUS load day (what it's unloaded as),
  // or null. This — not today's assignment — is the coverage the unload
  // workflow cares about.
  const prevCoverOf = (t: TruckWithState): number | null => prevCoverage.byCover.get(t.truck_number) ?? null;
  /**
   * The route whose load this truck brought back last night — carriers only.
   *
   * Deliberately from prevDayCarriers, not prevCoverOf: byCover excludes splits
   * but NOT two-way pairs, and in a two-way both trucks physically ran, so both
   * still own their own batch card. Getting that wrong would hide a card that
   * genuinely has to be filled.
   */
  const carriedRouteOf = (t: TruckWithState): number | null => {
    for (const [route, c] of prevDayCarriers) if (c.truck_number === t.truck_number) return route;
    return null;
  };
  // Route whose SPLIT overflow this truck carried on the prev load day. A
  // split truck ran too, so it comes back dirty and needs calling out for the
  // route it helped — but the route ALSO ran itself (byCover excludes splits),
  // so this is a separate signal.
  const prevSplitCoverOf = (t: TruckWithState): number | null => prevCoverage.splitHelpers.get(t.truck_number) ?? null;
  const isSplitHelper = (t: TruckWithState): boolean => prevSplitCoverOf(t) != null;
  // What this truck is unloaded AS: prev-day coverage (route → truck), or a
  // prev-day split it carried (route + truck), or nothing.
  const coverDisplay = (t: TruckWithState): { route: number | null; split: boolean } => {
    const c = prevCoverOf(t);
    if (c != null) return { route: c, split: false };
    const s = prevSplitCoverOf(t);
    if (s != null) return { route: s, split: true };
    return { route: null, split: false };
  };

  const batchingDisabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "batching_disabled")?.value === true,
    [settings],
  );
  // Pre-batch mode: the crew transcribes the paper batch sheet BEFORE the
  // trucks are actually emptied, so /batches/assign deliberately leaves status
  // alone. Batching therefore cannot be what finishes an unload while it's on.
  const prebatchMode = useMemo(
    () => (settings ?? []).find((s) => s.key === "prebatch_mode")?.value === true,
    [settings],
  );
  const wearerCap = useMemo(() => {
    const v = Number((settings ?? []).find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : 1800;
  }, [settings]);
  const upsert = useUpsertTruckState();
  const assign = useAssignBatch();
  const [busy, setBusy] = useState<number | null>(null);
  const [batchNum, setBatchNum] = useState("1");
  const [wearers, setWearers] = useState("0");
  const [batchOpen, setBatchOpen] = useState<number | null>(null);
  const [overflowOpen, setOverflowOpen] = useState<number | null>(null);
  const [unloadedSort, setUnloadedSort] = useState<"number" | "order">("number");
  const [statFilter, setStatFilter] = useState<"routes" | "coverage" | "holds" | "total" | null>(null);
  // Per-device layout preference: "cards" (Load-page look, default) | "list".
  const [style, setStyle] = useState<"cards" | "list">(() => (localStorage.getItem("unload:style") === "list" ? "list" : "cards"));
  const setStylePref = (s: "cards" | "list") => { setStyle(s); localStorage.setItem("unload:style", s); };
  // ?truck=N — where the arrival toast and web push land. Scroll that truck's
  // card into view and ring it briefly, then drop the param so a refresh isn't
  // stuck on it. Same pattern as Board.tsx; gated on the board being loaded so
  // a cold open from a push notification has something to scroll to.
  const [params, setParams] = useSearchParams();
  const focusTruck = (() => {
    const raw = params.get("truck");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  })();
  const [highlightTruck, setHighlightTruck] = useState<number | null>(null);
  useEffect(() => {
    if (focusTruck == null || data == null) return;
    setHighlightTruck(focusTruck);
    const scrollTimer = window.setTimeout(() => {
      document
        .getElementById(`unload-truck-${focusTruck}`)
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
  }, [focusTruck, data == null]);

  // Trucks marked unloaded this session — the card stays in its section (styled
  // done, with undo) until navigation.
  // The truck whose action menu is open (cards style).
  const [menuTruck, setMenuTruck] = useState<TruckWithState | null>(null);

  // Route numbers being covered by some other truck today.
  const coveredRouteNumbers = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      const r = getCoverageRouteNumber(t);
      if (r != null) s.add(r);
    }
    return s;
  }, [data]);
  // Routes taken over per UNLOAD semantics: only a SPARE carrier substitutes on
  // the unload side (a route-truck carrier ran its own route too — both come
  // back dirty). Gates the additive extras below.
  const spareTakenOverRoutes = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      if (t.truck_type === "Spare") {
        const r = getCoverageRouteNumber(t);
        if (r != null) s.add(r);
      }
    }
    return s;
  }, [data]);

  // Core roster = the SAME unload-day context every counting surface uses
  // (sidebar unload bar, Day Overview, Report). The page can therefore never
  // show fewer trucks than the denominator counts; page-specific inclusions
  // are strictly ADDITIVE on top.
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  // Standing wearer counts for this unload day, off the printed sheet.
  const dayTemplate = useUnloadDayTemplate(unloadsDay);
  const unloadCtx = useMemo(
    () => buildOperationalDayContext(data ?? [], unloadsDay, holidayUnload ?? false, false, "unload", prevSplitHelpers),
    [data, unloadsDay, holidayUnload, prevSplitHelpers],
  );

  const allTrucks = useMemo(() => {
    const core = new Set(unloadCtx.activeTrucks.map((t) => t.truck_number));
    return (data ?? []).filter((t) => {
      if (core.has(t.truck_number)) return true;
      // ---- deliberate extras beyond the counted roster (additive only) ----
      // Coverage carriers always appear even when off-schedule.
      if (t.route_swap_route != null || t.state?.oos_spare_route != null) return true;
      // A route taken over by a Spare never shows — the spare stands in.
      if (spareTakenOverRoutes.has(t.truck_number)) return false;
      // A covered OOS truck is represented by its cover.
      if ((t.is_oos || t.state?.status === "oos") && coveredRouteNumbers.has(t.truck_number)) return false;
      // Physical work ALWAYS appears regardless of schedule or type — dirty /
      // unfinished / "Unload and Hold" trucks (incl. dirty Spares and
      // scheduled-off trucks that ran anyway). NOTE: "in_progress" is LOAD
      // work, not unload work — it must not pull a truck in here.
      const s = t.state?.status;
      if (s === "dirty" || s === "unfinished" || t.state?.priority_hold === true) return true;
      return false; // idle Spares and off-schedule clean trucks stay out
    });
  }, [data, unloadCtx, spareTakenOverRoutes, coveredRouteNumbers]);
  // "Needs unloading" = any truck in allTrucks not yet unloaded/loaded/unfinished.
  const dirty = useMemo(
    () =>
      allTrucks.filter((t) => {
        if (carrierDone(t)) return false; // covered route: its carrier's unload IS its unload
        // Batched = done. Assigning a batch is what finishes an unload, so a
        // truck carrying a batch number has no business still sitting in
        // Arrived / Not arrived as outstanding work — it belongs under
        // Unloaded today. The exception is pre-batch mode, where the sheet is
        // deliberately transcribed BEFORE the trucks come back: there a batch
        // number says nothing about whether the truck has been emptied, and
        // dropping those would erase the crew's actual work list.
        if (!prebatchMode && t.state?.batch_id != null) return false;
        const s = t.state?.status;
        return s !== "unloaded" && s !== "loaded" && s !== "unfinished";
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTrucks, prebatchMode, prevDayCarriers],
  );
  /**
   * Trucks the driver has scanned "I'm Back" on (or that a lead tapped Arrived).
   *
   * "Dirty" only ever meant "scheduled to come back" — it says nothing about
   * whether the truck is physically in the yard. Arrival is the first signal
   * that distinguishes the two, so it leads the sort: what is here, oldest
   * arrival first, is the crew's actual work queue.
   */
  const arrivedAt = (t: TruckWithState): number | null => t.state?.arrived_at ?? null;
  const byArrivalThenNumber = (a: TruckWithState, b: TruckWithState) => {
    const aa = arrivedAt(a), ba = arrivedAt(b);
    if (aa != null && ba != null) return aa - ba;   // longest-waiting first
    if (aa != null) return -1;
    if (ba != null) return 1;
    return a.truck_number - b.truck_number;
  };

  // One predicate per unload bucket, shared by the sections below AND the stat
  // cards above, so a truck can never sit in a section but go missing from its
  // count. Coverage on THIS page is previous-day: whoever physically carried
  // someone else's freight on the prior load day is bringing back coverage
  // freight now — plus prev-day SPLIT helpers (they carried a route's overflow,
  // so call them out for that route). Today's covering fields stay in the test
  // for trucks assigned coverage before the unload board is worked.
  const isHoldTruck = (t: TruckWithState) => t.state?.priority_hold === true;
  const isCoverageTruck = useCallback(
    (t: TruckWithState) =>
      t.truck_type === "Spare" ||
      t.route_swap_route != null ||
      t.state?.oos_spare_route != null ||
      // Prev-day carrier. Without this only carriers that happen to be Spares by
      // TYPE landed here, so a route truck that covered another route sat in
      // "Dirty — route" with nothing saying what it actually brought back.
      prevCoverOf(t) != null ||
      isSplitHelper(t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prevCoverage],
  );

  /**
   * The dirty family, split ONE way: is the truck physically back yet.
   *
   * Two lists, deliberately. A coverage split on top (route trucks vs covering
   * trucks) turned this into four buckets and the crew read none of them; a
   * covering truck still wears its CoverageTag inside whichever list it is in,
   * which is all the coverage information the dock needs. Counting is not
   * touched — the stat cards compute their own route/coverage split off
   * stillDirty and never read these.
   *
   * Holds outrank arrival: a held truck stays in Requested (wearing its Back
   * time) rather than moving here. Both ⊆ dirty, so nothing outside the page
   * roster can appear.
   */
  /**
   * The truck the crew is emptying RIGHT NOW. Zero or one by construction —
   * the server clears every other marker when one is set — and it wins over
   * every other bucket so a truck lives in exactly one section. Not a status:
   * the truck is still Dirty underneath, and no counter reads this.
   */
  const unloadingAt = (t: TruckWithState): number | null => t.state?.unloading_started_at ?? null;
  // Only the truck actually on the dock ever shows this, so derive it for that
  // one truck rather than the whole board.
  const loadNeedOf = (t: TruckWithState): LoadNeed | null =>
    t.state?.unloading_started_at == null ? null : loadNeedFor(t, data ?? [], loadDay, holidayLoad);

  const unloading = useMemo(
    () => dirty.filter((t) => unloadingAt(t) != null).sort((a, b) => (unloadingAt(a) ?? 0) - (unloadingAt(b) ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty],
  );
  const back = useMemo(
    () => dirty.filter((t) => !isHoldTruck(t) && arrivedAt(t) != null && unloadingAt(t) == null).sort(byArrivalThenNumber),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty],
  );
  const notBack = useMemo(
    () => dirty.filter((t) => !isHoldTruck(t) && arrivedAt(t) == null && unloadingAt(t) == null).sort((a, b) => a.truck_number - b.truck_number),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty],
  );
  const requested = useMemo(
    () => dirty.filter((t) => isHoldTruck(t) && unloadingAt(t) == null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty],
  );
  const unfinished = useMemo(
    () => allTrucks.filter((t) => t.state?.status === "unfinished"),
    [allTrucks],
  );
  // Unloaded today = every truck that went dirty → unloaded this shift, i.e.
  // status "unloaded" AND anything further along that lifecycle ("in_progress"
  // /"loaded"). Excludes day-init seeds (auto/no unloaded_at) — nobody unloaded
  // those today.
  const unloaded = useMemo(
    () =>
      allTrucks.filter((t) => {
        if (carrierDone(t)) return true; // covered route: shown Unloaded once its carrier is
        // The mirror of the `dirty` rule above: batched is done, so it lands
        // here even if the status write is still in flight.
        if (!prebatchMode && t.state?.batch_id != null) return true;
        const s = t.state?.status;
        if (!(s === "unloaded" || s === "in_progress" || s === "loaded")) return false;
        if (s === "unloaded" && t.state?.state_source === "auto" && t.state?.unloaded_at == null) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTrucks, prebatchMode, prevDayCarriers],
  );
  const unloadedSorted = useMemo(() => {
    const arr = [...unloaded];
    if (unloadedSort === "order") {
      const toEpoch = (t: TruckWithState): number => {
        if (t.state?.unloaded_at != null) return t.state.unloaded_at;
        const ua = t.state?.updated_at;
        return ua ? new Date(ua).getTime() / 1000 : Number.POSITIVE_INFINITY;
      };
      arr.sort((a, b) => {
        const diff = toEpoch(a) - toEpoch(b);
        if (diff !== 0) return diff;
        return a.truck_number - b.truck_number;
      });
    } else {
      arr.sort((a, b) => a.truck_number - b.truck_number);
    }
    return arr;
  }, [unloaded, unloadedSort]);

  // ── Stat cards — the unload work still outstanding, bucketed the way THIS
  // page is organised (route / coverage / hold), not by truck type the way the
  // Load page splits it. Each card is the count of the section with the same
  // accent colour below, so tapping one drills into exactly that list.
  const stillDirty = useMemo(
    () => dirty,
    [dirty],
  );
  const routesLeftTrucks = useMemo(
    () => stillDirty.filter((t) => !isCoverageTruck(t) && !isHoldTruck(t)),
    [stillDirty, isCoverageTruck],
  );
  const coverageLeftTrucks = useMemo(
    () => stillDirty.filter((t) => isCoverageTruck(t) && !isHoldTruck(t)),
    [stillDirty, isCoverageTruck],
  );
  const holdsLeftTrucks = useMemo(() => stillDirty.filter(isHoldTruck), [stillDirty]);
  const routesLeft = routesLeftTrucks.length;
  const coverageLeft = coverageLeftTrucks.length;
  const holdsLeft = holdsLeftTrucks.length;
  // Unfinished trucks are outstanding unload work too — `dirty` deliberately
  // excludes them (they get their own section), so add them back here or the
  // total under-reports what's left to do.
  const totalLeft = routesLeft + coverageLeft + holdsLeft + unfinished.length;
  const totalLeftTrucks = useMemo(
    () => [...stillDirty, ...unfinished].sort((a, b) => a.truck_number - b.truck_number),
    [stillDirty, unfinished],
  );

  // ── Progress bars — schedule-based, matching the sidebar/Report/Day Overview
  const unloadTotal = unloadCtx.activeTrucks.length;
  const unloadDone = useMemo(() => countUnloadedFromContext(unloadCtx, prevDayCarriers), [unloadCtx, prevDayCarriers]);
  const unloadPct = unloadTotal > 0 ? Math.round((unloadDone / unloadTotal) * 100) : 0;
  const loadContext = useMemo(() => buildOperationalDayContext(data ?? [], loadDay, holidayLoad, false), [data, loadDay, holidayLoad]);
  const loadTotal = loadContext.activeTrucks.length;
  const loadDone = useMemo(() => countLoaded(data ?? [], loadDay, holidayLoad, unloadsDay, holidayUnload ?? false), [data, loadDay, unloadsDay, holidayLoad, holidayUnload]);
  const loadPct = loadTotal > 0 ? Math.round((loadDone / loadTotal) * 100) : 0;

  const toGo = Math.max(0, unloadTotal - unloadDone);

  /**
   * Assign the batch AND finish the unload — batching IS how a truck is marked
   * unloaded now, so the crew touches each truck once.
   *
   * `batchTruck` is where the CARD goes (the original route number for a
   * carrier — one card per load) while `physical` is the truck actually on the
   * dock, which is the one whose status moves. They are the same truck for
   * everything except coverage.
   *
   * The status write is deliberately here and not in the assign endpoint: the
   * pre-batch planning surfaces (wizard, Batches page) assign batches too and
   * must never touch status — the crew fills that paper in early and changes
   * it later.
   */
  async function assignBatch(batchTruck: number, physical?: TruckWithState) {
    await assign.mutateAsync({ run_date: runDate, batch_number: Number(batchNum), truck_number: batchTruck, wearers: Number(wearers || 0) });
    setBatchOpen(null);
    // NOT followed by a status write. /batches/assign already turns a dirty
    // truck unloaded and clears the unloading marker in the same transaction;
    // writing it again from here raced that commit and 409'd on the
    // expected_status precondition, leaving the truck dirty and un-batched.
    if (physical && prebatchMode && !isUnloadDone(physical)) {
      await markUnloaded(physical);
    }
  }

  /**
   * Tapping a truck IS starting its unload. Fire-and-forget: the tap must open
   * the truck instantly, and a truck that can't be started (already done, or
   * unloaded by its carrier) just opens.
   *
   * Idempotent by way of the server's first-tap-wins rule, so re-opening a
   * truck mid-job never restarts its clock.
   */
  function beginUnloading(t: TruckWithState) {
    if (isUnloadDone(t)) return;
    if (unloadingAt(t) != null) return;
    upsert.mutate({ truck_number: t.truck_number, run_date: runDate, unloading_started_at: Date.now() / 1000 });
  }

  async function cancelUnloading(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    try {
      await upsert.mutateAsync({ truck_number: t.truck_number, run_date: runDate, unloading_started_at: null });
    } finally {
      setBusy(null);
    }
  }

  async function markUnfinished(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    try {
      await upsert.mutateAsync({ truck_number: t.truck_number, run_date: runDate, status: "unfinished", wearers: t.state?.wearers ?? 0 });
    } finally {
      setBusy(null);
    }
  }

  async function markUnloaded(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    try {
      await upsert.mutateAsync({ truck_number: t.truck_number, run_date: runDate, status: "unloaded", wearers: t.state?.wearers ?? 0 });
    } finally {
      setBusy(null);
    }
  }

  async function undoUnload(truckNumber: number) {
    setBusy(truckNumber);
    try {
      await upsert.mutateAsync({ truck_number: truckNumber, run_date: runDate, status: "dirty" });
    } finally {
      setBusy(null);
    }
  }

  /**
   * The wearers to open the batch panel with. Same resolution the wizard and
   * the Batches page use, so batching a truck here fills in the standing number
   * off the day sheet instead of starting at 0 and asking the crew to remember
   * it. Order matters:
   *   1. a split helper contributes 0 — its load is part of a route counted in
   *      full on that route's own card (the server enforces this on assign too);
   *   2. a number already on the truck wins — someone set it deliberately;
   *   3. otherwise the sheet, resolved THROUGH coverage: a carrier is unloading
   *      the covered route's freight, so it takes that route's line, not its own.
   */
  function defaultWearersFor(t: TruckWithState): number {
    if (isSplitHelper(t)) return 0;
    const live = t.state?.wearers ?? 0;
    if (live > 0) return live;
    return dayTemplate.wearers[prevCoverOf(t) ?? t.truck_number] ?? 0;
  }

  function openTruckMenu(t: TruckWithState) {
    setBatchNum(String(t.state?.batch_id ?? 1));
    setWearers(String(defaultWearersFor(t)));
    beginUnloading(t);
    setMenuTruck(t);
  }
  function toggleBatch(t: TruckWithState) {
    const isOpen = batchOpen === t.truck_number;
    setBatchOpen(isOpen ? null : t.truck_number);
    setBatchNum(String(t.state?.batch_id ?? 1));
    setWearers(String(defaultWearersFor(t)));
    setOverflowOpen(null);
  }
  function toggleOverflow(truckNumber: number) {
    setOverflowOpen(overflowOpen === truckNumber ? null : truckNumber);
    setBatchOpen(null);
  }

  const GRID = "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]";

  // The dirty-family sections, shared by both layouts.
  const dirtySections = [
    // "Now unloading" — the one truck being emptied. Amber, the same tokens the
    // Load page's "Loading" and the Requested section use: the app's colour for
    // work in flight. Not green (that means done) and not orange (misreads
    // against amber on a wall display).
    { key: "unloading", title: "Unloading now", titleClass: "text-st-inprogress", trucks: unloading, accent: "text-amber-300", label: "Unloading", labelClass: "bg-amber-500 text-black", rowAccent: "border-l-st-inprogress", overflow: "dirty" as const },
    { key: "requested", title: "Requested — priority hold", titleClass: "text-st-inprogress", trucks: requested, accent: "text-amber-300", label: "HOLD", labelClass: "bg-amber-500 text-black", rowAccent: "border-l-st-inprogress", overflow: "dirty" as const },
    // Back = physically in the yard (driver tapped "I'm Back" / lead tapped
    // Arrived), oldest arrival first — what can be worked NOW.
    // Deliberately the SAME red as Not arrived. An arrived truck is still Dirty —
    // arrival is a fact about a dirty truck, not a fourth state — and green is
    // what "unloaded" means everywhere else in the app. The distinguishing mark
    // is the pin, not the hue.
    { key: "back", title: "Arrived", titleClass: "text-st-dirty", trucks: back, accent: "text-red-300", label: "Dirty", labelClass: "bg-[#b91c1c] text-white", rowAccent: "border-l-st-dirty", overflow: "dirty" as const },
    { key: "unfinished", title: "Unfinished", titleClass: "text-st-unfinished", trucks: unfinished, accent: "text-st-unfinished", label: "Unfinished", labelClass: "bg-[#b45309] text-white", rowAccent: "border-l-st-unfinished", overflow: "unfinished" as const },
    // Not arrived = still on the road. Coverage and route trucks together; the
    // CoverageTag on the card says which is which.
    { key: "notback", title: "Not arrived", titleClass: "text-st-dirty", trucks: notBack, accent: "text-red-300", label: "Dirty", labelClass: "bg-[#b91c1c] text-white", rowAccent: "border-l-st-dirty", overflow: "dirty" as const },
  ];

  /** Cards style: a tappable dirty-family truck card (opens the action menu). */
  function DirtyCard({ t, index, accent, label, labelClass }: { t: TruckWithState; index: number; accent: string; label: string; labelClass: string }) {
    const cd = coverDisplay(t);
    return (
      <AnimateCard key={t.truck_number} id={`unload-truck-${t.truck_number}`} delay={index * 0.03} hoverScale={1.02} className={clsx("h-full", highlightTruck === t.truck_number && "ring-2 ring-white/70 animate-pulse rounded-2xl")}>
        <button type="button" onClick={() => openTruckMenu(t)} className="h-full w-full text-left transition-all duration-150 active:scale-[0.98]">
          <LoadWorkflowCard
            truck={t}
            accent={accent}
            statusLabel={label}
            statusClassName={labelClass}
            coverageRoute={cd.route}
            coverageSplit={cd.split}
            footer={
              unloadingAt(t) != null ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <UnloadingSince startSec={unloadingAt(t)!} />
                  <LoadRequestBadge t={t} need={loadNeedOf(t)} />
                </span>
              ) : arrivedAt(t) != null ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                  <MapPin className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                  Arrived {formatEasternTime(arrivedAt(t)!)}
                </span>
              ) : t.state?.wearers ? (
                <span className="text-xs text-ink-muted">{t.state.wearers} wearers</span>
              ) : null
            }
            interactive
            ringClassName="hover:ring-st-dirty"
          />
        </button>
      </AnimateCard>
    );
  }

  /**
 * The load crew's advisory answer on the truck being unloaded.
 *
 * Cyan, both ways: red means dirty, green means unloaded, and amber is already
 * the whole unloading section — a badge inside an amber card in amber would
 * vanish. Cyan is what the app uses when the OTHER crew is saying something
 * (see the driver-claim card on the Fleet sheet). The words carry the polarity,
 * not the hue.
 */
function LoadRequestBadge({ t, need }: { t: TruckWithState; need: LoadNeed | null }) {
  const req = t.state?.load_request ?? null;
  // Never render on a truck the dock isn't actually on — the same staleness
  // guard every other reader of the marker applies.
  if (t.state?.unloading_started_at == null) return null;
  if (t.state.status !== "dirty" && t.state.status !== "unfinished") return null;

  // A person's decision outranks the schedule's, and reads louder: solid cyan
  // and the word LOAD, because someone actually looked at this truck.
  if (req != null) {
    return (
      <span className="badge shrink-0 bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/40">
        {req === "want" ? "LOAD: PULL FORWARD" : "LOAD: BACK OUT"}
      </span>
    );
  }
  // Nobody has spoken — state what the schedule says, in the dock's own terms
  // ("does tomorrow need this?") and quietly, so it can't be mistaken for
  // someone having checked.
  if (need == null) return null;
  return (
    <span
      className={clsx(
        "badge shrink-0 ring-1",
        need.needed
          ? "bg-cyan-500/10 text-cyan-300/80 ring-cyan-500/25"
          : "bg-slate-600/20 text-slate-300 ring-slate-500/30",
      )}
      title={need.reason}
    >
      {need.needed ? "LOADS TOMORROW" : "NOT LOADING TOMORROW"}
    </span>
  );
}

/** List style: a compact horizontal dirty-family row with inline actions. */
  function renderRow(t: TruckWithState, index: number, opts: { accentClass?: string; overflow: "dirty" | "unfinished" }) {
    const isBusy = busy === t.truck_number;
    const isBatchOpen = batchOpen === t.truck_number;
    const isOverflowOpen = overflowOpen === t.truck_number;
    const cd = coverDisplay(t); // prev-day coverage / split — what it's unloaded as
    const detailParts: string[] = [];
    if (t.truck_type === "Spare") detailParts.push("Spare");
    if (t.state?.batch_id != null) detailParts.push(`Batch ${t.state.batch_id}`);
    const detail = detailParts.join("  ·  ");
    return (
      <AnimateCard key={t.truck_number} id={`unload-truck-${t.truck_number}`} delay={index * 0.03} className={clsx("card flex flex-col !p-0", opts.accentClass, highlightTruck === t.truck_number && "ring-2 ring-white/70 animate-pulse")}>
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Tapping the row IS starting the unload, and it opens the batch
              entry that finishes it — one truck, one touch. */}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => { beginUnloading(t); toggleBatch(t); }}
          >
            <span className="font-mono text-[22px] font-black leading-none text-ink">#{t.truck_number}</span>
            {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{detail}</span>
            {/* List style previously showed no arrival at all — the sort moved
                trucks up but nothing said why. */}
            {unloadingAt(t) != null ? (
              <UnloadingSince startSec={unloadingAt(t)!} />
            ) : arrivedAt(t) != null ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink">
                <MapPin className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                Arrived {formatEasternTime(arrivedAt(t)!)}
              </span>
            ) : null}
            {t.state?.needs_checked && <span className="badge shrink-0 bg-st-inprogress text-black">Needs check</span>}
            <LoadRequestBadge t={t} need={loadNeedOf(t)} />
          </button>
          <div className="relative flex shrink-0 items-center gap-1.5">
              {isBusy && <span className="text-xs text-ink-muted">…</span>}
              <button className="flex h-9 w-8 items-center justify-center rounded-md border border-hairline bg-surface-2 text-lg leading-none text-ink-muted transition-colors hover:text-ink" onClick={() => toggleOverflow(t.truck_number)} title="More actions" aria-label="More actions">···</button>
              {isOverflowOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-hairline bg-surface-3 py-1 shadow-card">
                  {opts.overflow === "unfinished" ? (
                    <button className="w-full px-3 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2" disabled={isBusy} onClick={() => { setOverflowOpen(null); upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "dirty" }); }}>Back to dirty</button>
                  ) : (
                    <>
                      {unloadingAt(t) != null && (
                        <button className="w-full px-3 py-2 text-left text-sm font-medium text-amber-300 transition-colors hover:bg-surface-2" disabled={isBusy} onClick={() => void cancelUnloading(t)}>Not unloading — cancel</button>
                      )}
                      <button className="w-full px-3 py-2 text-left text-sm font-medium text-st-unfinished transition-colors hover:bg-surface-2" disabled={isBusy} onClick={() => markUnfinished(t)}>Mark unfinished</button>
                      {/* Batching normally finishes the unload; when it
                          can't (disabled, or pre-batch mode) there has to be
                          some way to say done. */}
                      {(batchingDisabled || prebatchMode) && (
                        <button className="w-full px-3 py-2 text-left text-sm font-medium text-st-unloaded transition-colors hover:bg-surface-2" disabled={isBusy} onClick={() => markUnloaded(t)}>Mark unloaded</button>
                      )}
                    </>
                  )}
                </div>
              )}
          </div>
        </div>
        {!batchingDisabled && isBatchOpen && (
          <div className="space-y-2 rounded-b-xl border-t border-hairline bg-surface-2 p-3">
            <div className="grid grid-cols-6 gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} type="button" onClick={() => setBatchNum(String(n))} className={batchNum === String(n) ? "rounded-md bg-st-unloaded py-2 text-center text-base font-bold text-black ring-2 ring-st-unloaded/60" : "rounded-md bg-surface-3 py-2 text-center text-base font-bold text-ink-soft hover:bg-track"}>{n}</button>
              ))}
            </div>
            <input type="number" min={0} className="input" placeholder="Wearers" value={wearers} onChange={(e) => setWearers(e.target.value)} />
            <button className="btn-primary w-full" disabled={assign.isPending || isBusy} onClick={() => void assignBatch(carriedRouteOf(t) ?? t.truck_number, t)}>{assign.isPending || isBusy ? "Saving…" : carriedRouteOf(t) != null ? `Assign as route #${carriedRouteOf(t)} — done` : "Assign — done unloading"}</button>
          </div>
        )}
      </AnimateCard>
    );
  }

  const styleToggle = (
    <div className="inline-flex overflow-hidden rounded-md border border-hairline text-[11px] font-semibold">
      <button type="button" onClick={() => setStylePref("cards")} className={clsx("px-2.5 py-1 transition-colors", style === "cards" ? "bg-accent text-white" : "bg-surface-2 text-ink-muted hover:bg-surface")}>Cards</button>
      <button type="button" onClick={() => setStylePref("list")} className={clsx("border-l border-hairline px-2.5 py-1 transition-colors", style === "list" ? "bg-accent text-white" : "bg-surface-2 text-ink-muted hover:bg-surface")}>List</button>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Unload"
        subtitle={`Day ${unloadsDay} — mark returning trucks unloaded and assign batches.`}
        actions={
          <div className="flex items-center gap-2">
            {styleToggle}
            <span className="badge bg-st-dirty text-white">{toGo} to go</span>
          </div>
        }
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-5 p-3 md:p-6">

        {/* Previous load-day coverage */}
        <PreBatchBanner />
        <WorkflowDayNotes scope="unload" day={unloadsDay} />

        {prevCoverage.items.length > 0 && (
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">Previous load-day coverage</span>
              {prevCoverage.date && (
                <span className="text-[10px] text-amber-500/70">({format(new Date(`${prevCoverage.date}T12:00:00`), "EEE MMM d")})</span>
              )}
            </div>
            <div className="mt-2">
              <CoverageCards entries={unloadCoverage} showPrevBadge={false} />
            </div>
          </div>
        )}

        {/* Stats grid — outstanding unload work, by the page's own buckets */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Routes Left" value={routesLeft} accent="#ef4444" active={statFilter === "routes"} onClick={() => setStatFilter(statFilter === "routes" ? null : "routes")} />
          <StatCard label="Coverage Left" value={coverageLeft} accent="#06b6d4" active={statFilter === "coverage"} onClick={() => setStatFilter(statFilter === "coverage" ? null : "coverage")} />
          <StatCard label="Holds" value={holdsLeft} accent="#f59e0b" active={statFilter === "holds"} onClick={() => setStatFilter(statFilter === "holds" ? null : "holds")} />
          <StatCard label="Total Left" value={totalLeft} accent="#dbe3ee" active={statFilter === "total"} onClick={() => setStatFilter(statFilter === "total" ? null : "total")} />
        </div>

        {/* Stat drill-down */}
        {statFilter && (() => {
          const trucks =
            statFilter === "routes" ? routesLeftTrucks
            : statFilter === "coverage" ? coverageLeftTrucks
            : statFilter === "holds" ? holdsLeftTrucks
            : totalLeftTrucks;
          const heading =
            statFilter === "routes" ? "Route trucks"
            : statFilter === "coverage" ? "Coverage"
            : statFilter === "holds" ? "Priority holds"
            : "All";
          return (
            <div className="card animate-slide-down space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {heading} still to unload ({trucks.length})
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {trucks.map((t) => {
                  const cd = coverDisplay(t);
                  const isUnfinished = t.state?.status === "unfinished";
                  return (
                    <span key={t.truck_number} className="flex min-h-[3.35rem] items-start justify-between rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5">
                      <span className="pt-0.5 text-lg font-extrabold tracking-tight tabular-nums text-ink">#{t.truck_number}</span>
                      <span className="flex flex-col items-end gap-1">
                        {isUnfinished ? (
                          <span className="rounded-full bg-fuchsia-950/60 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-fuchsia-300 ring-1 ring-fuchsia-900/80">Unfinished</span>
                        ) : (
                          <span className="rounded-full bg-red-950/60 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-300 ring-1 ring-red-900/80">Dirty</span>
                        )}
                        {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} />}
                        {t.state?.priority_hold && (
                          <span className="inline-flex items-center rounded-pill bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-300 ring-1 ring-amber-900/80">Hold</span>
                        )}
                      </span>
                    </span>
                  );
                })}
                {trucks.length === 0 && <span className="col-span-full text-sm text-ink-faint">All clear!</span>}
              </div>
            </div>
          );
        })()}

        {/* Load / Unload progress */}
        <div className="card space-y-2">
          <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
          <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
        </div>

        {/* Dirty-family sections */}
        {dirtySections.map((sec) => sec.trucks.length > 0 && (
          <section key={sec.key}>
            <h3 className={clsx("mb-2 text-sm font-semibold uppercase tracking-wide", sec.titleClass)}>{sec.title} ({sec.trucks.length})</h3>
            {style === "list" ? (
              <div className="flex flex-col gap-2">
                {sec.trucks.map((t, i) => renderRow(t, i, { accentClass: `border-l-[3px] ${sec.rowAccent}`, overflow: sec.overflow }))}
              </div>
            ) : (
              <div className={GRID}>
                {sec.trucks.map((t, i) => <DirtyCard key={t.truck_number} t={t} index={i} accent={sec.accent} label={sec.label} labelClass={sec.labelClass} />)}
              </div>
            )}
          </section>
        ))}

        {dirty.length === 0 && unfinished.length === 0 && (
          <p className="rounded-xl border border-dashed border-hairline bg-surface/50 p-6 text-center text-sm text-ink-muted">
            Everything's unloaded. Nice work.
          </p>
        )}

        {/* Unloaded today */}
        {unloaded.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-st-unloaded">Unloaded today ({unloaded.length})</h3>
              <div className="inline-flex overflow-hidden rounded-md border border-hairline text-[11px] font-semibold">
                <button type="button" onClick={() => setUnloadedSort("number")} className={clsx("px-2 py-1 transition-colors", unloadedSort === "number" ? "bg-st-unloaded text-[#052e16]" : "bg-surface-2 text-ink-muted hover:bg-surface")}># Number</button>
                <button type="button" onClick={() => setUnloadedSort("order")} className={clsx("border-l border-hairline px-2 py-1 transition-colors", unloadedSort === "order" ? "bg-st-unloaded text-[#052e16]" : "bg-surface-2 text-ink-muted hover:bg-surface")}>Unload order</button>
              </div>
            </div>
            {style === "list" ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {unloadedSorted.map((t, index) => {
                  const time = t.state?.unloaded_at != null ? format(new Date(t.state.unloaded_at * 1000), "h:mm a") : "—";
                  const cd = coverDisplay(t);
                  return (
                    <AnimateCard key={t.truck_number} id={`unload-truck-${t.truck_number}`} delay={index * 0.02} className={clsx("h-full", highlightTruck === t.truck_number && "ring-2 ring-white/70 animate-pulse rounded-[10px]")}>
                      <button type="button" onClick={() => openTruckMenu(t)} className="flex h-full min-h-[6rem] w-full flex-col items-center justify-center rounded-[10px] border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.06)] px-1.5 py-2.5 text-center transition-shadow hover:ring-2 hover:ring-st-unloaded">
                        <span className="font-mono text-[17px] font-extrabold leading-none text-ink">#{t.truck_number}</span>
                        {cd.route != null && <span className="mt-1 flex justify-center"><CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} /></span>}
                        <span className="mt-1 font-mono text-[10px] text-ink-muted">{unloadedSort === "order" ? `#${index + 1} · ${time}` : time}</span>
                      </button>
                    </AnimateCard>
                  );
                })}
              </div>
            ) : (
              <div className={GRID}>
                {unloadedSorted.map((t, idx) => {
                  const time = t.state?.unloaded_at != null ? format(new Date(t.state.unloaded_at * 1000), "h:mm a") : "—";
                  return (
                    <AnimateCard key={t.truck_number} id={`unload-truck-${t.truck_number}`} delay={idx * 0.02} className={clsx("h-full", highlightTruck === t.truck_number && "ring-2 ring-white/70 animate-pulse rounded-2xl")}>
                      <div className="relative h-full">
                        {unloadedSort === "order" && (
                          <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-surface-2 px-1 text-[10px] font-bold text-st-unloaded ring-1 ring-st-unloaded/60">{idx + 1}</span>
                        )}
                        <button type="button" onClick={() => openTruckMenu(t)} className="h-full w-full text-left transition-all duration-150 active:scale-[0.98]">
                          <LoadWorkflowCard truck={t} accent="text-st-unloaded" statusLabel="Unloaded" statusClassName="bg-st-unloaded text-[#052e16]" coverageRoute={coverDisplay(t).route} coverageSplit={coverDisplay(t).split} footer={<span className="text-xs text-ink-muted">{time}</span>} interactive ringClassName="hover:ring-st-unloaded" />
                        </button>
                      </div>
                    </AnimateCard>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Batches */}
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Batches</h3>
          {/* Three per row so the six batches read 1-2-3 over 4-5-6, like the
              paper batch sheet and the report. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(batches ?? Array.from({ length: 6 }, (_, i) => ({ batch_number: i + 1, trucks: [], total_wearers: 0 }))).map((b, index) => {
              const { bar, text } = capacityColor(b.total_wearers, false, wearerCap);
              const pct = capacityPct(b.total_wearers, wearerCap);
              return (
                <AnimateCard key={b.batch_number} delay={index * 0.03} className="card space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-ink">
                      Batch {b.batch_number}
                      <OverbatchedChip show={b.total_wearers > wearerCap} />
                    </span>
                    <span className={clsx("shrink-0 font-mono text-xs font-semibold tabular-nums", text)}>
                      {b.total_wearers.toLocaleString()} / {wearerCap.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full border border-hairline bg-surface-3">
                    <div className={clsx("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex min-h-[1.5rem] flex-wrap gap-1">
                    {b.trucks.length === 0 ? (
                      <span className="text-xs text-ink-muted">No trucks</span>
                    ) : (
                      b.trucks.map((t) => (
                        <span
                          key={t.truck_number}
                          className="badge bg-track font-mono text-base font-black tabular-nums text-ink"
                        >
                          #{t.truck_number}
                        </span>
                      ))
                    )}
                  </div>
                </AnimateCard>
              );
            })}
          </div>
        </section>

        {/* Truck action menu (cards style + unloaded-today taps) */}
        {menuTruck && (() => {
          const t = allTrucks.find((x) => x.truck_number === menuTruck.truck_number) ?? menuTruck;
          const isUnfin = t.state?.status === "unfinished";
          const cd = coverDisplay(t);
          const isBusy = busy === t.truck_number;
          const close = () => setMenuTruck(null);
          // This truck's unload is finished — from durable state, not just this
          // tab's memory of doing it. Undo is only offered where it means
          // something: a truck sitting at "unloaded". A covered route was
          // unloaded BY its carrier (nothing of its own to reverse), and one
          // already loading or loaded is past the unload stage entirely.
          const st = t.state?.status;
          const done = isUnloadDone(t);
          const carrierOnly = carrierDone(t) && st !== "unloaded";
          const carrierNum = prevDayCarriers.get(t.truck_number)?.truck_number ?? null;
          const canUndo = st === "unloaded" && !carrierOnly;
          return createPortal(
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={close}>
              <div className="max-h-[90svh] w-full max-w-sm space-y-4 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Truck #{t.truck_number}</h3>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                      {truckTypeLabel(t.truck_type)}
                      {isUnfin ? " · Unfinished" : ""}
                      {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} />}
                    </p>
                    {/* Start Unloading keeps this window open — the tablet sits
                        on the truck for the whole job — so the clock lives here
                        too, and Mark Unloaded is one tap away when it's done. */}
                    {unloadingAt(t) != null && (
                      <p className="mt-1.5">
                        <UnloadingSince startSec={unloadingAt(t)!} />
                      </p>
                    )}
                  </div>
                  <button className="btn-ghost" onClick={close}>Close</button>
                </div>

                {done ? (
                  <>
                    {canUndo ? (
                      <button className="w-full rounded-lg border border-slate-600 bg-slate-800 py-3.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50" disabled={isBusy} onClick={async () => { await undoUnload(t.truck_number); close(); }}>
                        {isBusy ? "…" : "Undo — back to Dirty"}
                      </button>
                    ) : (
                      <p className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-3 text-sm leading-snug text-slate-300">
                        {carrierOnly
                          ? carrierNum != null
                            ? `Unloaded on truck #${carrierNum}, which carried this route. Undo it there.`
                            : "Unloaded by the truck that carried this route."
                          : st === "loaded"
                            ? "Already loaded for tonight — past the unload stage."
                            : "Loading has started — past the unload stage."}
                      </p>
                    )}

                    {/* Batching stays available: wearers and batch numbers are
                        normally entered right after a truck is unloaded. One
                        returned load gets ONE card, under the original route
                        number — so a carrier shows where its card lives instead
                        of offering a second one. */}
                    {!batchingDisabled && (
                      <section>
                        <p className="label">
                          {carriedRouteOf(t) != null ? `Batch — as route #${carriedRouteOf(t)}` : "Batch"}
                        </p>
                        <div className="grid grid-cols-6 gap-1.5">
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <button key={n} type="button" onClick={() => setBatchNum(String(n))} className={batchNum === String(n) ? "rounded-md bg-emerald-600 py-2 text-center text-base font-bold text-white ring-2 ring-emerald-400" : "rounded-md bg-slate-700 py-2 text-center text-base font-bold text-slate-300 hover:bg-slate-600"}>{n}</button>
                          ))}
                        </div>
                        <input type="number" min={0} className="input mt-2" placeholder="Wearers" value={wearers} onChange={(e) => setWearers(e.target.value)} />
                        <button className="btn-primary mt-2 w-full font-semibold" disabled={assign.isPending} onClick={async () => { await assignBatch(carriedRouteOf(t) ?? t.truck_number, t); close(); }}>
                          {assign.isPending ? "Saving…" : t.state?.batch_id != null ? `Assign (current: Batch ${t.state.batch_id})` : "Assign Batch"}
                        </button>
                      </section>
                    )}
                  </>
                ) : (
                  <>
                    {/* Opening this truck already started its unload — the Load
                        board is watching the marker. Assigning the batch below
                        is what finishes it, so there is no separate "Start" or
                        "Mark Unloaded" left to forget. */}
                    <p className="rounded-lg border border-amber-600/40 bg-amber-950/25 px-3 py-2.5 text-xs leading-snug text-amber-200">
                      {unloadingAt(t) != null
                        ? "Unloading now — assign the batch below when it's empty and that marks it unloaded."
                        : "Assign the batch below when it's empty — that marks it unloaded."}
                    </p>

                    {/* What Load said about this truck. Advisory: it sits above
                        "Not unloading — cancel" because that's the action a
                        "back out" suggests, but nothing here presses it. The
                        unloader still decides. */}
                    {unloadingAt(t) != null && t.state?.load_request != null && (
                      <p className="rounded-lg border border-cyan-600/40 bg-cyan-950/30 px-3 py-2.5 text-sm font-semibold leading-snug text-cyan-200">
                        {t.state.load_request === "want"
                          ? "Load wants this one — pull it forward."
                          : "Load asked to back out of this one."}
                        {t.state.load_request_at != null && (
                          <span className="ml-1 font-normal text-cyan-300/70">
                            · {formatEasternTime(t.state.load_request_at)}
                          </span>
                        )}
                      </p>
                    )}
                    {/* Nobody from Load has looked at this one yet, so say what
                        the schedule says — quieter, and worded as a fact about
                        tomorrow rather than as a request from a person. */}
                    {unloadingAt(t) != null && t.state?.load_request == null && (() => {
                      const need = loadNeedOf(t);
                      if (need == null) return null;
                      return (
                        <p className={clsx(
                          "rounded-lg border px-3 py-2.5 text-xs leading-snug",
                          need.needed
                            ? "border-cyan-700/30 bg-cyan-950/20 text-cyan-300/90"
                            : "border-slate-600/40 bg-slate-800/40 text-slate-300",
                        )}>
                          <span className="font-semibold">
                            {need.needed ? "Loads tomorrow" : "Not loading tomorrow"}
                          </span>{" "}
                          — {need.reason}.
                        </p>
                      );
                    })()}

                    {/* Batching is what completes a truck now, so when it
                        can't be (switched off entirely, or pre-batch mode where
                        assigning deliberately leaves status alone) there has to
                        be another way to say done. */}
                    {(batchingDisabled || prebatchMode) && (
                      <button className="w-full rounded-lg bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-50" disabled={isBusy} onClick={async () => { await markUnloaded(t); close(); }}>
                        {isBusy ? "…" : "Mark Unloaded"}
                      </button>
                    )}

                    {unloadingAt(t) != null && (
                      <button className="w-full rounded-lg border border-amber-600/50 bg-amber-950/30 py-2.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-900/40 disabled:opacity-50" disabled={isBusy} onClick={() => void cancelUnloading(t)}>
                        Not unloading — cancel
                      </button>
                    )}

                    {/* The escape hatch: a truck that cannot be finished
                        tonight leaves the flow here instead of via batching. */}
                    {isUnfin ? (
                      <button className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700" onClick={() => { upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "dirty" }); close(); }}>
                        Back to Dirty
                      </button>
                    ) : (
                      <button className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2.5 text-sm font-medium text-st-unfinished transition-colors hover:bg-slate-700 disabled:opacity-50" disabled={isBusy} onClick={async () => { await markUnfinished(t); close(); }}>
                        Mark Unfinished
                      </button>
                    )}

                    {/* One returned load, one card, under the original route
                        — but the card still has to be fillable from the truck
                        that physically brought it back, because that is the
                        truck on the dock and the one whose status moves. */}
                    {!batchingDisabled && (
                      <section>
                        <p className="label">
                          {carriedRouteOf(t) != null ? `Batch — as route #${carriedRouteOf(t)}` : "Batch"}
                        </p>
                        <div className="grid grid-cols-6 gap-1.5">
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <button key={n} type="button" onClick={() => setBatchNum(String(n))} className={batchNum === String(n) ? "rounded-md bg-emerald-600 py-2 text-center text-base font-bold text-white ring-2 ring-emerald-400" : "rounded-md bg-slate-700 py-2 text-center text-base font-bold text-slate-300 hover:bg-slate-600"}>{n}</button>
                          ))}
                        </div>
                        <input type="number" min={0} className="input mt-2" placeholder="Wearers" value={wearers} onChange={(e) => setWearers(e.target.value)} />
                        <button className="btn-primary mt-2 w-full font-semibold" disabled={assign.isPending || isBusy} onClick={async () => { await assignBatch(carriedRouteOf(t) ?? t.truck_number, t); close(); }}>
                          {assign.isPending || isBusy ? "Saving…" : "Assign Batch — Mark Unloaded"}
                        </button>
                      </section>
                    )}
                  </>
                )}
              </div>
            </div>,
            document.body,
          );
        })()}
      </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (mirror the Load page)
// ---------------------------------------------------------------------------

/** "Unloading · mm:ss" — a live clock since the marker was set. Its own
 *  component because useElapsed is a hook and the footer is rendered per card. */
function UnloadingSince({ startSec }: { startSec: number }) {
  const elapsed = useElapsed(startSec);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden />
      Unloading · {formatDuration(elapsed)}
    </span>
  );
}

function StatCard({ label, value, accent, active, onClick }: { label: string; value: number; accent: string; active?: boolean; onClick?: () => void }) {
  const isTotal = label === "Total Left";
  return (
    <AnimateCard>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "flex min-h-[5rem] w-full flex-col items-center justify-center rounded-xl border px-4 py-3 text-center shadow-inset-top transition-shadow",
          isTotal ? "border-hairline bg-surface" : "border-transparent",
          active && "ring-2 ring-white/30",
        )}
        style={!isTotal ? { background: `rgba(${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)},0.10)`, borderColor: accent + "40" } : undefined}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent, opacity: 0.7 }}>{label}</p>
        <p className="mt-1 font-mono text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums" style={{ color: isTotal ? "#dbe3ee" : accent }}>{value}</p>
      </button>
    </AnimateCard>
  );
}

function ProgressRow({ label, done, total, pct, barColor }: { label: string; done: number; total: number; pct: number; barColor: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[58px] text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="w-24 text-right font-mono text-xs tabular-nums text-ink-muted">{done}/{total} ({pct}%)</span>
    </div>
  );
}
