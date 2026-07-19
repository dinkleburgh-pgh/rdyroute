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
 * Truck numbers counting toward the sidebar/board "loaded" progress.
 *
 * Derived from the SAME schedule context that supplies the denominator
 * (buildOperationalDayContext(board, loadDayNum).activeTrucks), so the
 * numerator is structurally a subset of the total. The previous hand-copied
 * version replicated only some of the context's exclusions: a truck carrying
 * "loaded" status while scheduled OFF the load day (e.g. after an off-day
 * schedule move, or loaded ahead) was counted but absent from the total —
 * the sidebar read 38/33.
 *
 * unloadsDayNum/holidayUnload are retained for call-site compatibility; the
 * unload-day fallback in effectiveWorkflowStatus only ever rewrites
 * dirty/unloaded statuses, so it can never produce (or hide) a "loaded".
 */
export function loadedTruckNumbers(
  board: TruckWithState[],
  loadDayNum: number,
  holidayLoad: boolean,
  _unloadsDayNum?: number,
  _holidayUnload?: boolean,
): number[] {
  return buildOperationalDayContext(board, loadDayNum, holidayLoad)
    .activeTrucks.filter((t) => t.state?.status === "loaded")
    .map((t) => t.truck_number);
}

/** Count of loaded trucks (see {@link loadedTruckNumbers}). */
export function countLoaded(
  board: TruckWithState[],
  loadDayNum: number,
  holidayLoad: boolean,
  unloadsDayNum: number,
  holidayUnload: boolean,
): number {
  return loadedTruckNumbers(board, loadDayNum, holidayLoad, unloadsDayNum, holidayUnload).length;
}

/**
 * A PURE day-init seed: status "unloaded" written by the auto seeder, never
 * touched by the workflow (no unloaded_at). The fleet SCHEDULE is the truth
 * for what must be unloaded — a scheduled truck the seeder guessed clean
 * stays in the denominator as pending work, but nobody unloaded it, so it
 * must not count as done (a stale board otherwise started at 6/28 done).
 */
export function isPureUnloadSeed(t: TruckWithState): boolean {
  return (
    t.state?.status === "unloaded" &&
    t.state?.state_source === "auto" &&
    t.state?.unloaded_at == null
  );
}

/**
 * Count of unloaded trucks from an already-built unload OperationalDayContext.
 * A truck counts as unloaded when its raw status is "unloaded" or "loaded"
 * (loaded means it unloaded previously and already moved to load workflow) —
 * except pure day-init seeds, which are pending work, not completed work.
 */
export function unloadedTruckNumbersFromContext(ctx: OperationalDayContext): number[] {
  return ctx.activeTrucks.filter((t) => {
    if (isPureUnloadSeed(t)) return false;
    const raw = (t.state?.status ?? "dirty") as TruckStatus;
    return raw === "unloaded" || raw === "loaded";
  }).map((t) => t.truck_number);
}

/** Count of unloaded trucks from an unload context (see {@link unloadedTruckNumbersFromContext}). */
export function countUnloadedFromContext(ctx: OperationalDayContext): number {
  return unloadedTruckNumbersFromContext(ctx).length;
}

export function getCoverageRouteNumber(t: TruckWithState): number | null {
  return t.route_swap_route ?? t.state?.oos_spare_route ?? null;
}

/**
 * Route this truck has physically TAKEN OVER — meaning the covered route's
 * own truck did NOT run and must never appear/count alongside its cover.
 *
 * True for any truck carrying `state.oos_spare_route` (spare-style coverage
 * is about the ASSIGNMENT, not the covering truck's type — a Uniform can
 * carry it, e.g. #75 covering route 53 on 2026-07-16), and for a Spare with
 * `route_swap_route`. A non-Spare `route_swap_route` is a load SWAP: both
 * trucks still run, so it is NOT a takeover.
 */
export function takenOverRouteNumber(t: TruckWithState): number | null {
  return t.state?.oos_spare_route ?? (t.truck_type === "Spare" ? t.route_swap_route ?? null : null);
}

export interface RouteSwapLogEntryLike {
  run_date: string;
  route_truck: number;
  load_on_truck: number;
}

export interface OpenSpareAssignmentLike {
  covering_route_truck: number;
  spare_truck_number: number;
  assigned_at: string;
}

/**
 * Read-only fallback coverage for routes still flagged is_oos with no LIVE
 * assignment as of asOfDate (e.g. nobody has re-confirmed the swap yet this
 * shift). The route truck didn't suddenly become dirty just because today's
 * coverage record lapsed — it's still represented by whoever covered it most
 * recently. Never writes anything; it only fills the display gap until the
 * swap is re-confirmed or the truck leaves OOS. Used by the Board's coverage
 * map, the sidebar's Live Status counts, and the Day Overview, so all three
 * always agree.
 *
 * Primary source: an open (never-returned) spare_assignments row for the
 * route, regardless of which day it was created — returned=false is the
 * authoritative "still active" signal, so it doesn't matter whether that row
 * is from yesterday or three weeks ago (unlike a date-recency heuristic,
 * which breaks the moment a covering spare's status.dirty is inherited from
 * an assignment that's older than the swap log's lookback window, or was
 * never logged at all — e.g. seeded directly rather than through the API).
 * Secondary source: the route-swap log's most recent entry on/before asOfDate
 * — RouteSwap rows are hard-deleted when cleared, so there's no "still open"
 * signal for route-truck swaps; the log is the best available signal there.
 */
export function buildHistoricalCoverageFallback(
  trucks: TruckWithState[],
  openSpareAssignments: OpenSpareAssignmentLike[],
  swapLog: RouteSwapLogEntryLike[],
  asOfDate: string,
): Map<number, number> {
  const liveCovered = new Set<number>();
  for (const t of trucks) {
    const r = getCoverageRouteNumber(t);
    if (r != null) liveCovered.add(r);
  }
  const fallback = new Map<number, number>();
  for (const t of trucks) {
    if (t.truck_type === "Spare" || !t.is_oos || liveCovered.has(t.truck_number)) continue;

    const open = openSpareAssignments
      .filter((a) => a.covering_route_truck === t.truck_number)
      .sort((a, b) => (a.assigned_at < b.assigned_at ? 1 : -1))[0];
    if (open) {
      fallback.set(t.truck_number, open.spare_truck_number);
      continue;
    }

    let bestDate: string | null = null;
    let bestLoadOn: number | null = null;
    for (const e of swapLog) {
      if (e.route_truck !== t.truck_number || e.run_date > asOfDate) continue;
      if (bestDate === null || e.run_date > bestDate) {
        bestDate = e.run_date;
        bestLoadOn = e.load_on_truck;
      }
    }
    if (bestLoadOn != null) fallback.set(t.truck_number, bestLoadOn);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Previous-day coverage (shared by Day Overview, Unload board, Reminders)
// ---------------------------------------------------------------------------

/**
 * The previous OPERATING day as a YYYY-MM-DD string, stepping over the weekend
 * (Monday's previous run day is Friday). Mirrors the run_date logic used across
 * the app so prior-day coverage follows the ship day across weekends. NOTE:
 * distinct from previousWorkday(), which returns a weekday NUMBER (1-5), not a
 * date.
 */
export function previousRunDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6); // skip Sun(0)/Sat(6)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface PrevDayCoverage {
  /** The actual run_date the coverage was resolved from (<= prevRunDate), or null. */
  date: string | null;
  /** route -> covering truck, sorted by route for display. */
  items: { route: number; loadOn: number }[];
  /** route number -> the truck that covered it. */
  byRoute: Map<number, number>;
  /** covering truck number -> the route it covered (inverse of byRoute). */
  byCover: Map<number, number>;
}

/**
 * Resolve who covered which route on/before `prevRunDate` from the route-swap
 * log: take the most recent operating day on/before prevRunDate that has any
 * entries, then the newest entry per route wins (the log is ordered newest
 * first). This is the same resolution the Day Overview uses; sharing it keeps
 * the Unload board and Reminders in lock-step, and it's what a manually-set
 * "Previous Day Coverage" record (a route_swap_log row dated to prevRunDate)
 * feeds into.
 */
export function buildPrevDayCoverage(
  swapLog: RouteSwapLogEntryLike[],
  prevRunDate: string,
): PrevDayCoverage {
  // Only surface coverage from the ACTUAL previous run day. Falling back to the
  // most recent swap on/before prevRunDate surfaced week-old coverage on days
  // that simply had no swaps — misleading, since those trucks returned and were
  // unloaded days ago. If the previous run day had no coverage, show nothing.
  const onPrevDay = swapLog.filter((e) => e.run_date === prevRunDate);
  if (onPrevDay.length === 0) return { date: null, items: [], byRoute: new Map(), byCover: new Map() };
  const byRoute = new Map<number, number>();
  // Newest-first log order → first entry seen per route is the most recent.
  for (const e of onPrevDay) {
    if (!byRoute.has(e.route_truck)) byRoute.set(e.route_truck, e.load_on_truck);
  }
  const items = [...byRoute.entries()]
    .map(([route, loadOn]) => ({ route, loadOn }))
    .sort((a, b) => a.route - b.route);
  const byCover = new Map<number, number>();
  for (const { route, loadOn } of items) byCover.set(loadOn, route);
  return { date: prevRunDate, items, byRoute, byCover };
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
  historicalCoverageFallback?: Map<number, number>,
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

  // Find route numbers whose load is being handled by another truck (route
  // swap or OOS spare). These are excluded from route-truck counts to mirror
  // buildOperationalDayContext's denominator logic and prevent numerator >
  // denominator in the progress bars. Computed up front (independent of
  // statusFor) so statusFor can consult it below.
  const coveredRouteNumbers = new Set<number>();
  for (const t of trucks) {
    const coveredRoute = getCoverageRouteNumber(t);
    if (coveredRoute != null) coveredRouteNumbers.add(coveredRoute);
  }
  if (historicalCoverageFallback) {
    for (const route of historicalCoverageFallback.keys()) coveredRouteNumbers.add(route);
  }
  // Routes physically TAKEN OVER (any truck's oos_spare_route, or a covering
  // Spare) — the covered truck is represented by its carrier and must not
  // also count, regardless of its own is_oos flag (a cleared flag let both
  // sides of "4 → 50" count as Loaded: sidebar 31 vs 29 real trucks).
  const takenOverRoutes = new Set<number>();
  for (const t of trucks) {
    const r = takenOverRouteNumber(t);
    if (r != null) takenOverRoutes.add(r);
  }

  function statusFor(t: TruckWithState): TruckStatus {
    // is_oos only overrides the workflow status once a covering truck is
    // actually assigned (matches the Board's Dirty/etc. filters): the covering
    // truck's card represents the route from then on. An is_oos truck with no
    // coverage yet is still physically sitting there — if it's dirty, someone
    // still has to unload it, so its real workflow status stands until it's
    // covered or unloaded.
    if (t.truck_type !== "Spare" && t.is_oos && coveredRouteNumbers.has(t.truck_number)) return "oos";
    const coveredRoute = getCoverageRouteNumber(t);
    if (coveredRoute != null) {
      return effectiveOperationalStatus(t, loadDayNum, holidayLoad);
    }
    return effectiveWorkflowStatus(t, loadDayNum, holidayLoad, unloadsDayNum, holidayUnload);
  }

  // Identify which route numbers are currently OOS so covering spares can be
  // bucketed into their lifecycle status rather than "spare".
  const oosRouteNumbers = new Set<number>();
  for (const t of trucks) {
    if (t.truck_type !== "Spare" && statusFor(t) === "oos") {
      oosRouteNumbers.add(t.truck_number);
    }
  }

  // Reverse the historical fallback (route -> covering truck) so a spare found
  // only via history (no live coverage field on its own state) still resolves
  // which route it's standing in for, below.
  const fallbackRouteByTruck = new Map<number, number>();
  if (historicalCoverageFallback) {
    for (const [route, truckNum] of historicalCoverageFallback) fallbackRouteByTruck.set(truckNum, route);
  }

  for (const t of trucks) {
    // A taken-over route's truck is represented by its carrier's card/count.
    if (t.truck_type !== "Spare" && takenOverRoutes.has(t.truck_number)) continue;
    if (t.truck_type === "Spare") {
      // Mirror the Board's Dirty/Unloaded filters exactly: ANY spare sitting
      // dirty/unfinished counts there whether or not it's covering a route
      // (it's a truck sitting there either way), same for unloaded. Only fall
      // back to the covering-route bucket for other statuses (e.g. a covering
      // spare that's in_progress/loaded). Otherwise the sidebar undercounted
      // Dirty by however many idle (non-covering) dirty spares existed.
      const rawSpareStatus = t.state?.status;
      if (rawSpareStatus === "dirty" || rawSpareStatus === "unfinished" || t.state == null) {
        out.dirty += 1;
      } else if (rawSpareStatus === "unloaded") {
        out.unloaded += 1;
      } else {
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? fallbackRouteByTruck.get(t.truck_number) ?? null;
        // Covering spares also surface in their live workflow bucket (e.g. unloaded).
        if (coveredRoute != null && oosRouteNumbers.has(coveredRoute)) {
          out[statusFor(t)] += 1;
        }
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
  dayRole: "load" | "unload" = "load",
): OperationalDayContext {
  // A takeover assignment describes where the NEXT load rides — it does not
  // change who physically RAN today. In the "unload" role a ROUTE-truck
  // carrier therefore counts as itself (its own schedule) and its covered
  // route's truck still counts if it ran; only Spares substitute for a route
  // on the unload side (a covering spare has no route of its own). Without
  // this, a swap entered overnight for Monday's load silently shrank
  // Friday's unload denominator (28 -> 25, 2026-07-18).
  const takeoverOf = (t: TruckWithState): number | null =>
    dayRole === "unload"
      ? (t.truck_type === "Spare" ? getCoverageRouteNumber(t) : null)
      : takenOverRouteNumber(t);
  const routeTruckByNumber = new Map<number, TruckWithState>();
  for (const truck of trucks) {
    if (truck.truck_type !== "Spare") {
      routeTruckByNumber.set(truck.truck_number, truck);
    }
  }

  // A TAKEOVER (takenOverRouteNumber: any truck's oos_spare_route, or a
  // Spare's route_swap_route) means the covered route's own truck doesn't
  // run — that route is removed from the count and the covering truck stands
  // in for it. The covering truck's TYPE is irrelevant: a Uniform carrying
  // oos_spare_route (#75 covering route 53, 2026-07-16) is a takeover too —
  // gating this on truck_type === "Spare" made both trucks count. A
  // non-Spare route-truck "swap" means BOTH trucks run (they just swap
  // loads), so a swap must NOT remove either route.
  const takeoverByRoute = new Map<number, TruckWithState>();
  for (const truck of trucks) {
    const coveredRoute = takeoverOf(truck);
    if (coveredRoute != null && !takeoverByRoute.has(coveredRoute)) {
      takeoverByRoute.set(coveredRoute, truck);
    }
  }
  const coveredRouteNumbers = new Set<number>();
  for (const [coveredRoute] of takeoverByRoute) {
    const coveredTruck = routeTruckByNumber.get(coveredRoute);
    if (
      coveredTruck &&
      (holidayMode || !isScheduledOff(coveredTruck, dayNum))
    ) {
      coveredRouteNumbers.add(coveredRoute);
    }
  }

  // Routes covered by ANY truck — a covering spare (oos_spare_route) OR a route
  // truck taking another route's load (route_swap_route). Used only to drop an
  // OOS route truck below; a normal route-swap between two healthy trucks leaves
  // both running and removes neither.
  const coveredByAnyRoute = new Set<number>();
  for (const truck of trucks) {
    const r = getCoverageRouteNumber(truck);
    if (r != null) coveredByAnyRoute.add(r);
  }

  const activeTrucks: TruckWithState[] = [];
  for (const truck of trucks) {
    // Covering trucks (spare-style takeover; any type in the load role,
    // Spares only in the unload role) stand in for the route truck — count
    // the cover instead, gated on the covered route's schedule, not the
    // cover's own.
    const takenOver = takeoverOf(truck);
    if (takenOver != null) {
      const coveredTruck = routeTruckByNumber.get(takenOver);
      if (coveredTruck && (holidayMode || includeOffDayCoverage || !isScheduledOff(coveredTruck, dayNum))) {
        activeTrucks.push(truck);
      }
      continue;
    }
    // Idle spares (no coverage) never participate in the load/unload count.
    if (truck.truck_type === "Spare") continue;

    // Route trucks count purely by the fleet schedule: a route runs (and must
    // be unloaded) iff it's not scheduled off that day. Operational state — OOS,
    // route swaps — never changes this, because a scheduled route always runs
    // (covered when needed). Only a physical takeover removes a route.
    if (!holidayMode && isScheduledOff(truck, dayNum)) continue;
    // A taken-over route did NOT run, no matter what its own flags say — the
    // is_oos gate below missed covers whose covered truck had is_oos cleared.
    if (takeoverByRoute.has(truck.truck_number)) continue;
    // An OOS route truck whose route is being covered by a route-swap truck
    // does not run — its freight loads on the cover — so it's not part of the
    // load/unload count. Uncovered OOS trucks are kept: still physically here
    // to handle. Mirrors Unload.tsx's allTrucks filter.
    if ((truck.is_oos || truck.state?.status === "oos") && coveredByAnyRoute.has(truck.truck_number)) continue;
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
