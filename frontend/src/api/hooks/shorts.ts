/**
 * Shortages + shortage-sheet OCR imports.
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
// Shorts
// ---------------------------------------------------------------------------

export function useShortageDates() {
  return useQuery({
    queryKey: ["shortage-dates"],
    queryFn: async () => (await api.get<string[]>("/shorts/dates")).data,
    staleTime: 60_000,
  });
}

export function useShortages(runDate: string = todayIso(), truckNumber?: number) {
  return useQuery({
    queryKey: ["shorts", runDate, truckNumber ?? "all"],
    queryFn: async () =>
      (await api.get<Shortage[]>("/shorts", {
        params: { run_date: runDate, truck_number: truckNumber },
      })).data,
    staleTime: 30_000,
  });
}

export function useCreateShortage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      truck_number: number;
      run_date: string;
      item_category: string;
      item_detail?: string;
      quantity?: number;
      initials?: string;
    }) => {
      // If the device is offline, queue for background sync and return early
      if (!navigator.onLine) {
        await offlineQueue.enqueue("create_shortage", "/shorts", "POST", payload);
        return { queued: true } as unknown as Shortage;
      }
      try {
        return (await api.post<Shortage>("/shorts", payload)).data;
      } catch (err) {
        // Network error while technically "online" — queue it
        if (offlineQueue.isNetworkError(err)) {
          await offlineQueue.enqueue("create_shortage", "/shorts", "POST", payload);
          return { queued: true } as unknown as Shortage;
        }
        throw err;
      }
    },
    onSuccess: () => {
      // Realtime handled by WebSocket broadcast; offline flush handles queued items.
      // 30s staleTime on useShortages is fallback.
    },
  });
}

export function useBulkCreateShortages() {
  return useMutation({
    mutationFn: async (payload: {
      run_date: string;
      item_category: string;
      item_detail?: string;
      initials?: string;
      initials_ts?: number | null;
      entries: { truck_number: number; quantity: number }[];
    }): Promise<Shortage[] | { queued: true }> => {
      // Whole batch queues as ONE mutation offline (replayed intact on flush).
      if (!navigator.onLine) {
        await offlineQueue.enqueue("bulk_create_shortage", "/shorts/bulk", "POST", payload);
        return { queued: true };
      }
      try {
        return (await api.post<Shortage[]>("/shorts/bulk", payload)).data;
      } catch (err) {
        if (offlineQueue.isNetworkError(err)) {
          await offlineQueue.enqueue("bulk_create_shortage", "/shorts/bulk", "POST", payload);
          return { queued: true };
        }
        throw err;
      }
    },
    onSuccess: () => {
      // Realtime handled by WebSocket broadcast; 30s staleTime on useShortages is fallback.
    },
  });
}

export function useUpdateShortage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: number; quantity?: number; item_category?: string; item_detail?: string }) =>
      (await api.patch<Shortage>(`/shorts/${id}`, payload)).data,
    onSuccess: () => { /* WebSocket handles invalidation */ },
  });
}

/**
 * Idempotent cell upsert for the editable Short Sheet (PUT /shorts/cells).
 * Each entry sets a (truck, item) cell to its canonical total; qty 0 clears it.
 *
 * NOTE: deliberately NOT offline-queued. The queue coalesces PUTs to the same
 * endpoint, which would collapse distinct cell saves and lose edits — so a
 * failed save rethrows and the caller keeps the local draft to retry.
 */
export interface RouteDriver {
  route_number: number | null;
  route_label: string;
  driver_name: string;
  is_active: boolean;
}

/**
 * SSR (driver) assigned to each route, seeded from the printed dock board and
 * editable from the Fleet Schedule's Edit mode. Non-guest gated, so this 403s
 * for guests — callers should treat an empty map as "no names available" and
 * render without them.
 */
export function useRouteDrivers(enabled = true) {
  return useQuery({
    queryKey: ["route-drivers"],
    queryFn: async () => (await api.get<RouteDriver[]>("/route-drivers")).data,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Set a route's SSR, or clear it with a blank name. Admin-only server-side. */
export function useUpsertRouteDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ route_number, driver_name }: { route_number: number; driver_name: string }) => {
      await api.put(`/route-drivers/${route_number}`, { driver_name });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["route-drivers"] }),
  });
}

export function useUpsertShortageCells() {
  return useMutation({
    mutationFn: async (payload: {
      run_date: string;
      initials?: string;
      initials_ts?: number | null;
      entries: { truck_number: number; item_category: string; item_detail?: string; quantity: number }[];
    }): Promise<Shortage[]> => (await api.put<Shortage[]>("/shorts/cells", payload)).data,
    onSuccess: () => { /* WebSocket handles invalidation; 30s staleTime on useShortages is fallback. */ },
  });
}

export function useDeleteShortage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => { await api.delete(`/shorts/${id}`); },
    onSuccess: () => { /* WebSocket handles invalidation */ },
  });
}

export function useShortageSheetImports(filters?: { runDate?: string; status?: string }) {
  return useQuery({
    queryKey: ["shorts-imports", filters?.runDate ?? "all", filters?.status ?? "all"],
    queryFn: async () => {
      const { data } = await api.get<ShortageSheetImport[] | unknown>("/shorts/imports", {
        params: {
          run_date: filters?.runDate || undefined,
          status: filters?.status || undefined,
        },
      });
      if (!Array.isArray(data)) {
        throw new Error("Shortage import API returned an unexpected response.");
      }
      return data as ShortageSheetImport[];
    },
    staleTime: 10_000,
  });
}

export function useShortageSheetTemplates() {
  return useQuery({
    queryKey: ["shorts-import-templates"],
    queryFn: async () => {
      const { data } = await api.get<ShortageSheetTemplate[] | unknown>("/shorts/imports/templates");
      if (!Array.isArray(data)) {
        throw new Error("Shortage import template API returned an unexpected response.");
      }
      return data as ShortageSheetTemplate[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useShortageSheetImport(importId?: string | null) {
  return useQuery({
    queryKey: ["shorts-import", importId ?? "none"],
    enabled: !!importId,
    queryFn: async () => {
      const { data } = await api.get<ShortageSheetImportDetail | unknown>(`/shorts/imports/${importId}`);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Shortage import detail API returned an unexpected response.");
      }
      return data as ShortageSheetImportDetail;
    },
    staleTime: 5_000,
  });
}

export function useCreateShortageSheetImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      run_date: string;
      files: File[];
      onUploadProgress?: (progress: { loaded: number; total: number | null; percent: number }) => void;
    }) => {
      const form = new FormData();
      form.append("run_date", args.run_date);
      for (const file of args.files) form.append("files", file);
      const { data } = await api.post<ShortageSheetImportDetail>("/shorts/imports", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event: AxiosProgressEvent) => {
          const total = typeof event.total === "number" && event.total > 0 ? event.total : null;
          const loaded = typeof event.loaded === "number" ? event.loaded : 0;
          const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          args.onUploadProgress?.({ loaded, total, percent });
        },
      });
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      qc.setQueryData(["shorts-import", data.id], data);
    },
  });
}

export function useCreateShortageSheetRow(importId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      truck_number: number;
      source_column_index?: number | null;
      item_category: string;
      item_detail?: string;
      quantity?: number;
      initials?: string;
      raw_text?: string;
      review_status?: "needs_review" | "accepted" | "rejected";
      reviewer_note?: string;
      confidence_score?: number | null;
      source_photo_id?: string | null;
    }) => {
      if (!importId) throw new Error("Import ID is required");
      return (await api.post<ShortageSheetRowDraft>(`/shorts/imports/${importId}/rows`, payload)).data;
    },
    onSuccess: (_data, _vars, _ctx) => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      if (importId) qc.invalidateQueries({ queryKey: ["shorts-import", importId] });
    },
  });
}

export function useUpdateShortageSheetRow(importId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      rowId: number;
      truck_number?: number | null;
      source_column_index?: number | null;
      item_category?: string;
      item_detail?: string;
      quantity?: number | null;
      initials?: string;
      raw_text?: string;
      review_status?: "needs_review" | "accepted" | "rejected";
      reviewer_note?: string;
      confidence_score?: number | null;
      source_photo_id?: string | null;
    }) => {
      if (!importId) throw new Error("Import ID is required");
      const { rowId, ...payload } = args;
      return (await api.patch<ShortageSheetRowDraft>(`/shorts/imports/${importId}/rows/${rowId}`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      if (importId) qc.invalidateQueries({ queryKey: ["shorts-import", importId] });
    },
  });
}

export function useUpdateShortageSheetColumn(importId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      column_index: number;
      truck_number?: number | null;
      route_number?: number | null;
      initials?: string;
      review_status?: "needs_review" | "accepted" | "rejected";
      reviewer_note?: string;
      source_photo_id?: string | null;
    }) => {
      if (!importId) throw new Error("Import ID is required");
      const { column_index, ...payload } = args;
      return (await api.patch<ShortageSheetImportDetail>(`/shorts/imports/${importId}/columns/${column_index}`, payload)).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      if (importId) qc.setQueryData(["shorts-import", importId], data);
    },
  });
}

export function useDeleteShortageSheetRow(importId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rowId: number) => {
      if (!importId) throw new Error("Import ID is required");
      await api.delete(`/shorts/imports/${importId}/rows/${rowId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      if (importId) qc.invalidateQueries({ queryKey: ["shorts-import", importId] });
    },
  });
}

export function useDeleteShortageSheetImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (importId: string) => {
      await api.delete(`/shorts/imports/${importId}`);
    },
    onSuccess: (_data, importId) => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      qc.removeQueries({ queryKey: ["shorts-import", importId] });
    },
  });
}

export function useApproveShortageSheetImport(importId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!importId) throw new Error("Import ID is required");
      return (await api.post<ShortageSheetImportDetail>(`/shorts/imports/${importId}/approve`)).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["shorts"] });
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      qc.setQueryData(["shorts-import", data.id], data);
    },
  });
}

export function useRejectShortageSheetImport(importId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason: string = "") => {
      if (!importId) throw new Error("Import ID is required");
      return (await api.post<ShortageSheetImportDetail>(`/shorts/imports/${importId}/reject`, { reason })).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["shorts-imports"] });
      qc.setQueryData(["shorts-import", data.id], data);
    },
  });
}

export function useShortageSheetOcrMemoryStatus(enabled = true) {
  return useQuery({
    queryKey: ["shorts-ocr-memory-status"],
    enabled,
    queryFn: async () =>
      (await api.get<ShortageSheetOcrMemoryStatus>("/shorts/imports/ocr-memory/status")).data,
    staleTime: 30_000,
  });
}

export function shortageSheetPhotoFileUrl(id: string): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/shorts/imports/photos/${id}/file`;
}

export function shortageSheetOcrMemoryExportUrl(): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/shorts/imports/ocr-memory/export`;
}

export function shortageSheetOcrHeaderMemoryExportUrl(): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/shorts/imports/ocr-memory/header-export`;
}

export function shortageSheetOcrDatasetExportUrl(): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/shorts/imports/ocr-memory/dataset.zip`;
}

export function shortageSheetOcrHeaderDatasetExportUrl(): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/shorts/imports/ocr-memory/header-dataset.zip`;
}

