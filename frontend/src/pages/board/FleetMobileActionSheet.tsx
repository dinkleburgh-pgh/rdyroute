import clsx from "clsx";
import { createPortal } from "react-dom";
import type { TruckStatus, TruckWithState } from "../../types";
import { useUpsertTruckState } from "../../api/hooks";
import { fmtCountdown } from "./useOutsideTimer";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS } from "./constants";

const STATUS_ACTIONS: TruckStatus[] = [
  "dirty",
  "unfinished",
  "shop",
  "unloaded",
  "loaded",
  "oos",
];

export default function FleetMobileActionSheet({
  truck,
  runDate,
  onClose,
  onManageTruck,
  arrivedEnabled,
  arrivedAt,
  needsChecked,
  outsideEnabled,
  outsideActive,
  outsideMinutes,
  outsideRemainingSeconds,
  paperBayEnabled,
  paperBayActive,
  paperBayMinutes,
  paperBayRemainingSeconds,
  onOutside,
  onCancelOutside,
  onPaperBay,
  onCancelPaperBay,
  onArrived,
  onClearArrived,
}: {
  truck: TruckWithState;
  runDate: string;
  onClose: () => void;
  onManageTruck: () => void;
  arrivedEnabled: boolean;
  arrivedAt?: number | null;
  needsChecked: boolean;
  outsideEnabled: boolean;
  outsideActive: boolean;
  outsideMinutes: number;
  outsideRemainingSeconds?: number;
  paperBayEnabled: boolean;
  paperBayActive: boolean;
  paperBayMinutes: number;
  paperBayRemainingSeconds?: number;
  onOutside: () => void;
  onCancelOutside: () => void;
  onPaperBay: () => void;
  onCancelPaperBay: () => void;
  onArrived: () => void;
  onClearArrived: () => void;
}) {
  const upsert = useUpsertTruckState();
  const status = (truck.is_oos ? "oos" : (truck.state?.status ?? "dirty")) as TruckStatus;
  const isHold = truck.state?.priority_hold === true;
  const arrivedActive = typeof arrivedAt === "number" && Number.isFinite(arrivedAt);
  const canStartOutside = outsideEnabled && !outsideActive && !paperBayActive;
  const canStartPaperBay = paperBayEnabled && !paperBayActive && !outsideActive;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <span className="text-2xl font-black tracking-tight text-white">#{truck.truck_number}</span>
            <span className="ml-2 text-sm text-slate-400">
              {truck.truck_type}
              {truck.truck_type === "Uniform" && truck.uniform_size != null ? ` · ${truck.uniform_size}ft` : ""}
            </span>
          </div>
          <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
            {STATUS_LABELS[status]}
          </span>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2">
            {STATUS_ACTIONS.map((s) => {
              const isCurrent = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={upsert.isPending || isCurrent}
                  onClick={() => {
                    if (s === "oos") {
                      onManageTruck();
                      return;
                    }
                    upsert.mutate({
                      truck_number: truck.truck_number,
                      run_date: runDate,
                      status: s,
                      wearers: truck.state?.wearers ?? 0,
                      ...(s === "loaded" ? { load_finish_time: Date.now() / 1000 } : {}),
                    });
                    onClose();
                  }}
                  className={clsx(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-semibold transition-colors",
                    isCurrent
                      ? "border-slate-600 bg-slate-800 text-slate-500"
                      : "border-slate-700/60 bg-slate-800/60 text-slate-200 hover:bg-slate-700",
                  )}
                >
                  <span className={clsx("h-3 w-3 rounded-full", STATUS_BG[s])} />
                  <span>{STATUS_LABELS[s]}</span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-800 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Quick Actions</p>
            <div className="flex flex-wrap gap-2">
              {isHold ? (
                <button
                  type="button"
                  disabled={upsert.isPending}
                  onClick={() => {
                    upsert.mutate({
                      truck_number: truck.truck_number,
                      run_date: runDate,
                      priority_hold: false,
                      wearers: truck.state?.wearers ?? 0,
                    });
                    onClose();
                  }}
                  className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-950/50"
                >
                  🔓 Clear Hold
                </button>
              ) : (
                <button
                  type="button"
                  disabled={upsert.isPending}
                  onClick={() => {
                    upsert.mutate({
                      truck_number: truck.truck_number,
                      run_date: runDate,
                      priority_hold: true,
                      wearers: truck.state?.wearers ?? 0,
                    });
                    onClose();
                  }}
                  className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-950/50"
                >
                  🚩 Unload &amp; Hold
                </button>
              )}
              <button
                type="button"
                disabled={upsert.isPending}
                onClick={() => {
                  upsert.mutate({
                    truck_number: truck.truck_number,
                    run_date: runDate,
                    needs_checked: !needsChecked,
                    wearers: truck.state?.wearers ?? 0,
                  });
                  onClose();
                }}
                className={needsChecked
                  ? "rounded-md border border-amber-600/50 bg-amber-900/40 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-900/60"
                  : "rounded-md border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700"}
              >
                {needsChecked ? "✅ Clear Checked" : "🔍 Needs Checked"}
              </button>
              {arrivedEnabled && arrivedActive && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300">
                  <span>
                    📍 Arrived {new Date(arrivedAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearArrived();
                      onClose();
                    }}
                    className="rounded border border-emerald-700/40 px-2 py-1 text-[11px] font-bold text-emerald-200 transition-colors hover:bg-emerald-900/50"
                  >
                    Clear
                  </button>
                </div>
              )}
              {outsideActive && typeof outsideRemainingSeconds === "number" && (
                <div className="flex items-center gap-2 rounded-md border border-orange-700/40 bg-orange-950/30 px-3 py-2 text-xs font-semibold text-orange-300">
                  <span>⏱ Outside {fmtCountdown(outsideRemainingSeconds)}</span>
                  <button
                    type="button"
                    onClick={onCancelOutside}
                    className="rounded border border-orange-700/40 px-2 py-1 text-[11px] font-bold text-orange-200 transition-colors hover:bg-orange-900/50"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {paperBayActive && typeof paperBayRemainingSeconds === "number" && (
                <div className="flex items-center gap-2 rounded-md border border-purple-700/40 bg-purple-950/30 px-3 py-2 text-xs font-semibold text-purple-300">
                  <span>📄 Paper Bay {fmtCountdown(paperBayRemainingSeconds)}</span>
                  <button
                    type="button"
                    onClick={onCancelPaperBay}
                    className="rounded border border-purple-700/40 px-2 py-1 text-[11px] font-bold text-purple-200 transition-colors hover:bg-purple-900/50"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {canStartOutside && (
                <button
                  type="button"
                  onClick={() => {
                    onOutside();
                    onClose();
                  }}
                  className="rounded-md border border-sky-700/40 bg-sky-950/30 px-3 py-2 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-950/50"
                >
                  ⏱ Outside ({outsideMinutes} min)
                </button>
              )}
              {canStartPaperBay && (
                <button
                  type="button"
                  onClick={() => {
                    onPaperBay();
                    onClose();
                  }}
                  className="rounded-md border border-purple-700/40 bg-purple-950/30 px-3 py-2 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-950/50"
                >
                  📄 Paper Bay ({paperBayMinutes} min)
                </button>
              )}
              {arrivedEnabled && !arrivedActive && (
                <button
                  type="button"
                  onClick={() => {
                    onArrived();
                    onClose();
                  }}
                  className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-950/50"
                >
                  📍 Arrived
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onManageTruck}
              className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-500"
            >
              🚚 Manage Truck
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
