import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosProgressEvent } from "axios";
import { api, todayIso } from "./client";
import * as offlineQueue from "./offlineQueue";
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
} from "../types";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function useLogin() {
  return useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const { data } = await api.post<TokenResponse>("/auth/login", creds);
      return data;
    },
  });
}

export function useGuestLogin() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<TokenResponse>("/auth/guest");
      return data;
    },
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => (await api.get<User>("/auth/me")).data,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

export function useFleet(includeInactive = false) {
  return useQuery({
    queryKey: ["fleet", includeInactive],
    queryFn: async () =>
      (await api.get<Truck[]>("/fleet", { params: { include_inactive: includeInactive } })).data,
    staleTime: 60_000,
  });
}

export function useAddTruck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { truck_number: number; truck_type?: string; is_persistent_spare?: boolean }) =>
      (await api.post<Truck>("/fleet", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet"] }),
  });
}

export function useUpdateTruck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      truck_number: number;
      truck_type?: string;
      is_active?: boolean;
      is_persistent_spare?: boolean;
      is_oos?: boolean;
      uniform_size?: string | null;
      scheduled_off_days?: number[];
    }) => {
      const { truck_number, ...patch } = args;
      return (await api.patch<Truck>(`/fleet/${truck_number}`, patch)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

export function useRemoveTruck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (truck_number: number) =>
      api.delete(`/fleet/${truck_number}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

export function useRegenerateQR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (truck_number: number) =>
      (await api.post<Truck>(`/fleet/${truck_number}/regenerate-qr`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Trucks / Board
// ---------------------------------------------------------------------------

export function useBoard(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["board", runDate],
    queryFn: async () =>
      (await api.get<TruckWithState[]>("/trucks/board", { params: { run_date: runDate } })).data,
    refetchInterval: 5000,
    staleTime: 4500,
  });
}

export function useUpsertTruckState() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["upsertTruckState"],
    mutationFn: async (args: {
      truck_number: number;
      run_date: string;
      status?: TruckStatus;
      state_source?: TruckStateSource | null;
      wearers?: number;
      batch_id?: number | null;
      load_start_time?: number | null;
      load_finish_time?: number | null;
      load_duration_seconds?: number | null;
      off_note?: string | null;
      shop_note?: string | null;
      oos_spare_route?: number | null;
      has_dust_garment?: boolean | null;
      priority_hold?: boolean | null;
      needs_checked?: boolean | null;
      arrived_at?: number | null;
    }) => {
      const { truck_number, run_date, state_source, ...rest } = args;
      const patch = {
        ...rest,
        state_source: state_source ?? "workflow",
      };
      // Try PUT first; if no row exists yet, create one
      try {
        const { data } = await api.put(
          `/trucks/${truck_number}/state`,
          patch,
          { params: { run_date } },
        );
        return data;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) {
          const { data } = await api.post(`/trucks/${truck_number}/state`, {
            truck_number,
            run_date,
            status: patch.status ?? "dirty",
            wearers: patch.wearers ?? 0,
            ...patch,
          });
          return data;
        }
        throw err;
      }
    },
    onMutate: async (vars) => {
      // Cancel in-flight refetches so they don't stomp the optimistic update
      await qc.cancelQueries({ queryKey: ["board", vars.run_date] });
      const previous = qc.getQueryData(["board", vars.run_date]);
      // Immediately reflect the change so the dropdown doesn't snap back
      qc.setQueryData<import("../types").TruckWithState[]>(
        ["board", vars.run_date],
        (old) => {
          if (!old) return old;
          return old.map((t) => {
            if (t.truck_number !== vars.truck_number) return t;
            const base = t.state ?? {
              id: 0,
              truck_number: vars.truck_number,
              run_date: vars.run_date,
              status: "dirty" as import("../types").TruckStatus,
              wearers: 0,
              batch_id: null,
              load_day_num: null,
              load_start_time: null,
              load_finish_time: null,
              load_duration_seconds: null,
              off_note: "",
              shop_note: "",
              oos_spare_route: null,
              has_dust_garment: false,
              priority_hold: false,
              needs_checked: false,
              arrived_at: null,
              unloaded_at: null,
              state_source: "workflow" as TruckStateSource,
              updated_at: new Date().toISOString(),
            };
            return {
              ...t,
              state: {
                ...base,
                ...(vars.status             !== undefined && { status: vars.status }),
                ...(vars.wearers            !== undefined && { wearers: vars.wearers }),
                ...(vars.batch_id           !== undefined && { batch_id: vars.batch_id }),
                ...(vars.load_start_time    !== undefined && { load_start_time: vars.load_start_time }),
                ...(vars.load_finish_time   !== undefined && { load_finish_time: vars.load_finish_time }),
                ...(vars.load_duration_seconds !== undefined && { load_duration_seconds: vars.load_duration_seconds }),
                ...(vars.off_note           !== undefined && { off_note: vars.off_note ?? "" }),
                ...(vars.shop_note          !== undefined && { shop_note: vars.shop_note ?? "" }),
                ...(vars.oos_spare_route    !== undefined && { oos_spare_route: vars.oos_spare_route }),
                ...(vars.has_dust_garment   !== undefined && { has_dust_garment: vars.has_dust_garment ?? false }),
                ...(vars.priority_hold      !== undefined && { priority_hold: vars.priority_hold ?? false }),
                ...(vars.needs_checked      !== undefined && { needs_checked: vars.needs_checked ?? false }),
                ...(vars.arrived_at         !== undefined && { arrived_at: vars.arrived_at }),
                ...(vars.state_source       !== undefined && vars.state_source !== null && { state_source: vars.state_source }),
              },
            };
          });
        },
      );
      return { previous };
    },
    onError: (_err, vars, context) => {
      const ctx = context as { previous?: unknown } | undefined;
      if (ctx?.previous !== undefined) {
        qc.setQueryData(["board", vars.run_date], ctx.previous);
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
    },
  });
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export function useBatchSummary(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["batches", runDate],
    queryFn: async () =>
      (await api.get<BatchSummary[]>("/batches/summary", { params: { run_date: runDate } })).data,
    refetchInterval: 10000,
    staleTime: 9500,
  });
}

export function useAssignBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      run_date: string;
      batch_number: number;
      truck_number: number;
      wearers: number;
    }) => (await api.post("/batches/assign", args)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["batches", vars.run_date] });
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
    },
  });
}

export function useRemoveTruckFromBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      run_date: string;
      batch_number: number;
      truck_number: number;
    }) =>
      api.delete(`/batches/${args.batch_number}/trucks/${args.truck_number}`, {
        params: { run_date: args.run_date },
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["batches", vars.run_date] });
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
    },
  });
}

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
    }) =>
      (await api.post<RouteSwap[]>("/route-swaps", {
        ...payload,
        two_way: payload.two_way ?? false,
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

// ---------------------------------------------------------------------------
// Shorts
// ---------------------------------------------------------------------------

export function useShortageCategories() {
  return useQuery({
    queryKey: ["shorts-categories"],
    queryFn: async () => (await api.get<Record<string, unknown>>("/shorts/categories")).data,
    staleTime: 5 * 60 * 1000,
  });
}

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

export function useUpdateShortage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: number; quantity?: number; item_category?: string; item_detail?: string }) =>
      (await api.patch<Shortage>(`/shorts/${id}`, payload)).data,
    onSuccess: () => { /* WebSocket handles invalidation */ },
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

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function useAuditEntries(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["audit", runDate],
    queryFn: async () =>
      (await api.get<AuditEntry[]>("/audit/entries", { params: { run_date: runDate } })).data,
    staleTime: 30_000,
  });
}

export function useCreateAuditEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      truck_number: number;
      run_date: string;
      item_label: string;
      quantity?: number;
      note?: string;
      warn_on_next_load?: boolean;
    }) => (await api.post<AuditEntry>("/audit/entries", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit"] }),
  });
}

export function useDeleteAuditEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/audit/entries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit"] }),
  });
}

export function useAuditDailyTrend(daysBack = 14) {
  return useQuery({
    queryKey: ["audit-trend", daysBack],
    queryFn: async () =>
      (await api.get<Array<{ run_date: string; total_qty: number; entry_count: number }>>(
        "/audit/trends/daily",
        { params: { days_back: daysBack } },
      )).data,
  });
}

export function useAuditDates() {
  return useQuery({
    queryKey: ["audit-dates"],
    queryFn: async () =>
      (await api.get<string[]>("/audit/dates")).data,
  });
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export function useMessages(channel = "Team") {
  return useQuery({
    queryKey: ["messages", channel],
    queryFn: async () =>
      (await api.get<Message[]>("/communications/messages", { params: { channel } })).data,
    refetchInterval: 5000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { channel?: string; username: string; sender_role?: string | null; message: string }) =>
      (await api.post<Message>("/communications/messages", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, username, role }: { id: string; username: string; role: string }) =>
      api.delete(`/communications/messages/${id}`, { params: { actor_username: username, actor_role: role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: ["settings"],
    enabled,
    queryFn: async () => (await api.get<AppSetting[]>("/settings")).data,
    staleTime: 60_000,
  });
}

export function useUpsertSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) =>
      (await api.put<AppSetting>(`/settings/${encodeURIComponent(key)}`, { value })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export function useSyncProductionData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<ProductionSyncResult>("/exports/dev/sync-production")).data,
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });
}

export function useNotificationStatus(enabled = true) {
  return useQuery({
    queryKey: ["notifications-status"],
    enabled,
    queryFn: async () => (await api.get<NotificationStatus>("/notifications/status")).data,
    staleTime: 30_000,
    retry: false,
  });
}

export function useSubscribeNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      device_label?: string | null;
      user_agent?: string | null;
    }) => (await api.post<PushSubscriptionRecord>("/notifications/subscribe", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-status"] }),
  });
}

export function useUnsubscribeNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { endpoint: string }) =>
      api.post("/notifications/unsubscribe", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications-status"] }),
  });
}

export function useSendNotificationTest() {
  return useMutation({
    mutationFn: async (payload?: { endpoint?: string | null }) =>
      (await api.post<NotificationEvent>("/notifications/test", payload ?? {})).data,
  });
}

export async function fetchNotificationPublicKey(): Promise<NotificationPublicKey> {
  return (await api.get<NotificationPublicKey>("/notifications/public-key")).data;
}

// ---------------------------------------------------------------------------
// Holiday mode (per run-date)
// ---------------------------------------------------------------------------

export function useHolidayMode(runDate: string) {
  return useQuery({
    queryKey: ["holiday-mode", runDate],
    queryFn: async () => {
      try {
        const { data } = await api.get<AppSetting>(`/settings/holiday_mode_${runDate}`);
        return data.value === true;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return false;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSetHolidayMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runDate, holiday }: { runDate: string; holiday: boolean }) =>
      (await api.put<AppSetting>(`/settings/holiday_mode_${runDate}`, { value: holiday })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["holiday-mode", vars.runDate] });
    },
  });
}

// ---------------------------------------------------------------------------
// Holiday Load / Unload flags (per run-date)
// ---------------------------------------------------------------------------

function makeHolidayOpHooks(op: "load" | "unload") {
  const key = `holiday_${op}` as const;
  function useFlag(runDate: string) {
    return useQuery({
      queryKey: [key, runDate],
      queryFn: async () => {
        try {
          const { data } = await api.get<AppSetting>(`/settings/${key}_${runDate}`);
          return data.value === true;
        } catch (err: unknown) {
          const e = err as { response?: { status?: number } };
          if (e?.response?.status === 404) return false;
          throw err;
        }
      },
      staleTime: 60_000,
      retry: false,
    });
  }
  function useSet() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async ({ runDate, value }: { runDate: string; value: boolean }) =>
        (await api.put<AppSetting>(`/settings/${key}_${runDate}`, { value })).data,
      onSuccess: (_data, vars) => {
        qc.invalidateQueries({ queryKey: [key, vars.runDate] });
      },
    });
  }
  return { useFlag, useSet };
}

const _holidayLoadHooks = makeHolidayOpHooks("load");
const _holidayUnloadHooks = makeHolidayOpHooks("unload");

export const useHolidayLoad = _holidayLoadHooks.useFlag;
export const useSetHolidayLoad = _holidayLoadHooks.useSet;
export const useHolidayUnload = _holidayUnloadHooks.useFlag;
export const useSetHolidayUnload = _holidayUnloadHooks.useSet;

// ---------------------------------------------------------------------------
// Day-number overrides (holiday run correction)
// ---------------------------------------------------------------------------

function makeDayOverrideHooks(op: "load_day" | "unloads_day") {
  const settingKey = `${op}_override`;
  function useOverride(runDate: string) {
    return useQuery({
      queryKey: [settingKey, runDate],
      queryFn: async (): Promise<number | null> => {
        try {
          const { data } = await api.get<AppSetting>(`/settings/${settingKey}_${runDate}`);
          const v = Number(data.value);
          return v >= 1 && v <= 5 ? v : null;
        } catch (err: unknown) {
          const e = err as { response?: { status?: number } };
          if (e?.response?.status === 404) return null;
          throw err;
        }
      },
      staleTime: 60_000,
      retry: false,
    });
  }
  function useSet() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async ({ runDate, value }: { runDate: string; value: number | null }) => {
        if (value === null) {
          try { await api.delete(`/settings/${settingKey}_${runDate}`); } catch { /* already absent */ }
          return null;
        }
        return (await api.put<AppSetting>(`/settings/${settingKey}_${runDate}`, { value })).data;
      },
      onSuccess: (_data, vars) => {
        qc.invalidateQueries({ queryKey: [settingKey, vars.runDate] });
      },
    });
  }
  return { useOverride, useSet };
}

const _loadDayOverrideHooks   = makeDayOverrideHooks("load_day");
const _unloadsDayOverrideHooks = makeDayOverrideHooks("unloads_day");

export const useLoadDayOverride    = _loadDayOverrideHooks.useOverride;
export const useSetLoadDayOverride = _loadDayOverrideHooks.useSet;
export const useUnloadsDayOverride    = _unloadsDayOverrideHooks.useOverride;
export const useSetUnloadsDayOverride = _unloadsDayOverrideHooks.useSet;

// ---------------------------------------------------------------------------
// Daily notes (per run-date)
// ---------------------------------------------------------------------------

export function useDailyNotes(runDate: string) {
  return useQuery({
    queryKey: ["daily-notes", runDate],
    queryFn: async () => {
      try {
        const { data } = await api.get<AppSetting>(`/settings/daily_notes_${runDate}`);
        return (data.value as string) ?? "";
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return "";
        throw err;
      }
    },
  });
}

export function useSetDailyNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runDate, notes }: { runDate: string; notes: string }) =>
      (await api.put<AppSetting>(`/settings/daily_notes_${runDate}`, { value: notes })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["daily-notes", vars.runDate] });
    },
  });
}

export function useWizardCompleted(runDate: string) {
  return useQuery({
    queryKey: ["wizard-completed", runDate],
    queryFn: async () => {
      try {
        const { data } = await api.get<AppSetting>(`/settings/wizard_completed_${runDate}`);
        return data.value === true;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return false;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSetWizardCompleted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runDate: string) =>
      (await api.put<AppSetting>(`/settings/wizard_completed_${runDate}`, { value: true })).data,
    onSuccess: (_data, runDate) => {
      qc.invalidateQueries({ queryKey: ["wizard-completed", runDate] });
    },
  });
}

export interface TrendDailyPoint {
  run_date: string;
  total_qty: number;
  entry_count: number;
}

export interface TrendSummary {
  total_qty: number;
  avg_per_day: number;
  peak_day: string | null;
  peak_qty: number;
  entry_count: number;
  days_with_data: number;
  trend_direction: "up" | "down" | "stable";
  change_vs_prior_pct: number | null;
  daily_series: TrendDailyPoint[];
}

export interface TrendTruckPoint {
  run_date: string;
  total_qty: number;
}

export interface TrendRoutePoint {
  run_date: string;
  total_qty: number;
}

export interface TrendComparison {
  current: TrendDailyPoint[];
  prior: TrendDailyPoint[];
}

export interface PaceDailyPoint {
  run_date: string;
  avg_seconds: number;
  load_count: number;
}

export interface CompletionDailyPoint {
  run_date: string;
  total_trucks: number;
  loaded_trucks: number;
  pct: number;
}

export interface WearersDailyPoint {
  run_date: string;
  avg_wearers: number;
  truck_count: number;
}

export interface CycleDailyPoint {
  run_date: string;
  avg_seconds: number;
  truck_count: number;
}

export interface ShortageDailyPoint {
  run_date: string;
  total_qty: number;
  entry_count: number;
}

export interface ShortageCategoryPoint {
  category: string;
  total_qty: number;
}

export interface ShortageSummary {
  total_qty: number;
  avg_per_day: number;
  peak_day: string | null;
  peak_qty: number;
  entry_count: number;
  days_with_data: number;
  trend_direction: "up" | "down" | "stable";
  change_vs_prior_pct: number | null;
  daily_series: { run_date: string; total_qty: number; entry_count: number }[];
}

export interface QualityRatePoint {
  run_date: string;
  loaded_trucks: number;
  audit_entry_count: number;
  audit_qty: number;
  discrepancy_rate: number | null;
  items_per_truck: number | null;
}

export interface QualityRateSummary {
  avg_items_per_truck: number | null;
  avg_discrepancy_rate: number | null;
  days_with_data: number;
  trend_direction: string;
  change_vs_prior_pct: number | null;
  daily_series: QualityRatePoint[];
}

export interface AnomalyDay {
  run_date: string;
  metric: string;
  value: number;
  mean: number;
  sigma: number;
  z_score: number;
}

export function useTrendSummary(daysBack = 14, compareDaysBack?: number) {
  return useQuery({
    queryKey: ["trend-summary", daysBack, compareDaysBack],
    queryFn: async () =>
      (
        await api.get<TrendSummary>("/audit/trends/summary", {
          params: { days_back: daysBack, compare_days_back: compareDaysBack },
        })
      ).data,
    staleTime: 60_000,
  });
}

export function useTruckTrend(truckNumber: number, daysBack = 30) {
  return useQuery({
    queryKey: ["trend-truck", truckNumber, daysBack],
    queryFn: async () =>
      (
        await api.get<TrendTruckPoint[]>(`/audit/trends/by-truck/${truckNumber}`, {
          params: { days_back: daysBack },
        })
      ).data,
    staleTime: 60_000,
  });
}

export function useRouteTrend(routeNumber: number, daysBack = 30) {
  return useQuery({
    queryKey: ["trend-route", routeNumber, daysBack],
    queryFn: async () =>
      (
        await api.get<TrendRoutePoint[]>(`/audit/trends/by-route/${routeNumber}`, {
          params: { days_back: daysBack },
        })
      ).data,
    staleTime: 60_000,
  });
}

export function useTrendComparison(daysBack = 14) {
  return useQuery({
    queryKey: ["trend-comparison", daysBack],
    queryFn: async () =>
      (
        await api.get<TrendComparison>("/audit/trends/comparison", {
          params: { days_back: daysBack },
        })
      ).data,
    staleTime: 60_000,
  });
}

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

export function useAuditByRoute(daysBack = 30) {
  return useQuery({
    queryKey: ["audit-by-route", daysBack],
    queryFn: async () =>
      (await api.get<AuditRouteRow[]>("/audit/trends/by-route", { params: { days_back: daysBack } }))
        .data,
  });
}

export function useAuditByTruck(daysBack = 30) {
  return useQuery({
    queryKey: ["audit-by-truck", daysBack],
    queryFn: async () =>
      (await api.get<AuditTruckRow[]>("/audit/trends/by-truck", { params: { days_back: daysBack } }))
        .data,
  });
}

// ---------------------------------------------------------------------------
// Load Pace, Completion, Wearers, Cycle, Shortage Trends, Anomalies
// ---------------------------------------------------------------------------

export function useLoadPaceTrend(daysBack = 14) {
  return useQuery({
    queryKey: ["load-pace-trend", daysBack],
    queryFn: async () =>
      (await api.get<PaceDailyPoint[]>("/load-durations/trends/daily", { params: { days_back: daysBack } })).data,
    staleTime: 60_000,
  });
}

export function useCompletionTrend(daysBack = 14) {
  return useQuery({
    queryKey: ["completion-trend", daysBack],
    queryFn: async () =>
      (await api.get<CompletionDailyPoint[]>("/trucks/trends/completion", { params: { days_back: daysBack } })).data,
    staleTime: 60_000,
  });
}

export function useWearersTrend(daysBack = 14) {
  return useQuery({
    queryKey: ["wearers-trend", daysBack],
    queryFn: async () =>
      (await api.get<WearersDailyPoint[]>("/trucks/trends/wearers", { params: { days_back: daysBack } })).data,
    staleTime: 60_000,
  });
}

export function useCycleTimeTrend(daysBack = 14) {
  return useQuery({
    queryKey: ["cycle-trend", daysBack],
    queryFn: async () =>
      (await api.get<CycleDailyPoint[]>("/trucks/trends/cycle", { params: { days_back: daysBack } })).data,
    staleTime: 60_000,
  });
}

export function useShortageDailyTrend(daysBack = 14) {
  return useQuery({
    queryKey: ["shortage-trend-daily", daysBack],
    queryFn: async () =>
      (await api.get<ShortageDailyPoint[]>("/shorts/trends/daily", { params: { days_back: daysBack } })).data,
    staleTime: 60_000,
  });
}

export function useShortageSummary(daysBack = 14, compareDaysBack?: number) {
  return useQuery({
    queryKey: ["shortage-summary", daysBack, compareDaysBack],
    queryFn: async () =>
      (
        await api.get<ShortageSummary>("/shorts/trends/summary", {
          params: { days_back: daysBack, compare_days_back: compareDaysBack },
        })
      ).data,
    staleTime: 60_000,
  });
}

export function useQualityRate(daysBack = 14, compareDaysBack?: number) {
  return useQuery({
    queryKey: ["quality-rate", daysBack, compareDaysBack],
    queryFn: async () =>
      (
        await api.get<QualityRateSummary>("/audit/trends/quality-rate", {
          params: { days_back: daysBack, compare_days_back: compareDaysBack },
        })
      ).data,
    staleTime: 60_000,
  });
}

export function useShortageByCategory(daysBack = 14) {
  return useQuery({
    queryKey: ["shortage-trend-cat", daysBack],
    queryFn: async () =>
      (await api.get<ShortageCategoryPoint[]>("/shorts/trends/by-category", { params: { days_back: daysBack } })).data,
    staleTime: 60_000,
  });
}

export function useTruckAnomalies(daysBack = 90) {
  return useQuery({
    queryKey: ["truck-anomalies", daysBack],
    queryFn: async () =>
      (await api.get<AnomalyDay[]>("/trucks/trends/anomalies", { params: { days_back: daysBack } })).data,
    staleTime: 120_000,
  });
}

export function useAuditAnomalies(daysBack = 90) {
  return useQuery({
    queryKey: ["audit-anomalies", daysBack],
    queryFn: async () =>
      (await api.get<AnomalyDay[]>("/audit/trends/anomalies", { params: { days_back: daysBack } })).data,
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export function useNotices(activeOnly = true) {
  return useQuery({
    queryKey: ["notices", activeOnly],
    queryFn: async () =>
      (await api.get<Notice[]>("/notices", { params: { active_only: activeOnly } })).data,
    refetchInterval: 30000,
  });
}

export function useCreateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      title: string;
      body?: string;
      severity?: NoticeSeverity;
      expires_at?: string | null;
    }) => (await api.post<Notice>("/notices", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notices"] }),
  });
}

export function useUpdateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: number } & Partial<Notice>) =>
      (await api.patch<Notice>(`/notices/${id}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notices"] }),
  });
}

export function useDeleteNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/notices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notices"] }),
  });
}

// ---------------------------------------------------------------------------
// Users / Auth Requests (admin)
// ---------------------------------------------------------------------------

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<User[]>("/auth/users")).data,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      username: string;
      password: string;
      role: AuthRole;
      display_name?: string;
    }) => (await api.post<User>("/auth/users", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      username,
      ...patch
    }: {
      username: string;
      role?: AuthRole;
      display_name?: string;
      is_enabled?: boolean;
    }) => (await api.patch<User>(`/auth/users/${username}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => api.delete(`/auth/users/${username}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async ({ username, new_password }: { username: string; new_password: string }) =>
      api.put(`/auth/users/${username}/password`, { new_password }),
  });
}

export function useAuthRequests(pendingOnly = true) {
  return useQuery({
    queryKey: ["auth-requests", pendingOnly],
    queryFn: async () =>
      (await api.get<AuthRequestRecord[]>("/auth/requests", {
        params: { pending_only: pendingOnly },
      })).data,
  });
}

export function useResolveAuthRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      resolved_by,
    }: {
      id: number;
      status: "approved" | "denied";
      resolved_by: string;
    }) =>
      (await api.patch<AuthRequestRecord>(`/auth/requests/${id}`, { status, resolved_by })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-requests"] }),
  });
}

// ---------------------------------------------------------------------------
// Audit photos
// ---------------------------------------------------------------------------

export interface AuditPhoto {
  id: string;
  truck_number: number;
  run_date: string;
  entry_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  caption: string;
  uploaded_by: string;
  uploaded_at: string;
}

export function useAuditPhotos(runDate: string = todayIso(), truckNumber?: number) {
  return useQuery({
    queryKey: ["audit-photos", runDate, truckNumber ?? "all"],
    queryFn: async () =>
      (
        await api.get<AuditPhoto[]>("/audit/photos", {
          params: { run_date: runDate, truck_number: truckNumber },
        })
      ).data,
  });
}

export function useUploadAuditPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      truck_number: number;
      run_date: string;
      file: File;
      caption?: string;
      uploaded_by?: string;
      entry_id?: string;
    }) => {
      const form = new FormData();
      form.append("truck_number", String(args.truck_number));
      form.append("run_date", args.run_date);
      form.append("caption", args.caption ?? "");
      form.append("uploaded_by", args.uploaded_by ?? "");
      if (args.entry_id) form.append("entry_id", args.entry_id);
      form.append("file", args.file);
      const { data } = await api.post<AuditPhoto>("/audit/photos", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-photos"] }),
  });
}

export function useDeleteAuditPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/audit/photos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-photos"] }),
  });
}

export function auditPhotoFileUrl(id: string): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/audit/photos/${id}/file`;
}

// ---------------------------------------------------------------------------
// Censor words (admin)
// ---------------------------------------------------------------------------

export function useCensorWords() {
  return useQuery({
    queryKey: ["censor-words"],
    queryFn: async () => (await api.get<string[]>("/communications/censor-words")).data,
  });
}

export function useUpdateCensorWords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (words: string[]) =>
      (await api.put<string[]>("/communications/censor-words", words)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["censor-words"] }),
  });
}

// ---------------------------------------------------------------------------
// Load durations (pace / timing)
// ---------------------------------------------------------------------------

export interface LoadDurationRecord {
  id: number;
  truck_number: number;
  run_date: string;
  duration_seconds: number;
  load_day_num: number | null;
  recorded_at: string;
}

export function useLoadDurations(opts?: { runDate?: string; truckNumber?: number; daysBack?: number }) {
  const params: Record<string, unknown> = { days_back: opts?.daysBack ?? 30 };
  if (opts?.runDate) params.run_date = opts.runDate;
  if (opts?.truckNumber != null) params.truck_number = opts.truckNumber;
  return useQuery({
    queryKey: ["load-durations", params],
    queryFn: async () => (await api.get<LoadDurationRecord[]>("/load-durations", { params })).data,
  });
}

export function useRecordLoadDuration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      truck_number: number;
      run_date: string;
      duration_seconds: number;
      load_day_num?: number | null;
    }) => (await api.post<LoadDurationRecord>("/load-durations", args)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["load-durations"] });
      qc.invalidateQueries({ queryKey: ["pace-average"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Truck Notes
// ---------------------------------------------------------------------------

export function useTruckNotes(opts?: { truckNumber?: number; loadDay?: number; activeOnly?: boolean }) {
  const params: Record<string, unknown> = { active_only: opts?.activeOnly ?? true };
  if (opts?.truckNumber != null) params.truck_number = opts.truckNumber;
  if (opts?.loadDay != null) params.load_day = opts.loadDay;
  return useQuery({
    queryKey: ["truck-notes", params],
    queryFn: async () => (await api.get<TruckNote[]>("/notes", { params })).data,
    staleTime: 60_000,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      truck_number: number;
      note_type: NoteType;
      body: string;
      workday_num?: number | null;
      expires_on?: string | null;
    }) => (await api.post<TruckNote>("/notes", payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["truck-notes"] }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: {
      id: number;
      note_type?: NoteType;
      body?: string;
      workday_num?: number | null;
      expires_on?: string | null;
      is_active?: boolean;
    }) => (await api.patch<TruckNote>(`/notes/${id}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["truck-notes"] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["truck-notes"] }),
  });
}

// Driver-portal hooks (unauthenticated, keyed by QR token)
export function useDriverTruckInfo(token: string | undefined) {
  return useQuery({
    queryKey: ["driver-truck", token],
    enabled: !!token,
    queryFn: async () =>
      (await api.get<{ truck_number: number }>(`/notes/driver/${token}/info`)).data,
    staleTime: Infinity,
  });
}

export function useDriverNotes(token: string | undefined) {
  return useQuery({
    queryKey: ["driver-notes", token],
    enabled: !!token,
    queryFn: async () =>
      (await api.get<TruckNote[]>(`/notes/driver/${token}`)).data,
    staleTime: 30_000,
  });
}

interface DriverNotePayload {
  note_type?: string;
  body: string;
  workday_num?: number | null;
  expires_on?: string | null;
}

export function useDriverCreateNote(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DriverNotePayload) =>
      (await api.post<TruckNote>(`/notes/driver/${token}`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-notes", token] }),
  });
}

export function useDriverDeleteNote(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) =>
      api.delete(`/notes/driver/${token}/${noteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-notes", token] }),
  });
}

export function usePaceAverage(lookbackDays = 30) {
  return useQuery({
    queryKey: ["pace-average", lookbackDays],
    queryFn: async () =>
      (await api.get<{ avg_seconds: number | null; lookback_days: number }>(
        "/load-durations/pace-average",
        { params: { lookback_days: lookbackDays } },
      )).data,
    staleTime: 60_000,
  });
}

export function usePurgeAbnormalDurations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.delete<{ removed: number; remaining: number }>("/load-durations/purge-abnormal"))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["load-durations"] }),
  });
}

// ---------------------------------------------------------------------------
// Next Up (per run-date) — stored as an AppSetting
// ---------------------------------------------------------------------------

function nextUpKey(runDate: string): string {
  return `runday_next_up_${runDate}`;
}

export function useNextUp(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["next-up", runDate],
    queryFn: async (): Promise<number | null> => {
      try {
        const { data } = await api.get<AppSetting>(
          `/settings/${encodeURIComponent(nextUpKey(runDate))}`,
        );
        const v = data?.value;
        if (typeof v === "number") return v;
        if (typeof v === "string") {
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return null;
        throw err;
      }
    },
    refetchInterval: 10_000,
  });
}

export function useSetNextUp(runDate: string = todayIso()) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (truckNumber: number) =>
      (
        await api.put<AppSetting>(`/settings/${encodeURIComponent(nextUpKey(runDate))}`, {
          value: truckNumber,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["next-up", runDate] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useClearNextUp(runDate: string = todayIso()) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api.delete(`/settings/${encodeURIComponent(nextUpKey(runDate))}`);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status !== 404) throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["next-up", runDate] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Tracked items (audit checklist catalog) — AppSetting "tracked_items_map"
// ---------------------------------------------------------------------------

export interface TrackedItem {
  label: string;
  qty_default: number;
  /** Optional grouping category shown in the Audit form and ItemsPanel */
  category?: string;
  /** Display label for the pack unit (e.g. "Case", "Bag", "Bundle") */
  unit_label?: string;
  /** Number of individual pieces per pack unit (e.g. 12 for JRT case) */
  pack_size?: number;
}

const DEFAULT_TRACKED_ITEMS: TrackedItem[] = [
  { label: "Terrys/Grids",  qty_default: 1, category: "Towels", unit_label: "Bag",    pack_size: 20 },
  { label: "White Micros",  qty_default: 1, category: "Towels", unit_label: "Bag",    pack_size: 20 },
  { label: "Red Shops",     qty_default: 1, category: "Towels", unit_label: "Bundle", pack_size: 50 },
  { label: "Black Aprons",  qty_default: 1, category: "Aprons", unit_label: "Bag",    pack_size: 10 },
  { label: "White Aprons",  qty_default: 1, category: "Aprons", unit_label: "Bag",    pack_size: 10 },
];

export function useTrackedItems() {
  return useQuery({
    queryKey: ["tracked-items"],
    staleTime: 0,
    queryFn: async (): Promise<TrackedItem[]> => {
      try {
        const { data } = await api.get<AppSetting>("/settings/tracked_items_map");
        const raw = data?.value;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const seen = new Set<string>();
          const items: TrackedItem[] = [];
          for (const [label, meta] of Object.entries(raw as Record<string, unknown>)) {
            const m = (meta && typeof meta === "object") ? (meta as Record<string, unknown>) : {};
            items.push({
              label,
              qty_default: Number(m.qty_default) || 1,
              category: typeof m.category === "string" ? m.category : undefined,
              unit_label: typeof m.unit_label === "string" ? m.unit_label : undefined,
              pack_size: typeof m.pack_size === "number" ? m.pack_size : undefined,
            });
            seen.add(label);
          }
          for (const d of DEFAULT_TRACKED_ITEMS) {
            if (!seen.has(d.label)) items.push(d);
          }
          return items;
        }
        return DEFAULT_TRACKED_ITEMS;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return DEFAULT_TRACKED_ITEMS;
        throw err;
      }
    },
  });
}

export function useUpdateTrackedItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: TrackedItem[]) => {
      const map: Record<string, { qty_default: number; category?: string; unit_label?: string; pack_size?: number }> = {};
      for (const it of items) {
        const label = it.label.trim();
        if (!label) continue;
        map[label] = {
          qty_default: Math.max(1, Math.round(it.qty_default || 1)),
          ...(it.category?.trim() ? { category: it.category.trim() } : {}),
          ...(it.unit_label?.trim() ? { unit_label: it.unit_label.trim() } : {}),
          ...(it.pack_size != null && it.pack_size > 0 ? { pack_size: it.pack_size } : {}),
        };
      }
      return (
        await api.put<AppSetting>("/settings/tracked_items_map", { value: map })
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracked-items"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Full workday reset
// ---------------------------------------------------------------------------

export function useResetWorkday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runDate: string) =>
      (await api.post(`/trucks/reset-workday?run_date=${runDate}`)).data,
    onSuccess: (_data, runDate) => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["truck-states"] });
      qc.invalidateQueries({ queryKey: ["batches", runDate] });
      qc.invalidateQueries({ queryKey: ["route-swaps", runDate] });
      qc.invalidateQueries({ queryKey: ["holiday-mode", runDate] });
      qc.invalidateQueries({ queryKey: ["holiday_load", runDate] });
      qc.invalidateQueries({ queryKey: ["holiday_unload", runDate] });
      qc.invalidateQueries({ queryKey: ["wizard-completed", runDate] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useSelectiveReset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      runDate: string;
      truck_states?: boolean;
      batches?: boolean;
      route_swaps?: boolean;
      day_flags?: boolean;
    }) => {
      const p = new URLSearchParams({ run_date: args.runDate });
      if (args.truck_states) p.set("truck_states", "true");
      if (args.batches)      p.set("batches", "true");
      if (args.route_swaps)  p.set("route_swaps", "true");
      if (args.day_flags)    p.set("day_flags", "true");
      return (await api.post(`/trucks/selective-reset?${p}`)).data;
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["truck-states"] });
      qc.invalidateQueries({ queryKey: ["batches", args.runDate] });
      qc.invalidateQueries({ queryKey: ["route-swaps", args.runDate] });
      qc.invalidateQueries({ queryKey: ["holiday-mode", args.runDate] });
      qc.invalidateQueries({ queryKey: ["holiday_load", args.runDate] });
      qc.invalidateQueries({ queryKey: ["holiday_unload", args.runDate] });
      qc.invalidateQueries({ queryKey: ["wizard-completed", args.runDate] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Bulk truck status update (Supervisor page)
// ---------------------------------------------------------------------------

export function useBulkUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      run_date: string;
      new_status: TruckStatus;
      /** Explicit trucks (e.g. Fleet page selection). */
      truck_numbers?: number[];
      /** Status-based selection, resolved SERVER-side at execution time —
       *  immune to stale client snapshots. Prefer for "all X → Y" moves. */
      from_status?: TruckStatus;
    }) => {
      const params = new URLSearchParams();
      params.set("run_date", args.run_date);
      params.set("new_status", args.new_status);
      for (const n of args.truck_numbers ?? []) params.append("truck_numbers", String(n));
      if (args.from_status) params.set("from_status", args.from_status);
      return (await api.put<TruckState[]>(`/trucks/bulk/status?${params.toString()}`)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["truck-states"] });
    },
  });
}
