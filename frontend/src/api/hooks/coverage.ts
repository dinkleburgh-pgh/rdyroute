/**
 * Spare assignments and route swaps (coverage writes).
 * Split from the 2,800-line api/hooks.ts; import from "api/hooks" as before.
 */
import { errorMessage } from "../errors";
import { emitToast } from "../../utils/toastBridge";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosProgressEvent } from "axios";
import { api, todayIso } from "../client";
import * as offlineQueue from "../offlineQueue";
import { logDebug } from "../../utils/debugLog";
import { buildCoverageList, buildPrevDayCoverage, resolvePrevRunDate, type CoverageEntry } from "../../utils/truckStatus";
import {
  WEARER_DEFAULTS_REVIEW_KEY,
  parseWearerDefaultsReview,
  type WearerDefaultsReview,
} from "../../utils/wearerDefaults";
import type {
  AppSetting,
  ActivityEventPage,
  AuditEntry,
  AuthRequestRecord,
  AuthRole,
  BatchSummary,
  Message,
  TruckState,
  Notice,
  NoticeSeverity,
  NotificationEvent,
  NotificationPublicKey,
  NotificationStatus,
  NoteType,
  PushSubscriptionRecord,
  GarmentDayLog,
  ProductionSyncResult,
  RouteSwap,
  RouteSwapLog,
  Shortage,
  ShortageSheetImport,
  ShortageSheetImportDetail,
  ShortageSheetOcrMemoryStatus,
  ShortageSheetRowDraft,
  ShortageSheetTemplate,
  SpareAssignment,
  TokenResponse,
  Truck,
  TruckNote,
  TruckStateSource,
  TruckStatus,
  TruckWithState,
  User,
} from "../../types";


// ---------------------------------------------------------------------------
// Spare assignments
// ---------------------------------------------------------------------------

export function useSpareAssignments(runDate: string = todayIso(), returnedOnly?: boolean) {
  return useQuery({
    queryKey: ["spares", runDate, returnedOnly ?? "all"],
    queryFn: async () =>
      (await api.get<SpareAssignment[]>("/spares", {
        params: { run_date: runDate, returned: returnedOnly },
      })).data,
    refetchInterval: 10000,
    staleTime: 9500,
  });
}

// Every spare assignment nobody has returned yet, regardless of which day it
// was made — the authoritative "is this coverage still active" signal. Used
// as the historical-coverage fallback source (a truck's dirty status often
// traces back to an assignment from a prior day whose record was never
// re-created for today, but was also never explicitly returned).
export function useOpenSpareAssignments() {
  return useQuery({
    queryKey: ["spares", "all-dates", "open"],
    queryFn: async () =>
      (await api.get<SpareAssignment[]>("/spares", { params: { returned: false } })).data,
    refetchInterval: 15000,
    staleTime: 14500,
  });
}

export function useAssignSpare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      run_date: string;
      spare_truck_number: number;
      covering_route_truck: number;
      /** Why the route is covered — "crossload" marks a same-day freight move. */
      kind?: "oos" | "crossload";
    }) => (await api.post<SpareAssignment>("/spares", payload)).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["spares"] });
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
      // Coverage overlays on Board/RunDay/Supervisor read the swap log; it must
      // refresh when coverage changes or those views show stale pre-swap state.
      qc.invalidateQueries({ queryKey: ["route-swap-log"] });
    },
  });
}

export function useReturnSpare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.post<SpareAssignment>(`/spares/${id}/return`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["spares"] });
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["route-swap-log"] });
    },
  });
}

export function useDeleteSpare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/spares/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["spares"] });
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["route-swap-log"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Route Swaps (V1: route_swap_assignments)
// ---------------------------------------------------------------------------

export function useRouteSwaps(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["route-swaps", runDate],
    queryFn: async () =>
      (await api.get<RouteSwap[]>("/route-swaps", { params: { run_date: runDate } })).data,
    refetchInterval: 10000,
    staleTime: 9500,
  });
}

export function useCreateRouteSwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      run_date: string;
      route_truck: number;
      load_on_truck: number;
      two_way?: boolean;
      /** SPLIT load: the route also runs; load_on carries the overflow. */
      split?: boolean;
    }) =>
      (await api.post<RouteSwap[]>("/route-swaps", {
        ...payload,
        two_way: payload.two_way ?? false,
        split: payload.split ?? false,
      })).data,
    onSuccess: (_data, vars) => {
      // Prefix key invalidates every ["route-swaps", *] query at once.
      qc.invalidateQueries({ queryKey: ["route-swaps"] });
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
      qc.invalidateQueries({ queryKey: ["route-swap-log"] });
    },
  });
}

export function useDeleteRouteSwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, alsoReciprocal, runDate }: { id: number; alsoReciprocal?: boolean; runDate: string }) =>
      api.delete(`/route-swaps/${id}`, {
        params: { also_reciprocal: alsoReciprocal ?? false },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["route-swaps"] });
      qc.invalidateQueries({ queryKey: ["board", vars.runDate] });
      qc.invalidateQueries({ queryKey: ["route-swap-log"] });
    },
  });
}

export function useRouteSwapLog(days = 30) {
  return useQuery({
    queryKey: ["route-swap-log", days],
    queryFn: async () =>
      (await api.get<RouteSwapLog[]>("/route-swaps/log", { params: { days } })).data,
    staleTime: 60_000,
  });
}


/**
 * route → the truck that carried that route's freight on the PREVIOUS load
 * day (from the route-swap log). Feed to countUnloadedFromContext so a
 * covered route counts as unloaded once its carrier is — the covered truck
 * never ran, so its carrier's unload IS its unload.
 */
export function usePrevDayCarriers(runDate: string, board: TruckWithState[]): Map<number, TruckWithState> {
  const { data: swapLog = [] } = useRouteSwapLog(14);
  const { data: prevOp } = usePrevOperatingDay(runDate);
  return useMemo(() => {
    const prev = buildPrevDayCoverage(swapLog, resolvePrevRunDate(runDate, prevOp));
    const byNum = new Map(board.map((t) => [t.truck_number, t]));
    const m = new Map<number, TruckWithState>();
    for (const c of prev.items) {
      // Split entries are NOT coverage: the route ran itself, so the helper's
      // unload never substitutes for the route's own.
      if (c.isSplit) continue;
      // Two-way swap: both trucks physically ran, so neither carries the other —
      // each unloads itself. Without this, unloading one credited both.
      if (prev.twoWayRoutes.has(c.route)) continue;
      const carrier = byNum.get(c.loadOn);
      if (carrier) m.set(c.route, carrier);
    }
    return m;
  }, [swapLog, runDate, board, prevOp]);
}

/**
 * Trucks that carried a route's split OVERFLOW on the previous load day —
 * they ran and are EXTRA unload slots today (the live board carries no split
 * marker the morning after; only the swap log knows). Pass to
 * buildOperationalDayContext's extraUnloadTruckNumbers.
 */
export function usePrevDaySplitHelpers(runDate: string): Set<number> {
  const { data: swapLog = [] } = useRouteSwapLog(14);
  const { data: prevOp } = usePrevOperatingDay(runDate);
  return useMemo(() => {
    const prev = buildPrevDayCoverage(swapLog, resolvePrevRunDate(runDate, prevOp));
    return new Set(prev.splitHelpers.keys());
  }, [swapLog, runDate, prevOp]);
}

/**
 * THE batching unit rule, in one place.
 *
 * One returned load gets exactly ONE batch card, filed under the ORIGINAL ROUTE
 * number — which is what the crew writes on the paper sheet. When spare #11
 * covers route #4 the team still calls it "4", so #4 owns the card and #11 is
 * not separately batchable.
 *
 * Sourced from usePrevDayCarriers ONLY, and that choice is what protects the
 * other two shapes for free:
 *   - SPLITS are excluded there, so helper and route stay two independent
 *     units, each owed its own card (the helper at 0 wearers).
 *   - TWO-WAY swaps are excluded there, so both trucks physically ran and both
 *     keep their own card.
 */
/**
 * Driver QR tokens, admin only.
 *
 * Separate from useFleet because these are bearer credentials for the public
 * /driver/{token} page — they used to ride along on every fleet/board payload,
 * which meant any session (including the no-credentials guest role) could
 * harvest all of them.
 */
export function useQrTokens(enabled = true) {
  return useQuery({
    queryKey: ["fleet", "qr-tokens"],
    enabled,
    queryFn: async () => (await api.get<Record<string, string>>("/fleet/qr-tokens")).data,
    staleTime: 300_000,
  });
}

export function useBatchUnit(runDate: string, board: TruckWithState[]) {
  const prevCarriers = usePrevDayCarriers(runDate, board);
  return useMemo(() => {
    const routeByCarrier = new Map<number, number>();
    for (const [route, carrier] of prevCarriers) routeByCarrier.set(carrier.truck_number, route);
    return {
      prevCarriers,
      /** The truck number that owns the batch card for the load this truck brought back. */
      batchUnitFor: (n: number) => routeByCarrier.get(n) ?? n,
      /** Which truck physically brought this route's freight back, if covered. */
      carrierOf: (route: number) => prevCarriers.get(route)?.truck_number ?? null,
      /** True when this truck carried someone else's route and so owns no card. */
      isCarrier: (n: number) => routeByCarrier.has(n),
    };
  }, [prevCarriers]);
}

/**
 * Prev-day split helper -> the route whose overflow it carried.
 *
 * The same data as usePrevDaySplitHelpers, but keeping the route instead of
 * discarding it. Batching needs the route: the helper is unloading THAT sheet
 * line, so batching the route satisfies the helper. Without the route a split
 * helper reads as its own unbatched job even though the crew batched the route
 * off the paper exactly as they should have.
 */
export function usePrevDaySplitRoutes(runDate: string): Map<number, number> {
  const { data: swapLog = [] } = useRouteSwapLog(14);
  const { data: prevOp } = usePrevOperatingDay(runDate);
  return useMemo(
    () => buildPrevDayCoverage(swapLog, resolvePrevRunDate(runDate, prevOp)).splitHelpers,
    [swapLog, runDate, prevOp],
  );
}

/**
 * The previous OPERATING run date from the server = max(run_date) with any
 * truck state before today — the exact signal day-init seeds from. Bridges
 * mid-week plant closures that a plain weekday-step (previousRunDate) skips, so
 * previous-day coverage doesn't silently vanish. 404/none → null → callers fall
 * back to the weekday step via resolvePrevRunDate.
 */
export function usePrevOperatingDay(runDate: string) {
  return useQuery({
    queryKey: ["prev-operating-day", runDate],
    queryFn: async () =>
      (
        await api.get<{ prev_run_date: string | null }>("/trucks/prev-operating-day", {
          params: { run_date: runDate },
        })
      ).data.prev_run_date,
    staleTime: 60_000,
  });
}

/**
 * The normalized coverage list a surface should display, scoped by role — the
 * single selector every coverage banner/list renders from. Load = today's
 * load-side coverage, Unload = previous-day, Fleet = today (all types) +
 * previous-day. Shares the corrected previous-operating-day + two-way labeling.
 */
export function useCoverageForRole(role: "load" | "unload" | "fleet", runDate: string, board: TruckWithState[]): CoverageEntry[] {
  const { data: swapLog = [] } = useRouteSwapLog(role === "fleet" ? 60 : 14);
  const { data: prevOp } = usePrevOperatingDay(runDate);
  return useMemo(() => {
    const prevCoverage = buildPrevDayCoverage(swapLog, resolvePrevRunDate(runDate, prevOp));
    return buildCoverageList({ role, board, prevCoverage });
  }, [role, runDate, board, swapLog, prevOp]);
}

export function useActivityEvents(filters?: {
  runDate?: string;
  truckNumber?: number;
  actorUsername?: string;
  eventFamily?: string;
  eventType?: string;
  statusBefore?: string;
  statusAfter?: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: [
      "activity-events",
      filters?.runDate ?? null,
      filters?.truckNumber ?? null,
      filters?.actorUsername ?? null,
      filters?.eventFamily ?? null,
      filters?.eventType ?? null,
      filters?.statusBefore ?? null,
      filters?.statusAfter ?? null,
      filters?.q ?? "",
      filters?.limit ?? 50,
      filters?.offset ?? 0,
    ],
    queryFn: async () =>
      (
        await api.get<ActivityEventPage>("/activity/events", {
          params: {
            run_date: filters?.runDate || undefined,
            truck_number: filters?.truckNumber || undefined,
            actor_username: filters?.actorUsername || undefined,
            event_family: filters?.eventFamily || undefined,
            event_type: filters?.eventType || undefined,
            status_before: filters?.statusBefore || undefined,
            status_after: filters?.statusAfter || undefined,
            q: filters?.q || undefined,
            limit: filters?.limit ?? 50,
            offset: filters?.offset ?? 0,
          },
        })
      ).data,
    staleTime: 5_000,
  });
}

