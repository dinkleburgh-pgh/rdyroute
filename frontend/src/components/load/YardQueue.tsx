import clsx from "clsx";
import { Play } from "lucide-react";
import EmptyState from "../EmptyState";
import { QuietTile, SectionHeader, TILE_GRID, TILE_GRID_LG } from "../workflow/QuietTile";
import { truckTypeLabel } from "../../utils/truckType";
import {
  BTN_GO,
  BTN_LINK,
  LineSlot,
  NotReadyChip,
  SuggestChip,
  ZONE,
  stagedStatus,
  type LoadPair,
} from "./loadUi";
import type { TruckWithState } from "../../types";

/**
 * THE YARD — everything not yet loading, as one line in the order it will go:
 * ① the queued truck (with its Start button), ②… the staging lane in pull-up
 * order, then the Ready grid, then what's not ready yet. Order is the layout,
 * so "what's next" is never a question.
 *
 * Rendered by the Load page AND the full-screen display (`dense`): the
 * display used to show its own ready grid, which is how the two surfaces
 * disagreed about the queue. In dense mode a tap starts the truck (the
 * display has no chooser), and the queue-suggestion chips are left out.
 *
 * Presentational: every write goes through the caller.
 */
export default function YardQueue({
  nextUp,
  staged,
  ready,
  held,
  unfinished,
  suggestions,
  busyTruck,
  canStart,
  readyFocus,
  pairOf,
  onTruck,
  onStart,
  onPickNextUp,
  onSuggest,
  dense = false,
}: {
  /** The explicitly queued truck — never a fallback guess. */
  nextUp: TruckWithState | null;
  /** The staging lane in pull-up order, minus the Up-next truck. */
  staged: TruckWithState[];
  /** Ready trucks not already in the line. */
  ready: TruckWithState[];
  held: TruckWithState[];
  unfinished: TruckWithState[];
  /** "Usually next" truck numbers, offered when nothing is queued. */
  suggestions: number[];
  busyTruck: number | null;
  /** False while a truck is loading (one at a time). */
  canStart: boolean;
  /** Few ready trucks → big tiles, readable across the dock. */
  readyFocus: boolean;
  pairOf: (t: TruckWithState) => LoadPair;
  /** Tap on a truck: the chooser on the page, Start on the display. */
  onTruck: (t: TruckWithState) => void;
  onStart: (t: TruckWithState) => void;
  onPickNextUp: () => void;
  onSuggest?: (truckNumber: number) => void;
  dense?: boolean;
}) {
  const inLine = (nextUp ? 1 : 0) + staged.length;
  // With nothing queued, the lane's front truck is the obvious next pick —
  // offered first, ahead of the history suggestions.
  const laneFirst = nextUp
    ? null
    : staged.find((t) => t.state?.status === "unloaded" && t.state?.priority_hold !== true) ?? null;
  const canStartNext = nextUp != null && canStart && busyTruck !== nextUp.truck_number;

  return (
    <section className="card flex flex-col gap-[18px]">
      {/* ---------------- The line ---------------- */}
      <div>
        <SectionHeader
          label="The yard"
          count={inLine}
          hint={inLine > 0 ? "in the order they'll go" : undefined}
        >
          <button type="button" onClick={onPickNextUp} className={BTN_LINK}>
            {nextUp ? "Change up next" : "Choose up next"}
          </button>
        </SectionHeader>
        <ol className="flex flex-col gap-2">
          {nextUp ? (
            <li>
              <LineSlot
                truck={nextUp}
                zone="next"
                position={1}
                pair={pairOf(nextUp)}
                dotClass={ZONE.next.dot}
                onClick={() => onTruck(nextUp)}
                sub={
                  <>
                    Up next · {truckTypeLabel(nextUp.truck_type)}
                    {nextUp.state?.wearers ? ` · ${nextUp.state.wearers} wearers` : ""}
                    {nextUp.state?.staged_at != null ? " · in the lane" : ""}
                  </>
                }
                action={
                  <button
                    type="button"
                    disabled={!canStartNext}
                    onClick={() => onStart(nextUp)}
                    title={canStart ? undefined : "Finish the loading truck first"}
                    className={clsx(BTN_GO, "min-h-[44px] shrink-0 px-4 text-[13px]")}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                    {busyTruck === nextUp.truck_number ? "Starting…" : "Start"}
                  </button>
                }
              />
            </li>
          ) : (
            <li className="flex min-h-[64px] flex-col justify-center gap-2 rounded-[10px] border border-dashed border-sky-500/25 px-3.5 py-3">
              <span className="text-[13px] text-ink-muted">
                Nothing queued up next{dense ? "." : " — tap a truck and choose Put Up next."}
              </span>
              {!dense && onSuggest && (laneFirst || suggestions.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-ink-faint">Queue:</span>
                  {laneFirst && <SuggestChip n={laneFirst.truck_number} note="1st in lane" onPick={onSuggest} />}
                  {suggestions.map((n) => (
                    <SuggestChip key={n} n={n} note="usually next" onPick={onSuggest} />
                  ))}
                </div>
              )}
            </li>
          )}
          {staged.map((t, i) => {
            const s = stagedStatus(t);
            return (
              <li key={t.truck_number}>
                <LineSlot
                  truck={t}
                  zone="staged"
                  position={(nextUp ? 1 : 0) + i + 1}
                  pair={pairOf(t)}
                  sub={s.label}
                  dotClass={s.dot}
                  disabled={busyTruck === t.truck_number}
                  onClick={() => onTruck(t)}
                />
              </li>
            );
          })}
        </ol>
      </div>

      {/* ---------------- Ready ---------------- */}
      <div>
        <SectionHeader
          label="Ready"
          count={ready.length}
          hint={
            ready.length === 0 ? undefined
            : dense ? "tap to start"
            : "tap to start, stage, or queue"
          }
        />
        <div className={readyFocus ? TILE_GRID_LG : TILE_GRID}>
          {ready.map((t) => (
            <QuietTile
              key={t.truck_number}
              truck={t}
              size={readyFocus ? "lg" : "md"}
              disabled={busyTruck === t.truck_number}
              onClick={() => onTruck(t)}
              title={t.state?.wearers ? `${t.state.wearers} wearers` : undefined}
              numberClass={t.truck_type === "Spare" ? "text-st-spare" : "text-st-unloaded"}
              dotClass={t.truck_type === "Spare" ? "bg-st-spare" : "bg-st-unloaded"}
              pair={pairOf(t)}
              sub={
                <span>
                  {t.truck_type === "Spare" ? "Spare" : "Unloaded"}
                  {t.state?.wearers ? ` · ${t.state.wearers} wearers` : ""}
                </span>
              }
            />
          ))}
          {ready.length === 0 && (
            <EmptyState compact className="col-span-full text-[13px] text-ink-muted">
              {inLine > 0 ? "Everything ready is already in the line." : "No trucks ready to load."}
            </EmptyState>
          )}
        </div>
      </div>

      {/* ---------------- Not ready yet ---------------- */}
      {held.length + unfinished.length > 0 && (
        <div>
          <SectionHeader label="Not ready yet" count={held.length + unfinished.length} hint="joins Ready when cleared" />
          <div className="flex flex-wrap gap-2">
            {held.map((t) => (
              <NotReadyChip key={t.truck_number} truck={t} pair={pairOf(t)} tone="text-st-dirty" dot="bg-st-dirty" label="On hold · clear in Fleet" />
            ))}
            {unfinished.map((t) => (
              <NotReadyChip key={t.truck_number} truck={t} pair={pairOf(t)} tone="text-st-unfinished" dot="bg-st-unfinished" label="Unload unfinished" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
