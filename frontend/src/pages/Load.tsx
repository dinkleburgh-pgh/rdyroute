import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  useBoard,
  usePaceAverage,
  useRecordLoadDuration,
  useUpsertTruckState,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import { effectiveStatus } from "../utils/truckStatus";
import type { TruckWithState } from "../types";

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
  const [dustOpen, setDustOpen] = useState(false);
  const [statFilter, setStatFilter] = useState<"dust" | "uniform" | "spare" | "total" | null>(null);

  const board = data ?? [];
  const { loadDay, unloadsDay } = workdayNumbers();

  const inProgress = useMemo(
    () => board.find((t) => t.state?.status === "in_progress"),
    [board],
  );
  // Only show trucks scheduled to run tomorrow (loadDay) — excludes trucks off tomorrow and spare-type trucks
  // unless they have a route swap assigned (in which case they're loading a swapped route).
  const ready = useMemo(
    () =>
      board.filter(
        (t) =>
          t.state?.status === "unloaded" &&
          (t.truck_type !== "Spare" || t.route_swap_route != null) &&
          !(t.scheduled_off_days ?? []).includes(loadDay),
      ),
    [board, loadDay],
  );
  const loaded = useMemo(
    () => board.filter((t) => t.state?.status === "loaded"),
    [board],
  );

  // Route-aware "not yet loaded" computation — mirrors Board/Sidebar logic.
  // Covering spares (route_swap_route set) stand in for their OOS route truck.
  const coveringSpareByRoute = useMemo(
    () =>
      new Map(
        board
          .filter((t) => t.truck_type === "Spare" && t.route_swap_route != null)
          .map((t) => [t.route_swap_route as number, t]),
      ),
    [board],
  );
  const dustsLeftTrucks = useMemo(() => {
    const result: TruckWithState[] = [];
    for (const t of board) {
      if (t.truck_type !== "Dust") continue;
      const eff = effectiveStatus(t, loadDay);
      if (eff === "loaded" || eff === "off") continue;
      if (eff === "oos") {
        const spare = coveringSpareByRoute.get(t.truck_number);
        if (spare && effectiveStatus(spare, loadDay) !== "loaded") result.push(spare);
        continue;
      }
      result.push(t);
    }
    return result;
  }, [board, loadDay, coveringSpareByRoute]);
  const uniformsLeftTrucks = useMemo(() => {
    const result: TruckWithState[] = [];
    for (const t of board) {
      if (t.truck_type !== "Uniform") continue;
      const eff = effectiveStatus(t, loadDay);
      if (eff === "loaded" || eff === "off") continue;
      if (eff === "oos") {
        const spare = coveringSpareByRoute.get(t.truck_number);
        if (spare && effectiveStatus(spare, loadDay) !== "loaded") result.push(spare);
        continue;
      }
      result.push(t);
    }
    return result;
  }, [board, loadDay, coveringSpareByRoute]);
  const dustsLeft = dustsLeftTrucks.length;
  const uniformsLeft = uniformsLeftTrucks.length;
  const sparesLeft = 0;
  const sparesLeftTrucks: typeof dustsLeftTrucks = [];
  const totalLeft = dustsLeft + uniformsLeft + sparesLeft;
  const totalLeftTrucks = useMemo(
    () => [...dustsLeftTrucks, ...uniformsLeftTrucks].sort((a, b) => a.truck_number - b.truck_number),
    [dustsLeftTrucks, uniformsLeftTrucks],
  );

  // Trucks scheduled to run today (unloadsDay) — the denominator for Unload progress.
  const scheduledForUnload = useMemo(
    () =>
      board.filter(
        (t) =>
          t.truck_type !== "Spare" &&
          !(t.scheduled_off_days ?? []).includes(unloadsDay),
      ),
    [board, unloadsDay],
  );

  // Load progress: loaded vs all scheduled for tomorrow.
  // Unload progress: past-unload (unloaded/in_progress/loaded) vs all scheduled for today.
  const loadedCount = loaded.length;
  const unloadedCount = useMemo(
    () =>
      scheduledForUnload.filter((t) =>
        ["unloaded", "in_progress", "loaded"].includes(t.state?.status ?? "dirty"),
      ).length,
    [scheduledForUnload],
  );
  const loadPct = totalLeft > 0 ? Math.round((loadedCount / totalLeft) * 100) : 0;
  const unloadPct =
    scheduledForUnload.length > 0
      ? Math.round((unloadedCount / scheduledForUnload.length) * 100)
      : 0;

  const anyInProgress = Boolean(inProgress);

  async function startLoad(t: TruckWithState) {
    if (anyInProgress) return;
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

  return (
    <div className="space-y-5 p-3 md:p-6">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-2xl font-semibold">Load</h2>
        <div className="flex items-center gap-3">
          <PaceBadge avgSeconds={pace?.avg_seconds ?? null} />
          <Link to="/audit" className="btn-ghost text-sm">Audit</Link>
        </div>
      </div>

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
        return (
          <div className="card animate-slide-down space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {statFilter === "dust" ? "Dusts" : statFilter === "uniform" ? "Uniforms" : statFilter === "spare" ? "Spares" : "All"} not yet loaded ({trucks.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {trucks.map((t: (typeof totalLeftTrucks)[number]) => {
                const st = t.state?.status ?? "dirty";
                return (
                  <span key={t.truck_number} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-sm font-semibold">
                    <span>#{t.truck_number}</span>
                    <span className={clsx("text-xs", statusColor[st] ?? "text-slate-400")}>{statusLabel[st] ?? st}</span>
                  </span>
                );
              })}
              {trucks.length === 0 && <span className="text-sm text-slate-500">All clear!</span>}
            </div>
          </div>
        );
      })()}

      {/* Load / Unload progress */}
      <div className="card space-y-2">
        <ProgressRow label="Load" done={loadedCount} total={totalLeft} pct={loadPct} color="bg-blue-500" />
        <ProgressRow label="Unload" done={unloadedCount} total={scheduledForUnload.length} pct={unloadPct} color="bg-emerald-500" />
      </div>

      {/* Set Dust Clothes */}
      <div className="card">
        <button
          type="button"
          className="flex w-full items-center justify-between text-sm font-semibold"
          onClick={() => setDustOpen((o) => !o)}
        >
          <span>Set Dust Clothes</span>
          <span className="text-slate-500">{dustOpen ? "-" : "+"}</span>
        </button>
        {dustOpen && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {board
              .filter(
                (t) =>
                  t.truck_type === "Dust" &&
                  !["off", "oos"].includes(t.state?.status ?? "dirty"),
              )
              .sort((a, b) => a.truck_number - b.truck_number)
              .map((t) => {
                const hasDust = t.state?.has_dust_garment ?? false;
                return (
                  <button
                    key={t.truck_number}
                    type="button"
                    className={clsx(
                      "rounded-md border px-3 py-2 text-center text-sm font-semibold transition-colors",
                      hasDust
                        ? "border-amber-600/60 bg-amber-950/40 text-amber-300"
                        : "border-slate-700 bg-slate-800 text-slate-400",
                    )}
                    onClick={() =>
                      upsert.mutate({
                        truck_number: t.truck_number,
                        run_date: runDate,
                        status: t.state?.status ?? "dirty",
                        wearers: t.state?.wearers ?? 0,
                        has_dust_garment: !hasDust,
                      })
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span>#{t.truck_number}</span>
                      {hasDust && <DustGarmentIcon className="h-3.5 w-3.5 text-amber-300" />}
                    </span>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* In-progress truck */}
      {inProgress && (
        <InProgressPanel
          truck={inProgress}
          paceAvgSeconds={pace?.avg_seconds ?? null}
          busy={busy === inProgress.truck_number}
          onFinish={() => finishLoad(inProgress)}
          onCancel={() => cancelLoad(inProgress)}
        />
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
        <div className="flex flex-wrap gap-2">
          {ready.map((t) => (
            <button
              key={t.truck_number}
              type="button"
              disabled={anyInProgress || busy === t.truck_number}
              onClick={() => startLoad(t)}
              className={clsx(
                "relative flex flex-col h-16 w-16 items-center justify-center rounded-xl border-b-4 text-2xl font-black text-white shadow transition active:translate-y-px select-none",
                anyInProgress || busy === t.truck_number
                  ? "cursor-not-allowed border-emerald-900 bg-emerald-900 opacity-40"
                  : "border-emerald-700 bg-emerald-600 hover:bg-emerald-500 active:border-emerald-800",
              )}
              style={{ WebkitTextStroke: "0.75px rgba(0,0,0,0.9)" }}
              title={t.state?.wearers ? `${t.state.wearers} wearers` : undefined}
            >
              {t.truck_number}
              {t.state?.has_dust_garment && (
                <span className="absolute -right-1 -top-1 rounded-full border border-amber-500/60 bg-amber-950 p-0.5">
                  <DustGarmentIcon className="h-2.5 w-2.5 text-amber-300" />
                </span>
              )}
              {t.route_swap_route != null && (
                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold text-blue-300">
                  R#{t.route_swap_route}
                </span>
              )}
            </button>
          ))}
          {ready.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">
              No trucks ready to load.
            </p>
          )}
        </div>
      </section>

      {/* Loaded today */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-400">
          Loaded today ({loaded.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {loaded.map((t) => {
            const coverRoute = t.state?.oos_spare_route ?? null;
            return (
            <div key={t.truck_number} className="group relative">
              <button
                type="button"
                disabled
                className={clsx(
                  "flex items-center justify-center rounded-xl border-b-4 border-blue-900 bg-blue-800 font-black text-white/80 shadow select-none opacity-80",
                  coverRoute != null ? "h-16 w-24 flex-col gap-0 px-1" : "h-16 w-16 text-2xl",
                )}
                style={{ WebkitTextStroke: "0.75px rgba(0,0,0,0.9)" }}
              >
                {coverRoute != null ? (
                  <>
                    <span className="text-xs font-semibold leading-none text-blue-200">Rt {coverRoute}</span>
                    <span className="text-[10px] leading-none text-blue-300/70">→</span>
                    <span className="text-base font-black leading-none">#{t.truck_number}</span>
                  </>
                ) : (
                  t.truck_number
                )}
                {t.state?.has_dust_garment && (
                  <span className="absolute -right-1 -top-1 rounded-full border border-amber-500/60 bg-amber-950 p-0.5">
                    <DustGarmentIcon className="h-2.5 w-2.5 text-amber-300" />
                  </span>
                )}
              </button>
              {(t.state?.load_start_time || t.state?.load_finish_time) && (
                <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 opacity-0 shadow-lg ring-1 ring-slate-700 transition-opacity group-hover:opacity-100">
                  {t.state?.load_start_time && (
                    <div className="text-slate-400">Start <span className="text-white">{new Date(t.state.load_start_time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
                  )}
                  {t.state?.load_finish_time && (
                    <div className="text-slate-400">Finish <span className="text-white">{new Date(t.state.load_finish_time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
                  )}
                  <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                </div>
              )}
            </div>
            );
          })}
          {loaded.length === 0 && (
            <p className="text-sm text-slate-500">Nothing loaded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color, active, onClick }: { label: string; value: number; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx("rounded-lg border px-4 py-3 text-center transition-shadow w-full", color, active && "ring-2 ring-white/30")}
    >
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </button>
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

function InProgressPanel({
  truck,
  paceAvgSeconds,
  busy,
  onFinish,
  onCancel,
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  busy: boolean;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const startSec = truck.state?.load_start_time ?? null;
  const [elapsed, setElapsed] = useState(() =>
    startSec ? Math.max(0, Math.round(Date.now() / 1000 - startSec)) : 0,
  );

  useEffect(() => {
    if (!startSec) return;
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round(Date.now() / 1000 - startSec)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startSec]);

  const paceDelta = paceAvgSeconds != null ? elapsed - paceAvgSeconds : null;
  const onPace = paceDelta == null ? null : paceDelta <= 0;

  return (
    <section className="card border-2 border-amber-500/60 bg-amber-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-amber-400">Loading in progress</div>
          <div className="text-3xl font-bold">Truck #{truck.truck_number}</div>
          {truck.state?.has_dust_garment && (
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-400">
              <DustGarmentIcon className="h-3.5 w-3.5" />
              Dust garment
            </div>
          )}
          {truck.state?.wearers ? (
            <div className="text-xs text-slate-400">{truck.state.wearers} wearers</div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl tabular-nums">{formatDuration(elapsed)}</div>
          {paceAvgSeconds != null && (
            <div className={`text-xs ${onPace ? "text-emerald-400" : "text-red-400"}`}>
              {onPace ? "on pace" : "over pace"} (avg {formatDuration(paceAvgSeconds)})
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={onFinish}>
          Finish Loading
        </button>
        <button className="btn-ghost" disabled={busy || elapsed >= 15} onClick={onCancel}>
          Cancel (back to Unloaded)
        </button>
        {elapsed < 15 && (
          <span className="text-xs text-slate-500">locks in {15 - elapsed}s</span>
        )}
        {elapsed >= 15 && (
          <span className="text-xs text-slate-500">cancel locked</span>
        )}
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

function DustGarmentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4h8l2 3-3 2v10H9V9L6 7l2-3z" />
      <path d="M10 4c0 1.1.9 2 2 2s2-.9 2-2" />
    </svg>
  );
}

