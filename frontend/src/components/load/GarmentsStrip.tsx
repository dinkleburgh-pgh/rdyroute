import { useState } from "react";
import clsx from "clsx";
import { DustGarmentIcon } from "../icons";
import { GARMENT_LOADED_HEX, GARMENT_PENDING_HEX } from "../../utils/truckStatus";
import type { TruckWithState } from "../../types";

/**
 * The F.S. garment checklist — one chip per F.S. truck in three states:
 * loaded with garments (cyan, out the door), garments still to load (amber,
 * needs action), or no garments (muted).
 *
 * Extracted from Load.tsx so the full-screen Load Display shows the same
 * strip. Read-only; `has_dust_garment` is set from the board / run-day wizard.
 *
 * Once the day's garments ARE set, the trucks without them are hidden: they
 * are the majority of the strip and none of its point, and on the Load Display
 * that space is competing with the panels below. Before anything is set there
 * is nothing to filter by, so the full list shows — otherwise the strip would
 * look empty exactly when someone needs to see the roster.
 */
export default function GarmentsStrip({
  trucks,
  className,
}: {
  /** Every F.S. truck, regardless of schedule or status. */
  trucks: TruckWithState[];
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const withGarment = trucks.filter((t) => t.state?.has_dust_garment).length;
  const anySet = withGarment > 0;
  const shown = anySet && !showAll
    ? trucks.filter((t) => t.state?.has_dust_garment)
    : trucks;
  const hidden = trucks.length - shown.length;
  return (
    <div
      className={clsx("rounded-xl border", className)}
      style={{ borderColor: "rgba(245,158,11,0.30)", background: "rgba(245,158,11,0.07)" }}
    >
      <div className="flex w-full items-center gap-2 px-3 py-2.5">
        <DustGarmentIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">F.S. Garments</span>
        {/* The hidden ones stay one tap away rather than gone — the count says
            they exist, so nobody has to wonder where a truck went. */}
        {hidden > 0 || showAll ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="ml-auto font-mono text-xs tabular-nums text-ink-muted underline-offset-2 transition-colors hover:text-ink-soft hover:underline"
          >
            {withGarment} of {trucks.length} w/ garment
            <span className="ml-1.5 text-ink-faint">{showAll ? "· hide rest" : `· +${hidden}`}</span>
          </button>
        ) : (
          <span className="ml-auto font-mono text-xs tabular-nums text-ink-muted">
            {withGarment} w/ garment
          </span>
        )}
      </div>
      <div className="border-t px-3 pb-3 pt-2" style={{ borderColor: "rgba(245,158,11,0.20)" }}>
        {trucks.length === 0 ? (
          <p className="text-xs text-ink-faint">No F.S. trucks scheduled.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((t) => {
              const garment = t.state?.has_dust_garment === true;
              // Garments already out the door read blue/cyan (done); still
              // pending ones stay amber (needs action); no garment is muted.
              const done = garment && t.state?.status === "loaded";
              const color = done ? GARMENT_LOADED_HEX : garment ? GARMENT_PENDING_HEX : "#6f7c8e";
              return (
                <span
                  key={t.truck_number}
                  title={done ? "Loaded with garments" : garment ? "Garments to load" : "No garments"}
                  className={clsx(
                    "inline-flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-base font-bold",
                    done
                      ? "border-sky-500/60 bg-sky-950/50"
                      : garment
                        ? "border-amber-600/60 bg-amber-950/50"
                        : "border-hairline bg-surface-3",
                  )}
                  style={{ color }}
                >
                  #{t.truck_number}
                  {garment && <DustGarmentIcon className="h-5 w-5" style={{ color }} />}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
