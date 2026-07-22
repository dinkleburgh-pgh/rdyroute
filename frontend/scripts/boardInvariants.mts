/**
 * Board-count invariant checker.
 *
 *   npx tsx scripts/boardInvariants.mts <board.json> <loadDay> <unloadsDay> [holidayLoad] [holidayUnload]
 *
 * Imports the app's REAL shared counting functions (src/utils/truckStatus)
 * and replicates each page's local composition (every replica carries a
 * "mirrors <file>" provenance note — if you change that page, update the
 * replica). Cross-checks every counting surface against the others and
 * exits 1 on hard invariant violations.
 *
 * HARD invariants = numbers a user sees side by side and expects to match.
 * WARN invariants = surfaces that can legitimately diverge (documented why);
 * reported for eyeballing but don't fail the run.
 */
import { readFileSync } from "node:fs";
import {
  buildOperationalDayContext,
  buildRouteStatusCounts,
  countLoaded,
  countUnloadedFromContext,
  effectiveOperationalStatus,
  effectiveStatus,
  effectiveWorkflowStatus,
  getCoverageRouteNumber,
  isPureUnloadSeed,
  isScheduledOff,
  takenOverRouteNumber,
} from "../src/utils/truckStatus";
import type { TruckStatus, TruckWithState } from "../src/types";

const [file, loadDayS, unloadDayS, hlS, huS] = process.argv.slice(2);
if (!file || !loadDayS || !unloadDayS) {
  console.error("usage: npx tsx scripts/boardInvariants.mts <board.json> <loadDay> <unloadsDay> [holidayLoad] [holidayUnload]");
  process.exit(2);
}
const board: TruckWithState[] = JSON.parse(readFileSync(file, "utf8"));
const loadDay = Number(loadDayS);
const unloadsDay = Number(unloadDayS);
const holidayLoad = hlS === "true";
const holidayUnload = huS === "true";

// ---------------------------------------------------------------------------
// Shared surfaces — the app's real functions, no replication.
// ---------------------------------------------------------------------------
const buckets = buildRouteStatusCounts(board, loadDay, holidayLoad, unloadsDay, holidayUnload);
const loadCtx = buildOperationalDayContext(board, loadDay, holidayLoad, false);
const unloadCtx = buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload");
const loadDone = countLoaded(board, loadDay, holidayLoad, unloadsDay, holidayUnload);
const unloadDone = countUnloadedFromContext(unloadCtx);

// Live-field coverage maps. NOTE: pages also fold in the historical fallback
// (route-swap log + open spare assignments) which a board snapshot doesn't
// carry — comparisons that depend on it are WARN-tier.
const coveringTruckByRoute = new Map<number, TruckWithState>();
for (const t of board) {
  const r = getCoverageRouteNumber(t);
  if (r != null && !coveringTruckByRoute.has(r)) coveringTruckByRoute.set(r, t);
}
const takenOverRoutes = new Set<number>();
for (const t of board) {
  const r = takenOverRouteNumber(t);
  if (r != null) takenOverRoutes.add(r);
}
const truckStatusByNumber = new Map<number, TruckStatus>(
  board.map((t) => [t.truck_number, effectiveStatus(t, loadDay, holidayLoad)]),
);

// ---------------------------------------------------------------------------
// Board page lifecycle filters — mirrors Board.tsx `filtered` (non-fleet).
// ---------------------------------------------------------------------------
function boardFiltered(filter: string): TruckWithState[] {
  if (filter === "all") return board;
  if (filter === "hold") return board.filter((t) => t.state?.priority_hold === true);
  return board.filter((t) => {
    const loadDayEff = effectiveStatus(t, loadDay, holidayLoad);
    if (filter === "off") {
      if (loadDayEff !== "off") return false;
      if (t.truck_type === "Spare") {
        const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
        if (coveredRoute == null) return false;
        return truckStatusByNumber.get(coveredRoute) === "oos";
      }
      return true;
    }
    if (filter === "spare") {
      return t.truck_type === "Spare";
    }
    if (filter === "oos") {
      if (t.truck_type === "Spare") return false;
      return t.is_oos || effectiveStatus(t, loadDay, holidayLoad) === "oos";
    }
    if (t.truck_type !== "Spare" && t.is_oos && coveringTruckByRoute.has(t.truck_number)) return false;
    if (t.truck_type !== "Spare" && takenOverRoutes.has(t.truck_number)) return false;
    const s = effectiveWorkflowStatus(t, loadDay, holidayLoad, unloadsDay, holidayUnload);
    const matchStatus = filter === "dirty" ? (s === "dirty" || s === "unfinished") : s === filter;
    if (!matchStatus) return false;
    if (t.truck_type === "Spare") {
      if (filter === "dirty" && (t.state?.status === "dirty" || t.state?.status === "unfinished" || t.state == null)) return true;
      if (filter === "unloaded" && t.state?.status === "unloaded") return true;
      const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
      if (coveredRoute == null) return false;
      return truckStatusByNumber.get(coveredRoute) === "oos";
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Day Overview grids — mirrors RunDay.tsx unloadTrucks/loadTrucks + the grid
// standalone-drop filters and card substitution (live-field coverage only).
// ---------------------------------------------------------------------------
function runDayUnloadCards(): Set<number> {
  const unloadTrucks = board.filter(
    (t) =>
      (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
      (holidayUnload || !isScheduledOff(t, unloadsDay)),
  );
  const rendered = new Set<number>();
  for (const t of unloadTrucks) {
    if (t.truck_type === "Spare" && getCoverageRouteNumber(t) != null) continue; // standalone spare cover drops
    const cover = coveringTruckByRoute.get(t.truck_number);
    const spareCover = cover?.truck_type === "Spare" ? cover : undefined;
    rendered.add((spareCover ?? t).truck_number);
  }
  return rendered;
}
function runDayLoadCards(): Set<number> {
  const loadTrucks = board.filter(
    (t) =>
      (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
      (holidayLoad || !isScheduledOff(t, loadDay)),
  );
  const rendered = new Set<number>();
  for (const t of loadTrucks) {
    if (takenOverRouteNumber(t) != null) continue; // load side: any takeover carrier substitutes
    const cover = coveringTruckByRoute.get(t.truck_number);
    const spareCover =
      cover && takenOverRouteNumber(cover) === t.truck_number
        ? cover
        : cover?.truck_type === "Spare" ? cover : undefined;
    rendered.add((spareCover ?? t).truck_number);
  }
  return rendered;
}

// ---------------------------------------------------------------------------
// Unload page roster — mirrors Unload.tsx allTrucks / toGo / tally.
// ---------------------------------------------------------------------------
function unloadPage() {
  const coveredRouteNumbers = new Set<number>();
  for (const t of board) {
    const r = getCoverageRouteNumber(t);
    if (r != null) coveredRouteNumbers.add(r);
  }
  const allTrucks = board.filter((t) => {
    if (t.route_swap_route != null || t.state?.oos_spare_route != null) return true;
    if (takenOverRoutes.has(t.truck_number)) return false;
    if ((t.is_oos || t.state?.status === "oos") && coveredRouteNumbers.has(t.truck_number)) return false;
    const s = t.state?.status;
    if (s === "dirty" || s === "unfinished" || t.state?.priority_hold === true) return true;
    if (t.truck_type === "Spare") return false;
    return holidayUnload || !isScheduledOff(t, unloadsDay);
  });
  // Badge = shared unload-day pending (Unload.tsx toGo), NOT the card-section
  // sum — the sections deliberately show extra off-schedule dirty/held trucks.
  const toGo = Math.max(0, unloadCtx.activeTrucks.length - unloadDone);
  const tally = allTrucks.filter((t) => {
    const s = t.state?.status;
    if (!(s === "unloaded" || s === "in_progress" || s === "loaded")) return false;
    if (s === "unloaded" && isPureUnloadSeed(t)) return false;
    return true;
  });
  return { toGo, tally: tally.length };
}

// ---------------------------------------------------------------------------
// Load page — mirrors Load.tsx loaded ("Loaded today") off the shared context.
// ---------------------------------------------------------------------------
const loadPageLoaded = loadCtx.activeTrucks.filter(
  (t) => effectiveOperationalStatus(t, loadDay, holidayLoad) === "loaded",
).length;

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
let hardFails = 0;
function check(tier: "HARD" | "WARN", name: string, a: number, b: number, note = "") {
  const ok = a === b;
  if (!ok && tier === "HARD") hardFails++;
  const mark = ok ? "  OK " : tier === "HARD" ? " FAIL" : " WARN";
  console.log(`${mark}  ${name}: ${a} ${ok ? "==" : "!="} ${b}${note && !ok ? `   (${note})` : ""}`);
}

console.log(`\nboard: ${file}  trucks: ${board.length}  loadDay: ${loadDay}  unloadsDay: ${unloadsDay}`);
console.log(`sidebar buckets: ${Object.entries(buckets).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" ")}`);
console.log(`bars: load ${loadDone}/${loadCtx.activeTrucks.length}  unload ${unloadDone}/${unloadCtx.activeTrucks.length}\n`);

check("HARD", "sidebar Loaded == Board loaded grid", buckets.loaded, boardFiltered("loaded").length);
check("HARD", "sidebar Unloaded == Board unloaded grid", buckets.unloaded, boardFiltered("unloaded").length);
check("HARD", "sidebar Dirty+Unfinished == Board dirty grid", buckets.dirty + buckets.unfinished, boardFiltered("dirty").length);
check("HARD", "load bar done <= total", Math.min(loadDone, loadCtx.activeTrucks.length), loadDone, "numerator exceeds denominator");
check("HARD", "unload bar done <= total", Math.min(unloadDone, unloadCtx.activeTrucks.length), unloadDone, "numerator exceeds denominator");
check("HARD", "load bar done == Load page 'Loaded today'", loadDone, loadPageLoaded);
check("WARN", "sidebar Off == Board off grid", buckets.off, boardFiltered("off").length, "off semantics differ by design: bucket=workflow, board=load-day");
check("WARN", "sidebar OOS == Board oos grid", buckets.oos, boardFiltered("oos").length, "board oos view keeps covered OOS trucks visible by design");
check("WARN", "Day Overview unload cards == unload bar total", runDayUnloadCards().size, unloadCtx.activeTrucks.length, "grids fold in historical-fallback coverage the snapshot lacks");
check("WARN", "Day Overview load cards == load bar total", runDayLoadCards().size, loadCtx.activeTrucks.length, "grid shows extra-schedule cards (holds etc.) by design");
const up = unloadPage();
check("HARD", "Unload page toGo == unload bar pending", up.toGo, unloadCtx.activeTrucks.length - unloadDone, "badge must stick to the schedule count");

// Structural: no takeover pair double-represented on a single surface.
let pairFails = 0;
for (const [route, cover] of coveringTruckByRoute) {
  if (takenOverRouteNumber(cover) !== route) continue; // swaps: both run, both allowed
  for (const [surface, set] of [
    ["Board loaded grid", new Set(boardFiltered("loaded").map((t) => t.truck_number))],
    ["Board unloaded grid", new Set(boardFiltered("unloaded").map((t) => t.truck_number))],
    ["Day Overview load cards", runDayLoadCards()],
  ] as const) {
    if (set.has(route) && set.has(cover.truck_number)) {
      console.log(` FAIL  takeover pair ${route}->${cover.truck_number} double-represented on ${surface}`);
      pairFails++;
    }
  }
}
if (pairFails === 0) console.log("  OK   no takeover pair double-represented on any surface");
hardFails += pairFails;

console.log(hardFails === 0 ? "\nALL HARD INVARIANTS PASS" : `\n${hardFails} HARD FAILURE(S)`);
process.exit(hardFails === 0 ? 0 : 1);
