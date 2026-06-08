/**
 * Resets panel — workday reset, selective reset, purge abnormal durations.
 * Extracted from Settings.tsx. Includes SelectiveResetCard sub-component.
 */
import { useState } from "react";
import clsx from "clsx";
import { usePurgeAbnormalDurations, useResetWorkday, useSelectiveReset } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";

const SELECTIVE_ITEMS = [
  { key: "truck_states", label: "Truck states",       desc: "Clears status, load times, wearers and garments for all trucks" },
  { key: "batches",      label: "Batch assignments",  desc: "Removes all truck → batch assignments" },
  { key: "route_swaps",  label: "Route swaps",        desc: "Deletes all route swap records" },
  { key: "day_flags",    label: "Day flags",           desc: "Resets wizard, holiday load/unload, and holiday mode flags" },
] as const;
type SelectiveKey = typeof SELECTIVE_ITEMS[number]["key"];

function SelectiveResetCard({ runDate, isPrivileged }: { runDate: string; isPrivileged: boolean }) {
  const selective = useSelectiveReset();
  const [checked, setChecked] = useState<Set<SelectiveKey>>(new Set());
  const [result, setResult]   = useState<string | null>(null);

  function toggle(key: SelectiveKey) {
    setChecked((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
    setResult(null);
  }

  async function run() {
    if (checked.size === 0) return;
    const labels = SELECTIVE_ITEMS.filter((i) => checked.has(i.key)).map((i) => i.label).join(", ");
    if (!confirm(`Selectively reset [${labels}] for ${runDate}? This cannot be undone.`)) return;
    const args: Parameters<ReturnType<typeof useSelectiveReset>["mutateAsync"]>[0] = { runDate };
    for (const key of checked) (args as Record<string, unknown>)[key] = true;
    const r = await selective.mutateAsync(args);
    const cleared = (r.cleared as string[]).map((c: string) => c.replace(/_/g, " ")).join(", ");
    setResult(`Done — cleared: ${cleared || "nothing"}.`);
    setChecked(new Set());
  }

  return (
    <div className="border-t border-slate-800 pt-4 space-y-3">
      <p className="text-sm font-medium text-slate-200">Selective reset</p>
      <p className="text-xs text-slate-500">Choose exactly which components to clear for the selected date.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SELECTIVE_ITEMS.map((item) => (
          <label key={item.key} className={clsx(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
            checked.has(item.key) ? "border-red-600/60 bg-red-950/30" : "border-slate-700 bg-slate-900 hover:border-slate-600",
          )}>
            <input type="checkbox" className="mt-0.5 accent-red-500" checked={checked.has(item.key)} onChange={() => toggle(item.key)} />
            <div>
              <p className="text-xs font-semibold text-slate-200">{item.label}</p>
              <p className="text-[11px] text-slate-500">{item.desc}</p>
            </div>
          </label>
        ))}
      </div>
      {result && <p className="text-xs text-emerald-400">{result}</p>}
      <button
        className="rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
        disabled={!isPrivileged || checked.size === 0 || selective.isPending}
        onClick={run}
      >
        {selective.isPending ? "Resetting…" : `Reset selected (${checked.size})`}
      </button>
    </div>
  );
}

export default function ResetsPanel() {
  const { user } = useAuth();
  const [runDate, setRunDate] = useState(todayIso());
  const reset  = useResetWorkday();
  const purge  = usePurgeAbnormalDurations();
  const [purgeResult, setPurgeResult]   = useState<string | null>(null);
  const [resetResult, setResetResult]   = useState<string | null>(null);

  const isPrivileged =
    user?.role === "admin" || user?.role === "fleet" || user?.role === "atl" ||
    user?.role === "supervisor" || user?.role === "lead";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <p className="text-xs text-slate-400">Destructive operations for the selected run date.</p>
        <div>
          <label className="label">Run date</label>
          <input className="input" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
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

        <div className="flex items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Reset workday</p>
            <p className="text-xs text-slate-500">
              Clears all truck states, batch assignments, route swaps, and day flags
              (holiday, wizard) for the selected date. Cannot be undone.
            </p>
            {resetResult && <p className="mt-1 text-xs text-emerald-400">{resetResult}</p>}
          </div>
          <button
            className="shrink-0 rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
            disabled={!isPrivileged || reset.isPending}
            onClick={() => {
              if (!confirm(`Full reset for ${runDate}? This clears all truck states, batches, route swaps, and day flags. Cannot be undone.`)) return;
              reset.mutate(runDate, {
                onSuccess: (r) => setResetResult(`Reset complete — ${r.states_cleared} truck state(s) cleared.`),
              });
            }}
          >
            {reset.isPending ? "Resetting…" : "Reset workday"}
          </button>
        </div>

        <SelectiveResetCard runDate={runDate} isPrivileged={isPrivileged} />
      </div>
    </div>
  );
}
