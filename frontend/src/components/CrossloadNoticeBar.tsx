/**
 * Crossload notice bar — the "someone needs to act on this" surface for the
 * needs_crossload flag.
 *
 * The flag can exist without a destination (a loaded truck going OOS raises it
 * automatically), and until now the only places it showed were the fleet card
 * chip and the Route Swaps accordion — easy to sail past. This bar sits at the
 * top of the Fleet and Load boards whenever any truck is flagged, lists each
 * one as freight → destination (or "pick a truck" when none is chosen), and
 * for roles that manage swaps opens Route Swaps directly on the crossload
 * section. Renders nothing when no truck is flagged, which is almost always.
 */
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import RouteSwapModal from "./RouteSwapModal";
import { useAuth } from "../contexts/AuthContext";
import type { TruckWithState } from "../types";

export default function CrossloadNoticeBar({ board }: { board: TruckWithState[] }) {
  const { user } = useAuth();
  const canAssign = ["admin", "fleet", "supervisor", "atl"].includes(user?.role ?? "");
  const [swapsOpen, setSwapsOpen] = useState(false);

  const flagged = useMemo(
    () =>
      board
        .filter((t) => t.state?.needs_crossload || t.state?.crossload_to_truck != null)
        .sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );
  if (flagged.length === 0) return null;

  const unassigned = flagged.filter((t) => t.state?.crossload_to_truck == null).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-fuchsia-800/50 bg-fuchsia-950/25 px-3.5 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-fuchsia-300">
          Needs crossloaded
        </span>
        {flagged.map((t) => (
          <span
            key={t.truck_number}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill border border-fuchsia-800/50 bg-slate-950/40 px-2 py-0.5 font-mono text-[12px] font-bold"
          >
            <span className="text-fuchsia-200">#{t.truck_number}</span>
            <ArrowRight className="h-3 w-3 text-fuchsia-500/80" />
            {t.state?.crossload_to_truck != null ? (
              <span className="text-fuchsia-100">#{t.state.crossload_to_truck}</span>
            ) : (
              <span className="font-sans font-semibold text-fuchsia-400/90">pick a truck</span>
            )}
          </span>
        ))}
        {canAssign && (
          <button
            type="button"
            onClick={() => setSwapsOpen(true)}
            className="ml-auto rounded-md border border-fuchsia-700/60 bg-fuchsia-900/40 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-900/70"
          >
            {unassigned > 0 ? "Assign truck" : "Manage"}
          </button>
        )}
      </div>
      {swapsOpen && <RouteSwapModal initialSection="crossload" onClose={() => setSwapsOpen(false)} />}
    </>
  );
}
