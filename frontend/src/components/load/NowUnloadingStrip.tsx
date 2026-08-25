import clsx from "clsx";
import CoverageTag from "../CoverageTag";
import { getCoverageRouteNumber, loadNeedFor } from "../../utils/truckStatus";
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
/** The alternative action — same weight in both states of the strip. */
const ACTION_BTN =
  "min-h-[44px] rounded-lg border border-slate-600 bg-surface-2 px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50";
/** The quiet one that sits beside it (Confirm / Clear). */
const GHOST_BTN =
  "min-h-[44px] rounded-lg px-4 text-sm font-semibold text-ink-muted transition-colors hover:text-ink disabled:opacity-50";
/** The current answer, worded by the caller. */
const PILL = "rounded-md px-2.5 py-1 text-xs font-bold";

export default function NowUnloadingStrip({
  trucks,
  actions,
  board,
  loadDay,
  holidayLoad,
  dense = false,
  renderClock,
}: {
  trucks: TruckWithState[];
  actions: LoadRequestActions;
  /** Whole board + load day: the auto answer is derived, not stored. */
  board: TruckWithState[];
  loadDay: number;
  holidayLoad?: boolean;
  dense?: boolean;
  /** The page's live elapsed-time component; omitted on the dense display. */
  renderClock?: (startSec: number) => React.ReactNode;
}) {
  if (trucks.length === 0) return null;

  return (
    <div
      className={clsx(
        // Quiet by design: amber is reserved for the loading card's rule and
        // clock. This strip is reference, not an alarm.
        "rounded-[10px] border border-hairline bg-surface-3",
        dense ? "space-y-2 px-3 py-2" : "space-y-2 px-4 py-2.5",
      )}
    >
      {trucks.map((t) => {
        const req = t.state?.load_request ?? null;
        const isBusy = actions.busy === t.truck_number;
        const cov = getCoverageRouteNumber(t);
        // What the schedule already says. Shown until a person disagrees.
        const need = loadNeedFor(t, board, loadDay, holidayLoad);
        const suggested: "want" | "skip" = need.needed ? "want" : "skip";
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
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* The schedule's own answer, stated before anyone taps. Load
                    only has to touch this to disagree with it. */}
                <span
                  className={clsx(
                    PILL,
                    need.needed
                      ? "bg-emerald-600/15 text-emerald-300 ring-1 ring-emerald-600/40"
                      : "bg-slate-600/25 text-slate-200 ring-1 ring-slate-500/40",
                  )}
                >
                  {need.needed ? "Pull it forward" : "Back it out"}
                  <span className="ml-1 font-normal opacity-70">· {need.reason}</span>
                </span>
                {actions.canAct && (
                  <>
                    {/* Named plainly for the action it takes, not phrased as a
                        rebuttal — it reads the same length as Change/Clear in
                        the other state, and needs no dense variant. */}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void actions.set(t, suggested === "want" ? "skip" : "want")}
                      className={ACTION_BTN}
                    >
                      {suggested === "want" ? "Back it out" : "Pull it forward"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void actions.set(t, suggested)}
                      className={GHOST_BTN}
                      title="Tell the dock a person checked this, not just the schedule"
                    >
                      Confirm
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="ml-auto flex items-center gap-2">
                <span
                  className={clsx(
                    PILL,
                    req === "want"
                      ? "bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-600/40"
                      : "bg-slate-600/30 text-slate-200 ring-1 ring-slate-500/40",
                  )}
                >
                  {req === "want" ? "Asked to pull forward" : "Asked to back out"}
                  {t.state?.load_request_at != null &&
                    ` · ${new Date(t.state.load_request_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                </span>
                {actions.canAct && (
                  <>
                    {/* Same pairing as the auto state: the alternative action
                        first, the quiet one beside it. */}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void actions.set(t, req === "want" ? "skip" : "want")}
                      className={ACTION_BTN}
                    >
                      {req === "want" ? "Back it out" : "Pull it forward"}
                    </button>
                    {/* Clearing has to stay reachable — a mis-tap on a tablet is
                        the likeliest single failure of this whole feature. */}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void actions.set(t, null)}
                      className={GHOST_BTN}
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
