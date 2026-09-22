import clsx from "clsx";
import type { TruckWithState } from "../types";

/**
 * NOGs checklist — "Not Our Garments" came back on these routes today.
 *
 * Sibling of the F.S. Garments strip, but for every route truck and on the
 * UNLOAD side, because NOGs are discovered while working through a dirty
 * truck. Read-only; the flag is set from the truck's status sheet. When
 * nothing is flagged the strip stays off the page entirely — it is a report
 * of findings, not a roster to work through.
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
  return (
    <div
      className={clsx("rounded-xl border", className)}
      style={{ borderColor: "rgba(244,63,94,0.30)", background: "rgba(244,63,94,0.06)" }}
    >
      <div className="flex w-full items-center gap-2 px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-rose-400">NOGs — not our garments</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-ink-muted">
          {trucks.length} route{trucks.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "rgba(244,63,94,0.20)" }}>
        <div className="flex flex-wrap gap-1.5">
          {trucks.map((t) => (
            <span
              key={t.truck_number}
              className="rounded-md border border-rose-800/50 bg-rose-950/30 px-2 py-0.5 font-mono text-sm font-bold text-rose-200"
            >
              #{t.truck_number}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
