import clsx from "clsx";
import type { ReactNode } from "react";
import type { TruckWithState } from "../types";
import { getCoverageRouteNumber } from "../utils/truckStatus";
import { DustGarmentIcon } from "./icons";

/**
 * WorkflowCard — the standard truck card used across the Load and Unload
 * workflow pages. Large truck number + a status badge, the truck type / batch
 * line, and an optional footer. Visual styling is shared so the Unloaded and
 * Loaded sections look consistent.
 */
export default function WorkflowCard({
  truck,
  accent,
  statusLabel,
  statusClassName,
  footer,
  disabled = false,
  interactive = false,
  ringClassName = "hover:ring-blue-500",
  coverageRoute,
}: {
  truck: TruckWithState;
  accent: string;
  statusLabel: string;
  statusClassName: string;
  footer?: ReactNode;
  disabled?: boolean;
  interactive?: boolean;
  ringClassName?: string;
  /**
   * Override the coverage route shown in the ROUTE → TRUCK pair. Undefined
   * (default) derives TODAY's coverage from the truck — used by the Load page.
   * Passing a value (number or null) uses it verbatim — the Unload page passes
   * PREVIOUS-day coverage (the route this truck actually carried, i.e. what's
   * being unloaded), never tonight's assignment. null hides the pair.
   */
  coverageRoute?: number | null;
}) {
  const overrideActive = coverageRoute !== undefined;
  const derivedCover = getCoverageRouteNumber(truck);
  const coverRoute = overrideActive ? coverageRoute : derivedCover;
  // SPLIT helper: carries route N's overflow while route N ALSO runs — same
  // big pair display, but a "+" connector and a Split label. Split never
  // applies under an explicit override (the unload side shows prev-day cover).
  const splitRoute = overrideActive ? null : (derivedCover == null ? (truck.route_split_route ?? null) : null);
  const pairRoute = coverRoute ?? splitRoute;
  return (
    <div
      className={clsx(
        "card relative flex h-full min-h-[5.5rem] flex-col gap-1 p-2 md:min-h-[11.5rem] md:gap-2 md:p-4",
        interactive && "hover:ring-2 transition-shadow",
        interactive && ringClassName,
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="flex w-full flex-col gap-0.5 md:gap-1">
        {(() => {
          const badges = (
            <span className={clsx(
              "flex min-h-[1.5rem] shrink-0 gap-1",
              pairRoute != null ? "flex-row flex-wrap items-center justify-end" : "flex-col items-end justify-start",
            )}>
              <span className={clsx("badge", statusClassName)}>{statusLabel}</span>
              {truck.state?.priority_hold && statusLabel !== "HOLD" && (
                <span className="badge bg-st-dirty/25 text-st-dirty">Hold</span>
              )}
              {truck.state?.needs_checked && (
                <span className="badge bg-st-inprogress/25 text-st-inprogress">Needs Checked</span>
              )}
              {truck.truck_type === "Dust" && truck.state?.has_dust_garment && (
                <span
                  className="inline-flex items-center justify-center rounded-pill border border-st-inprogress/60 bg-st-inprogress/10 p-0.5"
                  title="Dust garment"
                >
                  <DustGarmentIcon className="h-3.5 w-3.5" style={{ color: "#fcd34d" }} />
                </span>
              )}
            </span>
          );
          if (pairRoute == null) {
            return (
              <div className="flex w-full items-start justify-between gap-2">
                <div className="flex min-h-[2.5rem] flex-col justify-between gap-0.5 md:min-h-[4.5rem]">
                  <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-2xl md:text-5xl", accent)}>
                    {truck.truck_number}
                  </span>
                </div>
                {badges}
              </div>
            );
          }
          /* Coverage card: badges get their own top row, then the number area
             IS the coverage — full-width "ROUTE → TRUCK" pair with
             micro-labels. Stacking (instead of sharing a row with the badge)
             is what keeps the pair from clipping at the grid's minimum card
             width. */
          return (
            <>
              <div className="flex w-full justify-end">{badges}</div>
              <div className="flex min-h-[2.5rem] min-w-0 items-start gap-1.5 md:min-h-[4rem] md:gap-2">
                <div className="flex flex-col items-center">
                  <span className={clsx(
                    "font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-2xl md:text-4xl",
                    splitRoute != null ? "text-amber-300" : "text-sky-300",
                  )}>
                    {pairRoute}
                  </span>
                  <span className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.18em] text-ink-faint md:text-[9px]">
                    {splitRoute != null ? "Split" : "Route"}
                  </span>
                </div>
                <span className="pt-1 font-mono text-base leading-none text-ink-muted md:pt-1.5 md:text-2xl">{splitRoute != null ? "+" : "→"}</span>
                <div className="flex flex-col items-center">
                  <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-2xl md:text-4xl", accent)}>
                    {truck.truck_number}
                  </span>
                  <span className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.18em] text-ink-faint md:text-[9px]">
                    Truck
                  </span>
                </div>
              </div>
            </>
          );
        })()}
        <div className="text-[10px] text-ink-muted space-y-0.5 md:text-xs">
          <div>
            {truck.truck_type}
            {truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
          </div>
        </div>
      </div>
      {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
    </div>
  );
}
