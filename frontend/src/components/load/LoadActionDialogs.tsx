import { createPortal } from "react-dom";
import ConfirmDialog from "../ConfirmDialog";
import type { LoadActions } from "../../hooks/useLoadActions";

/**
 * The two confirmations that guard the load workflow — "Start loading?" and
 * the F.S. garment check before finishing.
 *
 * Rendered by each surface (Load page, Load Display) from the shared actions
 * object, so both get identical wording and identical guards. Both portal to
 * document.body at z-[90], which puts them above the Load Display (z-[85])
 * and below toasts (z-[100]).
 */
export default function LoadActionDialogs({ actions }: { actions: LoadActions }) {
  const {
    busy,
    anyInProgress,
    confirmLoadTruck,
    setConfirmLoadTruck,
    confirmGarmentTruck,
    setConfirmGarmentTruck,
    confirmIsUncoveredSpare,
    startLoad,
    finishLoad,
  } = actions;

  return (
    <>
      {confirmLoadTruck && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirmLoadTruck(null)}
        >
          <div
            className="max-h-[90svh] w-full max-w-sm overflow-y-auto rounded-xl border border-hairline bg-surface p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 font-mono text-base font-semibold tabular-nums">
              Start Loading Truck #{confirmLoadTruck.truck_number}?
            </h3>
            <p className="mb-4 text-sm text-ink-muted">
              {anyInProgress
                ? "Another truck is already in progress. Finish it first."
                : confirmIsUncoveredSpare
                ? "This spare has no route to cover yet. Assign a route to it on the board before loading."
                : confirmLoadTruck.route_split_route != null
                ? `Split load — carrying route #${confirmLoadTruck.route_split_route}'s overflow.`
                : `${confirmLoadTruck.truck_type}${confirmLoadTruck.state?.batch_id != null ? ` · Batch ${confirmLoadTruck.state.batch_id}` : ""}${confirmLoadTruck.state?.wearers ? ` · ${confirmLoadTruck.state.wearers} wearers` : ""}`}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmLoadTruck(null)}>Cancel</button>
              <button
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#16a34a" }}
                disabled={anyInProgress || confirmIsUncoveredSpare || busy === confirmLoadTruck.truck_number}
                onClick={() => {
                  void startLoad(confirmLoadTruck);
                  setConfirmLoadTruck(null);
                }}
              >
                {busy === confirmLoadTruck.truck_number ? "Starting…" : "Start Loading"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={confirmGarmentTruck !== null}
        title="Did you load garments?"
        description={`Truck #${confirmGarmentTruck?.truck_number ?? ""} is flagged with F.S. garments — confirm the garments were loaded before finishing.`}
        confirmLabel="Yes, finish loading"
        cancelLabel="Not yet"
        onConfirm={() => {
          const t = confirmGarmentTruck;
          setConfirmGarmentTruck(null);
          if (t) void finishLoad(t);
        }}
        onCancel={() => setConfirmGarmentTruck(null)}
      />
    </>
  );
}
