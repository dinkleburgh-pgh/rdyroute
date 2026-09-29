import clsx from "clsx";
import { Undo2 } from "lucide-react";
import { CHECKLIST_CHIP } from "./GarmentsStrip";
import type { TruckWithState } from "../../types";

/**
 * NOGs checklist — "Not Our Garments" going back OUT with these routes today.
 *
 * Sibling of the F.S. Garments strip on the LOAD side: the flag is set at the
 * start of the day (Setup Day wizard, or a truck's status sheet) and the load
 * crew makes sure the NOGs leave with the truck. Same one-row shape and the
 * same chip as the garments strip — sky once the truck is loaded (NOGs out
 * the door), rose while the load is still pending — so the two sit together
 * as one family. When nothing is flagged the strip stays off the page
 * entirely; most days there are none.
 */
export default function NogsStrip({
  trucks,
  loadingNow,
  carriers,
  className,
}: {
  /** Route trucks flagged has_nogs today (pre-filtered by the caller). */
  trucks: TruckWithState[];
  /** Chips whose NOGs are on the truck being loaded right now
   *  (loadingCargo().numbers) — their icon flashes. */
  loadingNow?: ReadonlySet<number>;
  /** Covered route -> the truck carrying its freight (loadingCargo().carriers).
   *  NOGs are out the door when the CARRIER is loaded, not the route truck. */
  carriers?: ReadonlyMap<number, TruckWithState>;
  className?: string;
}) {
  if (trucks.length === 0) return null;
  const isLoading = (t: TruckWithState) => loadingNow?.has(t.truck_number) === true;
  const isOut = (t: TruckWithState) =>
    !isLoading(t) && (carriers?.get(t.truck_number) ?? t).state?.status === "loaded";
  const out = trucks.filter(isOut).length;
  return (
    <div
      className={clsx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2", className)}
      style={{ borderColor: "rgba(244,63,94,0.30)", background: "rgba(244,63,94,0.06)" }}
    >
      <span className="inline-flex shrink-0 items-center gap-2">
        <Undo2 className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-rose-400">NOGs — not our garments</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {trucks.map((t) => {
          // Being loaded right now: the icon flashes until the load is done
          // (and wins over "done" — see GarmentsStrip on two-way swaps).
          const loading = isLoading(t);
          const done = isOut(t);
          return (
            <span
              key={t.truck_number}
              title={done ? "Loaded — NOGs out the door" : loading ? "Loading now — NOGs go on this load" : "NOGs to send back out"}
              className={clsx(
                CHECKLIST_CHIP,
                done
                  ? "border-sky-500/60 bg-sky-950/50 text-sky-200"
                  : "border-rose-800/50 bg-rose-950/30 text-rose-200",
                loading && "ring-2 ring-rose-400/80",
              )}
            >
              #{t.truck_number}
              <Undo2 className={clsx("h-5 w-5", loading && "animate-cargo-flash")} aria-hidden />
            </span>
          );
        })}
      </div>
      <span className="ml-auto font-mono text-xs tabular-nums text-ink-muted">
        {out} of {trucks.length} out
      </span>
    </div>
  );
}
