import clsx from "clsx";
import CoverageTag from "../CoverageTag";
import { DustGarmentIcon } from "../icons";
import { PaceBar, formatDuration, useElapsed } from "../LiveInProgress";
import { getCoverageRouteNumber } from "../../utils/truckStatus";
import type { TruckWithState } from "../../types";

const LOAD_DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

/**
 * The truck currently being loaded — big number, live timer, pace bar, and the
 * Finish / Cancel actions.
 *
 * Moved out of Load.tsx so the full-screen Load Display can show the SAME
 * panel rather than forking ~150 lines of timer and pace-threshold logic. It
 * stays purely presentational: every mutation belongs to the caller (see
 * hooks/useLoadActions), which is what keeps the page and the display honest.
 *
 * `variant="display"` scales the type up for reading across a dock.
 */
export default function InProgressHeroPanel({
  truck,
  paceAvgSeconds,
  busy,
  loadDay,
  nextUp,
  onFinish,
  onCancel,
  onShortSheet,
  variant = "page",
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  busy: boolean;
  loadDay: number;
  nextUp?: TruckWithState;
  onFinish: () => void;
  onCancel: () => void;
  /** Display only — opens the short-sheet drawer for this truck. */
  onShortSheet?: () => void;
  variant?: "page" | "display";
}) {
  const big = variant === "display";
  const startSec = truck.state?.load_start_time ?? null;
  const elapsed = useElapsed(startSec);

  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? elapsed / paceAvgSeconds : null;
  const onPace = pct == null ? null : pct < 1;

  const timerColor =
    pct == null   ? "text-ink"
    : pct >= 1    ? "text-st-dirty"
    : pct >= 0.85 ? "text-orange-400"
    :               "text-st-inprogress";

  const paceLabel =
    paceAvgSeconds == null ? null
    : onPace
      ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
      : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;

  const paceLabelColor =
    onPace == null ? "text-ink-muted"
    : onPace       ? "text-st-unloaded"
    :                "text-st-dirty";

  return (
    <section className="overflow-hidden rounded-xl border-2" style={{ borderColor: "rgba(245,158,11,0.50)", background: "rgba(245,158,11,0.07)" }}>
      {/* Amber pulse strip */}
      <div className="h-[3px] w-full animate-pulse" style={{ background: "#f59e0b" }} />

      <div className="space-y-4 p-4">
        {/* Identity row: Current Truck | divider | Next Up */}
        <div className="flex items-start gap-4">
          {/* Current Truck */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Current Truck</div>
            <div className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", big ? "text-[92px]" : "text-[58px]")} style={{ color: "#fbbf5c" }}>
              #{truck.truck_number}
            </div>
            {(() => {
              const cr = getCoverageRouteNumber(truck);
              return cr != null ? (
                <div className="mt-1">
                  <CoverageTag route={cr} truck={truck.truck_number} />
                </div>
              ) : null;
            })()}
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-st-unloaded/50 bg-st-unloaded/10 px-3 py-0.5 text-xs font-semibold text-st-unloaded">
              <span className="h-1.5 w-1.5 rounded-full bg-st-unloaded" />
              Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` · ${LOAD_DAY_NAMES[loadDay]}` : ""}
            </div>
            {truck.state?.has_dust_garment && (
              <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-st-inprogress">
                <DustGarmentIcon className="h-5 w-5" />
                F.S. garment
              </div>
            )}
            {truck.state?.wearers ? (
              <div className="mt-0.5 text-xs text-ink-muted">{truck.state.wearers} wearers</div>
            ) : null}
          </div>

          <div className="w-px self-stretch bg-hairline" />

          {/* Next Up */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Next Up</div>
                {nextUp ? (
                  <>
                    <div className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", big ? "text-[92px]" : "text-[58px]")} style={{ color: "#7dd3fc" }}>
                      #{nextUp.truck_number}
                    </div>
                    {(() => {
                      const cr = getCoverageRouteNumber(nextUp);
                      return cr != null ? (
                        <CoverageTag route={cr} truck={nextUp.truck_number} className="mt-1" />
                      ) : null;
                    })()}
                    {paceAvgSeconds != null && (
                      <div className="mt-1.5 text-xs text-ink-muted">
                        avg <span className="text-ink">{formatDuration(paceAvgSeconds)}</span>
                      </div>
                    )}
                  </>
                ) : (
              <div className="font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-ink-faint">—</div>
            )}
          </div>
        </div>

        {/* Timer — centered */}
        <div className="flex flex-col items-center gap-2 py-1">
          <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", timerColor)}
            style={{ fontSize: big ? "5.5rem" : "3.5rem" }}>
            {formatDuration(elapsed)}
          </span>
          {paceLabel && (
            <span className={clsx("text-sm font-medium", paceLabelColor)}>
              {paceLabel}
            </span>
          )}
        </div>

        {/* Full-width pace bar */}
        <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={14} />

        {/* Finish Loading — immediately below bar */}
        <button
          className="w-full rounded-xl py-4 text-lg font-bold text-white shadow transition-colors active:scale-[0.99] disabled:opacity-50"
          style={{ background: "#16a34a" }}
          disabled={busy}
          onClick={onFinish}
        >
          {busy ? "Finishing…" : "Finish Loading"}
        </button>

        {onShortSheet && (
          <button
            type="button"
            onClick={onShortSheet}
            className="mt-2 w-full rounded-lg border border-hairline bg-surface-2 py-3 text-base font-semibold text-ink-soft transition-colors hover:bg-surface"
          >
            Short sheet
          </button>
        )}

        {/* Cancel */}
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost"
            disabled={busy || elapsed >= 15}
            onClick={onCancel}
          >
            Cancel (back to Unloaded)
          </button>
          <span className="text-xs text-ink-muted">
            {elapsed < 15 ? `locks in ${15 - elapsed}s` : "cancel locked"}
          </span>
        </div>
      </div>
    </section>
  );
}
