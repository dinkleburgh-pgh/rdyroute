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
  className,
}: {
  /** Route trucks flagged has_nogs today (pre-filtered by the caller). */
  trucks: TruckWithState[];
  className?: string;
}) {
  if (trucks.length === 0) return null;
  const out = trucks.filter((t) => t.state?.status === "loaded").length;
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
          const done = t.state?.status === "loaded";
          return (
            <span
              key={t.truck_number}
              title={done ? "Loaded — NOGs out the door" : "NOGs to send back out"}
              className={clsx(
                CHECKLIST_CHIP,
                done
                  ? "border-sky-500/60 bg-sky-950/50 text-sky-200"
                  : "border-rose-800/50 bg-rose-950/30 text-rose-200",
              )}
            >
              #{t.truck_number}
              <Undo2 className="h-5 w-5" aria-hidden />
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
