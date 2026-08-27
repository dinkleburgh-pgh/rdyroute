import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { MonitorPlay } from "lucide-react";
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
  GARMENT_LOADED_HEX,
  GARMENT_PENDING_HEX,
} from "../utils/truckStatus";
import { reportProgressOverflow } from "../utils/debugLog";
import { NextUpPanel, PaceBar, StartNextUpBanner, formatDuration, useElapsed } from "../components/LiveInProgress";
import { useLoadActions } from "../hooks/useLoadActions";
import { useLoadRequest } from "../hooks/useLoadRequest";
import NowUnloadingStrip from "../components/load/NowUnloadingStrip";
import LoadActionDialogs from "../components/load/LoadActionDialogs";
import InProgressHeroPanel from "../components/load/InProgressHeroPanel";
import GarmentsStrip from "../components/load/GarmentsStrip";
import CrossloadNoticeBar from "../components/CrossloadNoticeBar";
import LoadDisplay from "../components/load/LoadDisplay";
import { DustGarmentIcon } from "../components/icons";
import type { TruckWithState, RecurringRouteSwap } from "../types";
import AnimateCard from "../components/AnimateCard";
import ConfirmDialog from "../components/ConfirmDialog";
import LoadWorkflowCard from "../components/WorkflowCard";
import PageHeader from "../components/PageHeader";
import { QuietTile, SectionHeader, TILE_GRID } from "../components/workflow/QuietTile";
import WorkflowDayNotes from "../components/WorkflowDayNotes";
import { motion } from "framer-motion";
import CoverageCards from "../components/CoverageCards";

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
  const { data } = useBoard(runDate);
  const { data: pace } = usePaceAverage(30);
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
  // Manually-set Next Up (shared with the In Progress page). When set and the
  // truck is still ready it wins; otherwise fall back to the first ready truck.
  const { data: storedNextUp } = useNextUp(runDate);
  const clearNextUp = useClearNextUp(runDate);
  // One hook call feeds both surfaces: LoadDisplay is rendered by this page.
  const loadRequest = useLoadRequest(runDate);
  const [nextUpOpen, setNextUpOpen] = useState(false);
  // The inline logger is revealed by the card's Log Shortage button rather
  // than sitting open under every load — it's a long panel and most loads
  // don't need it.
  const [shortagesOpen, setShortagesOpen] = useState(false);
  const nextUpTruck = useMemo(
    () => ready.find((t) => t.truck_number === storedNextUp) ?? ready[0],
    [ready, storedNextUp],
  );
  // Only an EXPLICITLY queued truck gets the big green start banner — the
  // fallback above (first ready truck) is fine as a hint inside the in-progress
  // panel, but it shouldn't put a one-tap "Start Loading" on a truck nobody
  // actually picked.
  const queuedNextUp = useMemo(
    () => ready.find((t) => t.truck_number === storedNextUp) ?? null,
    [ready, storedNextUp],
  );
  // Historical load-order suggestions ("usually loads ~3rd"), filtered to
  // trucks that are actually ready tonight — top 3 by average position.
  const { data: seqSuggestions = [] } = useLoadSequenceSuggestions(14);
  const suggestedNext = useMemo(() => {
    const readyNums = new Set(ready.map((t) => t.truck_number));
    return seqSuggestions
      .filter((s) => s.avg_load_position != null && s.times_loaded >= 2 && readyNums.has(s.truck_number))
      .slice(0, 3);
  }, [seqSuggestions, ready]);
  // Loaded = physically loaded and scheduled for tomorrow.
  const loaded = useMemo(
    () => loadDisplayTrucks.filter((t) => effectiveOperationalStatus(t, loadDay, holidayLoad) === "loaded"),
    [loadDisplayTrucks, loadDay, holidayLoad],
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

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Load"
        subtitle="Start loading, finish routes, and track pace for the next run day."
        actions={
          <div className="flex items-center gap-2">
            <PaceBadge avgSeconds={pace?.avg_seconds ?? null} />
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
        titleBadge={anyInProgress ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-st-inprogress">
            <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
            Live
          </span>
        ) : undefined}
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="p-3 md:p-6 space-y-5">

      {/* PageHeader hides its actions below md, so the phone gets its own. */}
      <button
        type="button"
        onClick={openDisplay}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-surface-2 py-2 text-sm font-semibold text-ink-soft md:hidden"
      >
        <MonitorPlay className="h-4 w-4" />
        Open Load Display
      </button>

      <GarmentsStrip trucks={dustGarmentTrucks} />

      {/* Freight that has to change trucks affects what gets loaded where —
          the load crew sees it here; swap-managing roles can assign from it. */}
      <CrossloadNoticeBar board={data ?? []} />

      {/* Two rails: the WORK on the left — what's loading, what's being
          unloaded, and the ready queue — with the reference material (notes,
          coverage, counts) on the right. Ready-to-load living down at page
          level left the whole left rail empty whenever nothing was in
          progress, beside a full right rail. */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* ---------------- Left rail ---------------- */}
        <div className="flex flex-col gap-4">
          {inProgress ? (
            <>
              <InProgressHeroPanel
                truck={inProgress}
                paceAvgSeconds={pace?.avg_seconds ?? null}
                busy={busy === inProgress.truck_number}
                loadDay={loadDay}
                nextUp={nextUpTruck}
                onFinish={() => requestFinish(inProgress)}
                onCancel={() => cancelLoad(inProgress)}
                onChangeNextUp={() => setNextUpOpen(true)}
                onLogShortage={() => setShortagesOpen((v) => !v)}
              />
              {shortagesOpen && <InlineShortages truck={inProgress} runDate={runDate} />}
            </>
          ) : queuedNextUp ? (
            /* Nothing loading — hand straight off to the queued truck rather
               than making the user find it again down in the ready grid. */
            <StartNextUpBanner
              truck={queuedNextUp}
              paceAvgSeconds={pace?.avg_seconds ?? null}
              busy={busy === queuedNextUp.truck_number}
              onStart={() => requestStart(queuedNextUp)}
            />
          ) : null}

          {/* What Unload is emptying right now — and the buttons that answer
              it. Shared with the full-screen display so they cannot drift. */}
          <NowUnloadingStrip
            trucks={unloadingNow}
            actions={loadRequest}
            board={board}
            loadDay={loadDay}
            holidayLoad={holidayLoad}
            renderClock={(startSec) => <UnloadingSinceLoad startSec={startSec} />}
          />

        {/* ---------------- Ready to load + On hold ---------------- */}
        <div className="card flex flex-col gap-[18px]">
          <div>
            <SectionHeader label="Ready to load" count={ready.length}>
              {suggestedNext.length > 0 && (
                <span className="text-[11px] text-ink-faint">
                  Usually next:{" "}
                  <span className="font-mono font-bold text-ink-soft">
                    {suggestedNext.map((sg) => `#${sg.truck_number}`).join(" · ")}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setNextUpOpen(true)}
                className="btn-ghost px-3 py-1 text-[11px]"
              >
                {storedNextUp != null ? `Next Up: #${storedNextUp} · Change` : "Set Next Up"}
              </button>
            </SectionHeader>
            {anyInProgress && (
              <p className="mb-2 text-[11px] text-st-inprogress">
                Finish the in-progress truck before starting another.
              </p>
            )}
            <div className={TILE_GRID}>
              {ready.map((t) => {
                const disabled = anyInProgress || busy === t.truck_number;
                const cr = getCoverageRouteNumber(t);
                return (
                  <QuietTile
                    key={t.truck_number}
                    truck={t}
                    disabled={disabled}
                    onClick={() => requestStart(t)}
                    title={t.state?.wearers ? `${t.state.wearers} wearers` : undefined}
                    tag={t.truck_number === storedNextUp ? "Next" : undefined}
                    tagClass="text-[#3b82f6]"
                    numberClass={t.truck_type === "Spare" ? "text-st-spare" : "text-st-unloaded"}
                    dotClass={t.truck_type === "Spare" ? "bg-st-spare" : "bg-st-unloaded"}
                    pair={loadPair(t)}
                    sub={
                      cr != null ? (
                        <span>Covering route {cr}</span>
                      ) : (
                        <span>
                          {t.truck_type === "Spare" ? "Spare" : "Unloaded"}
                          {t.state?.wearers ? ` · ${t.state.wearers} wearers` : ""}
                        </span>
                      )
                    }
                  />
                );
              })}
              {ready.length === 0 && (
                <p className="col-span-full text-sm text-ink-muted">No trucks ready to load.</p>
              )}
            </div>
          </div>

          {heldReady.length > 0 && (
            <div>
              <SectionHeader label="On hold" count={heldReady.length} />
              <div className={TILE_GRID}>
                {heldReady.map((t) => (
                  <QuietTile
                    key={t.truck_number}
                    truck={t}
                    dim
                    tag="Hold"
                    tagClass="text-st-dirty"
                    numberClass="text-st-dirty"
                    dotClass="bg-st-dirty"
                    sub={<span className="text-ink-faint">Clear in Fleet</span>}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        </div>

        {/* ---------------- Right rail ---------------- */}
        <div className="flex flex-col gap-4">
          {/* Standing load-workflow notes for today, edited on the Notes page. */}
          <WorkflowDayNotes scope="load" day={loadDay} />

          {loadCoverage.length > 0 && (
            <div className="rounded-xl border" style={{ borderColor: "rgba(56,189,248,0.30)", background: "rgba(56,189,248,0.07)" }}>
              <div className="flex w-full items-center gap-2 px-3.5 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-400">Coverage today</span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-muted">
                  {loadCoverage.length} route{loadCoverage.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="border-t px-3.5 pb-3.5 pt-3.5" style={{ borderColor: "rgba(56,189,248,0.20)" }}>
                {/* Rail-width grid: the default lg:grid-cols-3 was tuned for
                    full-width surfaces and overflowed the card outline here. */}
                <CoverageCards
                  entries={loadCoverage}
                  isRecurring={isRecurringCoverage}
                  statusOf={(n) => board.find((t) => t.truck_number === n)?.state?.status ?? null}
                  className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
                />
              </div>
            </div>
          )}

          {/* Left-to-load counts — one card, four cells, no tinted tiles. The
              dot carries the category; the number stays ink so a big count
              can't read as an alarm. */}
          <div className="card flex !px-0 !py-3.5">
            {([
              { key: "dust", value: dustsLeft, label: "F.S. left", dot: "bg-st-dirty" },
              { key: "uniform", value: uniformsLeft, label: "Uniforms left", dot: "bg-st-shop" },
              { key: "spare", value: sparesLeft, label: "Spares left", dot: "bg-st-spare" },
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

          {/* Stat drill-down */}
          {statFilter && (() => {
            const trucks = statFilter === "dust" ? dustsLeftTrucks : statFilter === "uniform" ? uniformsLeftTrucks : statFilter === "spare" ? sparesLeftTrucks : totalLeftTrucks;
            const statusLabel: Record<string, string> = { dirty: "Dirty", unloaded: "Unloaded", in_progress: "Loading" };
            const statusDot: Record<string, string> = { dirty: "bg-st-dirty", unloaded: "bg-st-unloaded", in_progress: "bg-st-inprogress" };
            return (
              <div className="card animate-slide-down space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {statFilter === "dust" ? "F.S." : statFilter === "uniform" ? "Uniforms" : statFilter === "spare" ? "Spares" : "All"} not yet loaded ({trucks.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {trucks.map((t: (typeof totalLeftTrucks)[number]) => {
                    const st = t.state?.status ?? "dirty";
                    const cr = getCoverageRouteNumber(t);
                    return (
                      <QuietTile
                        key={t.truck_number}
                        truck={t}
                        dotClass={statusDot[st] ?? "bg-st-off"}
                        numberClass={
                          st === "unloaded" ? "text-st-unloaded"
                          : st === "in_progress" ? "text-st-inprogress"
                          : "text-st-dirty"
                        }
                        pair={loadPair(t)}
                        tag={t.state?.priority_hold ? "Hold" : undefined}
                        tagClass="text-st-dirty"
                        sub={<span>{statusLabel[st] ?? st}</span>}
                      />
                    );
                  })}
                  {trucks.length === 0 && <span className="col-span-full text-sm text-ink-faint">All clear!</span>}
                </div>
              </div>
            );
          })()}

          {/* Load / Unload progress */}
          <div className="card flex flex-col justify-center gap-2.5">
            <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
            <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
          </div>
        </div>
      </div>

      {/* ---------------- Loaded today ---------------- */}
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
          {loadedSorted.map((t, idx) => (
            <div key={t.truck_number} className="relative">
              {loadedSort === "order" && (
                <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-surface-2 px-1 text-[10px] font-bold text-st-loaded ring-1 ring-st-loaded/60">
                  {idx + 1}
                </span>
              )}
              <QuietTile
                truck={t}
                numberClass="text-st-loaded"
                dotClass="bg-st-loaded"
                pair={loadPair(t)}
                sub={
                  <span className="text-ink-faint">
                    {loadPair(t) != null && <span className="mr-1 text-sky-300/90">Covering {loadPair(t)!.split ? `split ${loadPair(t)!.route}` : `route ${loadPair(t)!.route}`} ·</span>}
                    {t.state?.load_finish_time
                      ? `Done ${format(new Date(t.state.load_finish_time * 1000), "h:mm a")}`
                      : "Loaded"}
                  </span>
                }
              />
            </div>
          ))}
          {loaded.length === 0 && (
            <p className="col-span-full text-sm text-ink-muted">Nothing loaded yet.</p>
          )}
        </div>
      </div>
            <LoadActionDialogs actions={actions} />
      {/* Next Up picker — same panel the In Progress page uses */}
      {nextUpOpen && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setNextUpOpen(false)}
        >
          <div
            className="flex w-full max-w-lg flex-col rounded-xl border border-hairline bg-surface shadow-card"
            style={{ maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
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
          </div>
        </div>,
        document.body,
      )}
    </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, accent, active, onClick }: { label: string; value: number; accent: string; active?: boolean; onClick?: () => void }) {
  const isTotal = label === "Total Left";
  return (
    <AnimateCard>
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-xl border px-4 py-3 text-center transition-shadow w-full min-h-[5rem] flex flex-col items-center justify-center shadow-inset-top",
        isTotal ? "bg-surface border-hairline" : "border-transparent",
        active && "ring-2 ring-white/30",
      )}
      style={!isTotal ? { background: `rgba(${parseInt(accent.slice(1,3),16)},${parseInt(accent.slice(3,5),16)},${parseInt(accent.slice(5,7),16)},0.10)`, borderColor: accent + "40" } : undefined}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent, opacity: 0.7 }}>{label}</p>
      <p className="mt-1 font-mono tabular-nums tracking-[-0.02em] text-[32px] font-bold leading-none" style={{ color: isTotal ? "#dbe3ee" : accent }}>{value}</p>
    </button>
    </AnimateCard>
  );
}

/** "started 7:42 PM · 12:34" — hook-bearing, so its own component. */
function UnloadingSinceLoad({ startSec }: { startSec: number }) {
  const elapsed = useElapsed(startSec);
  return (
    <span className="text-xs text-amber-200/80">
      started {formatEasternTime(startSec)} · <span className="font-mono tabular-nums">{formatDuration(elapsed)}</span>
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

function PaceBadge({ avgSeconds }: { avgSeconds: number | null }) {
  if (avgSeconds == null) {
    return <span className="text-xs text-ink-muted">No pace history</span>;
  }
  return (
    <span className="font-mono tabular-nums text-xs text-ink-muted">
      30-day avg <span className="font-semibold text-ink">{formatDuration(avgSeconds)}</span>
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




