import clsx from "clsx";
import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { truckTypeLabel } from "../../utils/truckType";
import {
  BTN_GO,
  BTN_LINK,
  LineSlot,
  SuggestChip,
  ZONE,
  ZoneLabel,
  loadFaceText,
  stagedStatus,
  type LoadPair,
} from "./loadUi";
import type { TruckWithState } from "../../types";

/**
 * THE DOCK — the one truck loading right now, or the empty dock with the
 * queued truck's Start button.
 *
 * Two variants, one per Load view (hooks/useLoadLayout):
 *   dock  — the loading zone only; the yard (YardQueue) holds everything
 *           not yet loading, in the order it will go.
 *   zones — the classic card: Loading now over an Up next · Staged strip,
 *           so the crew's next two moves sit under the timer.
 *
 * Presentational: `loading` is the InProgressHeroPanel the page builds;
 * every write goes through the caller.
 */
type Common = {
  /** The Loading-now zone (InProgressHeroPanel), or null when the dock is free. */
  loading: ReactNode | null;
  /** The explicitly queued truck — never a fallback guess. */
  nextUp: TruckWithState | null;
  /** Trucks in the line (queued + staged) — only steers the idle hint. */
  lineCount: number;
  readyCount: number;
  busyTruck: number | null;
  /** False while a truck is loading (one at a time). */
  canStart: boolean;
  onStart: (t: TruckWithState) => void;
  /** "xl" = the Floor view: the zones one size up (the hero sizes itself). */
  size?: "md" | "xl";
};

type Props =
  | ({ variant: "dock" } & Common)
  | ({
      variant: "zones";
      /** The staging lane in pull-up order, minus the Up-next truck. */
      staged: TruckWithState[];
      suggestions: number[];
      pairOf: (t: TruckWithState) => LoadPair;
      onTruck: (t: TruckWithState) => void;
      onPickNextUp: () => void;
      onSuggest: (truckNumber: number) => void;
    } & Common);

export default function DockCard(p: Props) {
  const { loading, nextUp, lineCount, readyCount, busyTruck, canStart, onStart } = p;
  const where = p.variant === "zones" ? "below" : "in the yard";
  const idleHint = nextUp
    ? `${loadFaceText(nextUp)} is up next — start it when the dock is ready.`
    : lineCount > 0
      ? `Tap a staged truck ${where} to start it, or queue one up next.`
      : readyCount > 0
        ? `Tap a ready truck ${where} to start, stage, or queue it.`
        : "Nothing is ready to load yet.";

  return (
    // A size container: in the zones variant, Up next and Staged sit side by
    // side only when THIS card is wide, not the viewport.
    <section className={clsx("card overflow-hidden !p-0 [container-type:inline-size]", loading && "ring-1 ring-st-inprogress/25")}>
      {/* The one amber rule on the page — it only moves while a truck loads. */}
      <div className={clsx("h-[3px] w-full", loading ? "animate-pulse bg-st-inprogress" : "bg-track")} />
      <div className="px-4 py-4 sm:px-[22px] sm:py-[18px]">
        {loading ?? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="min-w-0 flex-1">
              <ZoneLabel zone="loading" muted>Loading now</ZoneLabel>
              <p className="mt-1.5 text-xl font-bold text-ink">Nothing loading</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">{idleHint}</p>
            </div>
            {nextUp && (
              <button
                type="button"
                disabled={!canStart || busyTruck === nextUp.truck_number}
                onClick={() => onStart(nextUp)}
                className={clsx(BTN_GO, "min-h-[52px] w-full text-[15px] sm:w-auto")}
              >
                <Play className="h-4 w-4 fill-current" aria-hidden />
                {busyTruck === nextUp.truck_number ? "Starting…" : `Start Loading ${loadFaceText(nextUp)}`}
              </button>
            )}
          </div>
        )}
      </div>

      {p.variant === "zones" && <Zones {...p} />}
    </section>
  );
}

/** The classic Up next · Staged strip under the loading zone. */
function Zones({
  nextUp,
  staged,
  suggestions,
  busyTruck,
  pairOf,
  onTruck,
  onPickNextUp,
  onSuggest,
  size = "md",
}: Extract<Props, { variant: "zones" }>) {
  const slotSize = size === "xl" ? "lg" : "md";
  // With nothing queued, the lane's front truck is the obvious next pick —
  // offered first, ahead of the history suggestions.
  const laneFirst = nextUp
    ? null
    : staged.find((t) => t.state?.status === "unloaded" && t.state?.priority_hold !== true) ?? null;

  return (
    <div className="grid items-start border-t border-hairline bg-surface-3/60 [@container(min-width:760px)]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="px-4 py-3.5 sm:px-[22px]">
        <div className="mb-2.5 flex min-h-[26px] items-center justify-between gap-2">
          <ZoneLabel zone="next">Up next</ZoneLabel>
          <button type="button" onClick={onPickNextUp} className={BTN_LINK}>
            {nextUp ? "Change" : "Choose"}
          </button>
        </div>
        {nextUp ? (
          <LineSlot
            truck={nextUp}
            zone="next"
            size={slotSize}
            pair={pairOf(nextUp)}
            dotClass={ZONE.next.dot}
            disabled={busyTruck === nextUp.truck_number}
            onClick={() => onTruck(nextUp)}
            sub={
              <>
                {truckTypeLabel(nextUp.truck_type)}
                {nextUp.state?.wearers ? ` · ${nextUp.state.wearers} wearers` : ""}
                {nextUp.state?.staged_at != null ? " · in the lane" : ""}
              </>
            }
          />
        ) : (
          <div className="flex min-h-[76px] flex-col justify-center gap-2 rounded-[10px] border border-dashed border-sky-500/25 px-3.5 py-3">
            <span className="text-[13px] text-ink-muted">Nothing queued.</span>
            {(laneFirst || suggestions.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-faint">Queue:</span>
                {laneFirst && <SuggestChip n={laneFirst.truck_number} note="1st in lane" onPick={onSuggest} />}
                {suggestions.map((n) => (
                  <SuggestChip key={n} n={n} note="usually next" onPick={onSuggest} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="self-stretch border-t border-hairline px-4 py-3.5 sm:px-[22px] [@container(min-width:760px)]:border-l [@container(min-width:760px)]:border-t-0">
        <div className="mb-2.5 flex min-h-[26px] items-center justify-between gap-2">
          <ZoneLabel zone="staged" count={staged.length}>Staged</ZoneLabel>
          {staged.length > 1 && <span className="text-[11px] text-ink-faint">in pull-up order</span>}
        </div>
        {staged.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
            {staged.map((t, i) => {
              const s = stagedStatus(t);
              return (
                <LineSlot
                  key={t.truck_number}
                  truck={t}
                  zone="staged"
                  size={slotSize}
                  position={i + 1}
                  pair={pairOf(t)}
                  sub={s.label}
                  dotClass={s.dot}
                  disabled={busyTruck === t.truck_number}
                  onClick={() => onTruck(t)}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[76px] items-center rounded-[10px] border border-dashed border-hairline px-3.5 py-3 text-[13px] text-ink-muted">
            Lane is empty — tap a ready truck and choose Stage.
          </div>
        )}
      </div>
    </div>
  );
}
