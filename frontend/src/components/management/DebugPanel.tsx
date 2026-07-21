/**
 * Debug tools — the client event log (mutations, bulk moves, API errors,
 * overflows; see utils/debugLog.ts) plus a live board-count consistency
 * readout computed from the SAME shared functions every surface uses.
 * The full offline cross-check is `npm run check:boards` in frontend/.
 */
import { useMemo, useState } from "react";
import { useBoard, useHolidayLoad, useHolidayUnload } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { workdayNumbers } from "../Clock";
import { clearDebugLog, getDebugLog } from "../../utils/debugLog";
import {
  buildOperationalDayContext,
  buildRouteStatusCounts,
  countLoaded,
  countUnloadedFromContext,
} from "../../utils/truckStatus";
import { FieldRow } from "./shared";

export default function DebugPanel() {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { loadDay, unloadsDay } = workdayNumbers();
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  const log = useMemo(() => getDebugLog().slice().reverse(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const consistency = useMemo(() => {
    const buckets = buildRouteStatusCounts(board, loadDay, holidayLoad, unloadsDay, holidayUnload);
    const loadCtx = buildOperationalDayContext(board, loadDay, holidayLoad, false);
    const unloadCtx = buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload");
    return {
      buckets: Object.entries(buckets).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join("  "),
      load: `${countLoaded(board, loadDay, holidayLoad, unloadsDay, holidayUnload)} / ${loadCtx.activeTrucks.length}`,
      unload: `${countUnloadedFromContext(unloadCtx)} / ${unloadCtx.activeTrucks.length}`,
    };
  }, [board, loadDay, unloadsDay, holidayLoad, holidayUnload]);

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(getDebugLog(), null, 1));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="card mt-4">
      <FieldRow
        label="Board consistency (live)"
        hint="Computed from the same shared counting functions every page uses. If a page shows a different number than this, that page has drifted."
      >
        <div className="space-y-1 font-mono text-xs text-slate-300">
          <div>buckets: {consistency.buckets || "—"}</div>
          <div>load bar: {consistency.load} · unload bar: {consistency.unload}</div>
          <div className="text-slate-500">run {runDate} · load day {loadDay} · unload day {unloadsDay}</div>
        </div>
      </FieldRow>
      <FieldRow
        label={`Debug log (${log.length})`}
        hint="Last 300 client events on this device: truck mutations, bulk moves, API errors, count overflows. Stored locally; Copy to share when reporting a bug."
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={() => setTick((t) => t + 1)}>Refresh</button>
            <button className="btn-ghost text-xs" onClick={copyLog}>{copied ? "Copied!" : "Copy"}</button>
            <button className="btn-danger text-xs" onClick={() => { clearDebugLog(); setTick((t) => t + 1); }}>Clear</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2 font-mono text-[11px]">
            {log.length === 0 ? (
              <p className="text-slate-500">No events yet on this device.</p>
            ) : (
              log.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-slate-500">
                    {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className={
                    e.cat === "api-error" || e.cat === "overflow"
                      ? "shrink-0 font-bold text-red-400"
                      : e.cat === "bulk"
                        ? "shrink-0 font-bold text-amber-300"
                        : "shrink-0 font-bold text-sky-300"
                  }>
                    {e.cat}
                  </span>
                  <span className="min-w-0 break-all text-slate-300">{e.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </FieldRow>
    </div>
  );
}
