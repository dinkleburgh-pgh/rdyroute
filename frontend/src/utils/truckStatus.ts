/**
 * Shared truck-status logic used by Board, RunDay, and Layout.
 *
 * Keep pure (no React, no hooks) so it can be imported anywhere.
 */

import type { TruckStatus, TruckType, TruckWithState } from "../types";

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

export function getCoverageRouteNumber(t: TruckWithState): number | null {
  return t.route_swap_route ?? t.state?.oos_spare_route ?? null;
}

export function effectiveOperationalStatus(
  t: TruckWithState,
  dayNum: number,
  holidayMode = false,
): TruckStatus {
  if (t.is_oos) return "oos";
  if (getCoverageRouteNumber(t) != null) {
    return (t.state?.status ?? "dirty") as TruckStatus;
  }
  return effectiveStatus(t, dayNum, holidayMode);
}

/**
 * Returns the operational lifecycle status used by the board/sidebar when a
 * truck is off for the next load day but still has work on the current unloads
 * day. In that case, dirty/unloaded trucks stay visible in their real workflow
 * bucket instead of disappearing under "off".
 */
export function effectiveWorkflowStatus(
  t: TruckWithState,
  loadDayNum: number,
  holidayLoad = false,
  unloadsDayNum?: number,
  holidayUnload?: boolean,
): TruckStatus {
  const loadDayStatus = effectiveStatus(t, loadDayNum, holidayLoad);
  if (unloadsDayNum !== undefined && loadDayStatus === "off") {
    const raw = (t.state?.status ?? "dirty") as TruckStatus;
    if (raw === "dirty" || raw === "unloaded") {
      return effectiveStatus(t, unloadsDayNum, holidayUnload ?? holidayLoad);
    }
  }
  return loadDayStatus;
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
  unloadsDayNum?: number,
  holidayUnload?: boolean,
): Record<TruckStatus, number> {
  const out: Record<TruckStatus, number> = {
    dirty: 0,
    unfinished: 0,
    shop: 0,
    in_progress: 0,
    unloaded: 0,
    loaded: 0,
    off: 0,
    oos: 0,
    spare: 0,
  };

  function statusFor(t: TruckWithState): TruckStatus {
    const coveredRoute = getCoverageRouteNumber(t);
    if (coveredRoute != null) {
      return effectiveOperationalStatus(t, loadDayNum, holidayLoad);
    }
    return effectiveWorkflowStatus(t, loadDayNum, holidayLoad, unloadsDayNum, holidayUnload);
  }

  // First pass: identify which route numbers are currently OOS so covering
  // spares can be bucketed into their lifecycle status rather than "spare".
  const oosRouteNumbers = new Set<number>();
  for (const t of trucks) {
    if (t.truck_type !== "Spare" && statusFor(t) === "oos") {
      oosRouteNumbers.add(t.truck_number);
    }
  }

  for (const t of trucks) {
    if (t.truck_type === "Spare") {
      // A spare actively covering an OOS route represents that route in the
      // workflow — count it under its own lifecycle status.
      const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
      if (coveredRoute != null && oosRouteNumbers.has(coveredRoute)) {
        out[statusFor(t)] += 1;
        out.spare += 1;
      } else {
        out.spare += 1;
        const s = statusFor(t);
        out[s] += 1;
      }
      continue;
    }

    // Route trucks always count in their effective status (OOS stays OOS).
    // Unfinished trucks surface under Dirty in the sidebar.
    const s = statusFor(t);
    out[s === "unfinished" ? "dirty" : s] += 1;
    // Also count in "off" if this truck is off for the load day but is being
    // shown under its unload-context status (dirty/unloaded). Both counts are
    // independently useful: unloaded = work to do today, off = not loading tomorrow.
    const loadDayEff = effectiveStatus(t, loadDayNum, holidayLoad);
    if (loadDayEff === "off" && s !== "off") {
      out.off += 1;
    }
  }

  return out;
}

export interface OperationalDayContext {
  activeTrucks: TruckWithState[];
  coveredRouteNumbers: Set<number>;
  routeTruckByNumber: Map<number, TruckWithState>;
}

export function buildOperationalDayContext(
  trucks: TruckWithState[],
  dayNum: number,
  holidayMode = false,
): OperationalDayContext {
  const routeTruckByNumber = new Map<number, TruckWithState>();
  for (const truck of trucks) {
    if (truck.truck_type !== "Spare") {
      routeTruckByNumber.set(truck.truck_number, truck);
    }
  }

  const coveredRouteNumbers = new Set<number>();
  for (const truck of trucks) {
    const coveredRoute = getCoverageRouteNumber(truck);
    if (coveredRoute != null) {
      const coveredTruck = routeTruckByNumber.get(coveredRoute);
      if (
        coveredTruck &&
        (holidayMode || !coveredTruck.scheduled_off_days.includes(dayNum))
      ) {
        coveredRouteNumbers.add(coveredRoute);
      }
    }
  }

  const activeTrucks: TruckWithState[] = [];
  for (const truck of trucks) {
    const coveredRoute = getCoverageRouteNumber(truck);
    if (coveredRoute != null) {
      const coveredTruck = routeTruckByNumber.get(coveredRoute);
      if (
        coveredTruck &&
        (holidayMode || !coveredTruck.scheduled_off_days.includes(dayNum))
      ) {
        activeTrucks.push(truck);
      }
      continue;
    }

    if (truck.truck_type === "Spare") continue;
    if (!holidayMode && truck.scheduled_off_days.includes(dayNum)) continue;
    if (coveredRouteNumbers.has(truck.truck_number)) continue;
    activeTrucks.push(truck);
  }

  return {
    activeTrucks,
    coveredRouteNumbers,
    routeTruckByNumber,
  };
}

export function getOperationalTruckType(
  t: TruckWithState,
  routeTruckByNumber: Map<number, TruckWithState>,
): TruckType {
  const coveredRoute = getCoverageRouteNumber(t);
  if (coveredRoute != null) {
    return routeTruckByNumber.get(coveredRoute)?.truck_type ?? t.truck_type;
  }
  return t.truck_type;
}

// ---------------------------------------------------------------------------
// Route-swap "Last Used" history  (localStorage, route-specific)
// ---------------------------------------------------------------------------

const _SWAP_HISTORY_KEY = "rr_swap_history";
const _SWAP_HISTORY_MAX = 3;

/** Record that `loadOnTruck` was used to cover `routeTruck`. */
export function recordSwapHistory(routeTruck: number, loadOnTruck: number): void {
  try {
    const raw = localStorage.getItem(_SWAP_HISTORY_KEY);
    const all: Record<string, number[]> = raw ? JSON.parse(raw) : {};
    const prev = all[String(routeTruck)] ?? [];
    // Deduplicate, keep most-recent first, cap at max
    const next = [loadOnTruck, ...prev.filter((n) => n !== loadOnTruck)].slice(0, _SWAP_HISTORY_MAX);
    all[String(routeTruck)] = next;
    localStorage.setItem(_SWAP_HISTORY_KEY, JSON.stringify(all));
  } catch {}
}

/** Return the last-used load-on truck numbers for a given route (most-recent first). */
export function getSwapHistory(routeTruck: number): number[] {
  try {
    const raw = localStorage.getItem(_SWAP_HISTORY_KEY);
    if (!raw) return [];
    const all: Record<string, number[]> = JSON.parse(raw);
    return all[String(routeTruck)] ?? [];
  } catch { return []; }
}
