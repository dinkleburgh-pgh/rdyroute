import clsx from "clsx";
import { Check } from "lucide-react";
import { DustGarmentIcon } from "../icons";
import Modal from "../Modal";
import type { LoadActions } from "../../hooks/useLoadActions";
import { BTN_GO, BTN_SECONDARY, SheetHead } from "./loadUi";

/**
 * The confirmation that guards the load workflow — the F.S. garment check
 * before finishing. (Starting a load has no confirmation any more; see
 * useLoadActions.requestStart.)
 *
 * Rendered by each surface (Load page, Load Display) from the shared actions
 * object, so both get identical wording and identical guards. It sits on the
 * Modal "dialog" layer (z-90), which puts it above the Load Display (z-85)
 * and below toasts (z-100).
 *
 * It shares the Load chooser's sheet (SheetHead + full-width buttons), so
 * Finish → garment check stays in the same visual family as the rest of the
 * page and the big green button is always in the same place.
 */
export default function LoadActionDialogs({ actions }: { actions: LoadActions }) {
  const { confirmGarmentTruck, confirmGarmentSource, setConfirmGarmentTruck, finishLoad } = actions;

  const g = confirmGarmentTruck;
  const closeGarment = () => setConfirmGarmentTruck(null);
  if (!g) return null;

  return (
    <Modal open onClose={closeGarment} size="sm" sheet layer="dialog" alert>
      <SheetHead
        eyebrow="Before you finish"
        eyebrowClass="text-amber-300"
        truck={g}
        onClose={closeGarment}
      />
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-600/50 bg-amber-950/40 px-3 py-3">
        <DustGarmentIcon className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" />
        <div>
          <p className="text-[15px] font-bold text-amber-200">Did you load the garments?</p>
          <p className="mt-0.5 text-[13px] leading-snug text-amber-100/80">
            {confirmGarmentSource != null
              ? `#${g.truck_number} is carrying route #${confirmGarmentSource}'s F.S. garments — confirm they went on before finishing.`
              : `#${g.truck_number} is flagged with F.S. garments — confirm they went on before finishing.`}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          className={clsx(BTN_GO, "min-h-[52px] w-full text-[15px]")}
          onClick={() => {
            closeGarment();
            void finishLoad(g);
          }}
        >
          <Check className="h-5 w-5" aria-hidden />
          Yes — finish loading
        </button>
        <button type="button" className={clsx(BTN_SECONDARY, "min-h-[44px] w-full text-sm")} onClick={closeGarment}>
          Not yet
        </button>
      </div>
    </Modal>
  );
}
