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
import { QuietTile, SectionHeader, TILE_GRID } from "../components/workflow/QuietTile";
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
const UNLOAD_DAY_NAMES: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday",
};

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
  // Long enough to be useful, short enough not to bury the work above it.
  // The batch the crew filled most recently tonight. Shown as a hint next to
  // the picker because batches are filled roughly in order, so the last one
  // used is nearly always the right answer for the truck on the dock.
  const lastBatchUsed = useMemo(() => {
    const done = (data ?? [])
      .filter((t) => t.state?.batch_id != null && t.state?.unloaded_at != null)
      .sort((a, b) => (b.state!.unloaded_at ?? 0) - (a.state!.unloaded_at ?? 0));
    return done[0]?.state?.batch_id ?? null;
  }, [data]);
  const UNLOADED_PREVIEW = 8;
  const [showAllUnloaded, setShowAllUnloaded] = useState(false);
  const [unloadedSort, setUnloadedSort] = useState<"number" | "order">("number");
  const [statFilter, setStatFilter] = useState<"routes" | "coverage" | "holds" | "total" | null>(null);
  // Per-device layout preference: "cards" (Load-page look, default) | "list".
  const [style, setStyle] = useState<"cards" | "list">(() => (localStorage.getItem("unload:style") === "list" ? "list" : "cards"));
  const setStylePref = (s: "cards" | "list") => { setStyle(s); localStorage.setItem("unload:style", s); };
  // Cards = the wide 5-up grid; List = the same tiles stacked narrow, for
  // a phone or a tablet held in portrait on the dock. Without this the
  // toggle was still on screen and still flipping a value nothing read.
  const tileGrid = style === "list" ? "grid gap-2 grid-cols-1 sm:grid-cols-2" : TILE_GRID;
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
    // /batches/assign turns a dirty truck unloaded and clears the unloading
    // marker in the same transaction — but only for the truck the CARD is
    // filed under. Writing it again from here would race that commit and 409
    // on the expected_status precondition, so we only step in when the server
    // can't have done it:
    //   - pre-batch mode, where assign deliberately leaves status alone; or
    //   - a carrier, where the card is filed under the route it brought back
    //     and the truck actually on the dock is a different one. Without this
    //     the route showed unloaded while the truck being emptied stayed dirty
    //     — exactly backwards from how coverage is counted everywhere else.
    const serverMarkedIt = !prebatchMode && physical != null && batchTruck === physical.truck_number;
    if (physical && !serverMarkedIt && !isUnloadDone(physical)) {
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
  /**
   * Follow a truck that just jumped sections.
   *
   * Starting an unload moves the row out of Arrived / Not arrived and into
   * "Unloading now" at the top of the page — so in list style the row the user
   * just tapped, and the batch entry that opens with it, vanish upward off
   * screen. Wait a frame for the optimistic update to re-render it in its new
   * home, then bring it back under their thumb.
   */
  function scrollToTruck(truckNumber: number) {
    window.setTimeout(() => {
      document
        .getElementById(`unload-truck-${truckNumber}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

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
  /**
   * The batch the crew is currently filling — the batch of the most recently
   * unloaded-and-batched truck. Trucks land in the same batch in runs, so the
   * last one used is almost always the next one wanted, and starting there
   * saves a tap on every truck.
   *
   * Derived from unloaded_at rather than remembered in tab state: it survives
   * a reload, and every device at the dock agrees on it. unloaded_at (not
   * updated_at) because later edits to a done truck must not steal the
   * default. Falls back to 1 on a fresh day.
   */
  const currentBatchDefault = useMemo(() => {
    let best: number | null = null;
    let bestAt = -1;
    // Pre-batch fallback: assigning there deliberately leaves status (and so
    // unloaded_at) alone, so track the freshest batched row by updated_at too
    // and use it only when no truck has actually been unloaded yet.
    let preBest: number | null = null;
    let preAt = "";
    for (const t of data ?? []) {
      const st = t.state;
      if (st?.batch_id == null) continue;
      if (st.unloaded_at != null && st.unloaded_at > bestAt) {
        bestAt = st.unloaded_at;
        best = st.batch_id;
      }
      if (st.updated_at > preAt) {
        preAt = st.updated_at;
        preBest = st.batch_id;
      }
    }
    return best ?? preBest ?? 1;
  }, [data]);

  function defaultWearersFor(t: TruckWithState): number {
    if (isSplitHelper(t)) return 0;
    const live = t.state?.wearers ?? 0;
    if (live > 0) return live;
    return dayTemplate.wearers[prevCoverOf(t) ?? t.truck_number] ?? 0;
  }

  function openTruckMenu(t: TruckWithState) {
    setBatchNum(String(t.state?.batch_id ?? currentBatchDefault));
    setWearers(String(defaultWearersFor(t)));
    beginUnloading(t);
    setMenuTruck(t);
  }
  function toggleBatch(t: TruckWithState) {
    const isOpen = batchOpen === t.truck_number;
    setBatchOpen(isOpen ? null : t.truck_number);
    setBatchNum(String(t.state?.batch_id ?? currentBatchDefault));
    setWearers(String(defaultWearersFor(t)));
    setOverflowOpen(null);
  }
  function toggleOverflow(truckNumber: number) {
    setOverflowOpen(overflowOpen === truckNumber ? null : truckNumber);
    setBatchOpen(null);
  }

  /**
   * The truck on the dock right now — and everything needed to finish it.
   *
   * Batch entry lives IN this card rather than behind a modal because
   * assigning the batch is what marks the truck unloaded: the crew's last act
   * on a truck and the app's completion signal are the same tap, so they
   * belong in the same place.
   */
  function UnloadingNowCard({ truck: t }: { truck: TruckWithState }) {
    const cd = coverDisplay(t);
    const startedAt = unloadingAt(t);
    const isBusy = busy === t.truck_number;
    const req = t.state?.load_request ?? null;
    const batchTarget = carriedRouteOf(t) ?? t.truck_number;
    const isUnfin = t.state?.status === "unfinished";
    return (
      <section className="card overflow-hidden !p-0">
        <div className="h-[2px] w-full animate-pulse bg-st-inprogress" />
        <div className="flex flex-col gap-4 px-[22px] py-[18px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div className="sm:min-w-[190px]">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-ink-muted">Unloading now</span>
              </div>
              <div className="mt-1 font-mono text-[46px] font-black leading-none tracking-[-0.02em] tabular-nums text-ink">
                #{t.truck_number}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
                <span>{truckTypeLabel(t.truck_type)}</span>
                {arrivedAt(t) != null && <span>· arrived {formatEasternTime(arrivedAt(t)!)}</span>}
                {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} />}
                {isUnfin && <span className="text-st-unfinished">· resumed</span>}
              </div>
            </div>
            <div className="hidden w-px self-stretch bg-hairline sm:block" />
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                {startedAt != null && <UnloadingSince startSec={startedAt} big />}
                {startedAt != null && (
                  <span className="text-[11px] text-ink-faint">started {formatEasternTime(startedAt)}</span>
                )}
              </div>
              {/* What Load said about this truck — their answer belongs where
                  the crew is already looking, not two sections away. */}
              {req != null && (
                <span className="mt-2 inline-flex rounded-md bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-cyan-200 ring-1 ring-cyan-500/30">
                  {req === "want" ? "Load: pull forward" : "Load: back it out"}
                </span>
              )}
            </div>
          </div>

          {!batchingDisabled && (
            <div className="rounded-lg border border-hairline bg-surface-3 p-3.5">
              <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                  Batch · finishes the unload
                </span>
                {carriedRouteOf(t) != null && (
                  <span className="text-[10px] text-ink-faint">as route #{carriedRouteOf(t)}</span>
                )}
                {lastBatchUsed != null && (
                  <span className="ml-auto text-[11px] text-ink-faint">last used: {lastBatchUsed}</span>
                )}
              </div>
              <div className="grid grid-cols-6 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBatchNum(String(n))}
                    className={clsx(
                      "rounded-md py-2.5 text-center font-mono text-base font-bold transition-colors",
                      batchNum === String(n)
                        ? "bg-st-unloaded/15 text-st-unloaded ring-2 ring-st-unloaded"
                        : "bg-surface-2 text-ink-soft hover:bg-surface",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <label className="flex flex-1 items-center gap-2.5 rounded-lg border border-hairline bg-surface-2 px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">Wearers</span>
                  <input
                    type="number"
                    min={0}
                    value={wearers}
                    onChange={(e) => setWearers(e.target.value)}
                    className="w-20 bg-transparent font-mono text-lg font-bold tabular-nums text-ink outline-none"
                  />
                  <span className="ml-auto text-[10px] text-ink-faint">from day sheet</span>
                </label>
                <button
                  type="button"
                  disabled={assign.isPending || isBusy}
                  onClick={() => void assignBatch(batchTarget, t)}
                  className="rounded-lg px-6 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-50"
                  style={{ background: "#15803d" }}
                >
                  {assign.isPending || isBusy ? "Saving…" : "Assign — done unloading"}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5 sm:flex-row">
            {batchingDisabled && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void markUnloaded(t)}
                className="flex-1 rounded-lg py-3 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: "#15803d" }}
              >
                Mark unloaded
              </button>
            )}
            <button type="button" className="btn-ghost px-5 py-3 text-xs" disabled={isBusy} onClick={() => void cancelUnloading(t)}>
              Not unloading — cancel
            </button>
            {!isUnfin && (
              <button
                type="button"
                className="btn-ghost px-5 py-3 text-xs !text-st-unfinished"
                disabled={isBusy}
                onClick={() => void markUnfinished(t)}
              >
                Mark unfinished
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  /** One truck in a section, in the shared quiet-tile language. */
  function renderTile(t: TruckWithState, kind: "arrived" | "notback" | "requested" | "unfinished") {
    const cd = coverDisplay(t);
    const isUnfin = kind === "unfinished";
    const dot =
      kind === "requested" ? "bg-st-inprogress"
      : isUnfin ? "bg-st-unfinished"
      : "bg-st-dirty";
    const sub =
      kind === "arrived" ? (
        <>
          <span>Dirty</span>
          {arrivedAt(t) != null && (
            <span className="inline-flex items-center gap-1 text-ink">
              <MapPin className="h-3 w-3 text-ink-soft" aria-hidden />
              {formatEasternTime(arrivedAt(t)!)}
            </span>
          )}
          {t.state?.needs_checked && <span className="text-st-inprogress">· Needs check</span>}
        </>
      ) : kind === "notback" ? (
        <span className="text-ink-faint">Still on the road</span>
      ) : kind === "requested" ? (
        <span className="text-ink-faint">
          {arrivedAt(t) != null ? `Back ${formatEasternTime(arrivedAt(t)!)} · ` : ""}waiting on dock
        </span>
      ) : (
        <span className="text-ink-faint">Partially emptied · tap to resume</span>
      );
    return (
      <QuietTile
        key={t.truck_number}
        id={`unload-truck-${t.truck_number}`}
        truck={t}
        highlight={highlightTruck === t.truck_number}
        dotClass={dot}
        onClick={() => openTruckMenu(t)}
        tag={
          kind === "requested" ? "Hold"
          : isUnfin ? "Unfinished"
          : cd.route != null ? `Route ${cd.route}${t.truck_type === "Spare" ? " · Spare" : ""}`
          : undefined
        }
        tagClass={
          kind === "requested" ? "text-st-inprogress"
          : isUnfin ? "text-st-unfinished"
          : "text-sky-300"
        }
        sub={sub}
      />
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
        titleBadge={
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-st-dirty/40 bg-st-dirty/10 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-st-dirty">
            <span className="h-1.5 w-1.5 rounded-full bg-st-dirty" />
            {toGo} to go
          </span>
        }
        subtitle={`Unload Day ${unloadsDay}${UNLOAD_DAY_NAMES[unloadsDay] ? ` · ${UNLOAD_DAY_NAMES[unloadsDay]}` : ""}`}
        actions={styleToggle}
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-5 p-3 md:p-6">

        <PreBatchBanner />

        {prevCoverage.items.length > 0 && (
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/20">
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-400">Previous load-day coverage</span>
              {prevCoverage.date && (
                <span className="text-[10px] text-amber-500/70">({format(new Date(`${prevCoverage.date}T12:00:00`), "EEE MMM d")})</span>
              )}
              <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-muted">
                {unloadCoverage.length} route{unloadCoverage.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="border-t border-amber-700/30 px-3.5 pb-3.5 pt-3.5">
              <CoverageCards entries={unloadCoverage} showPrevBadge={false} />
            </div>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
          {/* ---------------- Left rail: the work ---------------- */}
          <div className="flex flex-col gap-4">
            {unloading.map((t) => (
              <UnloadingNowCard key={t.truck_number} truck={t} />
            ))}

            {back.length > 0 && (
              <div>
                <SectionHeader label="Arrived" count={back.length} hint="oldest arrival first · tap to start unloading" />
                <div className={tileGrid}>
                  {back.map((t) => renderTile(t, "arrived"))}
                </div>
              </div>
            )}

            {notBack.length > 0 && (
              <div>
                <SectionHeader label="Not arrived" count={notBack.length} />
                <div className={tileGrid}>
                  {notBack.map((t) => renderTile(t, "notback"))}
                </div>
              </div>
            )}

            {dirty.length === 0 && unfinished.length === 0 && (
              <p className="rounded-xl border border-dashed border-hairline bg-surface/50 p-6 text-center text-sm text-ink-muted">
                Everything&apos;s unloaded. Nice work.
              </p>
            )}

            {unloaded.length > 0 && (
              <div>
                <SectionHeader label="Unloaded today" count={unloaded.length}>
                  <div className="inline-flex overflow-hidden rounded-[7px] border border-hairline text-[11px] font-semibold">
                    {([["number", "# Number"], ["order", "Unload order"]] as const).map(([key, text], i) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setUnloadedSort(key)}
                        className={clsx(
                          "px-3 py-1 transition-colors",
                          i > 0 && "border-l border-hairline",
                          unloadedSort === key ? "bg-track text-ink" : "text-ink-muted hover:text-ink",
                        )}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </SectionHeader>
                <div className={tileGrid}>
                  {(showAllUnloaded ? unloadedSorted : unloadedSorted.slice(0, UNLOADED_PREVIEW)).map((t, idx) => {
                    const time = t.state?.unloaded_at != null ? format(new Date(t.state.unloaded_at * 1000), "h:mm a") : "—";
                    const cd = coverDisplay(t);
                    return (
                      <QuietTile
                        key={t.truck_number}
                        id={`unload-truck-${t.truck_number}`}
                        truck={t}
                        highlight={highlightTruck === t.truck_number}
                        numberClass="text-ink-soft"
                        dotClass="bg-st-unloaded"
                        onClick={() => openTruckMenu(t)}
                        tag={cd.route != null ? `Route ${cd.route}` : undefined}
                        tagClass="text-sky-300"
                        sub={
                          <span className="text-ink-faint">
                            {unloadedSort === "order" ? `#${idx + 1} · ${time}` : time}
                            {t.state?.batch_id != null ? ` · Batch ${t.state.batch_id}` : ""}
                          </span>
                        }
                      />
                    );
                  })}
                  {/* The full list is 20+ tiles most nights — long enough to
                      bury the work above it, and nobody scrolls it twice. */}
                  {!showAllUnloaded && unloadedSorted.length > UNLOADED_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setShowAllUnloaded(true)}
                      className="rounded-[10px] border border-dashed border-hairline bg-surface/40 px-3.5 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
                    >
                      + {unloadedSorted.length - UNLOADED_PREVIEW} more
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ---------------- Right rail: reference ---------------- */}
          <div className="flex flex-col gap-4">
            <WorkflowDayNotes scope="unload" day={unloadsDay} />

            {/* Outstanding work, by the page's own buckets. Dot carries the
                category; the number stays ink so a big count isn't an alarm. */}
            <div className="card flex !px-0 !py-3.5">
              {([
                { key: "routes", value: routesLeft, label: "Routes left", dot: "bg-st-dirty" },
                { key: "coverage", value: coverageLeft, label: "Coverage left", dot: "bg-st-spare" },
                { key: "holds", value: holdsLeft, label: "Holds", dot: "bg-st-inprogress" },
                { key: "total", value: totalLeft, label: "Total left", dot: null },
              ] as const).map((cell, i) => (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setStatFilter(statFilter === cell.key ? null : cell.key)}
                  className={clsx(
                    "flex-1 px-1 text-center transition-colors",
                    i < 3 && "border-r border-hairline",
                    statFilter === cell.key ? "bg-surface-2" : "hover:bg-surface-2/60",
                  )}
                >
                  <div className="font-mono text-2xl font-black tabular-nums text-ink">{cell.value}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {cell.dot && <span className={clsx("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", cell.dot)} />}
                    {cell.label}
                  </div>
                </button>
              ))}
            </div>

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
                <div className="card animate-slide-down space-y-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {heading} still to unload ({trucks.length})
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {trucks.map((t) => {
                      const cd = coverDisplay(t);
                      const isUnfin = t.state?.status === "unfinished";
                      return (
                        <QuietTile
                          key={t.truck_number}
                          truck={t}
                          numberClass="text-ink-soft"
                          dotClass={isUnfin ? "bg-st-unfinished" : "bg-st-dirty"}
                          tag={t.state?.priority_hold ? "Hold" : undefined}
                          tagClass="text-st-inprogress"
                          sub={
                            <>
                              <span>{isUnfin ? "Unfinished" : "Dirty"}</span>
                              {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} />}
                            </>
                          }
                        />
                      );
                    })}
                    {trucks.length === 0 && <span className="col-span-full text-sm text-ink-faint">All clear!</span>}
                  </div>
                </div>
              );
            })()}

            <div className="card flex flex-col justify-center gap-2.5">
              <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
              <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
            </div>

            {/* Holds and unfinished trucks are exceptions, not queue — they sit
                beside the work rather than inside it, so the left rail stays a
                straight read of what to do next. */}
            {requested.length > 0 && (
              <div className="rounded-xl border border-amber-700/40 bg-amber-950/15 p-3.5">
                <SectionHeader label="Requested — priority hold" count={requested.length} />
                <div className="flex flex-col gap-2.5">
                  {requested.map((t) => renderTile(t, "requested"))}
                </div>
              </div>
            )}

            {unfinished.length > 0 && (
              <div className="rounded-xl border border-fuchsia-800/40 bg-fuchsia-950/15 p-3.5">
                <SectionHeader label="Unfinished" count={unfinished.length} />
                <div className="flex flex-col gap-2.5">
                  {unfinished.map((t) => renderTile(t, "unfinished"))}
                </div>
              </div>
            )}
          </div>
        </div>

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
function UnloadingSince({ startSec, big = false }: { startSec: number; big?: boolean }) {
  const elapsed = useElapsed(startSec);
  // `big` is the hero clock on the unloading card — the same instrument
  // treatment the Load page gives its elapsed timer.
  if (big) {
    return (
      <span className="font-mono text-[46px] font-black leading-none tracking-[-0.02em] tabular-nums text-st-inprogress">
        {formatDuration(elapsed)}
      </span>
    );
  }
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
