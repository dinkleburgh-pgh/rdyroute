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
  onChangeNextUp,
  onLogShortage,
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
  /** Opens the next-up picker. Rendered as a button under the Next Up number
   *  so the queue can be changed without leaving the timer. */
  onChangeNextUp?: () => void;
  /** Page variant only — reveals the inline shortage logger below the card. */
  onLogShortage?: () => void;
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

  const coverRoute = getCoverageRouteNumber(truck);

  // PAGE variant — the quiet instrument card. Colour is a signal only: amber
  // on the clock and the top rule, nothing else. The display variant below is
  // left alone; it is read from across a dock and needs the big centred type.
  if (!big) {
    return (
      <section className="card overflow-hidden !p-0">
        <div className="h-[2px] w-full animate-pulse bg-st-inprogress" />
        <div className="flex flex-col gap-4 px-[22px] py-[18px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="sm:min-w-[190px]">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-ink-muted">Loading now</div>
              <div className="mt-1 font-mono text-[46px] font-black leading-none tracking-[-0.02em] tabular-nums text-ink">
                #{truck.truck_number}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
                <span>
                  Load Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` — ${LOAD_DAY_NAMES[loadDay]}` : ""}
                </span>
                {truck.state?.wearers ? <span>· {truck.state.wearers} wearers</span> : null}
                {coverRoute != null && <CoverageTag route={coverRoute} truck={truck.truck_number} />}
                {truck.state?.has_dust_garment && (
                  <span className="inline-flex items-center gap-1 text-st-inprogress">
                    <DustGarmentIcon className="h-4 w-4" />
                    garment
                  </span>
                )}
              </div>
            </div>
            <div className="hidden w-px self-stretch bg-hairline sm:block" />
            <div className="flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className={clsx("font-mono text-[46px] font-black leading-none tracking-[-0.02em] tabular-nums", timerColor)}>
                  {formatDuration(elapsed)}
                </span>
                {paceLabel && <span className={clsx("text-xs", paceLabelColor)}>{paceLabel}</span>}
              </div>
              <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={6} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface-3 px-3.5 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Next up</span>
            <span className="font-mono text-xl font-black tabular-nums text-ink-soft">
              {nextUp ? `#${nextUp.truck_number}` : "—"}
            </span>
            {nextUp && paceAvgSeconds != null && (
              <span className="text-[11px] text-ink-faint">avg {formatDuration(paceAvgSeconds)}</span>
            )}
            {nextUp && getCoverageRouteNumber(nextUp) != null && (
              <CoverageTag route={getCoverageRouteNumber(nextUp)!} truck={nextUp.truck_number} />
            )}
            {onChangeNextUp && (
              <button type="button" onClick={onChangeNextUp} className="btn-ghost ml-auto px-3 py-1 text-[11px]">
                {nextUp ? "Change" : "Set Next Up"}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={onFinish}
              className="flex-1 rounded-lg py-3.5 text-sm font-bold text-white transition-opacity disabled:opacity-50"
              style={{ background: "#15803d" }}
            >
              {busy ? "Finishing…" : `Finish Loading #${truck.truck_number}`}
            </button>
            {/* The 15s lock stays: it exists so a mis-tapped Start can be taken
                back without letting a real load be cancelled mid-run. */}
            <button
              type="button"
              className="btn-ghost px-5 py-3.5 text-xs"
              disabled={busy || elapsed >= 15}
              onClick={onCancel}
              title={elapsed < 15 ? `Locks in ${15 - elapsed}s` : "Cancel locked — this load is under way"}
            >
              {elapsed < 15 ? `Cancel (${15 - elapsed}s)` : "Cancel"}
            </button>
            {onLogShortage && (
              <button type="button" onClick={onLogShortage} className="btn-ghost px-5 py-3.5 text-xs">
                Log Shortage
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

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
              Load Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` · ${LOAD_DAY_NAMES[loadDay]}` : ""}
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
              <div className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-ink-faint", big ? "text-[92px]" : "text-[58px]")}>—</div>
            )}
            {onChangeNextUp && (
              <button
                type="button"
                onClick={onChangeNextUp}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-sky-700/50 bg-sky-950/40 px-3 py-1.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-900/50"
              >
                {nextUp ? "Change Next Up" : "Set Next Up"}
              </button>
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
