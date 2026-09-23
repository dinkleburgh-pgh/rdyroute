import clsx from "clsx";
import type { TruckWithState } from "../../types";

/**
 * NOGs checklist — "Not Our Garments" going back OUT with these routes today.
 *
 * Sibling of the F.S. Garments strip on the LOAD side: the flag is set at the
 * start of the day (Setup Day wizard, or a truck's status sheet) and the load
 * crew makes sure the NOGs leave with the truck. Chips mirror the garments
 * strip — sky once the truck is loaded (NOGs out the door), rose while the
 * load is still pending. When nothing is flagged the strip stays off the page
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
      className={clsx("rounded-xl border", className)}
      style={{ borderColor: "rgba(244,63,94,0.30)", background: "rgba(244,63,94,0.06)" }}
    >
      <div className="flex w-full items-center gap-2 px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-rose-400">NOGs — not our garments</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-ink-muted">
          {out} of {trucks.length} out
        </span>
      </div>
      <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "rgba(244,63,94,0.20)" }}>
        <div className="flex flex-wrap gap-1.5">
          {trucks.map((t) => {
            const done = t.state?.status === "loaded";
            return (
              <span
                key={t.truck_number}
                title={done ? "Loaded — NOGs out the door" : "NOGs to send back out"}
                className={clsx(
                  "rounded-md border px-2 py-0.5 font-mono text-sm font-bold",
                  done
                    ? "border-sky-500/60 bg-sky-950/50 text-sky-200"
                    : "border-rose-800/50 bg-rose-950/30 text-rose-200",
                )}
              >
                #{t.truck_number}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
