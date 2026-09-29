/**
 * The Run Report archive — each run day's report inputs, snapshotted at the end
 * of 3rd shift (D+1 05:58 Eastern) so a past day can be read as it stood then
 * instead of recomputed from today's database. See routers/report_archive.py.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { errorStatus } from "../errors";
import type {
  AuditEntry,
  BatchSummary,
  RouteSwap,
  RouteSwapLog,
  Shortage,
  SpareAssignment,
  TruckWithState,
} from "../../types";

/** How a snapshot came to be: the end-of-shift loop on time, the same loop
 *  late (the backend was down at 05:58), or an admin's "Save now". */
export type ReportArchiveSource = "auto" | "catch-up" | "manual";

/** Headline counts the server derives from a snapshot's inputs, for the list. */
export interface ReportArchiveSummary {
  qty_short: number;
  trucks_shorted: number;
  trucks_loaded: number;
  trucks_timed: number;
  routes_covered: number;
  audit_items: number;
  batches_used: number;
}

/** One archived day, without its inputs (the list / capture response). */
export interface ReportArchiveItem {
  run_date: string; // YYYY-MM-DD
  captured_at: string; // ISO instant
  source: ReportArchiveSource;
  app_version: string | null;
  summary: ReportArchiveSummary;
}

/**
 * Exactly what the Report page reads for a run date, as each endpoint's
 * response_model sends it — so the page's own types apply unchanged.
 */
export interface ReportSnapshotInputs {
  run_date: string;
  board: TruckWithState[];
  batches: BatchSummary[];
  shortages: Shortage[];
  audit_entries: AuditEntry[];
  spares: SpareAssignment[];
  route_swaps: RouteSwap[];
  /** GET /route-swaps/log as of capture — previous-day coverage reads it. */
  route_swap_log: RouteSwapLog[];
  prev_operating_day: string | null;
  pace_avg_seconds: number | null;
  /** Every app_settings key the page reads for the day, raw stored value;
   *  a key that wasn't set is simply absent. */
  settings: Record<string, unknown>;
}

export interface ReportSnapshot extends ReportArchiveItem {
  inputs: ReportSnapshotInputs;
}

/** Archived days, newest run date first. */
export function useReportArchiveList(limit = 60) {
  return useQuery({
    queryKey: ["report-archive", limit],
    queryFn: async () =>
      (await api.get<ReportArchiveItem[]>("/reports/archive", { params: { limit } })).data,
    staleTime: 60_000,
  });
}

/**
 * One day's snapshot, or null when the day isn't archived (404 is an answer
 * here, not an error). Pass null to skip the request — today is always live.
 *
 * A snapshot only changes when someone re-saves it. The server broadcasts
 * that (report_archived → useRealtimeSync invalidates this key), but a device
 * that was offline misses the broadcast, and the cache persists to IndexedDB,
 * so a cached snapshot goes stale after a few minutes rather than never —
 * a revisit then refetches in the background (structural sharing keeps the
 * same object when nothing changed). "Not archived" is only fresh for a
 * minute: the end-of-shift or catch-up capture can land while the page is open.
 */
export function useReportSnapshot(runDate: string | null) {
  return useQuery({
    queryKey: ["report-snapshot", runDate],
    enabled: runDate != null,
    queryFn: async (): Promise<ReportSnapshot | null> => {
      try {
        return (await api.get<ReportSnapshot>(`/reports/archive/${runDate}`)).data;
      } catch (err: unknown) {
        if (errorStatus(err) === 404) return null;
        throw err;
      }
    },
    staleTime: (q) => (q.state.data === null ? 60_000 : 5 * 60_000),
  });
}

/**
 * Save (or re-save, replacing) a past day's report now — admin only. The
 * server refuses (409) a day whose shift hasn't ended yet or that never ran;
 * the global mutation handler toasts its reason.
 */
export function useCaptureReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runDate: string) =>
      (await api.post<ReportArchiveItem>(`/reports/archive/${runDate}`)).data,
    onSuccess: (_data, runDate) => {
      qc.invalidateQueries({ queryKey: ["report-archive"] });
      qc.invalidateQueries({ queryKey: ["report-snapshot", runDate] });
    },
  });
}
