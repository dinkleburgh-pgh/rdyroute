import clsx from "clsx";
import type { CoverageEntry } from "../utils/truckStatus";
import type { TruckWithState } from "../types";
import { formatDuration } from "./LiveInProgress";
import { useLoadTimerVisible } from "../hooks/useLoadTimerVisible";

/**
 * The canonical coverage card — the Report's "Routes covered" read, now the
 * one component every surface renders: big paired ROUTE → TRUCK numbers with
 * micro labels, the kind of cover as a chip, and a live state line under a
 * rule. Direction is unambiguous at a glance, unlike a compact pill.
 *
 * Three sizes, same anatomy. `lg` is the Report and the wall display, `md`
 * the page banners (Load / Unload / Fleet), `sm` a lane or a sidebar where two
 * cards share ~350px. Pick the size for the space; never a different card.
 *
 * CoverageTag / CoverageList (the pill forms) stay for genuinely dense places
 * — inside a truck card, a table cell, a note row — where a card cannot fit.
 *
 * The verb flips with the entry: previous-day coverage already happened
 * ("Loaded on"), today's is still ahead ("Loads on") until the cover loads.
 * The state line follows the same split: a prev-day pairing is what is being
 * UNLOADED today, so it reports the cover's unload; a today pairing reports
 * its load. Both need `truckOf`; without it the card is the static pairing.
 */
export type CoverageCardSize = "sm" | "md" | "lg";

const SIZE: Record<CoverageCardSize, { card: string; pair: string; num: string; glyph: string; chips: string; state: string }> = {
  lg: { card: "rounded-xl p-4", pair: "gap-4", num: "text-3xl", glyph: "text-2xl", chips: "mt-2.5", state: "mt-2.5 pt-2 text-xs" },
  md: { card: "rounded-xl p-3", pair: "gap-3", num: "text-2xl", glyph: "text-xl", chips: "mt-2", state: "mt-2 pt-1.5 text-[11px]" },
  sm: { card: "rounded-[10px] px-2.5 py-2", pair: "gap-3", num: "text-[22px]", glyph: "text-lg", chips: "mt-1.5", state: "mt-1.5 pt-1.5 text-[11px]" },
};

const DEFAULT_GRID: Record<CoverageCardSize, string> = {
  lg: "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
  md: "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3",
  sm: "grid grid-cols-2 gap-2 xl:grid-cols-3",
};

const CHIP = "rounded px-1.5 py-0.5 text-[10px] font-semibold";

function fmtClock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type StateLine = { text: string; className: string };

/** Tonight's load on the cover — the Report's wording, verbatim. The duration
 *  follows the Operations "Load timer" switch; the finish time always shows. */
function loadState(cover: TruckWithState | null | undefined, showDuration: boolean): StateLine {
  const s = cover?.state;
  if (s?.status === "loaded") {
    const when = s.load_finish_time ? ` · ${fmtClock(s.load_finish_time)}` : "";
    const took = showDuration && s.load_duration_seconds != null ? ` · ${formatDuration(s.load_duration_seconds)}` : "";
    return { text: `Loaded${when}${took}`, className: "text-st-loaded" };
  }
  if (s?.status === "in_progress") return { text: "Loading…", className: "text-st-inprogress" };
  return { text: "Not loaded", className: "text-ink-faint" };
}

/** Yesterday's load coming OFF the cover today. */
function unloadState(cover: TruckWithState | null | undefined): StateLine {
  const s = cover?.state;
  if (!s) return { text: "Not unloaded", className: "text-ink-faint" };
  if (s.unloading_started_at != null && (s.status === "dirty" || s.status === "unfinished")) {
    return { text: "Unloading…", className: "text-st-inprogress" };
  }
  if (s.status === "unloaded" || s.status === "loaded" || s.status === "in_progress") {
    return { text: `Unloaded${s.unloaded_at ? ` · ${fmtClock(s.unloaded_at)}` : ""}`, className: "text-st-unloaded" };
  }
  if (s.status === "unfinished") return { text: "Unfinished", className: "text-st-unfinished" };
  return { text: "Not unloaded", className: "text-ink-faint" };
}

export default function CoverageCards({
  entries,
  size = "lg",
  isRecurring,
  truckOf,
  showPrevBadge = true,
  className,
}: {
  entries: CoverageEntry[];
  size?: CoverageCardSize;
  /** Optional predicate to badge a pairing as a recurring rule. */
  isRecurring?: (route: number, cover: number) => boolean;
  /** The covering truck's live row. Drives the state line and tells a Spare
   *  cover from a route swap on prev-day entries (the swap log can't). */
  truckOf?: (truckNumber: number) => TruckWithState | null | undefined;
  /** Set false where the surrounding block already says these are prev-day
   *  (e.g. the Unload page's "Previous load-day coverage" header) — otherwise
   *  every card repeats the same chip. */
  showPrevBadge?: boolean;
  className?: string;
}) {
  const showDuration = useLoadTimerVisible();
  if (entries.length === 0) return null;
  const s = SIZE[size];
  return (
    <div className={className ?? DEFAULT_GRID[size]}>
      {entries.map((e) => {
        const cover = truckOf?.(e.cover) ?? null;
        const state = truckOf ? (e.prev ? unloadState(cover) : loadState(cover, showDuration)) : null;
        const done = !e.prev && cover?.state?.status === "loaded";
        const kind =
          e.kind === "split" ? "Split"
          : e.kind === "spare" || cover?.truck_type === "Spare" ? "Spare cover"
          : "Route swap";
        return (
          <div
            key={`${e.route}-${e.cover}-${e.prev ? "p" : "t"}`}
            className={clsx("border border-hairline bg-surface", s.card)}
          >
            <div className={clsx("flex items-center justify-center", s.pair)}>
              <div className="text-center">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">Route</p>
                <p className={clsx("font-mono font-black leading-none tabular-nums text-sky-300", s.num)}>#{e.route}</p>
              </div>
              {/* A split isn't a handoff — the route runs on BOTH trucks — so
                  it reads "+". Only real coverage gets the arrow. */}
              <span className={clsx("font-black leading-none text-ink-faint", s.glyph)} aria-hidden>
                {e.kind === "split" ? "+" : "→"}
              </span>
              <div className="text-center">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                  {e.prev || done ? "Loaded on" : "Loads on"}
                </p>
                <p className={clsx("font-mono font-black leading-none tabular-nums text-ink", s.num)}>#{e.cover}</p>
              </div>
            </div>
            <div className={clsx("flex flex-wrap items-center justify-center gap-1.5", s.chips)}>
              <span className={clsx(CHIP, "bg-surface-2 text-ink-muted")}>{kind}</span>
              {e.kind === "swap-twoway" && (
                <span className={clsx(CHIP, "bg-sky-500/20 text-sky-300")}>2-way</span>
              )}
              {isRecurring?.(e.route, e.cover) && (
                <span className={clsx(CHIP, "bg-amber-500/20 text-amber-300")}>recurring</span>
              )}
              {e.prev && showPrevBadge && (
                <span className={clsx(CHIP, "bg-surface-2 text-ink-faint")}>prev day</span>
              )}
            </div>
            {state && (
              <p className={clsx("border-t border-hairline text-center", s.state)}>
                <span className={state.className}>{state.text}</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
