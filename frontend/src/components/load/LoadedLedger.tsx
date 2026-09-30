import clsx from "clsx";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { format } from "date-fns";
import EmptyState from "../EmptyState";
import { QuietTile, SectionHeader, TILE_GRID } from "../workflow/QuietTile";
import { useCollapseState } from "../../utils/useCollapseState";
import type { LoadPair } from "./loadUi";
import type { TruckWithState } from "../../types";

/** The loaded wall is 30+ tiles by morning. Two rows, then a "+N more"
 *  expander (same pattern as Unload's unloaded wall). */
const PREVIEW = 10;

/**
 * Loaded today — folded to one line by default, because the work column's
 * job is what is LEFT, and this list only grows. The folded line keeps the
 * glance that matters ("did the truck I just finished register?"): the count
 * and the last finish. Open, it is the full wall with the sort toggle.
 *
 * Mount it with `key={runDate}`: the page lives on a dock tablet across the
 * 6am rollover, and last night's "show all" must not survive into tomorrow.
 */
export default function LoadedLedger({
  loaded,
  pairOf,
  collapsible = true,
}: {
  loaded: TruckWithState[];
  pairOf: (t: TruckWithState) => LoadPair;
  /** Classic view: always open, a section rule instead of the fold. */
  collapsible?: boolean;
}) {
  const fold = useCollapseState("load-loaded", false);
  const open = collapsible ? fold.open : true;
  const toggle = fold.toggle;
  const [sort, setSort] = useState<"number" | "order">("number");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...loaded];
    if (sort === "order") {
      // Sort by when the truck was actually finished loading. Prefer
      // load_finish_time (set by the V2 workflow); fall back to updated_at for
      // trucks set to "loaded" without going through the timed workflow.
      const toEpoch = (t: TruckWithState): number => {
        const ft = t.state?.load_finish_time;
        if (ft != null) return ft;
        const ua = t.state?.updated_at;
        if (ua) return new Date(ua).getTime() / 1000;
        return Number.POSITIVE_INFINITY;
      };
      arr.sort((a, b) => {
        const diff = toEpoch(a) - toEpoch(b);
        if (diff !== 0) return diff;
        return a.truck_number - b.truck_number;
      });
    } else {
      arr.sort((a, b) => a.truck_number - b.truck_number);
    }
    return arr;
  }, [loaded, sort]);
  const hidden = showAll ? 0 : Math.max(0, sorted.length - PREVIEW);

  const last = useMemo(() => {
    let best: TruckWithState | null = null;
    for (const t of loaded) {
      const ft = t.state?.load_finish_time;
      if (ft != null && (best?.state?.load_finish_time == null || ft > best.state.load_finish_time)) best = t;
    }
    return best;
  }, [loaded]);

  const sortToggle = loaded.length > 1 && (
    <div className="inline-flex overflow-hidden rounded-[7px] border border-hairline text-[11px] font-semibold">
      {([["number", "# Number"], ["order", "Load order"]] as const).map(([key, text], i) => (
        <button
          key={key}
          type="button"
          onClick={() => setSort(key)}
          className={clsx(
            "px-3 py-1 transition-colors",
            i > 0 && "border-l border-hairline",
            sort === key ? "bg-track text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <section className={clsx(collapsible && "card")}>
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-left"
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink">Loaded today</span>
          <span className="font-mono text-[11px] tabular-nums text-ink-faint">{loaded.length}</span>
          <span className="hidden h-px flex-1 bg-hairline sm:block" />
          {last?.state?.load_finish_time != null && (
            <span className="text-[11px] text-ink-muted">
              last <span className="font-mono font-bold text-st-loaded">#{last.truck_number}</span>
              {" · "}
              {format(new Date(last.state.load_finish_time * 1000), "h:mm a")}
            </span>
          )}
          <ChevronDown className={clsx("h-4 w-4 text-ink-faint transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      ) : (
        <SectionHeader label="Loaded today" count={loaded.length}>
          {sortToggle}
        </SectionHeader>
      )}

      {open && (
        <div className={clsx(collapsible && "mt-3")}>
          {collapsible && sortToggle && (
            <div className="mb-2.5 flex justify-end">
              {sortToggle}
            </div>
          )}
          <div className={TILE_GRID}>
            {/* Tail slice, not head: under Load-order sort the freshest
                finishes are LAST, so the preview keeps them and the expander
                (rendered first) hides the early-evening tiles. Pips stay true
                by offsetting past the hidden count. */}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-[10px] border border-dashed border-hairline bg-surface/40 px-3.5 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                + {hidden} more
              </button>
            )}
            {sorted.slice(hidden).map((t, idx) => (
              <div key={t.truck_number} className="relative">
                {sort === "order" && (
                  <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-surface-2 px-1 text-[10px] font-bold text-st-loaded ring-1 ring-st-loaded/60">
                    {hidden + idx + 1}
                  </span>
                )}
                <QuietTile
                  truck={t}
                  numberClass="text-st-loaded"
                  dotClass="bg-st-loaded"
                  pair={pairOf(t)}
                  sub={
                    <span className="text-ink-faint">
                      {t.state?.load_finish_time
                        ? `Done ${format(new Date(t.state.load_finish_time * 1000), "h:mm a")}`
                        : "Loaded"}
                    </span>
                  }
                />
              </div>
            ))}
            {loaded.length === 0 && <EmptyState className="col-span-full">Nothing loaded yet.</EmptyState>}
          </div>
        </div>
      )}
    </section>
  );
}
