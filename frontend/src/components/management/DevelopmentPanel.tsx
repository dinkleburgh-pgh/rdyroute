/**
 * Development tools — day-number override for holiday runs. Extracted from Settings.tsx.
 */
import { useEffect, useState } from "react";
import { useLoadDayOverride, useSetLoadDayOverride, useSetUnloadsDayOverride, useUnloadsDayOverride } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { workdayNumbers } from "../../components/Clock";
import { FieldRow } from "./shared";

const DAY_NAMES: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" };

export default function DevelopmentPanel() {
  const [runDate, setRunDate] = useState(todayIso());
  const { data: loadOverride = null }    = useLoadDayOverride(runDate);
  const { data: unloadsOverride = null } = useUnloadsDayOverride(runDate);
  const setLoadOverride    = useSetLoadDayOverride();
  const setUnloadsOverride = useSetUnloadsDayOverride();
  const [draftLoad, setDraftLoad]       = useState("");
  const [draftUnloads, setDraftUnloads] = useState("");

  useEffect(() => {
    setDraftLoad(loadOverride    != null ? String(loadOverride)    : "");
    setDraftUnloads(unloadsOverride != null ? String(unloadsOverride) : "");
  }, [loadOverride, unloadsOverride, runDate]);

  const [yr, mo, dy] = runDate.split("-").map(Number);
  const computedNums = workdayNumbers(new Date(yr, mo - 1, dy, 12));
  const isPending = setLoadOverride.isPending || setUnloadsOverride.isPending;
  const hasActive = loadOverride != null || unloadsOverride != null;

  function apply() {
    const ld = parseInt(draftLoad,   10);
    const ud = parseInt(draftUnloads, 10);
    if (draftLoad    !== "" && ld >= 1 && ld <= 5) setLoadOverride.mutate({    runDate, value: ld });
    if (draftUnloads !== "" && ud >= 1 && ud <= 5) setUnloadsOverride.mutate({ runDate, value: ud });
  }

  function clearAll() {
    setLoadOverride.mutate({    runDate, value: null });
    setUnloadsOverride.mutate({ runDate, value: null });
    setDraftLoad("");
    setDraftUnloads("");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
        ⚠ These tools override the route-day logic used by Run Day, Load, and Unload pages.
        Only apply overrides during holiday runs when the system is computing the wrong day.
        Clear them once the holiday run is complete.
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">Day Number Override</h3>
        <p className="text-xs text-slate-500">
          Overrides the load-day and unloads-day numbers used to filter which trucks appear on the
          Run Day, Load, and Unload pages.
        </p>

        <FieldRow label="Run date">
          <input type="date" className="input" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
        </FieldRow>

        <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-800/50 p-3 text-sm">
          <div>
            <p className="mb-1 text-xs text-slate-500">Computed load day</p>
            <p className="font-semibold text-white">{DAY_NAMES[computedNums.loadDay]} ({computedNums.loadDay})</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Computed unloads day</p>
            <p className="font-semibold text-white">{DAY_NAMES[computedNums.unloadsDay]} ({computedNums.unloadsDay})</p>
          </div>
        </div>

        {hasActive && (
          <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-3 py-2 text-xs text-amber-300">
            Overrides active for {runDate}
            {loadOverride    != null && ` · Load → ${DAY_NAMES[loadOverride]} (${loadOverride})`}
            {unloadsOverride != null && ` · Unloads → ${DAY_NAMES[unloadsOverride]} (${unloadsOverride})`}
          </div>
        )}

        <FieldRow label="Override load day">
          <select className="input" value={draftLoad} onChange={(e) => setDraftLoad(e.target.value)}>
            <option value="">— no override —</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{DAY_NAMES[n]} ({n})</option>)}
          </select>
        </FieldRow>

        <FieldRow label="Override unloads day">
          <select className="input" value={draftUnloads} onChange={(e) => setDraftUnloads(e.target.value)}>
            <option value="">— no override —</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{DAY_NAMES[n]} ({n})</option>)}
          </select>
        </FieldRow>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={isPending || (draftLoad === "" && draftUnloads === "")} onClick={apply}>
            {isPending ? "Saving…" : "Apply overrides"}
          </button>
          <button className="btn-ghost" disabled={isPending || !hasActive} onClick={clearAll}>
            Clear overrides
          </button>
        </div>
      </div>
    </div>
  );
}
