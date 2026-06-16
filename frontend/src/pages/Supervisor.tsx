import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  useBoard,
  useBulkUpdateStatus,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  usePaceAverage,
  useRecordLoadDuration,
  useRouteSwapLog,
  useRouteSwaps,
  useUpsertTruckState,
} from "../api/hooks";
import { todayIso } from "../api/client";
import type { TruckStatus, TruckWithState } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { effectiveStatus, isScheduledOff } from "../utils/truckStatus";
import { workdayNumbers } from "../components/Clock";
import AnimateCard from "../components/AnimateCard";

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  unfinished: "Unfinished",
  shop: "Shop",
  in_progress: "In Progress",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};

const STATUS_OPTIONS: TruckStatus[] = [
  "dirty",
  "shop",
  "in_progress",
  "unloaded",
  "loaded",
  "off",
  "oos",
  "spare",
];
// 'off' is not a valid target — off is schedule-managed, not manually set.
const STATUS_TO_OPTIONS: TruckStatus[] = STATUS_OPTIONS.filter((s) => s !== "off");

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export default function Supervisor() {
  const { user } = useAuth();
  const [runDate, setRunDate] = useState(todayIso());
  const { data: board, isLoading } = useBoard(runDate);
  const { data: pace } = usePaceAverage(30);
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const bulk = useBulkUpdateStatus();

  // OOS / route swap data
  const { data: swaps = [] } = useRouteSwaps(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: swapLog = [] } = useRouteSwapLog(60);
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const { loadDay } = workdayNumbers();

  const isPrivileged =
    user?.role === "admin" ||
    user?.role === "fleet" ||
    user?.role === "atl" ||
    user?.role === "supervisor" ||
    user?.role === "lead";

  const stuck = useMemo<TruckWithState[]>(() => {
    return (board ?? []).filter((t) => t.state?.status === "in_progress");
  }, [board]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: 0 };
    (board ?? []).forEach((t) => {
      c.total += 1;
      const s = t.state?.status ?? "dirty";
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [board]);

  // ---------------------------------------------------------------------------
  // OOS / route-card data
  // ---------------------------------------------------------------------------
  const boardByNum = useMemo(() => new Map((board ?? []).map((t) => [t.truck_number, t])), [board]);
  const swapByRoute = useMemo(() => new Map(swaps.map((s) => [s.route_truck, s])), [swaps]);
  const swapLoadOnSet = useMemo(() => new Set(swaps.map((s) => s.load_on_truck)), [swaps]);

  // All OOS trucks visible on this run date, sorted
  const oosTrucks = useMemo(() =>
    (board ?? [])
      .filter((t) =>
        t.truck_type !== "Spare" &&
        effectiveStatus(t, loadDay, holidayLoad) === "oos" &&
        (holidayLoad || !isScheduledOff(t, loadDay)),
      )
      .sort((a, b) => a.truck_number - b.truck_number),
    [board, loadDay, holidayLoad],
  );

  // Available load-on candidates: spares, off-trucks, OOS-but-covered
  const loadOnCandidates = useMemo(() => {
    const sorted = [...(board ?? [])].sort((a, b) => a.truck_number - b.truck_number);
    return {
      spares:    sorted.filter((t) => t.truck_type === "Spare"),
      off:       sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "off"),
      oosCovd:   sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swapByRoute.has(t.truck_number)),
      other:     sorted.filter((t) => t.truck_type !== "Spare" && !["off","oos"].includes(effectiveStatus(t, loadDay, holidayLoad))),
    };
  }, [board, loadDay, holidayLoad, swapByRoute]);

  // Per route_truck: last 2 distinct load_on_truck values historically
  const recentFor = useMemo(() => {
    const map = new Map<number, number[]>();
    const sorted = [...swapLog].sort(
      (a, b) => new Date(b.run_date).getTime() - new Date(a.run_date).getTime(),
    );
    for (const entry of sorted) {
      const list = map.get(entry.route_truck) ?? [];
      if (!list.includes(entry.load_on_truck)) list.push(entry.load_on_truck);
      map.set(entry.route_truck, list.slice(0, 2));
    }
    return map;
  }, [swapLog]);

  // Per-card select state for unassigned OOS trucks
  const [oosSelects, setOosSelects] = useState<Record<number, string>>({});

  // Bulk-action draft
  const [fromStatus, setFromStatus] = useState<TruckStatus>("loaded");
  const [toStatus, setToStatus] = useState<TruckStatus>("dirty");
  const candidates = useMemo(() => {
    return (board ?? []).filter((t) => (t.state?.status ?? "dirty") === fromStatus);
  }, [board, fromStatus]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
    <div className="space-y-4 p-3 md:p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Supervisor</h2>
          <p className="text-sm text-slate-400">
            Bulk actions & stuck-truck recovery for {runDate}
          </p>
        </div>
        <div>
          <label className="label">Run date</label>
          <input
            className="input"
            type="date"
            max={todayIso()}
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
          />
        </div>
      </div>

      {!isPrivileged && (
        <p className="text-xs text-amber-400">
          Bulk and force actions are admin/supervisor/lead only.
        </p>
      )}

      {isLoading && <p className="text-slate-400">Loading…</p>}

      {/* ── OOS Route Cards ─────────────────────────────────────── */}
      {oosTrucks.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              OOS Routes
            </h3>
            <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-xs font-bold text-red-300">
              {oosTrucks.length} truck{oosTrucks.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-slate-500">
              {swaps.filter((s) => oosTrucks.some((t) => t.truck_number === s.route_truck)).length} of {oosTrucks.length} covered
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {oosTrucks.map((truck, i) => {
              const swap = swapByRoute.get(truck.truck_number);
              const covered = !!swap;
              const recent = recentFor.get(truck.truck_number) ?? [];
              const selVal = oosSelects[truck.truck_number] ?? "";

              return (
                <AnimateCard
                  key={truck.truck_number}
                  className={[
                    "relative rounded-xl border p-4 transition-colors",
                    covered
                      ? "border-emerald-700/60 bg-emerald-950/30"
                      : "border-amber-700/50 bg-amber-950/20",
                  ].join(" ")}
                  delay={i * 0.08}
                >
                  {/* Card header */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-2xl font-black leading-none text-slate-100">
                        #{truck.truck_number}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
                        Out of Service
                      </p>
                    </div>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-[11px] font-bold",
                        covered
                          ? "bg-emerald-800/60 text-emerald-300"
                          : "bg-amber-800/50 text-amber-300",
                      ].join(" ")}
                    >
                      {covered ? "✓ Covered" : "Needs cover"}
                    </span>
                  </div>

                  {/* Current assignment */}
                  {covered && swap ? (
                    <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-800/50 bg-emerald-900/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Loading truck:</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                          #{swap.load_on_truck}
                        </span>
                        {boardByNum.get(swap.load_on_truck)?.truck_type === "Spare" && (
                          <span className="rounded bg-cyan-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">
                            Spare
                          </span>
                        )}
                        {swapLoadOnSet.has(swap.load_on_truck) && (
                          <span className="text-[10px] text-amber-400">also covers another route</span>
                        )}
                      </div>
                      <button
                        disabled={!isPrivileged || deleteSwap.isPending}
                        onClick={() => deleteSwap.mutate({ id: swap.id, runDate, alsoReciprocal: false })}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    /* Assignment selector */
                    <div className="mb-1 space-y-2">
                      {recent.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {recent.map((n) => {
                            const t = boardByNum.get(n);
                            const busy = swapLoadOnSet.has(n);
                            return (
                              <button
                                key={n}
                                disabled={!isPrivileged || createSwap.isPending}
                                onClick={() =>
                                  createSwap.mutate({
                                    run_date: runDate,
                                    route_truck: truck.truck_number,
                                    load_on_truck: n,
                                  })
                                }
                                className={[
                                  "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40",
                                  busy
                                    ? "border-amber-700/50 bg-amber-950/20 text-amber-300 hover:bg-amber-900/40"
                                    : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700",
                                ].join(" ")}
                                title={busy ? "Already covering a route today" : undefined}
                              >
                                ★ #{n}
                                {t?.truck_type === "Spare" ? " Spare" : ""}
                                {busy ? " ⚠" : ""}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <select
                        className="input w-full text-sm"
                        value={selVal}
                        disabled={!isPrivileged || createSwap.isPending}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOosSelects((p) => ({ ...p, [truck.truck_number]: val }));
                          if (val) {
                            createSwap.mutate(
                              { run_date: runDate, route_truck: truck.truck_number, load_on_truck: parseInt(val) },
                              { onSuccess: () => setOosSelects((p) => { const n = { ...p }; delete n[truck.truck_number]; return n; }) },
                            );
                          }
                        }}
                      >
                        <option value="">— Assign covering truck —</option>
                        {loadOnCandidates.spares.length > 0 && (
                          <optgroup label="Spare trucks">
                            {loadOnCandidates.spares.map((t) => (
                              <option key={t.truck_number} value={t.truck_number}>
                                #{t.truck_number} — Spare{swapLoadOnSet.has(t.truck_number) ? " ⚠ busy" : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {loadOnCandidates.off.length > 0 && (
                          <optgroup label="Off today">
                            {loadOnCandidates.off.map((t) => (
                              <option key={t.truck_number} value={t.truck_number}>
                                #{t.truck_number} — Off{swapLoadOnSet.has(t.truck_number) ? " ⚠ busy" : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {loadOnCandidates.oosCovd.length > 0 && (
                          <optgroup label="OOS — route covered (available driver)">
                            {loadOnCandidates.oosCovd.map((t) => (
                              <option key={t.truck_number} value={t.truck_number}>
                                #{t.truck_number} — OOS / covered
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {loadOnCandidates.other.length > 0 && (
                          <optgroup label="Route trucks">
                            {loadOnCandidates.other.map((t) => (
                              <option key={t.truck_number} value={t.truck_number}>
                                #{t.truck_number}{swapLoadOnSet.has(t.truck_number) ? " ⚠ already covering" : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  )}
                </AnimateCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Stuck trucks */}
      <AnimateCard className="card">
        <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Stuck loads ({stuck.length})
        </h3>
        {stuck.length === 0 ? (
          <p className="text-sm text-slate-500">No trucks currently in progress.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Truck</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Elapsed</th>
                <th className="px-3 py-2">vs pace</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stuck.map((t) => (
                <StuckRow
                  key={t.truck_number}
                  truck={t}
                  runDate={runDate}
                  paceSeconds={pace?.avg_seconds ?? null}
                  disabled={!isPrivileged}
                  onForceFinish={async () => {
                    const startTs = t.state?.load_start_time ?? null;
                    const dur = startTs ? Math.round(Date.now() / 1000 - startTs) : 0;
                    await upsert.mutateAsync({
                      truck_number: t.truck_number,
                      run_date: runDate,
                      status: "loaded",
                      load_finish_time: Date.now() / 1000,
                      load_duration_seconds: dur > 0 ? dur : undefined,
                    });
                    if (dur >= 30 && dur <= 7200) {
                      try {
                        await recordDuration.mutateAsync({
                          truck_number: t.truck_number,
                          run_date: runDate,
                          duration_seconds: dur,
                        });
                      } catch {
                        /* ignore duration insert failures */
                      }
                    }
                  }}
                  onCancel={() =>
                    upsert.mutate({
                      truck_number: t.truck_number,
                      run_date: runDate,
                      status: "unloaded",
                      load_start_time: null,
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
      </AnimateCard>

      {/* Bulk action */}
      <AnimateCard className="card">
        <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Bulk status change
        </h3>
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
          <div>
            <label className="label">From status</label>
            <select
              className="input"
              value={fromStatus}
              onChange={(e) => setFromStatus(e.target.value as TruckStatus)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]} ({counts[s] ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">To status</label>
            <select
              className="input"
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value as TruckStatus)}
            >
              {STATUS_TO_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-slate-400">
            {candidates.length} truck{candidates.length === 1 ? "" : "s"} will be
            updated.
          </div>
          <div>
            <button
              className="btn-primary w-full"
              disabled={
                !isPrivileged ||
                bulk.isPending ||
                candidates.length === 0 ||
                fromStatus === toStatus
              }
              onClick={() => {
                if (!candidates.length) return;
                const blocked = toStatus === "in_progress"
                  ? candidates.filter((t) => t.state?.priority_hold)
                  : [];
                const apply = blocked.length > 0
                  ? candidates.filter((t) => !t.state?.priority_hold)
                  : candidates;
                if (blocked.length > 0 && !confirm(
                  `${blocked.length} held truck(s) (#${blocked.map((t) => t.truck_number).join(", #")}) will be skipped.\n\nChange ${apply.length} truck(s) from ${STATUS_LABELS[fromStatus]} to ${STATUS_LABELS[toStatus]}?`,
                ))
                  return;
                if (blocked.length === 0 && !confirm(
                  `Change ${candidates.length} truck(s) from ${STATUS_LABELS[fromStatus]} to ${STATUS_LABELS[toStatus]}?`,
                ))
                  return;
                bulk.mutate({
                  run_date: runDate,
                  truck_numbers: apply.map((t) => t.truck_number),
                  new_status: toStatus,
                });
              }}
            >
              {bulk.isPending ? "Applying…" : "Apply bulk change"}
            </button>
          </div>
        </div>
        {candidates.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Trucks: {candidates.map((t) => `#${t.truck_number}`).join(", ")}
          </p>
        )}
      </section>
      </AnimateCard>
    </div>
    </motion.div>
  );
}

function StuckRow({
  truck,
  paceSeconds,
  disabled,
  onForceFinish,
  onCancel,
}: {
  truck: TruckWithState;
  runDate: string;
  paceSeconds: number | null;
  disabled: boolean;
  onForceFinish: () => void;
  onCancel: () => void;
}) {
  const startTs = truck.state?.load_start_time ?? null;
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = startTs ? now - startTs : 0;
  const vsPace =
    paceSeconds && startTs
      ? elapsed > paceSeconds
        ? `+${formatDuration(elapsed - paceSeconds)} over`
        : `${formatDuration(paceSeconds - elapsed)} under`
      : "—";

  const startedLabel = startTs
    ? new Date(startTs * 1000).toLocaleTimeString()
    : "—";

  return (
    <tr className="border-t border-slate-800">
      <td className="px-3 py-2 font-semibold">#{truck.truck_number}</td>
      <td className="px-3 py-2 text-slate-300">{startedLabel}</td>
      <td className="px-3 py-2 font-mono">{formatDuration(elapsed)}</td>
      <td
        className={
          "px-3 py-2 " +
          (paceSeconds && elapsed > paceSeconds
            ? "text-amber-400"
            : "text-emerald-400")
        }
      >
        {vsPace}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          className="btn-primary mr-2 text-xs"
          disabled={disabled}
          onClick={onForceFinish}
        >
          Force Finish
        </button>
        <button className="btn-ghost text-xs" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </td>
    </tr>
  );
}
