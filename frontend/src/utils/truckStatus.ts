/**
 * Shared truck-status logic used by Board, RunDay, and Layout.
 *
 * Keep pure (no React, no hooks) so it can be imported anywhere.
 */

import type { TruckStatus, TruckWithState } from "../types";

/**
 * Returns the effective display status for a truck on a given day.
 *
 * V1 parity: trucks whose route is scheduled off for the target day are shown
 * as "off" when they haven't entered an active workflow state yet (dirty or
 * unloaded). Spares are never auto-off, and the check is skipped entirely
 * when holiday mode is on (every route runs on holidays).
 */
export function effectiveStatus(
  t: TruckWithState,
  dayNum: number,
  holidayMode = false,
): TruckStatus {
  const raw = (t.state?.status ?? "dirty") as TruckStatus;
  if (
    !holidayMode &&
    t.truck_type !== "Spare" &&
    t.scheduled_off_days.includes(dayNum) &&
    (raw === "dirty" || raw === "unloaded")
  )
    return "off";
  return raw;
}

/**
 * Builds a route-aware status count map for the sidebar / progress display.
 *
 * Rules:
 * - Every spare counts once in the "spare" bucket regardless of lifecycle.
 * - A spare's in_progress / loaded state is promoted to the route it is
 *   covering (via route_swap_route) so the sidebar reflects route progress
 *   rather than inflating lifecycle buckets with spare trucks.
 * - Non-spare trucks on a scheduled-off day (dirty or unloaded) count as
 *   "off" unless holiday mode is active.
 */
export function buildRouteStatusCounts(
  trucks: TruckWithState[],
  loadDayNum: number,
  holidayLoad: boolean,
): Record<TruckStatus, number> {
  const out: Record<TruckStatus, number> = {
    dirty: 0,
    shop: 0,
    in_progress: 0,
    unloaded: 0,
    loaded: 0,
    off: 0,
    oos: 0,
    spare: 0,
  };

  // Build a map of covered route → spare's current status so we can promote
  // the route's bucket when the spare is further along (in_progress / loaded).
  const swapByRoute = new Map<number, TruckStatus>();
  for (const t of trucks) {
    if (t.truck_type === "Spare" && t.route_swap_route != null) {
      swapByRoute.set(t.route_swap_route, (t.state?.status ?? "dirty") as TruckStatus);
    }
  }

  for (const t of trucks) {
    const raw = (t.state?.status ?? "dirty") as TruckStatus;

    if (t.truck_type === "Spare") {
      out.spare += 1;
      continue;
    }

    let s: TruckStatus = effectiveStatus(t, loadDayNum, holidayLoad);

    // Promote the route's status when the covering spare is ahead in the
    // workflow — the spare represents this route's operational progress.
    const spareStatus = swapByRoute.get(t.truck_number);
    if (spareStatus === "loaded") s = "loaded";
    else if (spareStatus === "in_progress" && s !== "loaded") s = "in_progress";

    out[s] += 1;
  }

  return out;
}
