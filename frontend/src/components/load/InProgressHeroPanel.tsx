import clsx from "clsx";
import { Check, Undo2 } from "lucide-react";
import { DustGarmentIcon } from "../icons";
import { PaceBar, formatDuration, useElapsed } from "../LiveInProgress";
import { truckTypeLabel } from "../../utils/truckType";
import { useLoadTimerVisible } from "../../hooks/useLoadTimerVisible";
import { CARGO_FLASH, GARMENT_FLASH_TONE, NOGS_FLASH_TONE } from "./cargoFlash";
import { BTN_GO, BTN_SECONDARY, LoadFace, ZONE, ZoneLabel, loadFace, loadFaceText } from "./loadUi";
import type { TruckWithState } from "../../types";

const LOAD_DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

/** Cargo reminders are pills that flash whole for as long as this truck is
 *  loading — exactly the window in which the garments / NOGs have to go on.
 *  (index.css: a calmer fade under "reduce motion", never a static pill.) */
const CARGO_PILL = clsx("inline-flex items-center gap-1.5 rounded-lg border font-bold", CARGO_FLASH);
const GARMENT_PILL = "border-amber-600/60 bg-amber-950/50 text-amber-300";
const NOGS_PILL = "border-rose-800/50 bg-rose-950/30 text-rose-200";

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
 *
 * The clock, pace bar, over-pace line and averages all obey the Operations
 * "Load timer" switch (useLoadTimerVisible). Hidden, the load is still timed —
 * only the display goes. The 15-second Cancel lock still reads `elapsed`; it is
 * a mis-tap guard, not a timer anyone is measured against.
 */
export default function InProgressHeroPanel({
  truck,
  paceAvgSeconds,
  busy,
  loadDay,
  nextUp,
  garment,
  nogs,
  onFinish,
  onCancel,
  onShortSheet,
  onChangeNextUp,
  onLogShortage,
  shortagesOpen = false,
  variant = "page",
  size = "md",
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  busy: boolean;
  loadDay: number;
  nextUp?: TruckWithState;
  /** Garments ride on this load. The caller resolves coverage (a spare covering
   *  an F.S. route carries that route's garments); defaults to the truck's own
   *  flag. */
  garment?: boolean;
  /** NOGs go back out on this load — resolved like `garment`. */
  nogs?: boolean;
  onFinish: () => void;
  onCancel: () => void;
  /** Display only — opens the short-sheet drawer for this truck. */
  onShortSheet?: () => void;
  /** Display only — opens the next-up picker. Rendered as a button under the
   *  Next Up number so the queue can be changed without leaving the timer.
   *  (The page shows Up next as its own zone; `nextUp` is display-only too.) */
  onChangeNextUp?: () => void;
  /** Page variant only — reveals the inline shortage logger below the card. */
  onLogShortage?: () => void;
  /** Page variant only — the logger is open, so the button reads "Hide". */
  shortagesOpen?: boolean;
  variant?: "page" | "display";
  /** Page variant only — "xl" is the Floor view: one size up across the dock. */
  size?: "md" | "xl";
}) {
  const big = variant === "display";
  const xl = size === "xl";
  const showTimer = useLoadTimerVisible();
  const startSec = truck.state?.load_start_time ?? null;
  const elapsed = useElapsed(startSec);
  const hasGarment = garment ?? truck.state?.has_dust_garment === true;
  const hasNogs = nogs ?? truck.state?.has_nogs === true;

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

  const face = loadFace(truck);

  // PAGE variant — the "Loading now" zone of the Load page's dock card. No
  // card chrome of its own (the dock card owns it) and no Next Up row: Up next
  // is its own zone directly beneath, so the queue is never shown twice. The
  // display variant below is left alone; it is read from across a dock and
  // needs the big centred type.
  if (!big) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-6">
          <div className="min-w-0 sm:min-w-[210px]">
            <ZoneLabel zone="loading" pulse>{face.onTruck != null ? "Loading route" : "Loading now"}</ZoneLabel>
            <LoadFace truck={truck} size={xl ? "xl" : "lg"} numberClass={ZONE.loading.number} className="mt-2" />
            <div className={clsx("mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-muted", xl ? "text-[14px]" : "text-[12px]")}>
              <span>{truckTypeLabel(truck.truck_type)}</span>
              <span className="text-ink-faint">·</span>
              <span>
                Load Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` — ${LOAD_DAY_NAMES[loadDay]}` : ""}
              </span>
              {truck.state?.wearers ? (
                <>
                  <span className="text-ink-faint">·</span>
                  <span>{truck.state.wearers} wearers</span>
                </>
              ) : null}
            </div>
            {(hasGarment || hasNogs) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {hasGarment && (
                  <span className={clsx(CARGO_PILL, GARMENT_PILL, "px-2 py-0.5 text-xs")} style={GARMENT_FLASH_TONE}>
                    <DustGarmentIcon className="h-4 w-4" />
                    garment
                  </span>
                )}
                {hasNogs && (
                  <span className={clsx(CARGO_PILL, NOGS_PILL, "px-2 py-0.5 text-xs")} style={NOGS_FLASH_TONE}>
                    <Undo2 className="h-4 w-4" aria-hidden />
                    NOGs
                  </span>
                )}
              </div>
            )}
          </div>
          {showTimer && (
            <>
              <div className="hidden w-px self-stretch bg-hairline sm:block" />
              <div className="flex flex-1 flex-col justify-end">
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className={clsx("font-mono font-black leading-none tracking-[-0.02em] tabular-nums", xl ? "text-[76px]" : "text-[52px]", timerColor)}>
                    {formatDuration(elapsed)}
                  </span>
                  {paceLabel && <span className={clsx(xl ? "text-sm" : "text-xs", paceLabelColor)}>{paceLabel}</span>}
                </div>
                <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={xl ? 10 : 8} />
              </div>
            </>
          )}
        </div>

        {/* Finish owns the row; the two small ones share the next on a phone. */}
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button"
            disabled={busy}
            onClick={onFinish}
            className={clsx(BTN_GO, "col-span-2 sm:flex-1", xl ? "min-h-[64px] text-[19px]" : "min-h-[52px] text-[15px]")}
          >
            <Check className="h-5 w-5" aria-hidden />
            {busy ? "Finishing…" : `Finish Loading ${loadFaceText(truck)}`}
          </button>
          {onLogShortage && (
            <button
              type="button"
              onClick={onLogShortage}
              aria-pressed={shortagesOpen}
              className={clsx(BTN_SECONDARY, xl ? "min-h-[64px] text-sm" : "min-h-[52px]", shortagesOpen && "!border-sky-600/50 !text-sky-200")}
            >
              {shortagesOpen ? "Hide shortages" : "Log shortage"}
            </button>
          )}
          {/* The 15s lock stays: it exists so a mis-tapped Start can be taken
              back without letting a real load be cancelled mid-run. */}
          <button
            type="button"
            className={clsx(BTN_SECONDARY, xl ? "min-h-[64px] text-sm" : "min-h-[52px]", !onLogShortage && "col-span-2")}
            disabled={busy || elapsed >= 15}
            onClick={onCancel}
            title={elapsed < 15 ? `Locks in ${15 - elapsed}s` : "Cancel locked — this load is under way"}
          >
            {elapsed < 15 ? `Cancel (${15 - elapsed}s)` : "Cancel locked"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border-2" style={{ borderColor: "rgba(245,158,11,0.50)", background: "rgba(245,158,11,0.07)" }}>
      {/* Amber pulse strip */}
      <div className="h-[3px] w-full animate-pulse" style={{ background: "#f59e0b" }} />

      <div className="space-y-4 p-4">
        {/* Identity row: Current Truck | divider | Next Up */}
        <div className="flex items-start gap-4">
          {/* Current Truck — or, when it covers a route, the ROUTE being loaded
              with the truck to pull up underneath (same rule as the page). */}
          <div className="flex-1 text-center">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              {face.onTruck != null ? "Loading route" : "Current Truck"}
            </div>
            <div className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", big ? "text-[92px]" : "text-[58px]")} style={{ color: "#fbbf5c" }}>
              #{face.number}
            </div>
            {face.onTruck != null && (
              <div className="mt-1 font-mono text-3xl font-black tabular-nums text-ink">
                <span className="text-base font-semibold text-ink-muted">on truck</span> #{face.onTruck}
              </div>
            )}
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-st-unloaded/50 bg-st-unloaded/10 px-3 py-0.5 text-xs font-semibold text-st-unloaded">
              <span className="h-1.5 w-1.5 rounded-full bg-st-unloaded" />
              Load Day {loadDay}{LOAD_DAY_NAMES[loadDay] ? ` · ${LOAD_DAY_NAMES[loadDay]}` : ""}
            </div>
            {(hasGarment || hasNogs) && (
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                {hasGarment && (
                  <span className={clsx(CARGO_PILL, GARMENT_PILL, "px-3 py-1 text-sm")} style={GARMENT_FLASH_TONE}>
                    <DustGarmentIcon className="h-6 w-6" />
                    F.S. garment
                  </span>
                )}
                {hasNogs && (
                  <span className={clsx(CARGO_PILL, NOGS_PILL, "px-3 py-1 text-sm")} style={NOGS_FLASH_TONE}>
                    <Undo2 className="h-6 w-6" aria-hidden />
                    NOGs
                  </span>
                )}
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
                      #{loadFace(nextUp).number}
                    </div>
                    {loadFace(nextUp).onTruck != null && (
                      <div className="mt-1 font-mono text-3xl font-black tabular-nums text-ink">
                        <span className="text-base font-semibold text-ink-muted">on truck</span> #{loadFace(nextUp).onTruck}
                      </div>
                    )}
                    {showTimer && paceAvgSeconds != null && (
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

        {showTimer && (
          <>
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
          </>
        )}

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
