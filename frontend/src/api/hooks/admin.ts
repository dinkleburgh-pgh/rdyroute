/**
 * Notices, users, audit photos, documents, censor words, load durations, truck notes, next-up.
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
// Documents (shared file/photo library — leads + admins)
// ---------------------------------------------------------------------------

export interface DocumentLink {
  id: number;
  document_id: string;
  target_type: string; // "truck" | "run_date"
  target_key: string;
  created_by: string;
  created_at: string;
}

// Named DocumentItem (not Document) to avoid shadowing the DOM `Document` global.
export interface DocumentItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  links: DocumentLink[];
}

export function useDocuments(filters?: { q?: string; category?: string; tag?: string; targetType?: string; targetKey?: string; enabled?: boolean }) {
  const params: Record<string, unknown> = {};
  if (filters?.q) params.q = filters.q;
  if (filters?.category) params.category = filters.category;
  if (filters?.tag) params.tag = filters.tag;
  if (filters?.targetType) params.target_type = filters.targetType;
  if (filters?.targetKey) params.target_key = filters.targetKey;
  return useQuery({
    queryKey: ["documents", params],
    queryFn: async () => (await api.get<DocumentItem[]>("/documents", { params })).data,
    staleTime: 30_000,
    enabled: filters?.enabled ?? true,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      file: File;
      title?: string;
      description?: string;
      category?: string;
      tags?: string[];
      onProgress?: (pct: number) => void;
    }) => {
      const form = new FormData();
      form.append("title", args.title ?? "");
      form.append("description", args.description ?? "");
      form.append("category", args.category ?? "");
      form.append("tags", (args.tags ?? []).join(","));
      form.append("file", args.file);
      const { data } = await api.post<DocumentItem>("/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (args.onProgress && e.total) args.onProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; title?: string; description?: string; category?: string; tags?: string[] }) =>
      (await api.patch<DocumentItem>(`/documents/${id}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useAddDocumentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { documentId: string; targetType: string; targetKey: string }) =>
      (await api.post<DocumentLink>(`/documents/${args.documentId}/links`, {
        target_type: args.targetType,
        target_key: args.targetKey,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useRemoveDocumentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { documentId: string; linkId: number }) =>
      api.delete(`/documents/${args.documentId}/links/${args.linkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function documentFileUrl(id: string): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/documents/${id}/file`;
}

/** JPEG preview (HEIC/image downscale or PDF first page); generated on demand. */
export function documentPreviewUrl(id: string): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/documents/${id}/preview`;
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

/** Resolved coverage for a spare's QR page: the route it carried this run. */
export interface DriverCoverage {
  route_truck: number;
  run_date: string;
  source: "state" | "swap" | "assignment" | "log";
}

export interface DriverTruckInfo {
  truck_number: number;
  is_spare: boolean;
  coverage: DriverCoverage | null;
  /** Pending unconfirmed "I covered route N" claim, if the driver made one. */
  claimed_route: number | null;
  /** Route numbers for the Select Route picker — only when spare + no coverage. */
  route_options?: number[];
  /** When true, arrival stamps need the rotating dock code. */
  arrival_code_required?: boolean;
}

export function useDriverTruckInfo(token: string | undefined) {
  return useQuery({
    queryKey: ["driver-truck", token],
    enabled: !!token,
    queryFn: async () =>
      (await api.get<DriverTruckInfo>(`/notes/driver/${token}/info`)).data,
    // Coverage and claims change during the day (a lead confirms, an
    // assignment lands), so this can no longer be cached forever the way the
    // bare truck number could.
    staleTime: 60_000,
    networkMode: "always",
    retry: 1,
  });
}

/** Notes for the ROUTE a spare is covering (empty for route trucks / no coverage). */
export function useDriverCoverageNotes(token: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["driver-coverage-notes", token],
    enabled: !!token && enabled,
    queryFn: async () =>
      (await api.get<TruckNote[]>(`/notes/driver/${token}/coverage-notes`)).data,
    staleTime: 30_000,
    networkMode: "always",
    retry: 1,
  });
}

export interface DriverRunReportResult {
  truck_number: number;
  choice: "route" | "ran_special" | "clean";
  arrived_at: number | null;
  claimed_route: number | null;
  status: TruckStatus;
}

/** Spare driver reports how the run ended: route claim / ran special / clean. */
export function useDriverRunReport(token: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { choice: "route" | "ran_special" | "clean"; route_truck?: number; code?: string }) =>
      (await api.post<DriverRunReportResult>(`/notes/driver/${token}/run-report`, payload)).data,
    // Never queued, never paused — see useDriverNotes.
    networkMode: "always",
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-truck", token] }),
  });
}

export function useDriverNotes(token: string | undefined) {
  return useQuery({
    queryKey: ["driver-notes", token],
    enabled: !!token,
    queryFn: async () =>
      (await api.get<TruckNote[]>(`/notes/driver/${token}`)).data,
    staleTime: 30_000,
    // The app-wide default is offlineFirst, which PAUSES rather than errors when
    // the browser reports offline: isLoading and isError both go false with no
    // data, and the page renders as though the truck genuinely has no notes.
    // A driver in a yard would be told "No notes yet" while a real instruction
    // sat on the server. Always attempt, so a failure is a failure the UI can
    // report and offer to retry.
    networkMode: "always",
    retry: 1,
  });
}

interface DriverNotePayload {
  note_type?: string;
  body: string;
  workday_num?: number | null;
  expires_on?: string | null;
}

export function useDriverMarkArrived(token: string | undefined) {
  return useMutation({
    // The code rides in the BODY, matching run-report — a query string would
    // put a live (if short-lived) OTP into every access log on the path.
    mutationFn: async (code?: string) =>
      (await api.post<{ truck_number: number; arrived_at: number | null; already: boolean }>(
        `/notes/driver/${token}/arrived`,
        code ? { code } : {},
      )).data,
    // Never queued, never paused — a driver must not be told the dock knows
    // when it does not. See useDriverNotes.
    networkMode: "always",
  });
}

export function useDriverCreateNote(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DriverNotePayload) =>
      (await api.post<TruckNote>(`/notes/driver/${token}`, payload)).data,
    // Never silently pause a driver write — see useDriverNotes.
    networkMode: "always",
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-notes", token] }),
  });
}

export function useDriverDeleteNote(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) =>
      api.delete(`/notes/driver/${token}/${noteId}`),
    networkMode: "always",
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
    // Polled so a dock display picks up a Next Up set from someone's phone.
    // Settings changes don't broadcast over the websocket, hence the poll — but
    // Next Up changes a handful of times a shift, so 10s was ~350 requests an
    // hour per open tab for a value that rarely moves. The 404-on-unset is
    // still handled above for older backends; the server now returns a null
    // default instead.
    refetchInterval: 30_000,
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
  /** Optional COLOR_PRESETS key for the item's shortage-picker tile */
  color?: string;
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
          const items: TrackedItem[] = [];
          for (const [label, meta] of Object.entries(raw as Record<string, unknown>)) {
            const m = (meta && typeof meta === "object") ? (meta as Record<string, unknown>) : {};
            items.push({
              label,
              qty_default: Number(m.qty_default) || 1,
              category: typeof m.category === "string" ? m.category : undefined,
              unit_label: typeof m.unit_label === "string" ? m.unit_label : undefined,
              pack_size: typeof m.pack_size === "number" ? m.pack_size : undefined,
              color: typeof m.color === "string" ? m.color : undefined,
            });
          }
          // Defaults are a FIRST-RUN seed only. Back-filling per missing
          // label made deleted/renamed defaults resurrect on every read.
          return items.length > 0 ? items : DEFAULT_TRACKED_ITEMS;
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
      const map: Record<string, { qty_default: number; category?: string; unit_label?: string; pack_size?: number; color?: string }> = {};
      for (const it of items) {
        const label = it.label.trim();
        if (!label) continue;
        map[label] = {
          qty_default: Math.max(1, Math.round(it.qty_default || 1)),
          ...(it.category?.trim() ? { category: it.category.trim() } : {}),
          ...(it.unit_label?.trim() ? { unit_label: it.unit_label.trim() } : {}),
          ...(it.pack_size != null && it.pack_size > 0 ? { pack_size: it.pack_size } : {}),
          ...(it.color?.trim() ? { color: it.color.trim() } : {}),
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
// Tracked item categories — AppSetting "tracked_item_categories"
// Metadata map keyed by the normalized category string ("Top" or "Top > Sub"):
// existence (so empty categories survive reload) + optional color preset.
// ---------------------------------------------------------------------------

export interface CategoryMeta {
  color?: string;
}
export type CategoryMetaMap = Record<string, CategoryMeta>;

export function useTrackedItemCategories() {
  return useQuery({
    queryKey: ["tracked-item-categories"],
    staleTime: 0,
    queryFn: async (): Promise<CategoryMetaMap> => {
      try {
        const { data } = await api.get<AppSetting>("/settings/tracked_item_categories");
        const raw = data?.value;
        // Legacy tolerance: a bare string[] becomes { name: {} }.
        if (Array.isArray(raw)) {
          const out: CategoryMetaMap = {};
          for (const c of raw) if (typeof c === "string" && c.trim()) out[c.trim()] = {};
          return out;
        }
        if (raw && typeof raw === "object") {
          const out: CategoryMetaMap = {};
          for (const [name, meta] of Object.entries(raw as Record<string, unknown>)) {
            if (!name.trim()) continue;
            const m = (meta && typeof meta === "object") ? (meta as Record<string, unknown>) : {};
            out[name] = { ...(typeof m.color === "string" && m.color ? { color: m.color } : {}) };
          }
          return out;
        }
        return {};
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 404) return {};
        throw err;
      }
    },
  });
}

export function useUpdateTrackedItemCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (meta: CategoryMetaMap) =>
      (await api.put<AppSetting>("/settings/tracked_item_categories", { value: meta })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracked-item-categories"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Load crew's answer on the truck being unloaded
// ---------------------------------------------------------------------------

export type LoadRequestValue = "want" | "skip";

/**
 * Set (or clear, with null) the load crew's advisory request on one truck.
 *
 * Its own endpoint rather than the generic state upsert: the offline queue
 * filters by URL and this one is deliberately excluded (see api/client.ts), so
 * a tap on a dead connection fails visibly instead of replaying a stale opinion
 * later. `networkMode: "always"` keeps React Query from pausing it before axios
 * ever gets the chance to fail.
 */
export function useSetLoadRequest(runDate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      truck_number: number;
      request: LoadRequestValue | null;
      expected_status?: TruckStatus | null;
    }) => {
      const { truck_number, request, expected_status } = args;
      const { data } = await api.post(
        `/trucks/${truck_number}/load-request`,
        { request, ...(expected_status ? { expected_status } : {}) },
        { params: { run_date: runDate } },
      );
      return data;
    },
    networkMode: "always",
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", runDate] }),
  });
}

// ---------------------------------------------------------------------------
// Reset day — rewind a run date to how the day started
// ---------------------------------------------------------------------------

export interface ResetDayResult {
  reset: boolean;
  run_date: string;
  states_cleared: number;
  states_rebuilt: number;
  batches_cleared: number;
}

export function useResetDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runDate: string) =>
      (await api.post<ResetDayResult>(`/trucks/reset-day?run_date=${runDate}`)).data,
    onSuccess: (_data, runDate) => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["truck-states"] });
      qc.invalidateQueries({ queryKey: ["batches", runDate] });
      qc.invalidateQueries({ queryKey: ["next-up", runDate] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}


// ---------------------------------------------------------------------------
// Rotating dock arrival code (proof-of-presence for driver arrival stamps).
// ---------------------------------------------------------------------------

export interface ArrivalCodeOut {
  code: string;
  seconds_left: number;
  required: boolean;
}

/** The current dock code — for the plant screens (Load Display, /arrival-code). */
export function useArrivalCode() {
  return useQuery({
    queryKey: ["arrival-code"],
    queryFn: async () => (await api.get<ArrivalCodeOut>("/notes/arrival-code")).data,
    // Poll to land just after each rotation (never later than 20s), so the
    // screen flips to the new code as it becomes valid instead of showing the
    // old one for up to 20s of a flat interval.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d ? Math.min(20_000, d.seconds_left * 1000 + 300) : 20_000;
    },
    staleTime: 0,
  });
}
