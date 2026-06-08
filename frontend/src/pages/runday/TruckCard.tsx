/**
 * Truck tile card used on the Day Overview (RunDay) grids. Extracted from RunDay.tsx.
 */
import clsx from "clsx";
import type { TruckNote, TruckStatus, TruckWithState } from "../../types";
import { STATUS_BG, STATUS_TEXT, STATUS_LABELS, DustGarmentIcon } from "./constants";

export default function TruckCard({
  t,
  status,
  done,
  coveringSpare,
  dayNum,
  isExtraDay,
  notes,
}: {
  t: TruckWithState;
  status: TruckStatus;
  done: boolean;
  coveringSpare?: TruckWithState;
  dayNum?: number;
  isExtraDay?: boolean;
  notes?: TruckNote[];
}) {
  const showNotes = notes && notes.length > 0 && (status === "in_progress" || status === "unloaded");
  return (
    <div
      className={clsx(
        "card relative flex flex-col items-center gap-1.5 p-3 text-center transition-opacity",
        done && "opacity-40",
        status === "in_progress" && "animate-pulse ring-2 ring-amber-400",
        showNotes && "ring-1 ring-violet-500/50",
      )}
    >
      {t.truck_type === "Dust" && t.state?.has_dust_garment && (
        <span
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-full border border-amber-500/60 bg-amber-950/70 p-0.5"
          title="Garments assigned"
        >
          <DustGarmentIcon className="h-3.5 w-3.5 text-amber-300" />
        </span>
      )}
      <span
        className={clsx(
          "text-4xl font-extrabold tabular-nums leading-none",
          STATUS_TEXT[status],
        )}
      >
        {t.truck_number}
      </span>
      <span
        className={clsx(
          "rounded px-1.5 py-0.5 text-xs font-semibold text-white",
          STATUS_BG[status],
        )}
      >
        {STATUS_LABELS[status]}
      </span>
      <span className="text-xs text-slate-500">
        {t.truck_type}
        {coveringSpare && (
          <span className="text-sky-400"> · cov #{coveringSpare.truck_number}</span>
        )}
        {t.route_swap_route != null && t.truck_type !== "Spare" && (
          <span className="text-sky-400"> · rt#{t.route_swap_route}</span>
        )}
      </span>
      {dayNum != null && (
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            isExtraDay
              ? "bg-amber-900/60 text-amber-300"
              : "bg-blue-900/60 text-blue-300",
          )}
        >
          Day {dayNum}
        </span>
      )}
      {showNotes && (
        <div className="mt-1 w-full space-y-1 border-t border-slate-700/60 pt-1">
          {notes!.map((n) => (
            <p key={n.id} className="text-left text-[10px] leading-snug text-violet-200">
              {n.body}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
