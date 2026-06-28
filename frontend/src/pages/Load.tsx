import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import {
  useBoard,
  useHolidayLoad,
  useHolidayUnload,
  useLoadDayOverride,
  useUnloadsDayOverride,
  usePaceAverage,
  useRecordLoadDuration,
  useShortages,
  useSpareAssignments,
  useSettings,
  useUpsertTruckState,
} from "../api/hooks";
import { ShortageLogger } from "./Shorts";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import {
  buildOperationalDayContext,
  countLoaded,
  countUnloadedFromContext,
  effectiveOperationalStatus,
  effectiveStatus,
  getOperationalTruckType,
  isScheduledOff,
} from "../utils/truckStatus";
import { PaceBar, useElapsed } from "../components/LiveInProgress";
import { ChevronDown } from "lucide-react";
import { DustGarmentIcon } from "../components/icons";
import type { TruckWithState, RecurringRouteSwap } from "../types";
import AnimateCard from "../components/AnimateCard";
import PageHeader from "../components/PageHeader";
import { motion } from "framer-motion";

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
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const { data: pace } = usePaceAverage(30);
  const [busy, setBusy] = useState<number | null>(null);
  const [statFilter, setStatFilter] = useState<"dust" | "uniform" | "spare" | "total" | null>(null);
  const [loadedSort, setLoadedSort] = useState<"number" | "order">("number");
  const [confirmLoadTruck, setConfirmLoadTruck] = useState<TruckWithState | null>(null);
  const [dustCollapsed, setDustCollapsed] = useState(() => localStorage.getItem("load:dustCollapsed") === "1");
  const [coverageCollapsed, setCoverageCollapsed] = useState(() => localStorage.getItem("load:coverageCollapsed") === "1");

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
  const { data: spareAssignments = [] } = useSpareAssignments(runDate);
  const { data: appSettings = [] } = useSettings();
  const recurringRules = useMemo<RecurringRouteSwap[]>(() => {
    const row = appSettings.find((s) => s.key === "recurring_route_swaps");
    return Array.isArray(row?.value) ? (row!.value as RecurringRouteSwap[]) : [];
  }, [appSettings]);
  const activeCoverage = useMemo(() => spareAssignments.filter((s) => !s.returned), [spareAssignments]);
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
  // Ready = unloaded and scheduled for tomorrow.
  const ready = useMemo(
    () => loadDisplayTrucks.filter((t) => t.state?.status === "unloaded" && t.state?.priority_hold !== true && t.state?.needs_checked !== true),
    [loadDisplayTrucks],
  );
  const heldReady = useMemo(
    () => loadDisplayTrucks.filter((t) => t.state?.status === "unloaded" && t.state?.priority_hold === true),
    [loadDisplayTrucks],
  );
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

  const unloadScheduleContext = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload, false),
    [board, unloadsDay, holidayUnload],
  );
  const unloadTotal = unloadScheduleContext.activeTrucks.length;
  // Count "done" from the same context as the total so a spare covering an
  // off-day route can't push the numerator above the denominator (29/28 bug).
  const unloadDone = useMemo(
    () => countUnloadedFromContext(unloadScheduleContext),
    [unloadScheduleContext],
  );
  const unloadPct = unloadTotal > 0 ? Math.round((unloadDone / unloadTotal) * 100) : 0;

  const anyInProgress = Boolean(inProgress);

  async function startLoad(t: TruckWithState) {
    if (anyInProgress) return;
    if (t.state?.priority_hold) return;
    setBusy(t.truck_number);
    try {
      const nowSec = Date.now() / 1000;
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "in_progress",
        wearers: t.state?.wearers ?? 0,
        load_start_time: nowSec,
        load_finish_time: null,
        load_duration_seconds: null,
      });
    } finally {
      setBusy(null);
    }
  }

  async function finishLoad(t: TruckWithState) {
    setBusy(t.truck_number);
    try {
      const nowSec = Date.now() / 1000;
      const startSec = t.state?.load_start_time ?? nowSec;
      const duration = Math.max(1, Math.round(nowSec - startSec));
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "loaded",
        wearers: t.state?.wearers ?? 0,
        load_finish_time: nowSec,
        load_duration_seconds: duration,
      });
      if (duration >= 30 && duration <= 7200) {
        try {
          await recordDuration.mutateAsync({
            truck_number: t.truck_number,
            run_date: runDate,
            duration_seconds: duration,
            load_day_num: t.state?.load_day_num ?? null,
          });
        } catch {
          // history append failure shouldn't block status change
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function cancelLoad(t: TruckWithState) {
    setBusy(t.truck_number);
    try {
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "unloaded",
        wearers: t.state?.wearers ?? 0,
        load_start_time: null,
        load_finish_time: null,
        load_duration_seconds: null,
      });
    } finally {
      setBusy(null);
    }
  }

  // All dust trucks — show garment checklist regardless of schedule/status
  const dustGarmentTrucks = board
    .filter((t) => t.truck_type === "Dust")
    .sort((a, b) => a.truck_number - b.truck_number);

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Load"
        subtitle="Start loading, finish routes, and track pace for the next run day."
        actions={<PaceBadge avgSeconds={pace?.avg_seconds ?? null} />}
        mobileBadge={anyInProgress ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-st-inprogress">
            <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
            Live
          </span>
        ) : undefined}
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="p-3 md:p-6 space-y-5">

      {/* Coverage notice — which route's freight loads on which truck today */}
      {activeCoverage.length > 0 && (
        <div className="rounded-xl border" style={{ borderColor: "rgba(56,189,248,0.30)", background: "rgba(56,189,248,0.07)" }}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            onClick={() => setCoverageCollapsed((c) => { const next = !c; localStorage.setItem("load:coverageCollapsed", next ? "1" : "0"); return next; })}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-sky-400">Coverage today</span>
            <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
              <span className="font-mono tabular-nums">{activeCoverage.length} route{activeCoverage.length === 1 ? "" : "s"}</span>
              <ChevronDown className={clsx("h-3.5 w-3.5 text-sky-400/60 transition-transform", coverageCollapsed && "-rotate-90")} />
            </span>
          </button>
          {!coverageCollapsed && (
            <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "rgba(56,189,248,0.20)" }}>
              <div className="flex flex-col gap-1.5">
                {activeCoverage
                  .slice()
                  .sort((a, b) => a.covering_route_truck - b.covering_route_truck)
                  .map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-sm">
                      <span className="text-base font-black text-sky-300">{s.covering_route_truck}</span>
                      <span className="text-xs text-ink-muted">loads on</span>
                      <span className="text-base font-black text-ink">{s.spare_truck_number}</span>
                      {isRecurringCoverage(s.covering_route_truck, s.spare_truck_number) && (
                        <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">recurring</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dust Garments — read-only, collapsible */}
      <div className="rounded-xl border" style={{ borderColor: "rgba(245,158,11,0.30)", background: "rgba(245,158,11,0.07)" }}>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
          onClick={() => setDustCollapsed((c) => { const next = !c; localStorage.setItem("load:dustCollapsed", next ? "1" : "0"); return next; })}
        >
          <DustGarmentIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">Dust Garments</span>
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
            {dustCollapsed && (
              <span className="font-mono tabular-nums">
                {dustGarmentTrucks.filter((t) => t.state?.has_dust_garment).length} w/ garment
              </span>
            )}
            <ChevronDown className={clsx("h-3.5 w-3.5 text-amber-400/60 transition-transform", dustCollapsed && "-rotate-90")} />
          </span>
        </button>
        {!dustCollapsed && (
          <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "rgba(245,158,11,0.20)" }}>
            {dustGarmentTrucks.length === 0 ? (
              <p className="text-xs text-ink-faint">No dust trucks scheduled.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {dustGarmentTrucks.map((t) => (
                  <span
                    key={t.truck_number}
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
                      t.state?.has_dust_garment
                        ? "border-amber-600/60 bg-amber-950/50"
                        : "border-hairline bg-surface-3",
                    )}
                    style={t.state?.has_dust_garment ? { color: "#fcd34d" } : { color: "#6f7c8e" }}
                  >
                    #{t.truck_number}
                    {t.state?.has_dust_garment && <DustGarmentIcon className="h-3 w-3" style={{ color: "#fcd34d" }} />}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* In-progress truck — top of page */}
      {inProgress && (
        <>
          <InProgressPanel
            truck={inProgress}
            paceAvgSeconds={pace?.avg_seconds ?? null}
            busy={busy === inProgress.truck_number}
            loadDay={loadDay}
            nextUp={ready[0]}
            onFinish={() => finishLoad(inProgress)}
            onCancel={() => cancelLoad(inProgress)}
          />
          <InlineShortages truck={inProgress} runDate={runDate} />
        </>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Dusts Left" value={dustsLeft} accent="#ef4444" active={statFilter === "dust"} onClick={() => setStatFilter(statFilter === "dust" ? null : "dust")} />
        <StatCard label="Uniforms Left" value={uniformsLeft} accent="#6366f1" active={statFilter === "uniform"} onClick={() => setStatFilter(statFilter === "uniform" ? null : "uniform")} />
        <StatCard label="Spares Left" value={sparesLeft} accent="#22c55e" active={statFilter === "spare"} onClick={() => setStatFilter(statFilter === "spare" ? null : "spare")} />
        <StatCard label="Total Left" value={totalLeft} accent="#dbe3ee" active={statFilter === "total"} onClick={() => setStatFilter(statFilter === "total" ? null : "total")} />
      </div>

      {/* Stat drill-down */}
      {statFilter && (() => {
        const trucks = statFilter === "dust" ? dustsLeftTrucks : statFilter === "uniform" ? uniformsLeftTrucks : statFilter === "spare" ? sparesLeftTrucks : totalLeftTrucks;
        const statusLabel: Record<string, string> = { dirty: "Dirty", unloaded: "Unloaded", in_progress: "Loading" };
        const statusColor: Record<string, string> = { dirty: "text-red-400", unloaded: "text-emerald-400", in_progress: "text-amber-400" };
        const statusBadgeColor: Record<string, string> = {
          dirty: "bg-red-950/60 text-red-300 ring-red-900/80",
          unloaded: "bg-emerald-950/60 text-emerald-300 ring-emerald-900/80",
          in_progress: "bg-amber-950/60 text-amber-300 ring-amber-900/80",
        };
        return (
          <div className="card animate-slide-down space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {statFilter === "dust" ? "Dusts" : statFilter === "uniform" ? "Uniforms" : statFilter === "spare" ? "Spares" : "All"} not yet loaded ({trucks.length})
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {trucks.map((t: (typeof totalLeftTrucks)[number]) => {
                const st = t.state?.status ?? "dirty";
                const cr = t.state?.oos_spare_route ?? t.route_swap_route ?? null;
                return (
                  <span
                    key={t.truck_number}
                    className="flex min-h-[3.35rem] items-start justify-between rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5"
                  >
                    <span className="pt-0.5 text-lg font-extrabold tracking-tight tabular-nums text-ink">
                      #{t.truck_number}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span
                        className={clsx(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ring-1",
                          statusBadgeColor[st] ?? "bg-slate-700/70 text-slate-300 ring-slate-600/80",
                        )}
                      >
                        {statusLabel[st] ?? st}
                      </span>
                      {cr != null && (
                        <span className="inline-flex items-center rounded-pill bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-300 ring-1 ring-sky-700/40">
                          Cov. #{cr}
                        </span>
                      )}
                      {t.state?.priority_hold && (
                        <span className="inline-flex items-center rounded-pill bg-red-950/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-red-300 ring-1 ring-red-900/80">
                          Hold
                        </span>
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
        <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
        <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
      </div>

      {/* On Hold */}
      {heldReady.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-st-dirty">
            On Hold ({heldReady.length})
          </h3>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]">
            {heldReady.map((t, index) => {
              return (
                <AnimateCard key={t.truck_number} delay={index * 0.03} hoverScale={1.0}>
                  <LoadWorkflowCard
                    truck={t}
                    accent="text-red-300"
                    statusLabel="HOLD"
                    statusClassName="bg-[#b91c1c] text-white"
                    footer={<span className="text-[11px] font-semibold text-st-dirty">Clear in Fleet</span>}
                    disabled
                  />
                </AnimateCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Ready to load */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-st-unloaded">
          Ready to load ({ready.length})
        </h3>
        {anyInProgress && (
          <p className="mb-2 text-xs text-st-inprogress">
            Finish the in-progress truck before starting another.
          </p>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]">
          {ready.map((t, index) => {
            const disabled = anyInProgress || busy === t.truck_number;
            return (
              <AnimateCard key={t.truck_number} delay={index * 0.03} hoverScale={1.02}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setConfirmLoadTruck(t)}
                className={clsx(
                  "w-full text-left transition-all duration-150",
                  disabled
                    ? "cursor-not-allowed opacity-50"
                    : "active:scale-[0.98]",
                )}
                title={t.state?.wearers ? `${t.state.wearers} wearers` : undefined}
              >
                <LoadWorkflowCard
                  truck={t}
                  accent="text-st-unloaded"
                  statusLabel="Unloaded"
                  statusClassName="bg-[#16a34a] text-white"
                  footer={t.state?.wearers ? <span className="text-xs text-ink-muted">{t.state.wearers} wearers</span> : null}
                  interactive={!disabled}
                  ringClassName="hover:ring-st-unloaded"
                />
              </button>
              </AnimateCard>
            );
          })}
          {ready.length === 0 && (
            <p className="col-span-full text-sm text-ink-muted">
              No trucks ready to load.
            </p>
          )}
        </div>
      </section>

      {/* Loaded today */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-st-loaded">
            Loaded today ({loaded.length})
          </h3>
          {loaded.length > 1 && (
            <div className="inline-flex overflow-hidden rounded-md border border-hairline text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setLoadedSort("number")}
                className={clsx(
                  "px-2 py-1 transition-colors",
                  loadedSort === "number"
                    ? "bg-st-loaded text-white"
                    : "bg-surface-2 text-ink-muted hover:bg-surface",
                )}
              >
                # Number
              </button>
              <button
                type="button"
                onClick={() => setLoadedSort("order")}
                className={clsx(
                  "border-l border-hairline px-2 py-1 transition-colors",
                  loadedSort === "order"
                    ? "bg-st-loaded text-white"
                    : "bg-surface-2 text-ink-muted hover:bg-surface",
                )}
              >
                Load order
              </button>
            </div>
          )}
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]">
          {loadedSorted.map((t, idx) => {
            return (
              <AnimateCard key={t.truck_number} delay={idx * 0.03}>
                <div className="relative">
                  {loadedSort === "order" && (
                    <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-surface-2 px-1 text-[10px] font-bold text-st-loaded ring-1 ring-st-loaded/60">
                      {idx + 1}
                    </span>
                  )}
                  <LoadWorkflowCard
                    truck={t}
                    accent="text-st-loaded"
                    statusLabel="Loaded"
                    statusClassName="bg-st-loaded text-white"
                    footer={t.state?.load_finish_time ? (
                      <span className="text-xs text-ink-muted">
                        Done {format(new Date(t.state.load_finish_time * 1000), "h:mm a")}
                      </span>
                    ) : null}
                    interactive
                    ringClassName="hover:ring-st-loaded"
                  />
                </div>
              </AnimateCard>
            );
          })}
          {loaded.length === 0 && (
            <p className="col-span-full text-sm text-ink-muted">Nothing loaded yet.</p>
          )}
        </div>
      </section>
      {confirmLoadTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirmLoadTruck(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold font-mono tabular-nums">Start Loading Truck #{confirmLoadTruck.truck_number}?</h3>
            <p className="mb-4 text-sm text-ink-muted">
              {anyInProgress
                ? "Another truck is already in progress. Finish it first."
                : `${confirmLoadTruck.truck_type}${confirmLoadTruck.state?.batch_id != null ? ` · Batch ${confirmLoadTruck.state.batch_id}` : ""}${confirmLoadTruck.state?.wearers ? ` · ${confirmLoadTruck.state.wearers} wearers` : ""}`}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmLoadTruck(null)}>Cancel</button>
              <button
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#16a34a" }}
                disabled={anyInProgress || busy === confirmLoadTruck.truck_number}
                onClick={() => {
                  startLoad(confirmLoadTruck);
                  setConfirmLoadTruck(null);
                }}
              >
                {busy === confirmLoadTruck.truck_number ? "Starting…" : "Start Loading"}
              </button>
            </div>
          </div>
        </div>
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

function LoadWorkflowCard({
  truck,
  accent,
  statusLabel,
  statusClassName,
  footer,
  disabled = false,
  interactive = false,
  ringClassName = "hover:ring-blue-500",
}: {
  truck: TruckWithState;
  accent: string;
  statusLabel: string;
  statusClassName: string;
  footer?: ReactNode;
  disabled?: boolean;
  interactive?: boolean;
  ringClassName?: string;
}) {
  const coverRoute = truck.state?.oos_spare_route ?? truck.route_swap_route ?? null;
  return (
    <div
      className={clsx(
        "card relative flex min-h-[4.5rem] flex-col gap-1 p-2 md:min-h-[10rem] md:gap-2 md:p-4",
        interactive && "hover:ring-2 transition-shadow",
        interactive && ringClassName,
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="flex w-full flex-col gap-0.5 md:gap-1">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex min-h-[2.5rem] flex-col justify-between gap-0.5 md:min-h-[4.5rem]">
            <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-2xl md:text-5xl", accent)}>
              {truck.truck_number}
            </span>
          </div>
          <span className="flex min-h-[1.5rem] flex-col items-end justify-start gap-1">
            <span className={clsx("badge", statusClassName)}>{statusLabel}</span>
            {truck.state?.priority_hold && statusLabel !== "HOLD" && (
              <span className="badge bg-st-dirty/25 text-st-dirty">Hold</span>
            )}
            {truck.state?.needs_checked && (
              <span className="badge bg-st-inprogress/25 text-st-inprogress">Needs Checked</span>
            )}
            {coverRoute != null && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill bg-sky-900/40 px-2 py-0.5 text-[10px] font-bold text-sky-300 ring-1 ring-sky-700/40">
                → Cov. #{coverRoute}
              </span>
            )}
            {truck.truck_type === "Dust" && truck.state?.has_dust_garment && (
              <span
                className="inline-flex items-center justify-center rounded-pill border border-st-inprogress/60 bg-st-inprogress/10 p-0.5"
                title="Dust garment"
              >
                <DustGarmentIcon className="h-3.5 w-3.5" style={{ color: "#fcd34d" }} />
              </span>
            )}
          </span>
        </div>
        <div className="text-[10px] text-ink-muted space-y-0.5 md:text-xs">
          <div>
            {truck.truck_type}
            {truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
          </div>
        </div>
      </div>
      {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
    </div>
  );
}

const LOAD_DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

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

function InProgressPanel({
  truck,
  paceAvgSeconds,
  busy,
  loadDay,
  nextUp,
  onFinish,
  onCancel,
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  busy: boolean;
  loadDay: number;
  nextUp?: TruckWithState;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const startSec = truck.state?.load_start_time ?? null;
  const elapsed = useElapsed(startSec);

  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? elapsed / paceAvgSeconds : null;
  const onPace = pct == null ? null : pct < 1;

  const timerColor =
    pct == null   ? "text-ink"
    : pct >= 1    ? "text-st-dirty"
    : pct >= 0.85 ? "text-orange-400"
    :               "text-st-inprogress";

  const paceLabel =
    paceAvgSeconds == null ? null
    : onPace
      ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
      : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;

  const paceLabelColor =
    onPace == null ? "text-ink-muted"
    : onPace       ? "text-st-unloaded"
    :                "text-st-dirty";

  return (
    <section className="overflow-hidden rounded-xl border-2" style={{ borderColor: "rgba(245,158,11,0.50)", background: "rgba(245,158,11,0.07)" }}>
      {/* Amber pulse strip */}
      <div className="h-[3px] w-full animate-pulse" style={{ background: "#f59e0b" }} />

      <div className="space-y-4 p-4">
        {/* Identity row: Current Truck | divider | Next Up */}
        <div className="flex items-start gap-4">
          {/* Current Truck */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Current Truck</div>
            <div className="font-mono font-black tabular-nums tracking-[-0.02em] text-[58px] leading-none" style={{ color: "#fbbf5c" }}>
              #{truck.truck_number}
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-st-unloaded/50 bg-st-unloaded/10 px-3 py-0.5 text-xs font-semibold text-st-unloaded">
              <span className="h-1.5 w-1.5 rounded-full bg-st-unloaded" />
              Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` · ${LOAD_DAY_NAMES[loadDay]}` : ""}
            </div>
            {truck.state?.has_dust_garment && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-st-inprogress">
                <DustGarmentIcon className="h-5 w-5" />
                Dust garment
              </div>
            )}
            {truck.state?.wearers ? (
              <div className="mt-0.5 text-xs text-ink-muted">{truck.state.wearers} wearers</div>
            ) : null}
          </div>

          <div className="w-px self-stretch bg-hairline" />

          {/* Next Up */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Next Up</div>
                {nextUp ? (
                  <>
                    <div className="font-mono font-black tabular-nums tracking-[-0.02em] text-[58px] leading-none" style={{ color: "#7dd3fc" }}>
                      #{nextUp.truck_number}
                    </div>
                    {(() => {
                      const cr = nextUp.state?.oos_spare_route ?? nextUp.route_swap_route ?? null;
                      return cr != null ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-pill bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                          Cov. #{cr}
                        </span>
                      ) : null;
                    })()}
                    {paceAvgSeconds != null && (
                      <div className="mt-1.5 text-xs text-ink-muted">
                        avg <span className="text-ink">{formatDuration(paceAvgSeconds)}</span>
                      </div>
                    )}
                  </>
                ) : (
              <div className="font-mono font-black tabular-nums tracking-[-0.02em] text-[58px] leading-none text-ink-faint">—</div>
            )}
          </div>
        </div>

        {/* Timer — centered */}
        <div className="flex flex-col items-center gap-2 py-1">
          <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", timerColor)}
            style={{ fontSize: "3.5rem" }}>
            {formatDuration(elapsed)}
          </span>
          {paceLabel && (
            <span className={clsx("text-sm font-medium", paceLabelColor)}>
              {paceLabel}
            </span>
          )}
        </div>

        {/* Full-width pace bar */}
        <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={14} />

        {/* Finish Loading — immediately below bar */}
        <button
          className="w-full rounded-xl py-4 text-lg font-bold text-white shadow transition-colors active:scale-[0.99] disabled:opacity-50"
          style={{ background: "#16a34a" }}
          disabled={busy}
          onClick={onFinish}
        >
          {busy ? "Finishing…" : "Finish Loading"}
        </button>

        {/* Cancel */}
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost"
            disabled={busy || elapsed >= 15}
            onClick={onCancel}
          >
            Cancel (back to Unloaded)
          </button>
          <span className="text-xs text-ink-muted">
            {elapsed < 15 ? `locks in ${15 - elapsed}s` : "cancel locked"}
          </span>
        </div>
      </div>
    </section>
  );
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {

    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}



