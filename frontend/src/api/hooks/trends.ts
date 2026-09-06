/**
 * All trend/anomaly reads — one generic useTrend.
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

import type {
  PaceDailyPoint,
  CompletionDailyPoint,
  WearersDailyPoint,
  CycleDailyPoint,
  UnloadDailyPoint,
  ShortageTruckPoint,
  ShortageDailyPoint,
  ShortageSummary,
  QualityRateSummary,
  ShortageItemPoint,
  AnomalyDay,
} from "./ops";


// ---------------------------------------------------------------------------
// Audit — by route / by truck
// ---------------------------------------------------------------------------

export interface AuditRouteRow {
  route: number;
  item_label: string;
  total_qty: number;
}
export interface AuditTruckRow {
  truck_number: number;
  item_label: string;
  total_qty: number;
}



// ---------------------------------------------------------------------------
// Trend hooks — one generic, fourteen thin exports.
// Thirteen of these used to be full copy-pasted useQuery bodies differing by
// three tokens each. Names, query keys and staleTimes are unchanged.
// ---------------------------------------------------------------------------

function useTrend<T>(
  key: string,
  url: string,
  daysBack: number,
  opts: { staleTime?: number; compareDaysBack?: number } = {},
) {
  return useQuery({
    queryKey:
      "compareDaysBack" in opts ? [key, daysBack, opts.compareDaysBack] : [key, daysBack],
    queryFn: async () =>
      (
        await api.get<T>(url, {
          params:
            "compareDaysBack" in opts
              ? { days_back: daysBack, compare_days_back: opts.compareDaysBack }
              : { days_back: daysBack },
        })
      ).data,
    ...(opts.staleTime !== undefined ? { staleTime: opts.staleTime } : {}),
  });
}

export const useAuditByRoute = (daysBack = 30) =>
  useTrend<AuditRouteRow[]>("audit-by-route", "/audit/trends/by-route", daysBack);
export const useAuditByTruck = (daysBack = 30) =>
  useTrend<AuditTruckRow[]>("audit-by-truck", "/audit/trends/by-truck", daysBack);
export const useLoadPaceTrend = (daysBack = 14) =>
  useTrend<PaceDailyPoint[]>("load-pace-trend", "/load-durations/trends/daily", daysBack, { staleTime: 60_000 });
export const useCompletionTrend = (daysBack = 14) =>
  useTrend<CompletionDailyPoint[]>("completion-trend", "/trucks/trends/completion", daysBack, { staleTime: 60_000 });
export const useWearersTrend = (daysBack = 14) =>
  useTrend<WearersDailyPoint[]>("wearers-trend", "/trucks/trends/wearers", daysBack, { staleTime: 60_000 });
export const useCycleTimeTrend = (daysBack = 14) =>
  useTrend<CycleDailyPoint[]>("cycle-trend", "/trucks/trends/cycle", daysBack, { staleTime: 60_000 });
export const useUnloadTrend = (daysBack = 14) =>
  useTrend<UnloadDailyPoint[]>("unload-trend", "/trucks/trends/unload", daysBack, { staleTime: 60_000 });
export const useShortageByTruck = (daysBack = 14) =>
  useTrend<ShortageTruckPoint[]>("shortage-trend-truck", "/shorts/trends/by-truck", daysBack, { staleTime: 60_000 });
export const useShortageDailyTrend = (daysBack = 14) =>
  useTrend<ShortageDailyPoint[]>("shortage-trend-daily", "/shorts/trends/daily", daysBack, { staleTime: 60_000 });
export const useShortageSummary = (daysBack = 14, compareDaysBack?: number) =>
  useTrend<ShortageSummary>("shortage-summary", "/shorts/trends/summary", daysBack, { compareDaysBack, staleTime: 60_000 });
export const useQualityRate = (daysBack = 14, compareDaysBack?: number) =>
  useTrend<QualityRateSummary>("quality-rate", "/audit/trends/quality-rate", daysBack, { compareDaysBack, staleTime: 60_000 });
export const useShortageByItem = (daysBack = 14) =>
  useTrend<ShortageItemPoint[]>("shortage-trend-item", "/shorts/trends/by-item", daysBack, { staleTime: 60_000 });
export const useTruckAnomalies = (daysBack = 90) =>
  useTrend<AnomalyDay[]>("truck-anomalies", "/trucks/trends/anomalies", daysBack, { staleTime: 120_000 });
export const useAuditAnomalies = (daysBack = 90) =>
  useTrend<AnomalyDay[]>("audit-anomalies", "/audit/trends/anomalies", daysBack, { staleTime: 120_000 });













