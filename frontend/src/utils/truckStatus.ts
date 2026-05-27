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
  // is_oos flag persists across dates until explicitly disabled
  if (t.is_oos) return "oos";
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
 * - Route trucks always count in their own effectiveStatus bucket (OOS trucks
 *   always appear in "oos", never promoted to a spare's status).
 * - A spare covering an OOS route counts in its own lifecycle bucket so the
 *   sidebar reflects whether that route is being actively serviced (loaded,
 *   in_progress, etc.) in addition to the OOS count.
 * - Spares not covering any OOS route count in the "spare" bucket.
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

  // First pass: identify which route numbers are currently OOS so covering
  // spares can be bucketed into their lifecycle status rather than "spare".
  const oosRouteNumbers = new Set<number>();
  for (const t of trucks) {
    if (t.truck_type !== "Spare" && effectiveStatus(t, loadDayNum, holidayLoad) === "oos") {
      oosRouteNumbers.add(t.truck_number);
    }
  }

  for (const t of trucks) {
    if (t.truck_type === "Spare") {
      // A spare actively covering an OOS route represents that route in the
      // workflow — count it under its own lifecycle status.
      const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
      if (coveredRoute != null && oosRouteNumbers.has(coveredRoute)) {
        out[effectiveStatus(t, loadDayNum, holidayLoad)] += 1;
      } else {
        out.spare += 1;
      }
      continue;
    }

    // Route trucks always count in their effective status (OOS stays OOS).
    out[effectiveStatus(t, loadDayNum, holidayLoad)] += 1;
  }

  return out;
}
