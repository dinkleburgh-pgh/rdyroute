import { errorMessage } from "../api/errors";
import { useMemo, useState } from "react";
import {
  useBoard,
  useClearNextUp,
  useNextUp,
  useRecordLoadDuration,
  useUpsertTruckState,
} from "../api/hooks";
import { useToast } from "../contexts/ToastContext";
import type { TruckWithState } from "../types";

/**
 * The load workflow — start / finish / cancel — in one place.
 *
 * Both the Load page and the full-screen Load Display drive loading, and a
 * third copy of this logic is exactly how `InProgressHero` ended up diverging
 * (it navigates away on finish and skips the garment confirmation). Owning it
 * here means the two surfaces cannot drift.
 *
 * The confirm STATE lives here too, but each surface renders the dialogs
 * itself, so they can sit at whatever layer that surface needs.
 */
export interface LoadActions {
  busy: number | null;
  inProgress: TruckWithState | undefined;
  anyInProgress: boolean;
  /** Truck awaiting the "Start loading?" confirmation. */
  confirmLoadTruck: TruckWithState | null;
  setConfirmLoadTruck: (t: TruckWithState | null) => void;
  /** Truck awaiting the "Did you load garments?" confirmation. */
  confirmGarmentTruck: TruckWithState | null;
  setConfirmGarmentTruck: (t: TruckWithState | null) => void;
  /** The pending truck is a Spare with no route to carry — cannot load. */
  confirmIsUncoveredSpare: boolean;
  /** Ask to start a truck (opens the confirmation). */
  requestStart: (t: TruckWithState) => void;
  /** Finish a truck, routing through the garment prompt when it's flagged. */
  requestFinish: (t: TruckWithState) => void;
  /** Commit a start — call from the confirmation's confirm button. */
  startLoad: (t: TruckWithState) => Promise<void>;
  /** Commit a finish — call after the garment prompt (or directly). */
  finishLoad: (t: TruckWithState) => Promise<void>;
  cancelLoad: (t: TruckWithState) => Promise<void>;
}

export function useLoadActions(
  runDate: string,
  opts?: {
    /** Fired after a load starts. The Load page scrolls itself to the top
     *  here; the display deliberately passes nothing — its hero is already
     *  pinned, and scrolling the page underneath would move the operator's
     *  position for when they exit. */
    onStarted?: (t: TruckWithState) => void;
  },
): LoadActions {
  const { data: board = [] } = useBoard(runDate);
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const { data: storedNextUp } = useNextUp(runDate);
  const clearNextUp = useClearNextUp(runDate);
  const toast = useToast();

  const [busy, setBusy] = useState<number | null>(null);
  const [confirmLoadTruck, setConfirmLoadTruck] = useState<TruckWithState | null>(null);
  const [confirmGarmentTruck, setConfirmGarmentTruck] = useState<TruckWithState | null>(null);

  const inProgress = useMemo(
    () => board.find((t) => t.state?.status === "in_progress"),
    [board],
  );
  const anyInProgress = Boolean(inProgress);

  // A spare can't load until it's covering a route (enforced on the backend
  // too). A SPLIT assignment counts — the spare is carrying a route's
  // overflow even though it isn't "covering" it.
  const confirmIsUncoveredSpare =
    confirmLoadTruck != null &&
    confirmLoadTruck.truck_type === "Spare" &&
    confirmLoadTruck.route_swap_route == null &&
    confirmLoadTruck.route_split_route == null &&
    confirmLoadTruck.state?.oos_spare_route == null;

  async function startLoad(t: TruckWithState) {
    if (anyInProgress) return;
    if (t.state?.priority_hold) return;
    setBusy(t.truck_number);
    try {
      const nowSec = Date.now() / 1000;
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "in_progress",
        wearers: t.state?.wearers ?? 0,
        load_start_time: nowSec,
        load_finish_time: null,
        load_duration_seconds: null,
      });
      // Once the queued truck is actually loading it isn't "next" any more —
      // clear it so the queue doesn't hold a stale pick through the next
      // hand-off.
      if (storedNextUp === t.truck_number) clearNextUp.mutate();
      opts?.onStarted?.(t);
    } catch (err: unknown) {
      // The backend rejects an uncovered spare with a 409. This used to be a
      // bare try/finally, so the tap silently did nothing — survivable on the
      // page where the card stays put, but on a display there is no other
      // feedback at all.
      toast.error(errorMessage(err, `Couldn't start truck #${t.truck_number}.`));
    } finally {
      setBusy(null);
    }
  }

  async function finishLoad(t: TruckWithState) {
    setBusy(t.truck_number);
    try {
      const nowSec = Date.now() / 1000;
      const startSec = t.state?.load_start_time ?? nowSec;
      const duration = Math.max(1, Math.round(nowSec - startSec));
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "loaded",
        wearers: t.state?.wearers ?? 0,
        load_finish_time: nowSec,
        load_duration_seconds: duration,
      });
      // Don't append a pace sample for a truck that already has one — a second
      // finish racing in from another device would otherwise record a bogus
      // duration measured from the same start.
      const alreadyTimed = t.state?.load_duration_seconds != null;
      if (!alreadyTimed && duration >= 30 && duration <= 7200) {
        try {
          await recordDuration.mutateAsync({
            truck_number: t.truck_number,
            run_date: runDate,
            duration_seconds: duration,
            load_day_num: t.state?.load_day_num ?? null,
          });
        } catch {
          // history append failure shouldn't block status change
        }
      }
    } catch (err: unknown) {
      // Same rule as startLoad: on the wall display a silent failure has no
      // other feedback at all — and Finish is the most-pressed button here.
      toast.error(errorMessage(err, `Couldn't finish truck #${t.truck_number}.`));
    } finally {
      setBusy(null);
    }
  }

  async function cancelLoad(t: TruckWithState) {
    setBusy(t.truck_number);
    try {
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "unloaded",
        wearers: t.state?.wearers ?? 0,
        load_start_time: null,
        load_finish_time: null,
        load_duration_seconds: null,
      });
    } catch (err: unknown) {
      toast.error(errorMessage(err, `Couldn't cancel truck #${t.truck_number}'s load.`));
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    inProgress,
    anyInProgress,
    confirmLoadTruck,
    setConfirmLoadTruck,
    confirmGarmentTruck,
    setConfirmGarmentTruck,
    confirmIsUncoveredSpare,
    requestStart: (t) => setConfirmLoadTruck(t),
    // The garment branch lives here, not at the call site, so every surface
    // gets the prompt — InProgressHero's copy of "finish" has never had it.
    requestFinish: (t) => {
      if (t.state?.has_dust_garment) setConfirmGarmentTruck(t);
      else void finishLoad(t);
    },
    startLoad,
    finishLoad,
    cancelLoad,
  };
}
