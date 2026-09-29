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
 * One wrapping row that hugs its chips: label, chips, count. It never holds
 * more than a handful once the day's garments are set, so the old two-band
 * card (header row, rule, chip row) at half the page width was mostly empty
 * space. Extracted from Load.tsx so the full-screen Load Display shows the
 * same strip. Read-only; `has_dust_garment` is set from the board / wizard.
 *
 * Once the day's garments ARE set, the trucks without them are hidden: they
 * are the majority of the strip and none of its point. Before anything is set
 * there is nothing to filter by, so the full list shows — otherwise the strip
 * would look empty exactly when someone needs to see the roster.
 */

/** The checklist chip — shared with NogsStrip so the two rows read as one
 *  family at one size (the NOG chips used to be a size smaller). */
export const CHECKLIST_CHIP =
  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-base font-bold tabular-nums";

export default function GarmentsStrip({
  trucks,
  loadingNow,
  carriers,
  className,
}: {
  /** Every F.S. truck, regardless of schedule or status. */
  trucks: TruckWithState[];
  /** Chips whose garments are on the truck being loaded right now
   *  (loadingCargo().numbers) — their icon flashes. */
  loadingNow?: ReadonlySet<number>;
  /** Covered route -> the truck carrying its freight (loadingCargo().carriers).
   *  A chip is "out the door" when its CARRIER is loaded, not its own truck. */
  carriers?: ReadonlyMap<number, TruckWithState>;
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
      className={clsx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2", className)}
      style={{ borderColor: "rgba(245,158,11,0.30)", background: "rgba(245,158,11,0.07)" }}
    >
      <span className="inline-flex shrink-0 items-center gap-2">
        <DustGarmentIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">F.S. Garments</span>
      </span>
      {trucks.length === 0 ? (
        <p className="text-xs text-ink-faint">No F.S. trucks scheduled.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((t) => {
            const garment = t.state?.has_dust_garment === true;
            // Garments already out the door read blue/cyan (done); still
            // pending ones stay amber (needs action); no garment is muted.
            // Being loaded right now: the icon flashes until the load is
            // finished — the moment the garments have to go on. It wins over
            // "done": in a two-way swap the chip's own truck may already be
            // loaded (with its partner's freight) while ITS garments are on
            // this load.
            const loading = garment && loadingNow?.has(t.truck_number) === true;
            const carrier = carriers?.get(t.truck_number) ?? t;
            const done = garment && !loading && carrier.state?.status === "loaded";
            const color = done ? GARMENT_LOADED_HEX : garment ? GARMENT_PENDING_HEX : "#6f7c8e";
            return (
              <span
                key={t.truck_number}
                title={done ? "Loaded with garments" : loading ? "Loading now — garments go on this load" : garment ? "Garments to load" : "No garments"}
                className={clsx(
                  CHECKLIST_CHIP,
                  done
                    ? "border-sky-500/60 bg-sky-950/50"
                    : garment
                      ? "border-amber-600/60 bg-amber-950/50"
                      : "border-hairline bg-surface-3",
                  loading && "ring-2 ring-amber-400/80",
                )}
                style={{ color }}
              >
                #{t.truck_number}
                {garment && <DustGarmentIcon className={clsx("h-5 w-5", loading && "animate-cargo-flash")} style={{ color }} />}
              </span>
            );
          })}
        </div>
      )}
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
        trucks.length > 0 && (
          <span className="ml-auto font-mono text-xs tabular-nums text-ink-muted">
            {withGarment} w/ garment
          </span>
        )
      )}
    </div>
  );
}
