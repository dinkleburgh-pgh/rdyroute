import clsx from "clsx";
import CoverageTag from "./CoverageTag";
import { getCoverageRouteNumber } from "../utils/truckStatus";
import { STATUS_LABELS } from "../constants/truckStatus";
import type { TruckWithState, TruckStatus } from "../types";

/**
 * Coverage/swap badges for a FLEET card, shown from BOTH sides of a relationship
 * so it's legible on every card it touches:
 *   - CARRIER side  — this truck loads another route:  #route ⇄ #thisTruck
 *   - COVERED side  — this truck's route loads on someone else: #thisRoute ⇄ #carrier
 *   - SPLIT         — overflow only (route also runs):  #route + #truck
 * Each pill carries the CARRIER's live load status so "getting loaded" (dirty /
 * in_progress) vs "has been loaded" (loaded) is readable at a glance. Every board
 * coverage field lives on the carrier and names the covered route, so the covered
 * direction is resolved via the reverse map (coveringTruckByRoute).
 */

const STATUS_BG: Partial<Record<TruckStatus, string>> = {
  dirty: "bg-red-600",
  unloaded: "bg-green-600",
  loaded: "bg-blue-600",
  in_progress: "bg-amber-500",
  off: "bg-slate-500",
  oos: "bg-slate-600",
  shop: "bg-purple-600",
  spare: "bg-cyan-700",
  unfinished: "bg-fuchsia-600",
};

/** The carrier's load status — the "getting loaded vs has been loaded" cue. */
function LoadChip({ status }: { status?: TruckStatus | null }) {
  if (!status) return null;
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white", STATUS_BG[status] ?? "bg-slate-600")}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function CoverageCardBadges({
  truck,
  board,
  coveringTruckByRoute,
  coveringRouteByTruckNum,
  isOos,
  onNavigate,
}: {
  truck: TruckWithState;
  board: TruckWithState[];
  /** covered route -> { carrier truck, its status } */
  coveringTruckByRoute: Map<number, { num: number; status: TruckStatus | undefined }>;
  /** carrier truck -> covered route (live only) */
  coveringRouteByTruckNum: Map<number, number>;
  isOos: boolean;
  onNavigate: (n: number) => void;
}) {
  const statusOf = (n: number): TruckStatus | undefined =>
    board.find((t) => t.truck_number === n)?.state?.status as TruckStatus | undefined;

  // CARRIER side — the route THIS truck loads (spare / one-way / two-way; excludes split).
  const carrierRoute = getCoverageRouteNumber(truck) ?? coveringRouteByTruckNum.get(truck.truck_number) ?? null;
  // This truck is a SPLIT helper — carries route N's overflow (N also runs).
  const splitCarry = carrierRoute == null ? (truck.route_split_route ?? null) : null;
  // COVERED side (only when not itself a carrier) — who loads THIS truck's route.
  const coveredBy = carrierRoute == null ? coveringTruckByRoute.get(truck.truck_number) : undefined;
  // This truck's route ALSO runs but its overflow rides another truck (split-covered).
  const splitHelper = board.find((t) => t.route_split_route === truck.truck_number)?.truck_number ?? null;

  const anyCoverage = carrierRoute != null || splitCarry != null || coveredBy != null || splitHelper != null;
  const showNeeds = isOos && !anyCoverage;
  if (!anyCoverage && !showNeeds) return null;

  const btn = "transition-transform active:scale-95";
  const stop = (n: number) => (e: React.MouseEvent) => { e.stopPropagation(); onNavigate(n); };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* This truck is LOADING another route */}
      {carrierRoute != null && (
        <>
          <button type="button" className={btn} title="This truck is loading another route — tap to view it" onClick={stop(carrierRoute)}>
            <CoverageTag route={carrierRoute} truck={truck.truck_number} />
          </button>
          <LoadChip status={truck.state?.status as TruckStatus | undefined} />
        </>
      )}
      {splitCarry != null && (
        <>
          <button type="button" className={btn} title="This truck carries another route's overflow — tap to view it" onClick={stop(splitCarry)}>
            <CoverageTag route={splitCarry} truck={truck.truck_number} split />
          </button>
          <LoadChip status={truck.state?.status as TruckStatus | undefined} />
        </>
      )}
      {/* This truck's route is LOADED ON another truck */}
      {coveredBy != null && (
        <>
          <button type="button" className={btn} title="This route is loaded on another truck — tap to view it" onClick={stop(coveredBy.num)}>
            <CoverageTag route={truck.truck_number} truck={coveredBy.num} />
          </button>
          <LoadChip status={statusOf(coveredBy.num) ?? coveredBy.status} />
        </>
      )}
      {splitHelper != null && (
        <>
          <button type="button" className={btn} title="This route runs; its overflow is loaded on another truck — tap to view it" onClick={stop(splitHelper)}>
            <CoverageTag route={truck.truck_number} truck={splitHelper} split />
          </button>
          <LoadChip status={statusOf(splitHelper)} />
        </>
      )}
      {showNeeds && <span className="text-[10px] font-semibold text-amber-400">Needs assignment</span>}
    </div>
  );
}
