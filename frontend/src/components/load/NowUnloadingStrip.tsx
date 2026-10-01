import clsx from "clsx";
import { Check } from "lucide-react";
import CoverageTag from "../CoverageTag";
import { getCoverageRouteNumber, loadNeedFor } from "../../utils/truckStatus";
import type { LoadRequestActions } from "../../hooks/useLoadRequest";
import type { LoadRequestValue } from "../../api/hooks";
import type { TruckWithState } from "../../types";
import { BTN_LINK, ZoneLabel } from "./loadUi";

/**
 * What Unload is emptying right now — and the load crew's answer to it.
 *
 * Rendered by BOTH the Load page and the full-screen Load Display, which is the
 * whole point: the display is the load crew's primary surface, and a second
 * hand-maintained copy of this strip would drift the moment either one changed.
 * `dense` drops chrome for the display (coverage tag, elapsed clock) — but
 * never the answer and never its size. The display runs at 1.5x zoom on a
 * wall, and shrinking a target there is a trap.
 *
 * The answer is ONE question with two equal choices — "Need it for tonight's
 * load?" Yes, pull it forward / No, back it out. It replaced a green pill that
 * looked like a button, a red button, and a ghost Confirm, three weights for
 * one decision. The schedule's own answer is pre-marked (dashed) until a person
 * taps: tapping it confirms it, tapping the other overrides it, and either way
 * the choice fills solid.
 *
 * The answer is ADVISORY. "Back it out" raises a flag on the dock's board;
 * it does not stop the unload, and nothing here should imply that it does —
 * which is why the status line says "sent", not "done".
 */
export default function NowUnloadingStrip({
  trucks,
  actions,
  board,
  loadDay,
  holidayLoad,
  dense = false,
  renderClock,
  onQuickStart,
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
  /** One-tap fast path: finish the unload AND start loading this truck.
   *  Load-page only (the wall display never offers it — it skips the unload
   *  crew's own confirmation, so it stays a deliberate, close-up tap). */
  onQuickStart?: (t: TruckWithState) => void;
}) {
  if (trucks.length === 0) return null;

  return (
    <section className="card overflow-hidden !p-0">
      {trucks.map((t, i) => {
        const cov = getCoverageRouteNumber(t);
        const startSec = t.state!.unloading_started_at!;
        return (
          <div
            key={t.truck_number}
            className={clsx(
              dense ? "flex items-stretch gap-4 p-3" : "px-4 py-3.5 sm:px-[22px]",
              i > 0 && "border-t border-hairline",
            )}
          >
            {dense ? (
              /* The display's square. From across the dock the one thing this
                 strip has to say is WHICH truck is coming off — so the number
                 gets a box of its own, fixed in size so it cannot stretch with
                 the answer column beside it. The start time is static text:
                 the display has no live clock here on purpose (see renderClock). */
              <div className="flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-xl border border-hairline bg-surface-3 text-center">
                <ZoneLabel zone="unloading" className="!gap-1.5 !text-[9px] !tracking-[0.12em]">Unloading</ZoneLabel>
                <span className="mt-1 font-mono text-4xl font-black leading-none tabular-nums text-ink">
                  #{t.truck_number}
                </span>
                <span className="mt-1 text-[11px] font-semibold text-ink-muted">
                  since {new Date(startSec * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <ZoneLabel zone="unloading">At the unload dock</ZoneLabel>
                <span className="font-mono text-[22px] font-black leading-none tabular-nums text-ink">
                  #{t.truck_number}
                </span>
                {cov != null && <CoverageTag route={cov} truck={t.truck_number} />}
                {renderClock && <span className="ml-auto">{renderClock(startSec)}</span>}
              </div>
            )}

            <div className={clsx(dense ? "flex min-w-0 flex-1 flex-col justify-center" : "mt-3")}>
              <LoadAnswer truck={t} actions={actions} board={board} loadDay={loadDay} holidayLoad={holidayLoad} dense={dense} />
            </div>

            {!dense && onQuickStart && (
              <button
                type="button"
                onClick={() => onQuickStart(t)}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-sky-600/50 bg-sky-900/30 px-3 py-1.5 text-xs font-bold text-sky-200 transition-colors hover:bg-sky-800/40 active:scale-95"
              >
                <Check className="h-3.5 w-3.5" />
                Unloaded — Start Loading
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

const CHOICES: { value: LoadRequestValue; label: string }[] = [
  { value: "want", label: "Yes — pull it forward" },
  { value: "skip", label: "No — back it out" },
];

/** Tone per choice: filled once a person has answered, dashed while it is
 *  only the schedule's suggestion. Pull-forward is the ready green; backing
 *  out stays neutral — it is a routine answer, not an alarm. */
const TONES: Record<LoadRequestValue, { chosen: string; suggested: string }> = {
  want: {
    chosen: "border-emerald-500/60 bg-emerald-600/25 text-emerald-100",
    suggested: "border-dashed border-emerald-500/55 bg-emerald-500/[0.06] text-emerald-200",
  },
  skip: {
    chosen: "border-slate-300/40 bg-slate-400/20 text-ink",
    suggested: "border-dashed border-slate-400/55 bg-slate-400/[0.06] text-ink-soft",
  },
};

function LoadAnswer({
  truck,
  actions,
  board,
  loadDay,
  holidayLoad,
  dense,
}: {
  truck: TruckWithState;
  actions: LoadRequestActions;
  board: TruckWithState[];
  loadDay: number;
  holidayLoad?: boolean;
  dense: boolean;
}) {
  const req = truck.state?.load_request ?? null;
  const isBusy = actions.busy === truck.truck_number;
  // What the schedule already says. Shown until a person answers.
  const need = loadNeedFor(truck, board, loadDay, holidayLoad);
  const suggested: LoadRequestValue = need.needed ? "want" : "skip";
  const sentAt =
    truck.state?.load_request_at != null
      ? new Date(truck.state.load_request_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={clsx("font-semibold text-ink", dense ? "text-base" : "text-[13px]")}>
          Need it for tonight's load?
        </span>
        <span className={clsx("text-ink-faint", dense ? "text-xs" : "text-[11.5px]")}>
          Schedule: {need.reason}
        </span>
      </div>

      <div role="radiogroup" aria-label={`Need #${truck.truck_number} for tonight's load?`} className="grid grid-cols-2 gap-2">
        {CHOICES.map((c) => {
          const chosen = req === c.value;
          const isSuggestion = req == null && suggested === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={isBusy || !actions.canAct}
              // Re-tapping the standing answer is a no-op, not a second write.
              onClick={() => { if (!chosen) void actions.set(truck, c.value); }}
              title={isSuggestion ? "The schedule's answer — tap to confirm it to the dock" : undefined}
              className={clsx(
                "flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-center font-semibold leading-tight transition-colors disabled:cursor-default",
                dense ? "text-base" : "text-sm",
                chosen ? TONES[c.value].chosen
                : isSuggestion ? TONES[c.value].suggested
                : "border-hairline bg-surface-2 text-ink-muted enabled:hover:bg-track enabled:hover:text-ink",
                isBusy && "opacity-60",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {chosen && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                {c.label}
              </span>
              {isSuggestion && (
                <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] opacity-75">Suggested</span>
              )}
            </button>
          );
        })}
      </div>

      <div className={clsx("mt-2 flex min-h-[24px] items-center justify-between gap-2", dense ? "text-xs" : "text-[11.5px]")}>
        {req == null ? (
          <span className="text-ink-faint">
            {actions.canAct
              ? "Tap to confirm the suggestion or change it — the unload dock sees your answer."
              : "Nobody from Load has answered yet."}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <Check className="h-3.5 w-3.5 text-st-unloaded" aria-hidden />
            Sent to the unload dock{sentAt ? ` · ${sentAt}` : ""}
          </span>
        )}
        {/* Clearing has to stay reachable — a mis-tap on a tablet is the
            likeliest single failure of this whole feature. */}
        {req != null && actions.canAct && (
          <button type="button" disabled={isBusy} onClick={() => void actions.set(truck, null)} className={clsx(BTN_LINK, "shrink-0")}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
