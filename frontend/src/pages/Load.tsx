import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronsRight, MonitorPlay, Play, SquareParking, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import {
  useBoard,
  useHolidayLoad,
  useHolidayUnload,
  useLoadDayOverride,
  useUnloadsDayOverride,
  usePaceAverage,
  useShortages,
  useCoverageForRole,
  useSettings,
  useLoadSequenceSuggestions,
  useNextUp,
  useSetNextUp,
  useSetStaged,
  useClearNextUp,
  usePrevDayCarriers,
  usePrevDaySplitHelpers,
} from "../api/hooks";
import { ShortageLogger } from "./Shorts";
import { todayIso } from "../api/client";
import { formatEasternTime } from "../utils/dates";
import { workdayNumbers } from "../components/Clock";
import {
  buildOperationalDayContext,
  countLoaded,
  countUnloadedFromContext,
  effectiveOperationalStatus,
  effectiveStatus,
  getCoverageRouteNumber,
  getOperationalTruckType,
  isScheduledOff,
  loadedTruckNumbers,
  unloadedTruckNumbersFromContext,
  loadingCargo,
} from "../utils/truckStatus";
import { reportProgressOverflow } from "../utils/debugLog";
import { NextUpPanel, formatDuration, useElapsed } from "../components/LiveInProgress";
import { useLoadActions } from "../hooks/useLoadActions";
import { useLoadTimerVisible } from "../hooks/useLoadTimerVisible";
import { useLoadRequest } from "../hooks/useLoadRequest";
import NowUnloadingStrip from "../components/load/NowUnloadingStrip";
import LoadActionDialogs from "../components/load/LoadActionDialogs";
import InProgressHeroPanel from "../components/load/InProgressHeroPanel";
import GarmentsStrip from "../components/load/GarmentsStrip";
import NogsStrip from "../components/load/NogsStrip";
import CrossloadNoticeBar from "../components/CrossloadNoticeBar";
import LoadDisplay from "../components/load/LoadDisplay";
import DockCard from "../components/load/DockCard";
import { SheetHead } from "../components/load/loadUi";
import CoverageTag from "../components/CoverageTag";
import { truckTypeLabel } from "../utils/truckType";
import type { TruckWithState, RecurringRouteSwap } from "../types";
import PageHeader, { Sep, Stat } from "../components/PageHeader";
import { QuietTile, SectionHeader, TILE_GRID, TILE_GRID_LG } from "../components/workflow/QuietTile";
import WorkflowDayNotes from "../components/WorkflowDayNotes";
import { motion } from "framer-motion";
import CollapsibleCoverage from "../components/CollapsibleCoverage";
import Modal from "../components/Modal";
import PageStatus, { pageStatusFor } from "../components/PageStatus";
import EmptyState from "../components/EmptyState";
import { hasRanAhead } from "../utils/offNote";

/**
 * Load workflow (V1 parity):
 *   unloaded -> in_progress (Start Loading, stamps load_start_time)
 *   in_progress -> loaded (Finish Loading, stamps load_finish_time,
 *                          records duration to /load-durations)
 *
 * Only ONE truck may be in_progress at a time (matches V1 inprog_set max=1).
 */
export default function Load() {
  const runDate = todayIso();
  const boardQuery = useBoard(runDate);
  const { data } = boardQuery;
  const { data: pace } = usePaceAverage(30);
  // Operations "Load timer" switch: the header's 30-day pace follows it (the
  // hero panel and banners read it themselves).
  const showLoadTimer = useLoadTimerVisible();
  // The URL is the source of truth for the display, so /load?display=1 is
  // bookmarkable and the device comes back up straight into it.
  const [params, setParams] = useSearchParams();
  const displayOpen = params.get("display") === "1";
  function openDisplay() {
    const next = new URLSearchParams(params);
    next.set("display", "1");
    setParams(next); // pushes history, so Android back exits the display
    // Fullscreen needs the user gesture, so it has to happen in this handler.
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }
  function closeDisplay() {
    const next = new URLSearchParams(params);
    next.delete("display");
    setParams(next, { replace: true });
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }
  // Start / finish / cancel + both confirmations live in one shared hook so the
  // Load page and the full-screen Load Display can never drift apart.
  const actions = useLoadActions(runDate, {
    // Bring the now-loading truck's panel into view — the tap that starts a
    // load is usually deep down in the truck grid. The display passes nothing.
    onStarted: () => document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" }),
  });
  const { busy, cancelLoad, requestStart, requestFinish } = actions;
  const [statFilter, setStatFilter] = useState<"dust" | "uniform" | "spare" | "total" | null>(null);
  const [loadedSort, setLoadedSort] = useState<"number" | "order">("number");
  // The loaded wall is 30+ tiles by morning — long enough to bury the ready
  // queue it now shares a rail with. Two rows, then a "+N more" expander
  // (same pattern as Unload's unloaded wall).
  const LOADED_PREVIEW = 10;
  const [showAllLoaded, setShowAllLoaded] = useState(false);
  // The page lives mounted on a dock tablet across the 6am rollover — an
  // expansion from last night must not leave tomorrow's wall pre-expanded.
  useEffect(() => {
    setShowAllLoaded(false);
  }, [runDate]);
  // Dust-garment finish confirmation — asks "Did you load garments?" before
  // finishing a truck flagged with dust garments.

  const board = data ?? [];
  const { loadDay: computedLoadDay, unloadsDay: computedUnloadsDay } = workdayNumbers();
  const { data: loadDayOverride }    = useLoadDayOverride(runDate);
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const loadDay    = loadDayOverride    ?? computedLoadDay;
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);

  // Today's coverage assignments (manual + auto-applied recurring) — surfaced as
  // a notice so loaders know which route's freight loads on which truck.
  const { data: appSettings = [] } = useSettings();
  const recurringRules = useMemo<RecurringRouteSwap[]>(() => {
    const row = appSettings.find((s) => s.key === "recurring_route_swaps");
    return Array.isArray(row?.value) ? (row!.value as RecurringRouteSwap[]) : [];
  }, [appSettings]);
  // All of today's load-side coverage — spares AND one-way/two-way swaps AND
  // splits — via the shared selector. (The old banner showed only spares, so
  // route swaps created in the wizard/Fleet were invisible here.)
  const loadCoverage = useCoverageForRole("load", runDate, data ?? []);

  // The tile-face coverage pair: tonight's covered route, or the route whose
  // SPLIT overflow this truck carries (amber; the route also runs). One rule
  // for every tile on this page so covered loads read alike everywhere.
  const loadPair = (t: TruckWithState): { route: number; split?: boolean } | null => {
    const cr = getCoverageRouteNumber(t);
    if (cr != null) return { route: cr };
    if (t.route_split_route != null) return { route: t.route_split_route, split: true };
    return null;
  };
  function isRecurringCoverage(routeTruck: number, loadOnTruck: number): boolean {
    return recurringRules.some(
      (r) => r.route_truck === routeTruck && r.load_on_truck === loadOnTruck && r.days.includes(loadDay),
    );
  }

  const inProgress = useMemo(
    () => board.find((t) => t.state?.status === "in_progress"),
    [board],
  );
  const loadContext = useMemo(
    () => buildOperationalDayContext(board, loadDay, holidayLoad, false),
    [board, loadDay, holidayLoad],
  );
  const loadDisplayTrucks = loadContext.activeTrucks;
  // The truck Unload is emptying right now (0 or 1 — server enforces one at a
  // time). Whole board, status-guarded: a marker on anything not dirty/
  // unfinished is stale and must never paint a clean truck as "unloading".
  const unloadingNow = useMemo(
    () =>
      board
        .filter((t) => t.state?.unloading_started_at != null && (t.state.status === "dirty" || t.state.status === "unfinished"))
        .sort((a, b) => (a.state!.unloading_started_at ?? 0) - (b.state!.unloading_started_at ?? 0)),
    [board],
  );
  // Ready = unloaded and scheduled for tomorrow.
  const ready = useMemo(
    () => loadDisplayTrucks.filter((t) => t.state?.status === "unloaded" && t.state?.priority_hold !== true && t.state?.needs_checked !== true),
    [loadDisplayTrucks],
  );
  const heldReady = useMemo(
    () => loadDisplayTrucks.filter((t) => t.state?.status === "unloaded" && t.state?.priority_hold === true),
    [loadDisplayTrucks],
  );
  // Trucks whose unload was started but not completed — they'll join Ready
  // once Unload finishes them, and the load crew should see them coming.
  const unfinished = useMemo(
    () =>
      board
        .filter((t) => t.state?.status === "unfinished")
        .sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );
  // THE STAGING LANE. Trucks the load crew has physically pulled up, in the
  // order they were staged. Deliberately not filtered to `ready`: a truck can
  // be staged while it is still being unloaded, and hiding it the moment its
  // status moves would make the lane lie about what is actually parked there.
  // The server clears staged_at the moment a truck starts loading (and on
  // loaded/off/oos/shop), so anything still carrying a stamp genuinely
  // belongs in the lane.
  const staged = useMemo(
    () =>
      board
        .filter((t) => t.state?.staged_at != null)
        .sort((a, b) => (a.state!.staged_at ?? 0) - (b.state!.staged_at ?? 0)),
    [board],
  );
  const setStaged = useSetStaged(runDate);

  // Manually-set Next Up (shared with the In Progress page). When set and the
  // truck is still ready it wins; otherwise fall back to the first ready truck.
  const { data: storedNextUp } = useNextUp(runDate);
  const clearNextUp = useClearNextUp(runDate);
  // One hook call feeds both surfaces: LoadDisplay is rendered by this page.
  const loadRequest = useLoadRequest(runDate);
  const [nextUpOpen, setNextUpOpen] = useState(false);
  const setNextUp = useSetNextUp(runDate);
  // A ready tile no longer starts the load on tap — it opens a chooser: Start
  // Loading, Stage, or Set Next Up. Starting is the one that moves status, and
  // it was too easy to hit when the crew meant to stage or queue the truck.
  const [readyChoice, setReadyChoice] = useState<TruckWithState | null>(null);
  // The inline logger is revealed by the card's Log Shortage button rather
  // than sitting open under every load — it's a long panel and most loads
  // don't need it.
  const [shortagesOpen, setShortagesOpen] = useState(false);
  const nextUpTruck = useMemo(
    () => ready.find((t) => t.truck_number === storedNextUp) ?? ready[0],
    [ready, storedNextUp],
  );
  // Only an EXPLICITLY queued truck fills the dock card's Up next slot and gets
  // its one-tap "Start Loading" — the fallback above (first ready truck) is
  // fine as a hint on the full-screen display, but it shouldn't put a Start
  // button on a truck nobody actually picked.
  const queuedNextUp = useMemo(
    () => ready.find((t) => t.truck_number === storedNextUp) ?? null,
    [ready, storedNextUp],
  );
  // THE DOCK. Every truck appears ONCE on this page, in the first zone it
  // belongs to: Loading now → Up next → Staged → Ready → Not ready yet. Staged
  // trucks used to sit in the Staged card AND the Ready grid, and the queued
  // truck showed in three places — the page never said which was which.
  const lineStaged = useMemo(
    () => staged.filter((t) => t.truck_number !== queuedNextUp?.truck_number && t.state?.status !== "in_progress"),
    [staged, queuedNextUp],
  );
  const inDock = useMemo(() => {
    const s = new Set(lineStaged.map((t) => t.truck_number));
    if (queuedNextUp) s.add(queuedNextUp.truck_number);
    return s;
  }, [lineStaged, queuedNextUp]);
  const readyPool = useMemo(() => ready.filter((t) => !inDock.has(t.truck_number)), [ready, inDock]);
  const heldPool = useMemo(() => heldReady.filter((t) => !inDock.has(t.truck_number)), [heldReady, inDock]);
  const unfinishedPool = useMemo(() => unfinished.filter((t) => !inDock.has(t.truck_number)), [unfinished, inDock]);
  // Historical load-order suggestions ("usually loads ~3rd"), filtered to
  // ready trucks not already in the dock — top 3 by average position. Offered
  // as one-tap picks in the empty Up next slot.
  const { data: seqSuggestions = [] } = useLoadSequenceSuggestions(14);
  const suggestedNext = useMemo(() => {
    const poolNums = new Set(readyPool.map((t) => t.truck_number));
    return seqSuggestions
      .filter((s) => s.avg_load_position != null && s.times_loaded >= 2 && poolNums.has(s.truck_number))
      .slice(0, 3)
      .map((s) => s.truck_number);
  }, [seqSuggestions, readyPool]);
  // Loaded = physically loaded and scheduled for tomorrow.
  const loaded = useMemo(
    () => loadDisplayTrucks.filter((t) => effectiveOperationalStatus(t, loadDay, holidayLoad) === "loaded"),
    [loadDisplayTrucks, loadDay, holidayLoad],
  );
  // "Ran Ahead" trucks are OUT of the roster (context gate) — surface them so
  // the shrunken totals are explained rather than mysterious.
  const ranAhead = useMemo(
    () =>
      board
        .filter((t) => t.truck_type !== "Spare" && hasRanAhead(t.state?.off_note))
        .sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );
  // Sort variant for the "Loaded today" grid.
  const loadedSorted = useMemo(() => {
    const arr = [...loaded];
    if (loadedSort === "order") {
      // Sort by when the truck was actually finished loading.
      // Prefer load_finish_time (set by the V2 workflow); fall back to updated_at
      // (a proxy for when the status was last changed) for trucks that were
      // set to "loaded" without going through the timed workflow.
      const toEpoch = (t: TruckWithState): number => {
        const ft = t.state?.load_finish_time;
        if (ft != null) return ft;
        const ua = t.state?.updated_at;
        if (ua) return new Date(ua).getTime() / 1000;
        return Number.POSITIVE_INFINITY;
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
  }, [loaded, loadedSort]);
  const hiddenLoaded = showAllLoaded ? 0 : Math.max(0, loadedSorted.length - LOADED_PREVIEW);

  const notYetLoadedTrucks = useMemo(
    () =>
      loadDisplayTrucks.filter(
        (t) => effectiveOperationalStatus(t, loadDay, holidayLoad) !== "loaded",
      ),
    [loadDisplayTrucks, loadDay, holidayLoad],
  );
  const dustsLeftTrucks = useMemo(() => {
    return notYetLoadedTrucks.filter(
      (t) => getOperationalTruckType(t, loadContext.routeTruckByNumber) === "Dust",
    );
  }, [notYetLoadedTrucks, loadContext.routeTruckByNumber]);
  const uniformsLeftTrucks = useMemo(() => {
    return notYetLoadedTrucks.filter(
      (t) => getOperationalTruckType(t, loadContext.routeTruckByNumber) === "Uniform",
    );
  }, [notYetLoadedTrucks, loadContext.routeTruckByNumber]);
  const sparesLeftTrucks = useMemo(() => {
    return notYetLoadedTrucks.filter(
      (t) => getOperationalTruckType(t, loadContext.routeTruckByNumber) === "Spare",
    );
  }, [notYetLoadedTrucks, loadContext.routeTruckByNumber]);
  const dustsLeft = dustsLeftTrucks.length;
  const uniformsLeft = uniformsLeftTrucks.length;
  const sparesLeft = sparesLeftTrucks.length;
  const totalLeft = dustsLeft + uniformsLeft + sparesLeft;
  const totalLeftTrucks = useMemo(
    () => [...dustsLeftTrucks, ...uniformsLeftTrucks, ...sparesLeftTrucks].sort((a, b) => a.truck_number - b.truck_number),
    [dustsLeftTrucks, uniformsLeftTrucks, sparesLeftTrucks],
  );

  const loadTotal = loadDisplayTrucks.length;
  const loadDone = useMemo(
    () => countLoaded(board, loadDay, holidayLoad, unloadsDay, holidayUnload),
    [board, loadDay, unloadsDay, holidayLoad, holidayUnload],
  );
  const loadPct = loadTotal > 0 ? Math.round((loadDone / loadTotal) * 100) : 0;

  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const unloadScheduleContext = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload", prevSplitHelpers),
    [board, unloadsDay, holidayUnload, prevSplitHelpers],
  );
  const unloadTotal = unloadScheduleContext.activeTrucks.length;
  // Count "done" from the same context as the total so a spare covering an
  // off-day route can't push the numerator above the denominator (29/28 bug).
  // Prev-day carriers credit a covered route once its carrier is unloaded.
  const prevDayCarriers = usePrevDayCarriers(runDate, board);
  const unloadDone = useMemo(
    () => countUnloadedFromContext(unloadScheduleContext, prevDayCarriers),
    [unloadScheduleContext, prevDayCarriers],
  );
  const unloadPct = unloadTotal > 0 ? Math.round((unloadDone / unloadTotal) * 100) : 0;

  // Debug: log a numerator > denominator overflow (with the offending truck)
  // to the server, so the intermittent "N+1 of N" is captured centrally.
  useEffect(() => {
    reportProgressOverflow(
      "Load (Load page)",
      loadedTruckNumbers(board, loadDay, holidayLoad, unloadsDay, holidayUnload),
      loadDisplayTrucks.map((t) => t.truck_number),
      { run_date: runDate, loadDay },
    );
    reportProgressOverflow(
      "Unload (Load page)",
      unloadedTruckNumbersFromContext(unloadScheduleContext),
      unloadScheduleContext.activeTrucks.map((t) => t.truck_number),
      { run_date: runDate, unloadsDay },
    );
  }, [board, loadDay, unloadsDay, holidayLoad, holidayUnload, loadDisplayTrucks, unloadScheduleContext, runDate]);

  const anyInProgress = actions.anyInProgress;

  // All dust trucks — show garment checklist regardless of schedule/status
  const dustGarmentTrucks = board
    .filter((t) => t.truck_type === "Dust")
    .sort((a, b) => a.truck_number - b.truck_number);

  // Trucks sending Not-Our-Garments back out today (set at Setup Day, like
  // the F.S. garments). The strip hides itself when nothing is flagged.
  const nogsTrucks = board
    .filter((t) => t.state?.has_nogs === true)
    .sort((a, b) => a.truck_number - b.truck_number);

  // Whose garments / NOGs ride on the truck being loaded (coverage-aware):
  // their strip icons flash, and the hero shows + flashes them.
  const cargo = loadingCargo(inProgress, board);

  // Focus mode: the ready queue rarely holds more than ~10 trucks and spends
  // most of the night under 5 — render those few BIG (readable from across
  // the dock) instead of reserving a wall-sized grid for them.
  const readyFocus = readyPool.length > 0 && readyPool.length <= 4;

  if (displayOpen) {
    return (
      <>
        <LoadDisplay
          runDate={runDate}
          loadDay={loadDay}
          actions={actions}
          paceAvgSeconds={pace?.avg_seconds ?? null}
          ready={ready}
          unloading={unloadingNow}
          loadRequest={loadRequest}
          board={board}
          holidayLoad={holidayLoad}
          nextUpTruck={nextUpTruck}
          queuedNextUp={queuedNextUp}
          coverage={loadCoverage}
          isRecurringCoverage={isRecurringCoverage}
          garmentTrucks={dustGarmentTrucks}
          nogsTrucks={nogsTrucks}
          loadedCount={loadDone}
          loadTotal={loadTotal}
          onExit={closeDisplay}
        />
        {/* Rendered here, outside the display, so the dialogs portal at z-90
            land above the z-85 overlay. */}
        <LoadActionDialogs actions={actions} />
      </>
    );
  }

  // Loading / dead-connection gate — never render the fake empty day.
  const pageGate = pageStatusFor(boardQuery);
  if (pageGate) return <PageStatus {...pageGate} />;

  // Two blocks that change rails with the screen: on a phone they sit in the
  // one column right where the crew needs them; on desktop they move to the
  // right rail so the work rail is just the dock, Ready and Loaded. Built once
  // and placed twice (CSS shows one), so the two copies cannot drift.
  //
  // What Unload is emptying right now — and the one question it asks the load
  // crew. Shared with the full-screen display.
  const unloadCard = unloadingNow.length > 0 ? (
    <NowUnloadingStrip
      trucks={unloadingNow}
      actions={loadRequest}
      board={board}
      loadDay={loadDay}
      holidayLoad={holidayLoad}
      renderClock={(startSec) => <UnloadingSinceLoad startSec={startSec} />}
    />
  ) : null;
  // Held and unfinished trucks are one idea to the load crew — ready soon, not
  // yet — so they share one card of compact chips (nothing to tap here).
  const notReadyCard = heldPool.length + unfinishedPool.length > 0 ? (
    <div className="card">
      <SectionHeader
        label="Not ready yet"
        count={heldPool.length + unfinishedPool.length}
        hint="joins Ready when cleared"
      />
      <div className="flex flex-wrap gap-2">
        {heldPool.map((t) => (
          <NotReadyChip key={t.truck_number} truck={t} pair={loadPair(t)} tone="text-st-dirty" dot="bg-st-dirty" label="On hold · clear in Fleet" />
        ))}
        {unfinishedPool.map((t) => (
          <NotReadyChip key={t.truck_number} truck={t} pair={loadPair(t)} tone="text-st-unfinished" dot="bg-st-unfinished" label="Unload unfinished" />
        ))}
      </div>
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        title="Load"
        titleBadge={anyInProgress ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-st-inprogress">
            <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
            Live
          </span>
        ) : undefined}
        meta={
          <>
            <Stat value={`${loadDone}/${loadTotal}`} label="loaded" tone="loaded" />
            {showLoadTimer && pace?.avg_seconds != null && (
              <>
                <Sep />
                <Stat value={formatDuration(pace.avg_seconds)} label="30-day pace" />
              </>
            )}
          </>
        }
        actions={
          <button
            type="button"
            onClick={openDisplay}
            title="Open the full-screen load display"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-soft active:scale-95"
          >
            <MonitorPlay className="h-4 w-4" />
            Display
          </button>
        }
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="p-3 md:p-6 space-y-5">

      {/* Both checklists hug their chips and share one wrapping row — neither
          ever shows more than ~8, so two half-width cards were mostly empty. */}
      <div className="flex flex-wrap items-start gap-3">
        <GarmentsStrip trucks={dustGarmentTrucks} loadingNow={cargo.numbers} carriers={cargo.carriers} />
        <NogsStrip trucks={nogsTrucks} loadingNow={cargo.numbers} carriers={cargo.carriers} />
      </div>

      {/* Freight that has to change trucks affects what gets loaded where —
          the load crew sees it here; swap-managing roles can assign from it. */}
      <CrossloadNoticeBar board={data ?? []} />

      {/* Two rails: the WORK on the left — the dock (loading / up next /
          staged), the unload dock's question, and what's left to load — with
          the reference material (notes, coverage, tonight's numbers) on the
          right. */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* ---------------- Left rail ---------------- */}
        <div className="flex flex-col gap-4">
          <DockCard
            loading={
              inProgress ? (
                <InProgressHeroPanel
                  truck={inProgress}
                  paceAvgSeconds={pace?.avg_seconds ?? null}
                  busy={busy === inProgress.truck_number}
                  loadDay={loadDay}
                  garment={cargo.garment}
                  nogs={cargo.nogs}
                  onFinish={() => requestFinish(inProgress)}
                  onCancel={() => cancelLoad(inProgress)}
                  onLogShortage={() => setShortagesOpen((v) => !v)}
                  shortagesOpen={shortagesOpen}
                />
              ) : null
            }
            nextUp={queuedNextUp}
            staged={lineStaged}
            readyCount={readyPool.length}
            suggestions={suggestedNext}
            busyTruck={busy}
            canStart={!anyInProgress}
            pairOf={loadPair}
            onTruck={setReadyChoice}
            onStart={requestStart}
            onPickNextUp={() => setNextUpOpen(true)}
            onSuggest={(n) => setNextUp.mutate(n)}
          />
          {inProgress && shortagesOpen && <InlineShortages truck={inProgress} runDate={runDate} />}

          {/* Phone: the unload question stays right under the dock. Desktop
              moves it to the top of the right rail (below). */}
          {unloadCard && <div className="lg:hidden">{unloadCard}</div>}

        {/* ---------------- Ready to load ---------------- */}
        <div className="card">
          <SectionHeader
            label="Ready to load"
            count={readyPool.length}
            hint={
              inDock.size > 0
                ? `+${inDock.size} in the dock above`
                : readyPool.length > 0
                  ? "tap to start, stage, or queue"
                  : undefined
            }
          />
          <div className={readyFocus ? TILE_GRID_LG : TILE_GRID}>
            {readyPool.map((t) => (
              <QuietTile
                key={t.truck_number}
                truck={t}
                size={readyFocus ? "lg" : "md"}
                disabled={busy === t.truck_number}
                onClick={() => setReadyChoice(t)}
                title={t.state?.wearers ? `${t.state.wearers} wearers` : undefined}
                numberClass={t.truck_type === "Spare" ? "text-st-spare" : "text-st-unloaded"}
                dotClass={t.truck_type === "Spare" ? "bg-st-spare" : "bg-st-unloaded"}
                pair={loadPair(t)}
                sub={
                  <span>
                    {t.truck_type === "Spare" ? "Spare" : "Unloaded"}
                    {t.state?.wearers ? ` · ${t.state.wearers} wearers` : ""}
                  </span>
                }
              />
            ))}
            {readyPool.length === 0 && (
              <EmptyState compact className="col-span-full text-[13px] text-ink-muted">
                {inDock.size > 0 ? "Everything ready is already in the dock." : "No trucks ready to load."}
              </EmptyState>
            )}
          </div>
        </div>

        {notReadyCard && <div className="lg:hidden">{notReadyCard}</div>}

        {/* ---------------- Loaded today ----------------
            Lives IN the work rail: ready shrinks exactly as this grows, so
            the column holds its height all night instead of hollowing out
            beside the reference rail. Two rows, then the expander. */}
        <div>
          <SectionHeader label="Loaded today" count={loaded.length}>
            {loaded.length > 1 && (
              <div className="inline-flex overflow-hidden rounded-[7px] border border-hairline text-[11px] font-semibold">
                {([["number", "# Number"], ["order", "Load order"]] as const).map(([key, text], i) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLoadedSort(key)}
                    className={clsx(
                      "px-3 py-1 transition-colors",
                      i > 0 && "border-l border-hairline",
                      loadedSort === key ? "bg-track text-ink" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </SectionHeader>
          <div className={TILE_GRID}>
            {/* Tail slice, not head: the glance here is "did the truck I just
                finished register" — under Load-order sort the freshest finishes
                are LAST, so the preview keeps them and the expander (rendered
                first) hides the early-evening tiles instead. Pips stay true by
                offsetting past the hidden count. */}
            {hiddenLoaded > 0 && (
              <button
                type="button"
                onClick={() => setShowAllLoaded(true)}
                className="rounded-[10px] border border-dashed border-hairline bg-surface/40 px-3.5 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                + {hiddenLoaded} more
              </button>
            )}
            {loadedSorted.slice(hiddenLoaded).map((t, idx) => (
              <div key={t.truck_number} className="relative">
                {loadedSort === "order" && (
                  <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-surface-2 px-1 text-[10px] font-bold text-st-loaded ring-1 ring-st-loaded/60">
                    {hiddenLoaded + idx + 1}
                  </span>
                )}
                <QuietTile
                  truck={t}
                  numberClass="text-st-loaded"
                  dotClass="bg-st-loaded"
                  pair={loadPair(t)}
                  sub={
                    <span className="text-ink-faint">
                      {t.state?.load_finish_time
                        ? `Done ${format(new Date(t.state.load_finish_time * 1000), "h:mm a")}`
                        : "Loaded"}
                    </span>
                  }
                />
              </div>
            ))}
            {loaded.length === 0 && (
              <EmptyState className="col-span-full">Nothing loaded yet.</EmptyState>
            )}
          </div>
        </div>
        </div>

        {/* ---------------- Right rail ---------------- */}
        <div className="flex flex-col gap-4">
          {/* Desktop: the unload question heads this rail — the dock card and
              Ready already fill the work rail, and the question is about the
              other crew's truck, not ours. */}
          {unloadCard && <div className="hidden lg:block">{unloadCard}</div>}

          {/* Standing load-workflow notes for today, edited on the Notes page. */}
          <WorkflowDayNotes scope="load" day={loadDay} />

          {/* Collapsible coverage — shared banner, collapsed to chips by
              default. Same component on Fleet and Unload. */}
          <CollapsibleCoverage
            entries={loadCoverage}
            title="Coverage today"
            storageKey="rr-load-coverage-open"
            tone="sky"
            isRecurring={isRecurringCoverage}
            truckOf={(n) => board.find((t) => t.truck_number === n)}
            cardsClassName="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
          />

          {/* Tonight: progress, then what's left to load, then (on tap) the
              trucks behind a count — one card instead of three. The dot
              carries the category; the number stays ink so a big count can't
              read as an alarm. */}
          <div className="card overflow-hidden !p-0">
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-muted">Tonight</div>
              <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
              {ranAhead.length > 0 && (
                <p className="text-[11px] font-semibold text-sky-300">
                  {ranAhead.length} ran ahead — not in tonight's load
                </p>
              )}
              <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
            </div>
            <div className="flex border-t border-hairline">
              {([
                { key: "dust", value: dustsLeft, label: "F.S. left", dot: "bg-st-dirty" },
                { key: "uniform", value: uniformsLeft, label: "Uniforms left", dot: "bg-st-shop" },
                { key: "spare", value: sparesLeft, label: "Spares left", dot: "bg-st-spare" },
                { key: "total", value: totalLeft, label: "Total left", dot: null },
              ] as const).map((cell, i) => (
                <button
                  key={cell.key}
                  type="button"
                  aria-pressed={statFilter === cell.key}
                  onClick={() => setStatFilter(statFilter === cell.key ? null : cell.key)}
                  className={clsx(
                    "flex-1 px-1 py-3 text-center transition-colors",
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

            {/* Stat drill-down */}
            {statFilter && (() => {
              const trucks = statFilter === "dust" ? dustsLeftTrucks : statFilter === "uniform" ? uniformsLeftTrucks : statFilter === "spare" ? sparesLeftTrucks : totalLeftTrucks;
              const statusLabel: Record<string, string> = { dirty: "Dirty", unloaded: "Unloaded", in_progress: "Loading" };
              /* Compact chips, not full tiles: "total left" is 25-plus trucks
                 most of the night, and two-column tiles ran the list far off
                 screen. A chip carries everything the glance needs — number
                 (pair form when covering), status colour, hold ring — and the
                 whole set fits in a few rows. */
              return (
                <div className="animate-slide-down space-y-2.5 border-t border-hairline px-4 py-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {statFilter === "dust" ? "F.S." : statFilter === "uniform" ? "Uniforms" : statFilter === "spare" ? "Spares" : "All"} not yet loaded ({trucks.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {trucks.map((t: (typeof totalLeftTrucks)[number]) => {
                      const st = t.state?.status ?? "dirty";
                      const pair = loadPair(t);
                      const tone =
                        st === "unloaded" ? "text-st-unloaded"
                        : st === "in_progress" ? "text-st-inprogress"
                        : "text-st-dirty";
                      return (
                        <span
                          key={t.truck_number}
                          className={clsx(
                            "inline-flex items-center rounded-md border border-hairline bg-surface px-2 py-1.5 font-mono text-[13px] font-bold tabular-nums",
                            tone,
                            t.state?.priority_hold && "ring-1 ring-st-dirty/60",
                          )}
                          title={`${statusLabel[st] ?? st}${pair != null ? ` · covering route ${pair.route}` : ""}${t.state?.priority_hold ? " · hold" : ""}`}
                        >
                          {pair != null ? (
                            <>
                              <span className={pair.split ? "text-amber-300" : "text-sky-300"}>{pair.route}</span>
                              <span className="px-0.5 text-ink-faint">{pair.split ? "+" : "→"}</span>
                              {t.truck_number}
                            </>
                          ) : (
                            <>#{t.truck_number}</>
                          )}
                        </span>
                      );
                    })}
                    {trucks.length === 0 && <span className="text-sm text-ink-faint">All clear!</span>}
                  </div>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
                    {([["bg-st-dirty", "Dirty"], ["bg-st-unloaded", "Unloaded"], ["bg-st-inprogress", "Loading"]] as const).map(([dot, label]) => (
                      <span key={label} className="inline-flex items-center gap-1">
                        <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
                        {label}
                      </span>
                    ))}
                  </p>
                </div>
              );
            })()}
          </div>

          {notReadyCard && <div className="hidden lg:block">{notReadyCard}</div>}
        </div>
      </div>

      <LoadActionDialogs actions={actions} />
      {/* Truck chooser — what a truck in the dock or the Ready grid can
          become. Start Loading starts straight away (no second confirmation;
          useLoadActions.requestStart toasts anything that blocks it). Same
          sheet as the garment check, so Finish stays in the family. */}
      {readyChoice && (() => {
        const t = readyChoice;
        const n = t.truck_number;
        const st = t.state?.status;
        const isStaged = t.state?.staged_at != null;
        const isNext = storedNextUp === n;
        const held = t.state?.priority_hold === true;
        const isReady = st === "unloaded" && !held;
        const startBlocked =
          anyInProgress ? "Another truck is loading — finish it first"
          : held ? "On hold — clear it in Fleet first"
          : !isReady ? "Not unloaded yet"
          : null;
        const where =
          isNext && isReady ? { text: "Up next", cls: "text-sky-300" }
          : isStaged ? { text: "Staged", cls: "text-ink" }
          : held ? { text: "On hold", cls: "text-st-dirty" }
          : isReady ? { text: "Ready to load", cls: "text-st-unloaded" }
          : st === "unfinished" ? { text: "Unload unfinished", cls: "text-st-unfinished" }
          : { text: "Not unloaded yet", cls: "text-st-dirty" };
        const pair = loadPair(t);
        const close = () => setReadyChoice(null);
        return (
          <Modal open onClose={close} size="sm" sheet>
            <SheetHead
              eyebrow={where.text}
              eyebrowClass={where.cls}
              truckNumber={n}
              onClose={close}
              detail={
                <>
                  <span>{truckTypeLabel(t.truck_type)}</span>
                  {t.state?.wearers ? <span>· {t.state.wearers} wearers</span> : null}
                  {pair && <CoverageTag route={pair.route} truck={n} split={pair.split} />}
                </>
              }
            />
            <div className="mt-5 flex flex-col gap-2">
              <ChoiceButton
                icon={<Play className="h-4 w-4 fill-current" />}
                label={`Start Loading #${n}`}
                hint={startBlocked ?? "Starts the load now"}
                tone="go"
                disabled={startBlocked != null || busy === n}
                onClick={() => { close(); requestStart(t); }}
              />
              <ChoiceButton
                icon={isStaged ? <Undo2 className="h-4 w-4" /> : <SquareParking className="h-4 w-4" />}
                label={isStaged ? "Unstage" : "Stage"}
                hint={isStaged ? "Take it back out of the lane" : "Pulled up to the lane, ready to go"}
                tone="neutral"
                disabled={setStaged.isPending}
                onClick={() => {
                  setStaged.mutate({ truck_number: n, staged: !isStaged, expected_status: t.state?.status ?? null });
                  close();
                }}
              />
              <ChoiceButton
                icon={isNext ? <X className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
                label={isNext ? "Take off Up next" : "Put Up next"}
                hint={
                  isNext ? "It's queued next right now"
                  : !isReady ? "Only ready trucks can be queued"
                  : storedNextUp != null ? `Replaces #${storedNextUp}`
                  : "Queue it as the next load"
                }
                tone="sky"
                disabled={setNextUp.isPending || clearNextUp.isPending || (!isNext && !isReady)}
                onClick={() => {
                  if (isNext) clearNextUp.mutate();
                  else setNextUp.mutate(n);
                  close();
                }}
              />
            </div>
          </Modal>
        );
      })()}
      {/* Next Up picker — same panel the In Progress page uses */}
      {nextUpOpen && (
        <Modal open onClose={() => setNextUpOpen(false)} size="lg" panelClassName="border-hairline bg-surface" bodyClassName="flex max-h-[85svh] flex-col">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h3 className="text-base font-bold tracking-wide">Set Next Up</h3>
              <button
                onClick={() => setNextUpOpen(false)}
                className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <NextUpPanel
                runDate={runDate}
                nextUp={storedNextUp ?? null}
                unloaded={ready}
                anyInProgress={anyInProgress}
                onPick={() => setNextUpOpen(false)}
                defaultOpen
              />
            </div>
        </Modal>
      )}
    </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Each chooser row wears the colour of where it sends the truck: go-green
 *  to Loading, neutral to the lane (Staged is white on the dock card), sky to
 *  Up next. */
const CHOICE_TONES = {
  go: "border-transparent bg-[#15803d] text-white enabled:hover:bg-[#16a34a]",
  neutral: "border-hairline bg-surface-2 text-ink enabled:hover:bg-track",
  sky: "border-sky-500/30 bg-sky-500/[0.08] text-sky-100 enabled:hover:bg-sky-500/[0.14]",
} as const;

/** One row of the truck chooser: an icon, a verb, one line on what it does. */
function ChoiceButton({
  icon,
  label,
  hint,
  tone,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  tone: keyof typeof CHOICE_TONES;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex min-h-[60px] w-full items-center gap-3.5 rounded-xl border px-4 py-2.5 text-left transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45",
        CHOICE_TONES[tone],
      )}
    >
      <span
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tone === "go" ? "bg-white/15" : tone === "sky" ? "bg-sky-400/15" : "bg-track",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold">{label}</span>
        <span className="text-[12px] font-normal opacity-75">{hint}</span>
      </span>
    </button>
  );
}

/** One held / unfinished truck: number in its status colour, then why. */
function NotReadyChip({
  truck,
  pair,
  tone,
  dot,
  label,
}: {
  truck: TruckWithState;
  pair: { route: number; split?: boolean } | null;
  tone: string;
  dot: string;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-lg border border-hairline bg-surface-3 px-3 py-2">
      <span className={clsx("font-mono text-[17px] font-black leading-none tabular-nums", tone)}>
        {pair != null ? (
          <>
            <span className={pair.split ? "text-amber-300" : "text-sky-300"}>{pair.route}</span>
            <span className="px-0.5 text-[13px] text-ink-faint">{pair.split ? "+" : "→"}</span>
            {truck.truck_number}
          </>
        ) : (
          <>#{truck.truck_number}</>
        )}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
      </span>
    </div>
  );
}

/** "started 7:42 PM · 12:34" — hook-bearing, so its own component. */
function UnloadingSinceLoad({ startSec }: { startSec: number }) {
  const elapsed = useElapsed(startSec);
  return (
    <span className="text-xs text-ink-muted">
      started {formatEasternTime(startSec)} · <span className="font-mono tabular-nums text-ink-soft">{formatDuration(elapsed)}</span>
    </span>
  );
}

function ProgressRow({
  label,
  done,
  total,
  pct,
  barColor,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
  barColor: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[58px] text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="w-24 text-right font-mono tabular-nums text-xs text-ink-muted">
        {done}/{total} ({pct}%)
      </span>
    </div>
  );
}

function InlineShortages({ truck, runDate }: { truck: TruckWithState; runDate: string }) {
  const { data: shorts = [] } = useShortages(runDate, truck.truck_number);
  return (
    <div className="card">
      <ShortageLogger
        inline
        truck={truck}
        shorts={shorts}
        runDate={runDate}
        onBack={() => {}}
      />
    </div>
  );
}




