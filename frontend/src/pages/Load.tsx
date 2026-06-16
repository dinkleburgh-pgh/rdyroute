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
  useUpsertTruckState,
} from "../api/hooks";
import { ShortageLogger } from "./Shorts";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import {
  buildOperationalDayContext,
  effectiveOperationalStatus,
  effectiveStatus,
  getOperationalTruckType,
} from "../utils/truckStatus";
import { PaceBar, useElapsed } from "../components/LiveInProgress";
import { DustGarmentIcon } from "../components/icons";
import type { TruckWithState } from "../types";
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

  const board = data ?? [];
  const { loadDay: computedLoadDay, unloadsDay: computedUnloadsDay } = workdayNumbers();
  const { data: loadDayOverride }    = useLoadDayOverride(runDate);
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const loadDay    = loadDayOverride    ?? computedLoadDay;
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);

  const inProgress = useMemo(
    () => board.find((t) => t.state?.status === "in_progress"),
    [board],
  );
  const loadContext = useMemo(
    () => buildOperationalDayContext(board, loadDay, holidayLoad),
    [board, loadDay, holidayLoad],
  );
  const loadDisplayTrucks = loadContext.activeTrucks;
  // Ready = unloaded and scheduled for tomorrow.
  const ready = useMemo(
    () => loadDisplayTrucks.filter((t) => t.state?.status === "unloaded" && t.state?.priority_hold !== true),
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
  const loadDone = loaded.length;
  const loadPct = loadTotal > 0 ? Math.round((loadDone / loadTotal) * 100) : 0;

  const unloadContext = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload),
    [board, unloadsDay, holidayUnload],
  );
  const unloadDone = unloadContext.activeTrucks.filter((t) =>
    ["unloaded", "loaded"].includes(effectiveOperationalStatus(t, unloadsDay, holidayUnload)),
  ).length;
  const unloadPct =
    unloadContext.activeTrucks.length > 0
      ? Math.round((unloadDone / unloadContext.activeTrucks.length) * 100)
      : 0;

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

  // Dust trucks scheduled for loading and their garment status
  const dustGarmentTrucks = board
    .filter(
      (t) =>
        t.truck_type === "Dust" &&
        !(["off", "oos"] as string[]).includes(effectiveStatus(t, loadDay, holidayLoad)) &&
        (holidayLoad || !(t.scheduled_off_days ?? []).includes(loadDay)),
    )
    .sort((a, b) => a.truck_number - b.truck_number);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="p-3 md:p-6 space-y-5">
      <PageHeader
        eyebrow="Workflow"
        title="Load"
        subtitle="Start loading, finish routes, and track pace for the next run day."
        actions={<PaceBadge avgSeconds={pace?.avg_seconds ?? null} />}
      />

      {/* Dust Garments � read-only, set from Setup Day */}
      <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <DustGarmentIcon className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">Dust Garments</span>
          <span className="ml-auto text-xs text-slate-500">Set from Setup Day</span>
        </div>
        {dustGarmentTrucks.length === 0 ? (
          <p className="text-xs text-slate-600">No dust trucks scheduled.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {dustGarmentTrucks.map((t) => (
              <span
                key={t.truck_number}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-base font-semibold",
                  t.state?.has_dust_garment
                    ? "border-amber-600/60 bg-amber-950/50 text-amber-300"
                    : "border-slate-700 bg-slate-800/60 text-slate-500",
                )}
              >
                #{t.truck_number}
                {t.state?.has_dust_garment && <DustGarmentIcon className="h-5 w-5 text-amber-300" />}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* In-progress truck � top of page */}
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
        <StatCard label="Dusts Left" value={dustsLeft} color="bg-rose-950/60 border-rose-800/60 text-rose-300" active={statFilter === "dust"} onClick={() => setStatFilter(statFilter === "dust" ? null : "dust")} />
        <StatCard label="Uniforms Left" value={uniformsLeft} color="bg-indigo-950/60 border-indigo-800/60 text-indigo-300" active={statFilter === "uniform"} onClick={() => setStatFilter(statFilter === "uniform" ? null : "uniform")} />
        <StatCard label="Spares Left" value={sparesLeft} color="bg-emerald-950/60 border-emerald-800/60 text-emerald-300" active={statFilter === "spare"} onClick={() => setStatFilter(statFilter === "spare" ? null : "spare")} />
        <StatCard label="Total Left" value={totalLeft} color="bg-slate-800/60 border-slate-600/60 text-slate-200" active={statFilter === "total"} onClick={() => setStatFilter(statFilter === "total" ? null : "total")} />
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
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {statFilter === "dust" ? "Dusts" : statFilter === "uniform" ? "Uniforms" : statFilter === "spare" ? "Spares" : "All"} not yet loaded ({trucks.length})
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {trucks.map((t: (typeof totalLeftTrucks)[number]) => {
                const st = t.state?.status ?? "dirty";
                const cr = t.state?.oos_spare_route ?? t.route_swap_route ?? null;
                return (
                  <span
                    key={t.truck_number}
                    className="flex min-h-[3.35rem] items-start justify-between rounded-lg border border-slate-700/70 bg-slate-800/80 px-2.5 py-1.5"
                  >
                    <span className="pt-0.5 text-lg font-extrabold tracking-tight tabular-nums text-slate-100">
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
                        <span className="inline-flex items-center rounded-full bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-300 ring-1 ring-sky-700/40">
                          Cov. #{cr}
                        </span>
                      )}
                      {t.state?.priority_hold && (
                        <span className="inline-flex items-center rounded-full bg-red-950/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-red-300 ring-1 ring-red-900/80">
                          Hold
                        </span>
                      )}
                    </span>
                  </span>
                );
              })}
              {trucks.length === 0 && <span className="col-span-full text-sm text-slate-500">All clear!</span>}
            </div>
          </div>
        );
      })()}

      {/* Load / Unload progress */}
      <div className="card space-y-2">
        <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} color="bg-blue-500" />
        <ProgressRow label="Unload" done={unloadDone} total={unloadContext.activeTrucks.length} pct={unloadPct} color="bg-emerald-500" />
      </div>

      {/* On Hold */}
      {heldReady.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-400">
            On Hold ({heldReady.length})
          </h3>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            {heldReady.map((t, index) => {
              return (
                <AnimateCard key={t.truck_number} delay={index * 0.03} hoverScale={1.0}>
                  <LoadWorkflowCard
                    truck={t}
                    accent="text-red-300"
                    statusLabel="HOLD"
                    statusClassName="bg-red-700 text-white"
                    footer={<span className="text-[11px] font-semibold text-red-400">Clear in Fleet</span>}
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
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-400">
          Ready to load ({ready.length})
        </h3>
        {anyInProgress && (
          <p className="mb-2 text-xs text-amber-400">
            Finish the in-progress truck before starting another.
          </p>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
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
                  accent="text-emerald-300"
                  statusLabel="Unloaded"
                  statusClassName="bg-emerald-700 text-white"
                  footer={t.state?.wearers ? <span className="text-xs text-slate-500">{t.state.wearers} wearers</span> : null}
                  interactive={!disabled}
                  ringClassName="hover:ring-emerald-500"
                />
              </button>
              </AnimateCard>
            );
          })}
          {ready.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">
              No trucks ready to load.
            </p>
          )}
        </div>
      </section>

      {/* Loaded today */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-400">
            Loaded today ({loaded.length})
          </h3>
          {loaded.length > 1 && (
            <div className="inline-flex overflow-hidden rounded-md border border-slate-700 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setLoadedSort("number")}
                className={clsx(
                  "px-2 py-1 transition-colors",
                  loadedSort === "number"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:bg-slate-800",
                )}
              >
                # Number
              </button>
              <button
                type="button"
                onClick={() => setLoadedSort("order")}
                className={clsx(
                  "border-l border-slate-700 px-2 py-1 transition-colors",
                  loadedSort === "order"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:bg-slate-800",
                )}
              >
                Load order
              </button>
            </div>
          )}
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
          {loadedSorted.map((t, idx) => {
            return (
              <AnimateCard key={t.truck_number} delay={idx * 0.03}>
                <div className="relative">
                  {loadedSort === "order" && (
                    <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-blue-300 ring-1 ring-blue-500/60">
                      {idx + 1}
                    </span>
                  )}
                  <LoadWorkflowCard
                    truck={t}
                    accent="text-sky-300"
                    statusLabel="Loaded"
                    statusClassName="bg-blue-600 text-white"
                    footer={t.state?.load_finish_time ? (
                      <span className="text-xs text-slate-500">
                        Done {format(new Date(t.state.load_finish_time * 1000), "h:mm a")}
                      </span>
                    ) : null}
                    interactive
                    ringClassName="hover:ring-blue-500"
                  />
                </div>
              </AnimateCard>
            );
          })}
          {loaded.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">Nothing loaded yet.</p>
          )}
        </div>
      </section>
      {confirmLoadTruck && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirmLoadTruck(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-base font-semibold">Start Loading Truck #{confirmLoadTruck.truck_number}?</h3>
            <p className="mb-4 text-sm text-slate-400">
              {anyInProgress
                ? "Another truck is already in progress. Finish it first."
                : `${confirmLoadTruck.truck_type}${confirmLoadTruck.state?.batch_id != null ? ` · Batch ${confirmLoadTruck.state.batch_id}` : ""}${confirmLoadTruck.state?.wearers ? ` · ${confirmLoadTruck.state.wearers} wearers` : ""}`}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmLoadTruck(null)}>Cancel</button>
              <button
                className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
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
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color, active, onClick }: { label: string; value: number; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <AnimateCard>
    <button
      type="button"
      onClick={onClick}
      className={clsx("rounded-lg border px-4 py-3 text-center transition-shadow w-full min-h-[5rem] flex flex-col items-center justify-center", color, active && "ring-2 ring-white/30")}
    >
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </button>
    </AnimateCard>
  );
}

function ProgressRow({
  label,
  done,
  total,
  pct,
  color,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
        <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-24 text-right text-xs text-slate-400">
        {done}/{total} ({pct}%)
      </span>
    </div>
  );
}

function PaceBadge({ avgSeconds }: { avgSeconds: number | null }) {
  if (avgSeconds == null) {
    return <span className="text-xs text-slate-500">No pace history</span>;
  }
  return (
    <span className="text-xs text-slate-400">
      30-day avg:{" "}
      <span className="font-semibold text-slate-200">{formatDuration(avgSeconds)}</span>
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
            <span className={clsx("font-extrabold tracking-tight tabular-nums leading-none text-2xl md:text-5xl", accent)}>
              {truck.truck_number}
            </span>
          </div>
          <span className="flex min-h-[1.5rem] flex-col items-end justify-start gap-0.5 md:min-h-[2.25rem]">
            <span className={clsx("badge", statusClassName)}>{statusLabel}</span>
            {truck.state?.priority_hold && statusLabel !== "HOLD" && (
              <span className="badge bg-red-700 text-white">Hold</span>
            )}
            {truck.state?.needs_checked && (
              <span className="badge bg-amber-700 text-white">Needs Checked</span>
            )}
            {coverRoute != null && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-900/40 px-2 py-0.5 text-[10px] font-bold text-sky-300 ring-1 ring-sky-700/40">
                → Cov. #{coverRoute}
              </span>
            )}
            {truck.truck_type === "Dust" && truck.state?.has_dust_garment && (
              <span
                className="inline-flex items-center justify-center rounded-full border border-amber-500/60 bg-amber-950/70 p-0.5"
                title="Dust garment"
              >
                <DustGarmentIcon className="h-3.5 w-3.5 text-amber-300" />
              </span>
            )}
          </span>
        </div>
        <div className="text-[10px] text-slate-400 space-y-0.5 md:text-xs">
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
    pct == null   ? "text-slate-200"
    : pct >= 1    ? "text-red-400"
    : pct >= 0.85 ? "text-orange-400"
    :               "text-amber-300";

  const paceLabel =
    paceAvgSeconds == null ? null
    : onPace
      ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
      : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;

  const paceLabelColor =
    onPace == null ? "text-slate-500"
    : onPace       ? "text-emerald-400"
    :                "text-red-400";

  return (
    <section className="overflow-hidden rounded-xl border-2 border-amber-500/50 bg-amber-950/20">
      {/* Amber pulse bar */}
      <div className="h-1 w-full animate-pulse bg-amber-500/70" />

      <div className="space-y-4 p-4">
        {/* Identity row: Current Truck | divider | Next Up */}
        <div className="flex items-start gap-4">
          {/* Current Truck */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Current Truck</div>
            <div className="font-black tabular-nums text-amber-400" style={{ fontSize: "3.5rem", lineHeight: 1 }}>
              #{truck.truck_number}
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-600/50 bg-emerald-950/40 px-3 py-0.5 text-xs font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` · ${LOAD_DAY_NAMES[loadDay]}` : ""}
            </div>
            {truck.state?.has_dust_garment && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-400">
                <DustGarmentIcon className="h-5 w-5" />
                Dust garment
              </div>
            )}
            {truck.state?.wearers ? (
              <div className="mt-0.5 text-xs text-slate-400">{truck.state.wearers} wearers</div>
            ) : null}
          </div>

          <div className="w-px self-stretch bg-slate-700/50" />

          {/* Next Up */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Next Up</div>
                {nextUp ? (
                  <>
                    <div className="font-black tabular-nums text-sky-400" style={{ fontSize: "3.5rem", lineHeight: 1 }}>
                      #{nextUp.truck_number}
                    </div>
                    {(() => {
                      const cr = nextUp.state?.oos_spare_route ?? nextUp.route_swap_route ?? null;
                      return cr != null ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                          Cov. #{cr}
                        </span>
                      ) : null;
                    })()}
                    {paceAvgSeconds != null && (
                      <div className="mt-1.5 text-xs text-slate-400">
                        avg <span className="text-slate-300">{formatDuration(paceAvgSeconds)}</span>
                      </div>
                    )}
                  </>
                ) : (
              <div className="mt-3 font-black text-slate-600" style={{ fontSize: "3.5rem", lineHeight: 1 }}>—</div>
            )}
          </div>
        </div>

        {/* Timer — centered */}
        <div className="flex flex-col items-center gap-2 py-1">
          <span className={clsx("font-mono font-black tabular-nums leading-none", timerColor)}
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
          className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow transition-colors hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-50"
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
          <span className="text-xs text-slate-500">
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



