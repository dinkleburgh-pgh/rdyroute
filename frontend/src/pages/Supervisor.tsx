import { useEffect, useMemo, useState } from "react";
import {
  useBoard,
  useBulkUpdateStatus,
  usePaceAverage,
  useRecordLoadDuration,
  useUpsertTruckState,
} from "../api/hooks";
import { todayIso } from "../api/client";
import type { TruckStatus, TruckWithState } from "../types";
import { useAuth } from "../contexts/AuthContext";

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
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

  // Bulk-action draft
  const [fromStatus, setFromStatus] = useState<TruckStatus>("loaded");
  const [toStatus, setToStatus] = useState<TruckStatus>("dirty");
  const candidates = useMemo(() => {
    return (board ?? []).filter((t) => (t.state?.status ?? "dirty") === fromStatus);
  }, [board, fromStatus]);

  return (
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

      {/* Stuck trucks */}
      <section className="card">
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

      {/* Bulk action */}
      <section className="card">
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
              {STATUS_OPTIONS.map((s) => (
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
                if (
                  !confirm(
                    `Change ${candidates.length} truck(s) from ${STATUS_LABELS[fromStatus]} to ${STATUS_LABELS[toStatus]}?`,
                  )
                )
                  return;
                bulk.mutate({
                  run_date: runDate,
                  truck_numbers: candidates.map((t) => t.truck_number),
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
    </div>
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
