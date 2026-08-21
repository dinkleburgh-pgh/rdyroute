/**
 * Resets panel — one day reset, plus the load-time outlier purge.
 *
 * There used to be three overlapping controls here (full workday reset,
 * a four-checkbox selective reset, and the purge). The two resets existed for
 * testing and were easy to misfire: both wiped coverage and day flags, so
 * "undo the shift" also erased the setup the shift was built on. They are
 * replaced by a single "Reset day" that rewinds to how the day started.
 */
import { useState } from "react";
import { usePurgeAbnormalDurations, useResetDay } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";

export default function ResetsPanel() {
  const { user } = useAuth();
  const [runDate, setRunDate] = useState(todayIso());
  const reset = useResetDay();
  const purge = usePurgeAbnormalDurations();
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const isPrivileged =
    user?.role === "admin" || user?.role === "fleet" || user?.role === "atl" ||
    user?.role === "supervisor" || user?.role === "lead";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <p className="text-xs text-slate-400">Destructive operations for the selected run date.</p>
        <div>
          <label className="label">Run date</label>
          <input className="input" type="date" value={runDate} onChange={(e) => { setRunDate(e.target.value); setResetResult(null); setResetError(null); }} />
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Remove abnormal load times</p>
            <p className="text-xs text-slate-500">Deletes statistical outliers from load-time history used for pace averaging.</p>
            {purgeResult && <p className="mt-1 text-xs text-emerald-400">{purgeResult}</p>}
          </div>
          <button
            className="shrink-0 rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
            disabled={!isPrivileged || purge.isPending}
            onClick={() => {
              purge.mutate(undefined, {
                onSuccess: (r) => setPurgeResult(`Removed ${r.removed} record(s). ${r.remaining} remaining.`),
              });
            }}
          >
            {purge.isPending ? "Running…" : "Run now"}
          </button>
        </div>

        <div className="border-t border-slate-800 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-200">Reset day</p>
              <p className="text-xs text-slate-500">
                Puts the selected date back to how it looked right after Setup Day —
                every truck returns to its start-of-day status and the shift&apos;s work is undone.
              </p>
            </div>
            <button
              className="shrink-0 rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
              disabled={!isPrivileged || reset.isPending}
              onClick={() => {
                if (!confirm(
                  `Reset ${runDate} back to how the day started?\n\n` +
                  "Clears: truck statuses, arrival times, holds, unloading/loading progress, wearers, batches, Next Up.\n" +
                  "Keeps: coverage, holiday flags, and any shortages or audit entries logged today.\n\n" +
                  "This cannot be undone.",
                )) return;
                setResetError(null);
                reset.mutate(runDate, {
                  onSuccess: (r) => {
                    setResetResult(
                      `Day reset — ${r.states_rebuilt} truck(s) back to their start-of-day status` +
                      (r.batches_cleared > 0 ? `, ${r.batches_cleared} batch assignment(s) cleared.` : "."),
                    );
                  },
                  // The server refuses a day that hasn't started (nothing to
                  // go back to). Without this the button just did nothing.
                  onError: (err) => {
                    setResetResult(null);
                    const detail = (err as { response?: { data?: { detail?: string } } })
                      ?.response?.data?.detail;
                    setResetError(detail ?? "Couldn't reset that day — try again.");
                  },
                });
              }}
            >
              {reset.isPending ? "Resetting…" : "Reset day"}
            </button>
          </div>

          {/* Spelled out, because the old resets quietly took coverage and the
              day flags with them and people learned to fear the button. */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Cleared</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Truck statuses · arrival times · holds &amp; needs-checked · unloading and loading
                progress · wearers · batch assignments · Next Up · corrected load order
              </p>
            </div>
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Kept</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Coverage (route swaps &amp; spares) · holiday load/unload flags · Setup Day completion ·
                shortages and audit entries logged today
              </p>
            </div>
          </div>

          {resetResult && <p className="mt-2 text-xs text-emerald-400">{resetResult}</p>}
          {resetError && <p className="mt-2 text-xs font-semibold text-amber-300">{resetError}</p>}
        </div>
      </div>
    </div>
  );
}
