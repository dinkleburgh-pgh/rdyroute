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
}: {
  truck: TruckWithState;
  accent: string;
  statusLabel: string;
  statusClassName: string;
  footer?: ReactNode;
  disabled?: boolean;
  interactive?: boolean;
  ringClassName?: string;
}) {
  const coverRoute = getCoverageRouteNumber(truck);
  return (
    <div
      className={clsx(
        "card relative flex min-h-[4.5rem] flex-col gap-1 p-2 md:min-h-[10rem] md:gap-2 md:p-4",
        interactive && "hover:ring-2 transition-shadow",
        interactive && ringClassName,
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="flex w-full flex-col gap-0.5 md:gap-1">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex min-h-[2.5rem] flex-col justify-between gap-0.5 md:min-h-[4.5rem]">
            <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-2xl md:text-5xl", accent)}>
              {truck.truck_number}
            </span>
          </div>
          <span className="flex min-h-[1.5rem] flex-col items-end justify-start gap-1">
            <span className={clsx("badge", statusClassName)}>{statusLabel}</span>
            {truck.state?.priority_hold && statusLabel !== "HOLD" && (
              <span className="badge bg-st-dirty/25 text-st-dirty">Hold</span>
            )}
            {truck.state?.needs_checked && (
              <span className="badge bg-st-inprogress/25 text-st-inprogress">Needs Checked</span>
            )}
            {coverRoute != null && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill bg-sky-900/40 px-2 py-0.5 text-[10px] font-bold text-sky-300 ring-1 ring-sky-700/40">
                → Cov. #{coverRoute}
              </span>
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
        </div>
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
