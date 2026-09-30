import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronsRight, MonitorPlay, Play, SquareParking, Undo2, X } from "lucide-react";
import clsx from "clsx";
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
import YardLayout from "../components/load/YardLayout";
import ClassicLayout from "../components/load/ClassicLayout";
import FloorLayout from "../components/load/FloorLayout";
import TonightCard from "../components/load/TonightCard";
import type { LoadViewProps } from "../components/load/loadView";
import { useLoadLayout } from "../hooks/useLoadLayout";
import { SheetHead, loadFaceText, loadPairOf } from "../components/load/loadUi";
import CoverageTag from "../components/CoverageTag";
import { truckTypeLabel } from "../utils/truckType";
import type { TruckWithState, RecurringRouteSwap } from "../types";
import PageHeader, { Sep, Stat } from "../components/PageHeader";
import WorkflowDayNotes from "../components/WorkflowDayNotes";
import { motion } from "framer-motion";
import CollapsibleCoverage from "../components/CollapsibleCoverage";
import Modal from "../components/Modal";
import PageStatus, { pageStatusFor } from "../components/PageStatus";
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
  // Classic (default), yard or floor arrangement — this device's choice, from
  // the header switch.
  const [layout, setLayout] = useLoadLayout();
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
  // for every tile on this page AND the display (loadUi.loadPairOf), so
  // covered loads read alike everywhere.
  const loadPair = loadPairOf;
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
  const totalLeftTrucks = useMemo(
    () => [...dustsLeftTrucks, ...uniformsLeftTrucks, ...sparesLeftTrucks].sort((a, b) => a.truck_number - b.truck_number),
    [dustsLeftTrucks, uniformsLeftTrucks, sparesLeftTrucks],
  );

  const loadTotal = loadDisplayTrucks.length;
  const loadDone = useMemo(
    () => countLoaded(board, loadDay, holidayLoad, unloadsDay, holidayUnload),
    [board, loadDay, unloadsDay, holidayLoad, holidayUnload],
  );

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
          staged={lineStaged}
          readyPool={readyPool}
          held={heldPool}
          unfinished={unfinishedPool}
          readyFocus={readyFocus}
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

  // Everything a layout needs, derived once here. The layouts only arrange.
  const view: LoadViewProps = {
    runDate,
    loading: inProgress ? (
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
        size={layout === "floor" ? "xl" : "md"}
      />
    ) : null,
    shortages: inProgress && shortagesOpen ? <InlineShortages truck={inProgress} runDate={runDate} /> : null,
    unloadCard,
    unloadAnswered: unloadingNow.every((t) => t.state?.load_request != null),
    tonightCard: (
      <TonightCard
        loadDone={loadDone}
        loadTotal={loadTotal}
        unloadDone={unloadDone}
        unloadTotal={unloadTotal}
        ranAhead={ranAhead.length}
        left={{ dust: dustsLeftTrucks, uniform: uniformsLeftTrucks, spare: sparesLeftTrucks, total: totalLeftTrucks }}
        pairOf={loadPair}
      />
    ),
    // Collapsible coverage — shared banner, collapsed to chips by default.
    // Same component on Fleet and Unload.
    coverageCard: (
      <CollapsibleCoverage
        entries={loadCoverage}
        title="Coverage today"
        storageKey="rr-load-coverage-open"
        tone="sky"
        isRecurring={isRecurringCoverage}
        truckOf={(n) => board.find((t) => t.truck_number === n)}
        cardsClassName="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
      />
    ),
    // Standing load-workflow notes for today, edited on the Notes page.
    notesCard: <WorkflowDayNotes scope="load" day={loadDay} />,
    nextUp: queuedNextUp,
    staged: lineStaged,
    ready: readyPool,
    held: heldPool,
    unfinished: unfinishedPool,
    loaded,
    suggestions: suggestedNext,
    inLine: inDock.size,
    readyFocus,
    busyTruck: busy,
    canStart: !anyInProgress,
    pairOf: loadPair,
    onTruck: setReadyChoice,
    onStart: requestStart,
    onPickNextUp: () => setNextUpOpen(true),
    onSuggest: (n) => setNextUp.mutate(n),
  };

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
          <div className="flex shrink-0 items-center gap-2">
            {/* Yard | Classic — this device's arrangement of the page. */}
            <div className="inline-flex overflow-hidden rounded-lg border border-hairline text-[11px] font-semibold" role="group" aria-label="Load view">
              {([["classic", "Classic"], ["yard", "Yard"], ["floor", "Floor"]] as const).map(([key, text], i) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={layout === key}
                  onClick={() => setLayout(key)}
                  title={{
                    yard: "The dock on the left, the yard as one line on the right",
                    classic: "The three-zone dock card over the Ready grid, reference on the right",
                    floor: "Just what a loader acts on, one size up — no reference cards",
                  }[key]}
                  className={clsx(
                    "px-2.5 py-1.5 transition-colors",
                    i > 0 && "border-l border-hairline",
                    layout === key ? "bg-track text-ink" : "bg-surface-2 text-ink-muted hover:text-ink",
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openDisplay}
              title="Open the full-screen load display"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-soft active:scale-95"
            >
              <MonitorPlay className="h-4 w-4" />
              Display
            </button>
          </div>
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

      {/* The arrangement is this device's choice (header switch): classic by
          default, or the yard / floor views. All are fed the same view props;
          only the layout components differ. */}
      {layout === "yard" ? <YardLayout {...view} /> : layout === "floor" ? <FloorLayout {...view} /> : <ClassicLayout {...view} />}

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
              truck={t}
              onClose={close}
              detail={
                <>
                  <span>{truckTypeLabel(t.truck_type)}</span>
                  {t.state?.wearers ? <span>· {t.state.wearers} wearers</span> : null}
                  {pair?.split && <CoverageTag route={pair.route} truck={n} split />}
                </>
              }
            />
            <div className="mt-5 flex flex-col gap-2">
              <ChoiceButton
                icon={<Play className="h-4 w-4 fill-current" />}
                label={`Start Loading ${loadFaceText(t)}`}
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

/** "started 7:42 PM · 12:34" — hook-bearing, so its own component. */
function UnloadingSinceLoad({ startSec }: { startSec: number }) {
  const elapsed = useElapsed(startSec);
  return (
    <span className="text-xs text-ink-muted">
      started {formatEasternTime(startSec)} · <span className="font-mono tabular-nums text-ink-soft">{formatDuration(elapsed)}</span>
    </span>
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




