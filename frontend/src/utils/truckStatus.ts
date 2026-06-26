/**
 * Shared truck-status logic used by Board, RunDay, and Layout.
 *
 * Keep pure (no React, no hooks) so it can be imported anywhere.
 */

import type { TruckStatus, TruckType, TruckWithState } from "../types";

/** Previous workday in the 1–5 day-number system (Mon→Fri on day 1). */
export function previousWorkday(dayNum: number): number {
  return dayNum === 1 ? 5 : dayNum - 1;
}

/**
 * Returns the effective display status for a truck on a given day.
 *
 * V1 parity: trucks whose route is scheduled off for the target day are shown
 * as "off" when they haven't entered an active workflow state yet (dirty or
 * unloaded). Spares are never auto-off, and the check is skipped entirely
 * when holiday mode is on (every route runs on holidays).
 *
 * A truck that was OFF the previous workday is shown as "unloaded" — it
 * didn't run, so it's ready for today's workflow.
 */
export function effectiveStatus(
  t: TruckWithState,
  dayNum: number,
  holidayMode = false,
): TruckStatus {
  const raw = (t.state?.status ?? "dirty") as TruckStatus;
  if (t.is_oos && raw !== "dirty") return "oos";
  if (
    !holidayMode &&
    t.truck_type !== "Spare" &&
    isScheduledOff(t, dayNum) &&
    (raw === "dirty" || raw === "unloaded")
  ) {
    // Trucks that actually ran (coverage route or ran special) should not be
    // suppressed to "off" — they need to go through the real workflow.
    const actuallyRan = getCoverageRouteNumber(t) != null || (t.state?.needs_checked ?? false);
    if (!actuallyRan) return "off";
  }
  return raw;
}

/**
 * Pure schedule check — is this truck assigned off on this day, regardless
 * of current operational status? Used for planning views (OffDaySchedulePanel,
 * day assignment filtering). Not affected by holiday mode.
 */
export function isScheduledOff(truck: { scheduled_off_days: number[] }, dayNum: number): boolean {
  return (truck.scheduled_off_days ?? []).includes(dayNum);
}

/**
 * Status-aware off-day check — matches the logic inside effectiveStatus.
 * Returns true only for route trucks (not spares) that are scheduled off
 * AND haven't entered an active workflow (status is dirty or unloaded).
 * Holiday mode disables the check entirely.
 */
export function isOffDay(truck: TruckWithState, dayNum: number, holidayMode = false): boolean {
  if (holidayMode) return false;
  if (truck.truck_type === "Spare") return false;
  if (!(truck.scheduled_off_days ?? []).includes(dayNum)) return false;
  const raw = (truck.state?.status ?? "dirty") as TruckStatus;
  return raw === "dirty" || raw === "unloaded";
}

/**
 * Count of loaded trucks matching the sidebar/board "loaded" filter.
 * Route trucks: effectiveWorkflowStatus === "loaded", and NOT covered by a swap/OOS spare.
 * Spare trucks: only counted when covering an OOS route and loaded.
 *
 * Covered route trucks are excluded because their route is being handled by
 * the covering truck — including them would over-count relative to the
 * denominator in buildOperationalDayContext (which already excludes them).
 */
export function countLoaded(
  board: TruckWithState[],
  loadDayNum: number,
  holidayLoad: boolean,
  unloadsDayNum: number,
  holidayUnload: boolean,
): number {
  const statusByNumber = new Map<number, TruckStatus>(
    board.map((t) => [t.truck_number, effectiveStatus(t, loadDayNum, holidayLoad)] as [number, TruckStatus]),
  );

  // Build the set of route numbers whose load is being handled by another truck
  // (same logic as buildOperationalDayContext) so we can exclude them below.
  const routeTruckByNumber = new Map<number, TruckWithState>();
  for (const t of board) {
    if (t.truck_type !== "Spare") routeTruckByNumber.set(t.truck_number, t);
  }
  // Only spare coverage removes a route truck from the count — a route-truck
  // swap leaves both trucks running (see buildOperationalDayContext).
  const coveredRouteNumbers = new Set<number>();
  for (const t of board) {
    if (t.truck_type !== "Spare") continue;
    const coveredRoute = getCoverageRouteNumber(t);
    if (coveredRoute != null && routeTruckByNumber.has(coveredRoute)) {
      coveredRouteNumbers.add(coveredRoute);
    }
  }

  return board.filter((t) => {
    const s = effectiveWorkflowStatus(t, loadDayNum, holidayLoad, unloadsDayNum, holidayUnload);
    if (s !== "loaded") return false;
    if (t.truck_type !== "Spare") {
      // Skip trucks whose route is being handled by a covering truck — they are
      // not in the denominator and should not inflate the numerator.
      if (coveredRouteNumbers.has(t.truck_number)) return false;
      return true;
    }
    const coveredRoute = getCoverageRouteNumber(t);
    if (coveredRoute == null) return false;
    const coveredStatus = statusByNumber.get(coveredRoute);
    return coveredStatus === "oos";
  }).length;
}

/**
 * Count of unloaded trucks from an already-built unload OperationalDayContext.
 * A truck counts as unloaded when its raw status is "unloaded" or "loaded"
 * (loaded means it unloaded previously and already moved to load workflow).
 */
export function countUnloadedFromContext(ctx: OperationalDayContext): number {
  return ctx.activeTrucks.filter((t) => {
    const raw = (t.state?.status ?? "dirty") as TruckStatus;
    return raw === "unloaded" || raw === "loaded";
  }).length;
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
 * - Spares only appear when covering an OOS route — idle spares are excluded
 *   from load/unload workflow counts entirely.
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

  // Second pass: find route numbers whose load is being handled by another
  // truck (route swap or OOS spare). These are excluded from route-truck
  // counts to mirror buildOperationalDayContext's denominator logic and
  // prevent numerator > denominator in the progress bars.
  const coveredRouteNumbers = new Set<number>();
  for (const t of trucks) {
    const coveredRoute = getCoverageRouteNumber(t);
    if (coveredRoute != null) coveredRouteNumbers.add(coveredRoute);
  }

  for (const t of trucks) {
    if (t.truck_type === "Spare") {
      const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
      // Covering spares also surface in their live workflow bucket (e.g. unloaded).
      if (coveredRoute != null && oosRouteNumbers.has(coveredRoute)) {
        out[statusFor(t)] += 1;
      }
      // Every available (non-OOS) spare counts in the Spare bucket — including
      // idle spares sitting unloaded and ready, so the sidebar reflects how many
      // spares are on hand, not just the ones currently covering a route.
      if (!t.is_oos) out.spare += 1;
      continue;
    }

    // Route trucks always count in their effective status (OOS stays OOS).
    // Unfinished trucks surface under Dirty in the sidebar.
    const s = statusFor(t);
    out[s === "unfinished" ? "dirty" : s] += 1;
    // If this truck is off for the load day but its workflow status resolved to
    // a real-work status (dirty/in_progress/loaded), count it in "off" too so
    // the sidebar shows the off filter count alongside its workflow bucket.
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
  includeOffDayCoverage = false,
): OperationalDayContext {
  const routeTruckByNumber = new Map<number, TruckWithState>();
  for (const truck of trucks) {
    if (truck.truck_type !== "Spare") {
      routeTruckByNumber.set(truck.truck_number, truck);
    }
  }

  // Only a Spare physically takes over a route so the original truck doesn't
  // run — that route is removed from the count. A route-truck "swap" means BOTH
  // trucks run (they just swap loads), so a swap must NOT remove either route.
  const coveredRouteNumbers = new Set<number>();
  for (const truck of trucks) {
    if (truck.truck_type !== "Spare") continue;
    const coveredRoute = getCoverageRouteNumber(truck);
    if (coveredRoute != null) {
      const coveredTruck = routeTruckByNumber.get(coveredRoute);
      if (
        coveredTruck &&
        (holidayMode || !isScheduledOff(coveredTruck, dayNum))
      ) {
        coveredRouteNumbers.add(coveredRoute);
      }
    }
  }

  const activeTrucks: TruckWithState[] = [];
  for (const truck of trucks) {
    // Covering spares stand in for the route truck — count the spare instead.
    if (truck.truck_type === "Spare") {
      const coveredRoute = getCoverageRouteNumber(truck);
      if (coveredRoute != null) {
        const coveredTruck = routeTruckByNumber.get(coveredRoute);
        if (coveredTruck && (holidayMode || includeOffDayCoverage || !isScheduledOff(coveredTruck, dayNum))) {
          activeTrucks.push(truck);
        }
      }
      // Idle spares (no coverage) never participate in the load/unload count.
      continue;
    }

    // Route trucks count purely by the fleet schedule: a route runs (and must
    // be unloaded) iff it's not scheduled off that day. Operational state — OOS,
    // route swaps — never changes this, because a scheduled route always runs
    // (covered when needed). Only a spare physically taking over removes a route.
    if (!holidayMode && isScheduledOff(truck, dayNum)) continue;
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
