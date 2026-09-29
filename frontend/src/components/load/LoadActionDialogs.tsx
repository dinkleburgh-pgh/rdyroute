import ConfirmDialog from "../ConfirmDialog";
import type { LoadActions } from "../../hooks/useLoadActions";

/**
 * The confirmation that guards the load workflow — the F.S. garment check
 * before finishing. (Starting a load has no confirmation any more; see
 * useLoadActions.requestStart.)
 *
 * Rendered by each surface (Load page, Load Display) from the shared actions
 * object, so both get identical wording and identical guards. ConfirmDialog
 * portals to document.body at z-[90], which puts it above the Load Display
 * (z-[85]) and below toasts (z-[100]).
 */
export default function LoadActionDialogs({ actions }: { actions: LoadActions }) {
  const { confirmGarmentTruck, confirmGarmentSource, setConfirmGarmentTruck, finishLoad } = actions;

  return (
    <ConfirmDialog
      open={confirmGarmentTruck !== null}
      title="Did you load garments?"
      description={
        confirmGarmentSource != null
          ? `Truck #${confirmGarmentTruck?.truck_number ?? ""} is carrying route #${confirmGarmentSource}'s F.S. garments — confirm they were loaded before finishing.`
          : `Truck #${confirmGarmentTruck?.truck_number ?? ""} is flagged with F.S. garments — confirm the garments were loaded before finishing.`
      }
      confirmLabel="Yes, finish loading"
      cancelLabel="Not yet"
      onConfirm={() => {
        const t = confirmGarmentTruck;
        setConfirmGarmentTruck(null);
        if (t) void finishLoad(t);
      }}
      onCancel={() => setConfirmGarmentTruck(null)}
    />
  );
}
