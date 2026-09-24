import clsx from "clsx";
import type { ReactNode } from "react";
import type { TruckWithState } from "../../types";

/**
 * The quiet-tile language shared by the Load and Unload workflow pages.
 *
 * Both pages list trucks in three or four sections each, and both used to do
 * it with their own colour-block badges. Owning the tile and the section rule
 * here is what stops the two boards drifting apart the next time either one is
 * touched — the same reason useLoadActions exists.
 */

/** Section rule: label, mono count, a hairline that eats the slack, controls. */
export function SectionHeader({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  /** Quiet right-aligned note, e.g. "oldest arrival first · tap to start". */
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-ink-faint">{count}</span>
      <span className="hidden h-px flex-1 bg-hairline sm:block" />
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
      {children}
    </div>
  );
}

/**
 * One truck: the number carries both the weight and the STATUS COLOUR, with a
 * matching 6px dot and words beneath it.
 *
 * The first pass at these tiles left every number ink-white and let the dot
 * alone carry status. That reads calmly but it doesn't survive the actual use:
 * the crew scans a wall of these from a few feet away and needs to sort red
 * from green without reading. Colouring the numeral gets that back without
 * bringing back the colour-block badges — the tile itself stays quiet.
 */
export function QuietTile({
  truck,
  sub,
  dotClass,
  tag,
  tagClass,
  numberClass = "text-ink",
  pair,
  dim = false,
  disabled = false,
  onClick,
  title,
  id,
  highlight = false,
  extra,
  size = "md",
}: {
  truck: TruckWithState;
  sub: ReactNode;
  dotClass: string;
  tag?: ReactNode;
  tagClass?: string;
  numberClass?: string;
  /** Coverage: the tile renders the app-wide ROUTE → TRUCK pair instead of a
   *  bare number (amber ROUTE + TRUCK for a split — the route also runs).
   *  Same idiom as WorkflowCard's coverage face and CoverageTag, so a covered
   *  load reads identically on every surface. */
  pair?: { route: number; split?: boolean } | null;
  dim?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  /** DOM id, so a ?truck= deep link can scroll to it. */
  id?: string;
  highlight?: boolean;
  /** Interactive content under the sub line (pickers, inline actions). Forces
   *  a div root — a <button> cannot legally contain selects and buttons. */
  extra?: ReactNode;
  /** "lg" = focus-mode tile (few trucks on the board → numbers readable from
   *  across the dock). Default "md" is byte-identical to the original tile. */
  size?: "md" | "lg";
}) {
  const numCls = size === "lg" ? "text-[34px]" : "text-[22px]";
  const joinCls = size === "lg" ? "text-[16px]" : "text-[13px]";
  const subCls = size === "lg" ? "text-[12px]" : "text-[11px]";
  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {pair ? (
          <span
            className="flex items-baseline gap-1"
            title={
              pair.split
                ? `Split load — route ${pair.route} also runs; #${truck.truck_number} carries its overflow`
                : `Route ${pair.route}'s load rides on truck ${truck.truck_number}`
            }
          >
            <span className={clsx("font-mono font-black leading-none tabular-nums", numCls, pair.split ? "text-amber-300" : "text-sky-300")}>
              {pair.route}
            </span>
            <span className={clsx("font-mono leading-none text-ink-muted", joinCls)}>{pair.split ? "+" : "→"}</span>
            <span className={clsx("font-mono font-black leading-none tabular-nums", numCls, numberClass)}>
              {truck.truck_number}
            </span>
          </span>
        ) : (
          <span className={clsx("font-mono font-black leading-none tabular-nums", numCls, numberClass)}>
            #{truck.truck_number}
          </span>
        )}
        {tag && (
          <span className={clsx("text-[9.5px] font-bold uppercase tracking-[0.08em]", tagClass)}>{tag}</span>
        )}
      </div>
      <div className={clsx("mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-muted", subCls)}>
        <span className={clsx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
        {sub}
      </div>
    </>
  );
  const cls = clsx(
    // h-full: grid neighbours stretch to the row, so a tile whose sub wraps
    // (coverage pairs) never leaves the card beside it hanging short.
    "h-full w-full rounded-[10px] border border-hairline text-left transition-colors",
    size === "lg" ? "px-4 py-3.5" : "px-3.5 py-3",
    dim ? "bg-surface-3 opacity-75" : "bg-surface",
    onClick && !disabled && "hover:bg-surface-2 active:scale-[0.99]",
    disabled && "cursor-not-allowed opacity-50",
    highlight && "ring-2 ring-white/70 animate-pulse",
  );
  if (!onClick) return <div id={id} className={cls}>{body}{extra}</div>;
  if (extra) {
    // The body stays a REAL button (keyboard + AT for free); extra sits
    // outside it, so its selects/buttons are never presentational children
    // of a role="button" — and never trigger the tile's own click.
    return (
      <div id={id} className={cls}>
        <button type="button" className="block w-full text-left" disabled={disabled} onClick={onClick} title={title}>
          {body}
        </button>
        {extra}
      </div>
    );
  }
  return (
    <button id={id} type="button" className={cls} disabled={disabled} onClick={onClick} title={title}>
      {body}
    </button>
  );
}

/** Shared grid for every truck section on both workflow pages. */
export const TILE_GRID = "grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

/** Focus-mode grid: few tiles, rendered big (pairs with QuietTile size="lg"). */
export const TILE_GRID_LG = "grid gap-2.5 grid-cols-1 sm:grid-cols-2";
