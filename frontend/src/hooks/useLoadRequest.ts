import { useState } from "react";
import { useSetLoadRequest, type LoadRequestValue } from "../api/hooks";
import { useToast } from "../contexts/ToastContext";
import { can } from "../utils/permissions";
import { useAuth } from "../contexts/AuthContext";
import type { TruckWithState } from "../types";
import { errorDetail } from "../api/errors";

/**
 * The load crew's answer on the truck the dock is emptying — in one place.
 *
 * Both the Load page and the full-screen Load Display show that truck, so both
 * need to be able to answer. Owning the mutation here means they cannot drift;
 * this is the same move `useLoadActions` makes, and for the same reason (a
 * third copy of load logic is exactly how InProgressHero diverged).
 *
 * Advisory: sending "skip" changes nothing about the truck's state. It raises a
 * flag on the dock's own board and the unloader decides what to do with it.
 */
export interface LoadRequestActions {
  /** Truck number currently being written, for spinner/disabled state. */
  busy: number | null;
  /** False for roles that can't act on the load workflow — buttons hide. */
  canAct: boolean;
  set: (t: TruckWithState, request: LoadRequestValue | null) => Promise<void>;
}

export function useLoadRequest(runDate: string): LoadRequestActions {
  const { user } = useAuth();
  const mutation = useSetLoadRequest(runDate);
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  async function set(t: TruckWithState, request: LoadRequestValue | null) {
    setBusy(t.truck_number);
    try {
      await mutation.mutateAsync({
        truck_number: t.truck_number,
        request,
        // Secondary guard. The real one is server-side ("is this still the
        // truck being unloaded"), which is the only thing that catches the dock
        // tapping "Not unloading — cancel" — that clears the marker without
        // touching status, so this precondition sails straight past it.
        expected_status: t.state?.status ?? null,
      });
    } catch (err) {
      // Never silent: this write is excluded from the offline queue on purpose,
      // so a dead connection surfaces here rather than faking a success.
      const detail = errorDetail(err);
      toast.error(detail ?? "Couldn't send that — the dock didn't hear you.");
    } finally {
      setBusy(null);
    }
  }

  return { busy, canAct: can(user?.role, "load:trucks"), set };
}
