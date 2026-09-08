/**
 * Audit entries, communications, settings, templates, workflow notes, toast settings, holiday flags, day overrides, daily notes.
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

/**
 * Unacknowledged load warnings, grouped by truck number.
 *
 * The endpoint has existed since the audit feature shipped — its docstring
 * says it is "used by the loader workflow to surface warnings before starting
 * a truck" — but nothing on the load side ever rendered it. The Load Display
 * is the first consumer.
 */
export function useActiveWarnings(runDate: string = todayIso()) {
  return useQuery({
    queryKey: ["active-warnings", runDate],
    queryFn: async () =>
      (await api.get<Record<string, AuditEntry[]>>("/audit/active-warnings", {
        params: { run_date: runDate },
      })).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
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

// ---------------------------------------------------------------------------
// Unload-day templates (per unload day 1-5)
//
// The paper unload sheet is the same every week for a given day: the same
// routes with the same wearer counts, and the same standing notes ("69 must be
// in its own batch"). Storing that per day means the batching wizard can
// prefill wearers instead of someone retyping ~20 numbers a night.
//
// Kept in AppSettings (like recurring_route_swaps) rather than a table — it's
// a handful of small documents, edited rarely, and needs no migration.
// ---------------------------------------------------------------------------

export const unloadDayWearersKey = (day: number) => `unload_day_wearers_${day}`;
const unloadDayNotesKey = (day: number) => `unload_day_notes_${day}`;

export interface UnloadDayTemplate {
  /** truck number -> wearers for this unload day. */
  wearers: Record<number, number>;
  /** Standing notes for this unload day, one per line. */
  notes: string;
}

/** The stored template for an unload day (1-5). Reads the shared settings
 *  payload, so it costs no extra request. */
export function useUnloadDayTemplate(day: number | null | undefined): UnloadDayTemplate {
  const { data: settings = [] } = useSettings();
  return useMemo(() => {
    if (day == null) return { wearers: {}, notes: "" };
    const raw = settings.find((s) => s.key === unloadDayWearersKey(day))?.value;
    const wearers: Record<number, number> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const n = Number(k);
        const w = Number(v);
        if (Number.isFinite(n) && Number.isFinite(w)) wearers[n] = w;
      }
    }
    const notesRaw = settings.find((s) => s.key === unloadDayNotesKey(day))?.value;
    return { wearers, notes: typeof notesRaw === "string" ? notesRaw : "" };
  }, [settings, day]);
}

/**
 * Who last confirmed the monthly wearer sheets, and for which service month.
 * Null until someone confirms for the first time.
 */
export function useWearerDefaultsReview(): WearerDefaultsReview | null {
  const { data: settings = [] } = useSettings();
  return useMemo(
    () => parseWearerDefaultsReview(
      settings.find((s) => s.key === WEARER_DEFAULTS_REVIEW_KEY)?.value,
    ),
    [settings],
  );
}

/**
 * A setting row's own `updated_at`, which the API already ships.
 *
 * This is the fallback for per-day "last changed" on sheets written before
 * anyone confirmed — it has a timestamp but no author. Note it only moves when
 * the VALUE actually changed: re-saving identical numbers is not an UPDATE, so
 * this answers "last changed", never "last checked".
 */
export function useSettingUpdatedAt(key: string): string | null {
  const { data: settings = [] } = useSettings();
  return useMemo(() => settings.find((s) => s.key === key)?.updated_at ?? null, [settings, key]);
}

// ---------------------------------------------------------------------------
// Workflow notes (unload / load)
//
// Two kinds, per workflow:
//   - PERSISTENT: applies every run day  -> "{scope}_persistent_notes"
//   - PER WORKDAY 1-5                    -> "{scope}_day_notes_{n}"
//
// The unload side already used `unload_day_notes_{n}` for the standing notes
// transcribed off the paper sheet, so this generalises those keys rather than
// introducing a parallel set — editing day 3 here edits what the Unload page
// and the batching wizard have always shown.
//
// Stored in AppSettings for the same reason as the wearer sheets: a handful of
// small documents, edited rarely, no migration needed.
// ---------------------------------------------------------------------------

export type NoteScope = "unload" | "load";

export const workflowDayNotesKey = (scope: NoteScope, day: number) =>
  `${scope}_day_notes_${day}`;
export const workflowPersistentNotesKey = (scope: NoteScope) =>
  `${scope}_persistent_notes`;

export interface WorkflowNotes {
  /** Shown every run day for this workflow. */
  persistent: string;
  /** Workday number (1-5) -> that day's standing notes. */
  days: Record<number, string>;
}

/** Every stored note for a workflow. Reads the shared settings payload, so it
 *  costs no extra request. */
export function useWorkflowNotes(scope: NoteScope): WorkflowNotes {
  const { data: settings = [] } = useSettings();
  return useMemo(() => {
    const str = (key: string) => {
      const v = settings.find((s) => s.key === key)?.value;
      return typeof v === "string" ? v : "";
    };
    const days: Record<number, string> = {};
    for (const d of [1, 2, 3, 4, 5]) days[d] = str(workflowDayNotesKey(scope, d));
    return { persistent: str(workflowPersistentNotesKey(scope)), days };
  }, [settings, scope]);
}

/** The notes that apply to a workflow RIGHT NOW: the persistent set plus the
 *  current workday's, already split into lines with bullet markers stripped. */
export function useActiveWorkflowNotes(scope: NoteScope, day: number | null | undefined) {
  const notes = useWorkflowNotes(scope);
  return useMemo(() => {
    const split = (s: string) =>
      s.split("\n").map((l) => l.replace(/^\s*[*•-]\s*/, "").trim()).filter(Boolean);
    return {
      persistent: split(notes.persistent),
      day: day == null ? [] : split(notes.days[day] ?? ""),
    };
  }, [notes, day]);
}

// ---------------------------------------------------------------------------
// Pop-up (toast) settings
//
// Every slide-in alert has a KIND. Each kind can be turned off on its own and
// given its own dwell time, because they aren't equally urgent: a chat message
// can flick past, a truck going out of service should sit there until someone
// acknowledges it. Stored as one AppSetting document rather than a key per
// kind — it's a handful of small values edited together on one screen.
//
// `seconds: 0` means STICKY: the toast stays until dismissed. That's the same
// contract ToastContext already uses for durationMs <= 0.
// ---------------------------------------------------------------------------

export const TOAST_SETTINGS_KEY = "toast_settings";

export type ToastKind =
  | "driver_note"
  | "chat_message"
  | "notice"
  | "truck_unloaded"
  | "truck_arrived"
  | "truck_hold"
  | "truck_oos"
  | "coverage"
  | "load_request";

export interface ToastKindConfig {
  enabled: boolean;
  /** Dwell time in seconds; 0 = stays until dismissed. */
  seconds: number;
  /** Play the chime with this toast. Only meaningful where a default sets it. */
  sound?: boolean;
}

/** Defaults reproduce the durations these alerts have always used, so an
 *  install with no saved settings behaves exactly as before. */
export const TOAST_DEFAULTS: Record<ToastKind, ToastKindConfig> = {
  driver_note:    { enabled: true, seconds: 12 },
  chat_message:   { enabled: true, seconds: 12 },
  notice:         { enabled: true, seconds: 15 },
  // Long by design: whoever walks up to Load should still see the trucks that
  // came ready while they were away from the screen.
  truck_unloaded: { enabled: true, seconds: 420 },
  // sound on by default: the unload dock works heads-down, and the whole
  // point of the arrival toast is to be noticed without watching the screen.
  truck_arrived:  { enabled: true, seconds: 10, sound: true },
  // Hold and OOS must be acknowledged — sticky unless someone changes it.
  truck_hold:     { enabled: true, seconds: 0 },
  truck_oos:      { enabled: true, seconds: 0 },
  coverage:       { enabled: true, seconds: 12 },
  // Aimed at one specific person on the dock, like a hold — sticky so it can't
  // scroll past while they're heads-down in a truck. Sound off by default;
  // the dock can turn the chime on for itself.
  load_request:   { enabled: true, seconds: 0, sound: false },
};

export const TOAST_KIND_LABELS: Record<ToastKind, { label: string; hint: string }> = {
  driver_note:    { label: "Driver note", hint: "A driver added a note from their QR page." },
  chat_message:   { label: "Chat message", hint: "A new message in Communications." },
  notice:         { label: "Notice", hint: "A fleet notice was posted." },
  truck_unloaded: { label: "Truck unloaded", hint: "Shown only on Fleet and Load — a truck is ready to load." },
  truck_arrived:  { label: "Truck arrived", hint: "A truck parked back in the yard." },
  truck_hold:     { label: "Priority hold", hint: "A truck was put on hold. Needs acknowledging." },
  truck_oos:      { label: "Out of service", hint: "A truck went OOS. Needs acknowledging." },
  coverage:       { label: "Coverage change", hint: "Coverage assigned, changed, or removed." },
  load_request:   { label: "Load asked", hint: "Shown only on Unload — Load wants the current truck pulled forward, or backed out of." },
};

export interface ToastSettings {
  /** Master switch — when false nothing pops at all. */
  enabled: boolean;
  kinds: Record<ToastKind, ToastKindConfig>;
}

/** Resolved pop-up settings: stored values over the defaults. Reads the shared
 *  settings payload, so it costs no extra request. */
export function useToastSettings(): ToastSettings {
  const { data: settings = [] } = useSettings();
  return useMemo(() => {
    const enabled = settings.find((s) => s.key === "realtime_toasts_enabled")?.value !== false;
    const raw = settings.find((s) => s.key === TOAST_SETTINGS_KEY)?.value;
    const kinds = { ...TOAST_DEFAULTS };
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!(k in TOAST_DEFAULTS) || !v || typeof v !== "object") continue;
        const cfg = v as Partial<ToastKindConfig>;
        const secs = Number(cfg.seconds);
        kinds[k as ToastKind] = {
          enabled: cfg.enabled !== false,
          // Guard the stored value: a negative or non-numeric dwell would make
          // a toast that should expire hang around forever.
          seconds: Number.isFinite(secs) && secs >= 0 ? secs : TOAST_DEFAULTS[k as ToastKind].seconds,
          sound: typeof cfg.sound === "boolean" ? cfg.sound : TOAST_DEFAULTS[k as ToastKind].sound === true,
        };
      }
    }
    return { enabled, kinds };
  }, [settings]);
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
  total_wearers: number;
  truck_count: number;
}

export interface UnloadDailyPoint {
  run_date: string;
  arrived_trucks: number;
  unloaded_trucks: number;
  avg_dwell_seconds: number | null;
}

export interface ShortageTruckPoint {
  truck_number: number;
  total_qty: number;
  entry_count: number;
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

export interface ShortageItemPoint {
  category: string;
  detail: string;
  label: string; // fully-qualified exact item, e.g. "Bulk > Towels Red Shop"
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

export interface LastAuditedRow {
  truck_number: number;
  last_run_date: string | null;
}

/** Audit-rotation steering — least-recently-audited route trucks first. */
export function useLastAudited() {
  return useQuery({
    queryKey: ["audit-last-audited"],
    queryFn: async () => (await api.get<LastAuditedRow[]>("/audit/last-audited")).data,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Day gap — unlogged weekdays between the last used day and a run date.
// ---------------------------------------------------------------------------

export interface DayGapDay {
  date: string;
  closed: boolean;
}

export interface DayGapOut {
  prev_data_date: string | null;
  gap_days: DayGapDay[];
}

/** Unlogged weekdays before this run date, with their plant-closed flags. */
export function useDayGap(runDate: string) {
  return useQuery({
    queryKey: ["day-gap", runDate],
    queryFn: async () =>
      (await api.get<DayGapOut>("/trucks/day-gap", { params: { run_date: runDate } })).data,
    staleTime: 60_000,
  });
}

/** Record which gap days the plant was closed; reseeds the day when untouched. */
export function useApplyDayGap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { run_date: string; closed_dates: string[]; reseed?: boolean }) =>
      (
        await api.post<{ gap_days: DayGapDay[]; reseeded: boolean; reason: string | null }>(
          "/trucks/day-gap",
          payload,
        )
      ).data,
    onSuccess: (data, vars) => {
      // The response carries the authoritative flags — seed the cache with
      // them so the banner can't render a stale window between invalidation
      // and refetch.
      qc.setQueryData(["day-gap", vars.run_date], (old: DayGapOut | undefined) =>
        old ? { ...old, gap_days: data.gap_days } : old,
      );
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}
