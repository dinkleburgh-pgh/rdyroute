import clsx from "clsx";
import type { ReactNode } from "react";
import { ChevronRight, Play } from "lucide-react";
import CoverageTag from "../CoverageTag";
import { truckTypeLabel } from "../../utils/truckType";
import { BTN_GO, BTN_LINK, LoadFace, ZONE, ZoneLabel, loadFaceText } from "./loadUi";
import type { TruckWithState } from "../../types";
import { ReturnTag } from "./ReturnReminder";
import type { LastReturn } from "../../utils/lastReturn";

export type LoadPair = { route: number; split?: boolean } | null;

/**
 * The Load page's dock card: what is loading, what goes next, and what is
 * already pulled up — top to bottom in the order the trucks will go.
 *
 * These three used to live in three places (a hero card, a Next Up row inside
 * it plus a button on the Ready header plus a tag on a Ready tile, and a
 * Staged card that ALSO left its trucks in the Ready grid), and none of them
 * said which truck was which at a glance. Now each truck appears once, in one
 * zone, wearing that zone's colour. The Ready grid below lists only what is
 * left over.
 *
 * Presentational: every write goes through the caller (the chooser, the
 * next-up picker, useLoadActions).
 */
export default function DockCard({
  loading,
  nextUp,
  staged,
  readyCount,
  busyTruck,
  canStart,
  pairOf,
  onTruck,
  onStart,
  onPickNextUp,
  onSuggest,
  returnOf,
}: {
  /** The Loading-now zone (InProgressHeroPanel), or null when the dock is free. */
  loading: ReactNode | null;
  /** The explicitly queued truck — never a fallback guess. */
  nextUp: TruckWithState | null;
  /** The staging lane in pull-up order, minus the Up-next truck. */
  staged: TruckWithState[];
  /** Trucks still in the Ready grid — only steers the idle hint. */
  readyCount: number;
  busyTruck: number | null;
  /** False while a truck is loading (one at a time). */
  canStart: boolean;
  pairOf: (t: TruckWithState) => LoadPair;
  /** Opens the Start / Stage / Next Up chooser for a truck. */
  onTruck: (t: TruckWithState) => void;
  onStart: (t: TruckWithState) => void;
  onPickNextUp: () => void;
  onSuggest: (truckNumber: number) => void;
  /** The route's last audit return — tagged on the Up next / Staged slots
   *  (loud ones only), which the direct Start button reaches without the
   *  chooser sheet. */
  returnOf?: (t: TruckWithState) => LastReturn | null;
}) {
  // With nothing queued, the lane's front truck is the obvious next pick —
  // offered as a one-tap chip. (History-based "usually next" picks were
  // dropped: the crew found them noise.)
  const laneFirst = nextUp
    ? null
    : staged.find((t) => t.state?.status === "unloaded" && t.state?.priority_hold !== true) ?? null;

  const idleHint = nextUp
    ? `${loadFaceText(nextUp)} is up next — start it when the dock is ready.`
    : staged.length > 0
      ? "Tap a staged truck to start it, or queue one up next."
      : readyCount > 0
        ? "Tap a ready truck below to start, stage, or queue it."
        : "Nothing is ready to load yet.";

  return (
    // A size container: Up next and Staged sit side by side only when THIS
    // card is wide, not the viewport — the card lives in a 1.5fr rail beside
    // the reference rail, so a viewport breakpoint squeezed both zones.
    <section className={clsx("card overflow-hidden !p-0 [container-type:inline-size]", loading && "ring-1 ring-st-inprogress/25")}>
      {/* The one amber rule on the page — it only moves while a truck loads. */}
      <div className={clsx("h-[3px] w-full", loading ? "animate-pulse bg-st-inprogress" : "bg-track")} />

      {/* ---------------- Loading now ---------------- */}
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

      {/* ---------------- Up next · Staged ---------------- */}
      <div className="grid items-start border-t border-hairline bg-surface-3/60 [@container(min-width:760px)]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="px-4 py-3.5 sm:px-[22px]">
          <div className="mb-2.5 flex min-h-[26px] items-center justify-between gap-2">
            <ZoneLabel zone="next">Up next</ZoneLabel>
            <button type="button" onClick={onPickNextUp} className={BTN_LINK}>
              {nextUp ? "Change" : "Choose"}
            </button>
          </div>
          {nextUp ? (
            <Slot
              truck={nextUp}
              zone="next"
              big
              pair={pairOf(nextUp)}
              onClick={() => onTruck(nextUp)}
              sub={
                <>
                  {truckTypeLabel(nextUp.truck_type)}
                  {nextUp.state?.wearers ? ` · ${nextUp.state.wearers} wearers` : ""}
                  {nextUp.state?.staged_at != null ? " · in the lane" : ""}
                  <ReturnTag ret={returnOf?.(nextUp) ?? null} />
                </>
              }
            />
          ) : (
            <div className="flex min-h-[76px] flex-col justify-center gap-2 rounded-[10px] border border-dashed border-sky-500/25 px-3.5 py-3">
              <span className="text-[13px] text-ink-muted">Nothing queued.</span>
              {laneFirst && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-ink-faint">Queue:</span>
                  <SuggestChip n={laneFirst.truck_number} note="1st in lane" onPick={onSuggest} />
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
              {staged.map((t, i) => (
                <Slot
                  key={t.truck_number}
                  truck={t}
                  zone="staged"
                  position={i + 1}
                  pair={pairOf(t)}
                  onClick={() => onTruck(t)}
                  sub={<>{stagedSub(t)}<ReturnTag ret={returnOf?.(t) ?? null} /></>}
                  dotClass={stagedDot(t)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[76px] items-center rounded-[10px] border border-dashed border-hairline px-3.5 py-3 text-[13px] text-ink-muted">
              Lane is empty — tap a ready truck and choose Stage.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One-tap "queue this one up next" chip for the empty Up next slot. */
function SuggestChip({ n, note, onPick }: { n: number; note: string; onPick: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(n)}
      title={`Queue #${n} up next`}
      className="inline-flex items-baseline gap-1.5 rounded-md border border-sky-600/40 bg-sky-950/40 px-2 py-1 transition-colors hover:bg-sky-900/50"
    >
      <span className="font-mono text-[13px] font-bold tabular-nums text-sky-200">#{n}</span>
      <span className="text-[10px] text-sky-300/70">{note}</span>
    </button>
  );
}

/** What a staged truck is waiting on. The lane can hold a truck that is
 *  still being unloaded, and the slot has to say so rather than look ready. */
function stagedSub(t: TruckWithState): ReactNode {
  const st = t.state?.status;
  const since = t.state?.staged_at != null
    ? new Date(t.state.staged_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const what =
    t.state?.priority_hold ? "On hold"
    : st === "unloaded" ? "Ready"
    : st === "unfinished" ? "Unload unfinished"
    : st === "dirty" ? "Not unloaded"
    : "Staged";
  return since ? `${what} · ${since}` : what;
}

function stagedDot(t: TruckWithState): string {
  const st = t.state?.status;
  if (t.state?.priority_hold) return "bg-st-dirty";
  if (st === "unloaded") return t.truck_type === "Spare" ? "bg-st-spare" : "bg-st-unloaded";
  if (st === "unfinished") return "bg-st-unfinished";
  return "bg-st-dirty";
}

/** One truck in a dock zone. Tapping opens the chooser. */
function Slot({
  truck,
  zone,
  big = false,
  position,
  pair,
  sub,
  dotClass,
  onClick,
}: {
  truck: TruckWithState;
  zone: "next" | "staged";
  big?: boolean;
  position?: number;
  pair: LoadPair;
  sub: ReactNode;
  dotClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group flex h-full min-h-[76px] w-full items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors active:scale-[0.99]",
        zone === "next"
          ? "border-sky-500/30 bg-sky-500/[0.07] hover:bg-sky-500/[0.12]"
          : "border-hairline bg-surface hover:bg-surface-2",
      )}
    >
      {position != null && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-track font-mono text-[11px] font-bold tabular-nums text-ink-soft">
          {position}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Route first when covering (LoadFace); a split keeps the truck
              first and wears the amber split tag instead. */}
          <LoadFace truck={truck} size={big ? "md" : "sm"} numberClass={ZONE[zone].number} />
          {pair?.split && <CoverageTag route={pair.route} truck={truck.truck_number} split />}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5 text-[11.5px] leading-snug text-ink-muted">
          <span className={clsx("h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full", dotClass ?? ZONE[zone].dot)} />
          <span className="min-w-0">{sub}</span>
        </div>
      </div>
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink-muted sm:block" aria-hidden />
    </button>
  );
}
