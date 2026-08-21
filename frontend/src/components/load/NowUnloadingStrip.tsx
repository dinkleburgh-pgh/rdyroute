import clsx from "clsx";
import CoverageTag from "../CoverageTag";
import { getCoverageRouteNumber } from "../../utils/truckStatus";
import type { LoadRequestActions } from "../../hooks/useLoadRequest";
import type { TruckWithState } from "../../types";

/**
 * What Unload is emptying right now — and the load crew's answer to it.
 *
 * Rendered by BOTH the Load page and the full-screen Load Display, which is the
 * whole point: the display is the load crew's primary surface, and a second
 * hand-maintained copy of this strip would drift the moment either one changed.
 * `dense` drops chrome for the display (coverage tag, elapsed clock, the
 * trailing sentence) — but never the buttons and never their size. The display
 * runs at 1.5x zoom on a wall, and shrinking a target there is a trap.
 *
 * The answer is ADVISORY. "Back out of it" raises a flag on the dock's board;
 * it does not stop the unload, and nothing here should imply that it does —
 * which is why the labels are "asked", not "told".
 */
export default function NowUnloadingStrip({
  trucks,
  actions,
  dense = false,
  renderClock,
}: {
  trucks: TruckWithState[];
  actions: LoadRequestActions;
  dense?: boolean;
  /** The page's live elapsed-time component; omitted on the dense display. */
  renderClock?: (startSec: number) => React.ReactNode;
}) {
  if (trucks.length === 0) return null;

  return (
    <div
      className={clsx(
        "card border-amber-600/40 bg-amber-950/20",
        dense ? "space-y-2 py-2" : "space-y-2 px-4 py-2.5",
      )}
    >
      {trucks.map((t) => {
        const req = t.state?.load_request ?? null;
        const isBusy = actions.busy === t.truck_number;
        const cov = getCoverageRouteNumber(t);
        return (
          <div key={t.truck_number} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
              Now unloading
            </span>
            <span className="font-mono text-lg font-black tabular-nums text-ink">
              #{t.truck_number}
            </span>
            {!dense && cov != null && <CoverageTag route={cov} truck={t.truck_number} />}
            {!dense && renderClock?.(t.state!.unloading_started_at!)}

            {req == null ? (
              actions.canAct ? (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void actions.set(t, "want")}
                    className="min-h-[44px] rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {dense ? "Pull it forward" : "We want it — pull it forward"}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void actions.set(t, "skip")}
                    className="min-h-[44px] rounded-lg border border-slate-500 bg-slate-800 px-4 text-sm font-bold text-slate-100 transition-colors hover:bg-slate-700 disabled:opacity-50"
                  >
                    {dense ? "Back out" : "Back out of it"}
                  </button>
                </div>
              ) : (
                !dense && (
                  <span className="ml-auto text-[11px] text-ink-muted">
                    Ready to load once Unload marks it done.
                  </span>
                )
              )
            ) : (
              <div className="ml-auto flex items-center gap-2">
                <span
                  className={clsx(
                    "rounded-md px-2.5 py-1 text-xs font-bold",
                    req === "want"
                      ? "bg-emerald-600/20 text-emerald-300"
                      : "bg-slate-600/30 text-slate-200",
                  )}
                >
                  {req === "want" ? "Asked to pull forward" : "Asked to back out"}
                  {t.state?.load_request_at != null &&
                    ` · ${new Date(t.state.load_request_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                </span>
                {actions.canAct && (
                  <>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void actions.set(t, req === "want" ? "skip" : "want")}
                      className="min-h-[44px] rounded-lg border border-slate-600 bg-surface-2 px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface disabled:opacity-50"
                    >
                      Change
                    </button>
                    {/* Clearing has to stay reachable — a mis-tap on a tablet is
                        the likeliest single failure of this whole feature. */}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void actions.set(t, null)}
                      className="min-h-[44px] rounded-lg px-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
