/**
 * Confirmation modal for starting a load on a truck. Blocks if another truck
 * is already in progress. Extracted from Board.tsx.
 */
import clsx from "clsx";
import { createPortal } from "react-dom";
import type { TruckWithState } from "../../types";
import { truckTypeLabel } from "../../utils/truckType";
import { AlertTriangle } from "lucide-react";
import Modal from "../../components/Modal";

export default function StartLoadModal({
  truck,
  blockedBy,
  busy,
  onConfirm,
  onClose,
}: {
  truck: TruckWithState;
  blockedBy: TruckWithState | null;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const isBlocked = blockedBy !== null;

  // Portal to <body> so transformed ancestors can't break viewport centering;
  // clamp to the visible height so the action row stays reachable.
  return (
    <Modal open onClose={onClose} size="sm" sheet bodyClassName="">
        {/* Header stripe */}
        <div className={clsx(
          "px-6 py-5",
          isBlocked ? "bg-amber-950/60" : "bg-surface-2",
        )}>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
            {isBlocked ? "Blocked" : "Start Loading"}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-ink">
            Truck #{truck.truck_number}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">{truckTypeLabel(truck.truck_type)}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {isBlocked ? (
            <div className="flex items-start gap-3 rounded-lg bg-amber-950/40 border border-amber-700/40 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              <div>
                <p className="text-sm font-medium text-amber-300">
                  Truck #{blockedBy!.truck_number} is already loading
                </p>
                <p className="text-xs text-amber-500 mt-0.5">
                  Finish or cancel the current load before starting another.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Mark this truck as <span className="font-semibold text-ink-soft">Loading</span> and begin the load timer?
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              className="flex-1 rounded-lg border border-hairline bg-surface-2 py-2.5 text-sm font-medium text-ink-soft hover:bg-track transition"
              onClick={onClose}
            >
              Cancel
            </button>
            {!isBlocked && (
              <button
                className="flex-1 rounded-lg bg-green-700 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50 transition"
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? "Starting…" : "Start Loading"}
              </button>
            )}
          </div>
        </div>
    </Modal>
  );
}
