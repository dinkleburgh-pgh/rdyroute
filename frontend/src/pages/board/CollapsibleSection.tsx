/**
 * Collapsible drill-page section (extracted from Board.tsx). Remembers its
 * open state per sectionKey; renders its rows through the caller's card/tile
 * renderer in either the classic card grid or the quiet-tile grids.
 */
import clsx from "clsx";
import { useRef, type ReactNode } from "react";
import type { TruckWithState } from "../../types";

export default function CollapsibleSection({
  sectionKey,
  title,
  titleClassName,
  sectionRows,
  renderTruckCard,
  tileGrid,
}: {
  sectionKey: string;
  title: string;
  titleClassName: string;
  sectionRows: TruckWithState[];
  renderTruckCard: (truck: TruckWithState, index: number) => ReactNode;
  /** Quiet-tile grid (denser); "oos" leaves room for the inline picker. */
  tileGrid?: boolean | "oos";
}) {
  const initOpen = useRef(
    localStorage.getItem(`readyroutev2_collapse_board-${sectionKey}`) !== "false"
  ).current;
  if (sectionRows.length === 0) return null;
  return (
    <details
      open={initOpen ? true : undefined}
      onToggle={(e) => {
        const val = (e.target as HTMLDetailsElement).open;
        try { localStorage.setItem(`readyroutev2_collapse_board-${sectionKey}`, String(val)); } catch { }
      }}
      className="group col-span-full overflow-hidden rounded-2xl border border-hairline bg-surface-3/50"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-surface/80 px-4 py-3">
        <div className="min-w-0">
          <div className={clsx("text-xl font-black uppercase tracking-[0.3em] sm:text-2xl", titleClassName)}>
            {title}
          </div>
          <div className="text-xs font-medium text-ink-muted">
            {sectionRows.length} truck{sectionRows.length !== 1 ? "s" : ""}
          </div>
        </div>
        <span className="text-lg text-ink-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-hairline p-3">
        <div className={clsx(
          tileGrid === "oos"
            ? "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
            : tileGrid
            ? "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
            : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
        )}>
          {sectionRows.map((truck, sectionIndex) => renderTruckCard(truck, sectionIndex))}
        </div>
      </div>
    </details>
  );
}
