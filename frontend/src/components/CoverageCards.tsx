import type { CoverageEntry } from "../utils/truckStatus";

/**
 * The canonical coverage display: big paired ROUTE → TRUCK numbers with micro
 * labels, one card per covered route. This is the read the floor wants —
 * direction is unambiguous at a glance, unlike a compact pill.
 *
 * CoverageTag / CoverageList (the chip forms) stay the fallback for genuinely
 * dense places — inside a truck card, a table cell, a note row — where a card
 * simply doesn't fit.
 *
 * The verb flips with the entry: previous-day coverage already happened
 * ("Loaded on"), today's is still ahead ("Loads on").
 */
export default function CoverageCards({
  entries,
  isRecurring,
  showPrevBadge = true,
  className = "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3",
}: {
  entries: CoverageEntry[];
  /** Optional predicate to badge a pairing as a recurring rule. */
  isRecurring?: (route: number, cover: number) => boolean;
  /** Set false where the surrounding block already says these are prev-day
   *  (e.g. the Unload page's "Previous load-day coverage" header) — otherwise
   *  every card repeats the same chip. */
  showPrevBadge?: boolean;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={className}>
      {entries.map((e) => (
        <div
          key={`${e.route}-${e.cover}-${e.prev ? "p" : "t"}`}
          className="rounded-xl border border-hairline bg-surface p-3"
        >
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">Route</p>
              <p className="font-mono text-3xl font-black leading-none tabular-nums text-sky-300">#{e.route}</p>
            </div>
            <span className="text-2xl font-black leading-none text-ink-faint">
              {e.kind === "split" ? "+" : "→"}
            </span>
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                {e.prev ? "Loaded on" : "Loads on"}
              </p>
              <p className="font-mono text-3xl font-black leading-none tabular-nums text-ink">#{e.cover}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {e.kind === "split" && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">split</span>
            )}
            {e.kind === "swap-twoway" && (
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">2-way</span>
            )}
            {isRecurring?.(e.route, e.cover) && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">recurring</span>
            )}
            {e.prev && showPrevBadge && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">prev day</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
