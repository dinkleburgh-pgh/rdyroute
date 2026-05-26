import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, todayIso } from "./client";
import * as offlineQueue from "./offlineQueue";
import type {
  AppSetting,
  AuditEntry,
  AuthRequestRecord,
  AuthRole,
  BatchSummary,
  Message,
  Notice,
  NoticeSeverity,
  RouteSwap,
  Shortage,
  SpareAssignment,
  TokenResponse,
  Truck,
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

// ---------------------------------------------------------------------------
// Trucks / Board
// ---------------------------------------------------------------------------

export function useBoard(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["board", runDate],
    queryFn: async () =>
      (await api.get<TruckWithState[]>("/trucks/board", { params: { run_date: runDate } })).data,
    refetchInterval: 5000,
  });
}

export function useUpsertTruckState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      truck_number: number;
      run_date: string;
      status?: TruckStatus;
      wearers?: number;
      batch_id?: number | null;
      load_start_time?: number | null;
      load_finish_time?: number | null;
      load_duration_seconds?: number | null;
      off_note?: string | null;
      shop_note?: string | null;
      oos_spare_route?: number | null;
      has_dust_garment?: boolean | null;
    }) => {
      const { truck_number, run_date, ...patch } = args;
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
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["batches", vars.run_date] }),
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
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["batches", vars.run_date] }),
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
    },
  });
}

export function useDeleteSpare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/spares/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spares"] }),
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
      qc.invalidateQueries({ queryKey: ["route-swaps", vars.run_date] });
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
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
      qc.invalidateQueries({ queryKey: ["route-swaps", vars.runDate] });
      qc.invalidateQueries({ queryKey: ["board", vars.runDate] });
    },
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

export function useShortages(runDate: string = todayIso(), truckNumber?: number) {
  return useQuery({
    queryKey: ["shorts", runDate, truckNumber ?? "all"],
    queryFn: async () =>
      (await api.get<Shortage[]>("/shorts", {
        params: { run_date: runDate, truck_number: truckNumber },
      })).data,
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
    onSuccess: (data) => {
      // Skip cache invalidation for queued items; sync will handle it on reconnect
      if (data && "queued" in (data as object)) return;
      qc.invalidateQueries({ queryKey: ["shorts"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function useAuditEntries(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["audit", runDate],
    queryFn: async () =>
      (await api.get<AuditEntry[]>("/audit/entries", { params: { run_date: runDate } })).data,
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

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get<AppSetting[]>("/settings")).data,
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
}

export function useTrackedItems() {
  return useQuery({
    queryKey: ["tracked-items"],
    queryFn: async (): Promise<TrackedItem[]> => {
      try {
        const { data } = await api.get<AppSetting>("/settings/tracked_items_map");
        const raw = data?.value;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          return Object.entries(raw as Record<string, unknown>).map(([label, meta]) => {
            const m = (meta && typeof meta === "object") ? (meta as Record<string, unknown>) : {};
            return {
              label,
              qty_default: Number(m.qty_default) || 1,
              category: typeof m.category === "string" ? m.category : undefined,
            };
          });
        }
        return [];
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return [];
        throw err;
      }
    },
  });
}

export function useUpdateTrackedItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: TrackedItem[]) => {
      const map: Record<string, { qty_default: number; category?: string }> = {};
      for (const it of items) {
        const label = it.label.trim();
        if (!label) continue;
        map[label] = {
          qty_default: Math.max(1, Math.round(it.qty_default || 1)),
          ...(it.category?.trim() ? { category: it.category.trim() } : {}),
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
// Bulk truck status update (Supervisor page)
// ---------------------------------------------------------------------------

export function useBulkUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      run_date: string;
      truck_numbers: number[];
      new_status: TruckStatus;
    }) => {
      const params = new URLSearchParams();
      params.set("run_date", args.run_date);
      params.set("new_status", args.new_status);
      for (const n of args.truck_numbers) params.append("truck_numbers", String(n));
      return (await api.put(`/trucks/bulk/status?${params.toString()}`)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["truck-states"] });
    },
  });
}
