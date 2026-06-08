/**
 * Bulk Status Panel — move all trucks from one status to another for today's run date.
 * Lives in the Fleet card (Operations > Fleet > Bulk Status tab).
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import { useBoard, useBulkUpdateStatus } from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { todayIso } from "../../api/client";
import ConfirmDialog from "../ConfirmDialog";
import type { TruckStatus } from "../../types";

const STATUSES: TruckStatus[] = [
  "dirty", "unfinished", "shop", "in_progress", "unloaded", "loaded", "off", "oos", "spare",
];

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty", unfinished: "Unfinished", shop: "Shop", in_progress: "In Progress",
  unloaded: "Unloaded", loaded: "Loaded", off: "Off", oos: "OOS", spare: "Spare",
};

const STATUS_COLOR: Record<TruckStatus, { bg: string; text: string; ring: string }> = {
  dirty:       { bg: "bg-red-950/60",    text: "text-red-300",    ring: "ring-red-700/60" },
  unfinished:  { bg: "bg-fuchsia-950/60",text: "text-fuchsia-300",ring: "ring-fuchsia-700/60" },
  shop:        { bg: "bg-violet-950/60", text: "text-violet-300", ring: "ring-violet-700/60" },
  in_progress: { bg: "bg-amber-950/60",  text: "text-amber-300",  ring: "ring-amber-700/60" },
  unloaded:    { bg: "bg-green-950/60",  text: "text-green-300",  ring: "ring-green-700/60" },
  loaded:      { bg: "bg-blue-950/60",   text: "text-blue-300",   ring: "ring-blue-700/60" },
  off:         { bg: "bg-slate-800/80",  text: "text-slate-400",  ring: "ring-slate-600/60" },
  oos:         { bg: "bg-slate-800/80",  text: "text-slate-400",  ring: "ring-slate-600/60" },
  spare:       { bg: "bg-cyan-950/60",   text: "text-cyan-300",   ring: "ring-cyan-700/60" },
};

export default function BulkStatusPanel() {
  const { user } = useAuth();
  const runDate = todayIso();
  const { data: board, isLoading } = useBoard(runDate);
  const bulk = useBulkUpdateStatus();

  const [fromStatus, setFromStatus] = useState<TruckStatus | null>(null);
  const [toStatus,   setToStatus]   = useState<TruckStatus | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isPrivileged =
    user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor" ||
    user?.role === "lead"  || user?.role === "atl";

  const counts = useMemo(() => {
    const c: Partial<Record<TruckStatus, number>> = {};
    for (const t of board ?? []) {
      const s = (t.state?.status ?? "dirty") as TruckStatus;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [board]);

  const candidates = useMemo(
    () => (board ?? []).filter((t) => (t.state?.status ?? "dirty") === fromStatus),
    [board, fromStatus],
  );

  function handleApply() {
    if (!fromStatus || !toStatus || !candidates.length) return;
    bulk.mutate(
      { run_date: runDate, truck_numbers: candidates.map((t) => t.truck_number), new_status: toStatus },
      {
        onSuccess: () => {
          setFromStatus(null);
          setToStatus(null);
          setConfirmOpen(false);
        },
        onError: () => setConfirmOpen(false),
      },
    );
  }

  const readyToApply = fromStatus && toStatus && fromStatus !== toStatus && candidates.length > 0;

  if (isLoading) return <p className="text-sm text-slate-500">Loading board…</p>;

  return (
    <div className="space-y-6">
      {!isPrivileged && (
        <p className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-400">
          Bulk status changes are restricted to admin / fleet / supervisor / lead / atl roles.
        </p>
      )}

      <p className="text-xs text-slate-400">
        Move all trucks currently in one status to another. Select a source status, then a target.
      </p>

      {/* Step 1 — pick FROM status */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          1. Select source status
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {STATUSES.map((s) => {
            const count = counts[s] ?? 0;
            const col = STATUS_COLOR[s];
            const isSelected = fromStatus === s;
            return (
              <button
                key={s}
                disabled={!isPrivileged || count === 0}
                onClick={() => {
                  setFromStatus(isSelected ? null : s);
                  setToStatus(null);
                }}
                className={clsx(
                  "flex flex-col items-center rounded-xl border px-3 py-3 text-center transition-all disabled:opacity-40",
                  col.bg, col.ring,
                  isSelected
                    ? `ring-2 ${col.ring} brightness-125`
                    : "hover:brightness-110",
                  count === 0 && "cursor-not-allowed",
                )}
              >
                <span className={clsx("text-2xl font-black tabular-nums leading-none", col.text)}>
                  {count}
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {STATUS_LABELS[s]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2 — pick TO status (only shown once source is selected) */}
      {fromStatus && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            2. Move{" "}
            <span className={clsx("font-black", STATUS_COLOR[fromStatus].text)}>
              {candidates.length} {STATUS_LABELS[fromStatus]}
            </span>{" "}
            truck{candidates.length !== 1 ? "s" : ""} to…
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {STATUSES.filter((s) => s !== fromStatus).map((s) => {
              const col = STATUS_COLOR[s];
              const isSelected = toStatus === s;
              return (
                <button
                  key={s}
                  disabled={!isPrivileged}
                  onClick={() => setToStatus(isSelected ? null : s)}
                  className={clsx(
                    "flex flex-col items-center rounded-xl border px-3 py-3 text-center transition-all disabled:opacity-40",
                    col.bg, col.ring,
                    isSelected
                      ? `ring-2 ${col.ring} brightness-125`
                      : "hover:brightness-110",
                  )}
                >
                  <span className={clsx("text-base font-bold uppercase tracking-wide", col.text)}>
                    {STATUS_LABELS[s]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Apply button */}
      {readyToApply && (
        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={!isPrivileged || bulk.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {bulk.isPending ? "Applying…" : `Move ${candidates.length} truck${candidates.length !== 1 ? "s" : ""} → ${STATUS_LABELS[toStatus!]}`}
          </button>
          <button className="btn-ghost text-sm" onClick={() => { setFromStatus(null); setToStatus(null); }}>
            Clear
          </button>
        </div>
      )}

      {fromStatus && toStatus && candidates.length > 0 && (
        <p className="text-xs text-slate-500">
          Trucks: {candidates.map((t) => `#${t.truck_number}`).join(", ")}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Move ${candidates.length} truck${candidates.length !== 1 ? "s" : ""} to ${STATUS_LABELS[toStatus!] ?? ""}?`}
        description={`All ${STATUS_LABELS[fromStatus!] ?? ""} trucks will be changed to ${STATUS_LABELS[toStatus!] ?? ""} for ${runDate}. This cannot be undone.`}
        confirmLabel="Apply"
        variant="danger"
        busy={bulk.isPending}
        onConfirm={handleApply}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
