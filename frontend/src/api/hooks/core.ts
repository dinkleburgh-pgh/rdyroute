/**
 * Auth, fleet, board state, load order, batches.
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
      needs_crossload?: boolean | null;
      crossload_to_truck?: number | null;
      arrived_at?: number | null;
      unloading_started_at?: number | null;
      driver_claimed_route?: number | null;
      /**
       * The status this write assumed the truck was in. Filled in automatically
       * by onMutate below from the pre-mutation cache; the server 409s if the
       * committed row disagrees. Pass `null` explicitly to opt out (a write that
       * genuinely does not care what it is overwriting).
       */
      expected_status?: TruckStatus | null;
    }) => {
      const { truck_number, run_date, state_source, expected_status, ...rest } = args;
      const patch = {
        ...rest,
        state_source: state_source ?? "workflow",
        // Omitted entirely when unknown, so the server skips the check rather
        // than comparing against null.
        ...(expected_status ? { expected_status } : {}),
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
          // No row exists, so there is nothing to have a stale opinion about —
          // and TruckStateCreate has no such field. Strip it.
          const { expected_status: _drop, ...createBody } = patch as typeof patch & {
            expected_status?: TruckStatus | null;
          };
          const { data } = await api.post(`/trucks/${truck_number}/state`, {
            truck_number,
            run_date,
            status: createBody.status ?? "dirty",
            wearers: createBody.wearers ?? 0,
            ...createBody,
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
      // Stamp the precondition from the PRE-mutation cache — the status this
      // write is actually reacting to. React Query hands the same `vars` object
      // to mutationFn, so doing it here covers every caller of this hook at
      // once, and no future surface can forget it. It has to happen before the
      // optimistic update below, which overwrites the very value we need.
      if ((vars.status !== undefined || vars.unloading_started_at !== undefined) && vars.expected_status === undefined) {
        const seen = (previous as import("../../types").TruckWithState[] | undefined)
          ?.find((t) => t.truck_number === vars.truck_number)?.state?.status;
        if (seen) vars.expected_status = seen;
      }
      // Immediately reflect the change so the dropdown doesn't snap back
      qc.setQueryData<import("../../types").TruckWithState[]>(
        ["board", vars.run_date],
        (old) => {
          if (!old) return old;
          return old.map((t) => {
            if (t.truck_number !== vars.truck_number) return t;
            const base = t.state ?? {
              id: 0,
              truck_number: vars.truck_number,
              run_date: vars.run_date,
              status: "dirty" as import("../../types").TruckStatus,
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
              needs_crossload: false,
              crossload_to_truck: null,
              arrived_at: null,
              unloaded_at: null,
              unloading_started_at: null,
              load_request: null,
              load_request_at: null,
              driver_claimed_route: null,
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
                ...(vars.needs_crossload    !== undefined && { needs_crossload: vars.needs_crossload ?? false }),
                ...(vars.crossload_to_truck !== undefined && { crossload_to_truck: vars.crossload_to_truck }),
                ...(vars.arrived_at         !== undefined && { arrived_at: vars.arrived_at }),
                ...(vars.unloading_started_at !== undefined && { unloading_started_at: vars.unloading_started_at }),
                ...(vars.driver_claimed_route !== undefined && { driver_claimed_route: vars.driver_claimed_route }),
                ...(vars.state_source       !== undefined && vars.state_source !== null && { state_source: vars.state_source }),
              },
            };
          });
        },
      );
      return { previous };
    },
    onError: (err, vars, context) => {
      logDebug("mutation", `FAILED #${vars.truck_number} → ${vars.status ?? "(fields)"} @${vars.run_date}`, {
        vars,
        error: (err as { message?: string })?.message,
      });
      const ctx = context as { previous?: unknown } | undefined;
      if (ctx?.previous !== undefined) {
        qc.setQueryData(["board", vars.run_date], ctx.previous);
      }
      // The rollback is invisible on its own: the card flips, then flips back
      // a beat later — which reads as a haunted board, not a failed save.
      emitToast(
        errorMessage(err, `Couldn't save truck #${vars.truck_number} — change reverted.`),
        "error",
        { durationMs: 6000, chip: `#${vars.truck_number}` },
      );
    },
    onSuccess: (_data, vars) => {
      logDebug("mutation", `#${vars.truck_number} → ${vars.status ?? "(fields)"} @${vars.run_date}`, vars);
      qc.invalidateQueries({ queryKey: ["board", vars.run_date] });
    },
  });
}

// ---------------------------------------------------------------------------
// Load/unload sequence history — "this truck usually loads 3rd".
// ---------------------------------------------------------------------------

export interface SequenceSuggestion {
  truck_number: number;
  avg_load_position: number | null;
  times_loaded: number;
  avg_unload_position: number | null;
  times_unloaded: number;
}

export function useLoadSequenceSuggestions(daysBack = 14) {
  return useQuery({
    queryKey: ["sequence-suggestions", daysBack],
    queryFn: async () =>
      (await api.get<{ days_back: number; suggestions: SequenceSuggestion[] }>(
        "/load-durations/sequence-suggestions",
        { params: { days_back: daysBack } },
      )).data.suggestions,
    staleTime: 5 * 60 * 1000,
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

