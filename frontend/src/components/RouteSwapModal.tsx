/**
 * RouteSwapModal — standalone route swap management dialog.
 *
 * Shows all current swaps for today with one-click delete,
 * and an add-swap form with smart truck grouping.
 *
 * Accessible from the sidebar "Route Swap" button.
 */
import { useState } from "react";
import { todayIso } from "../api/client";
import { useBoard, useRouteSwaps, useCreateRouteSwap, useDeleteRouteSwap, useHolidayLoad } from "../api/hooks";
import { workdayNumbers } from "./Clock";
import { effectiveStatus } from "../utils/truckStatus";
import type { TruckWithState, RouteSwap } from "../types";

// ---- helpers ---------------------------------------------------------------

function truckLabel(t: TruckWithState, loadDay: number, holidayLoad: boolean, swapLoadOnSet: Set<number>, swapRouteSet: Set<number>): string {
  if (t.truck_type === "Spare") return `#${t.truck_number} — Spare`;
  const eff = effectiveStatus(t, loadDay, holidayLoad);
  if (eff === "oos") {
    if (swapRouteSet.has(t.truck_number)) return `#${t.truck_number} — OOS (route covered)`;
    return `#${t.truck_number} — OOS`;
  }
  if (eff === "off") return `#${t.truck_number} — Off`;
  if (swapLoadOnSet.has(t.truck_number)) return `#${t.truck_number} — Covering another route`;
  return `#${t.truck_number}`;
}

// ---- component -------------------------------------------------------------

interface Props {
  onClose: () => void;
}

export default function RouteSwapModal({ onClose }: Props) {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: swaps = [], isLoading: swapsLoading } = useRouteSwaps(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { loadDay } = workdayNumbers();

  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();

  const [routeTruck, setRouteTruck] = useState("");
  const [loadOnTruck, setLoadOnTruck] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [oosLoadOns, setOosLoadOns] = useState<Record<number, string>>({});

  // Sets for quick lookups
  const swapRouteSet = new Set(swaps.map((s) => s.route_truck));
  const swapLoadOnSet = new Set(swaps.map((s) => s.load_on_truck));

  // OOS trucks with no swap yet — shown as prefill rows
  const unswappedOos = [...board]
    .filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swapRouteSet.has(t.truck_number))
    .sort((a, b) => a.truck_number - b.truck_number);

  async function addOosSwap(routeTruckNum: number, loadOnTruckNum: number) {
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: routeTruckNum, load_on_truck: loadOnTruckNum, two_way: false });
      setOosLoadOns((prev) => { const n = { ...prev }; delete n[routeTruckNum]; return n; });
    } catch (err: unknown) {
      console.error("OOS swap save failed", err);
    }
  }

  // Sorted truck lists
  const sorted = [...board].sort((a, b) => a.truck_number - b.truck_number);

  // Route Truck options: all non-spare trucks
  const routeOptions = sorted.filter((t) => t.truck_type !== "Spare");

  // Load On options: all trucks (grouped), including OOS trucks
  const spares        = sorted.filter((t) => t.truck_type === "Spare");
  const offTrucks     = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "off");
  // OOS trucks whose route is already covered are especially good candidates
  const oosRouteless  = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swapRouteSet.has(t.truck_number));
  const oosUncovered  = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swapRouteSet.has(t.truck_number));
  const otherTrucks   = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "off" && effectiveStatus(t, loadDay, holidayLoad) !== "oos");

  async function handleAdd() {
    const rt = parseInt(routeTruck);
    const lo = parseInt(loadOnTruck);
    if (isNaN(rt) || isNaN(lo)) { setError("Select both trucks."); return; }
    if (rt === lo) { setError("Route truck and load-on truck must be different."); return; }
    setError(null);
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: rt, load_on_truck: lo, two_way: false });
      setRouteTruck("");
      setLoadOnTruck("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "Failed to save swap.");
    }
  }

  function handleDelete(s: RouteSwap) {
    deleteSwap.mutate({ id: s.id, runDate, alsoReciprocal: false });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">Route Swaps</h2>
            <p className="text-xs text-slate-400">{runDate}</p>
          </div>
          <button
            className="rounded p-1 text-slate-500 hover:text-slate-200"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Current swaps */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Active swaps {swaps.length > 0 && <span className="ml-1 rounded-full bg-blue-800/60 px-2 py-0.5 text-blue-300">{swaps.length}</span>}
            </p>

            {/* OOS prefill rows */}
            {unswappedOos.length > 0 && (
              <div className="mb-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                  OOS — Select covering truck
                </p>
                {unswappedOos.map((t) => (
                  <div key={t.truck_number} className="flex items-center gap-2 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-2">
                    <span className="whitespace-nowrap text-sm font-bold text-amber-300">
                      #{t.truck_number} <span className="text-[10px] font-semibold text-amber-500">OOS</span>
                    </span>
                    <span className="text-sm text-slate-500">→</span>
                    <select
                      className="input flex-1 text-sm"
                      value={oosLoadOns[t.truck_number] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOosLoadOns((prev) => ({ ...prev, [t.truck_number]: val }));
                        if (val) addOosSwap(t.truck_number, parseInt(val));
                      }}
                    >
                      <option value="">— Load on —</option>
                      {spares.length > 0 && (
                        <optgroup label="Spare trucks">
                          {spares.map((s) => (
                            <option key={s.truck_number} value={s.truck_number}>#{s.truck_number} — Spare</option>
                          ))}
                        </optgroup>
                      )}
                      {offTrucks.length > 0 && (
                        <optgroup label="Off today">
                          {offTrucks.map((s) => (
                            <option key={s.truck_number} value={s.truck_number}>#{s.truck_number} — Off</option>
                          ))}
                        </optgroup>
                      )}
                      {otherTrucks.length > 0 && (
                        <optgroup label="Route trucks">
                          {otherTrucks.map((s) => (
                            <option key={s.truck_number} value={s.truck_number}>#{s.truck_number}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {swapsLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : swaps.length === 0 ? (
              <p className="rounded-md border border-slate-700 bg-slate-800/50 px-4 py-3 text-center text-sm text-slate-500">
                No swaps set for today.
              </p>
            ) : (
              <div className="space-y-2">
                {swaps.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="text-xl font-black text-red-400">#{s.route_truck}</span>
                      <span className="text-base font-bold text-slate-500">→</span>
                      <span className="text-xl font-black text-blue-300">#{s.load_on_truck}</span>
                      <span className="text-xs text-slate-500">loads route</span>
                    </div>
                    <button
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                      disabled={deleteSwap.isPending}
                      onClick={() => handleDelete(s)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Add swap form */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Add swap</p>

            <div className="grid grid-cols-2 gap-3">
              {/* Route Truck selector */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Route Truck
                  <span className="ml-1 normal-case font-normal text-slate-500">(whose route?)</span>
                </label>
                <select
                  className="input w-full text-sm"
                  value={routeTruck}
                  onChange={(e) => { setRouteTruck(e.target.value); setError(null); }}
                >
                  <option value="">— select —</option>
                  {/* OOS trucks first */}
                  {routeOptions.filter((t) => effectiveStatus(t, loadDay, holidayLoad) === "oos").length > 0 && (
                    <optgroup label="OOS — needs covering">
                      {routeOptions
                        .filter((t) => effectiveStatus(t, loadDay, holidayLoad) === "oos")
                        .map((t) => (
                          <option key={t.truck_number} value={t.truck_number}>
                            #{t.truck_number} — OOS
                          </option>
                        ))}
                    </optgroup>
                  )}
                  <optgroup label="Route trucks">
                    {routeOptions
                      .filter((t) => effectiveStatus(t, loadDay, holidayLoad) !== "oos")
                      .map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number}{swapRouteSet.has(t.truck_number) ? " ✓ covered" : ""}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>

              {/* Load On selector */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Load On
                  <span className="ml-1 normal-case font-normal text-slate-500">(who loads it?)</span>
                </label>
                <select
                  className="input w-full text-sm"
                  value={loadOnTruck}
                  onChange={(e) => { setLoadOnTruck(e.target.value); setError(null); }}
                >
                  <option value="">— select —</option>
                  {spares.length > 0 && (
                    <optgroup label="Spare trucks">
                      {spares.map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number} — Spare
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {offTrucks.length > 0 && (
                    <optgroup label="Off today">
                      {offTrucks.map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number} — Off
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {oosRouteless.length > 0 && (
                    <optgroup label="OOS — route covered (available)">
                      {oosRouteless.map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number} — OOS / route covered
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {oosUncovered.length > 0 && (
                    <optgroup label="OOS — route uncovered">
                      {oosUncovered.map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number} — OOS
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherTrucks.length > 0 && (
                    <optgroup label="Route trucks">
                      {otherTrucks.map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          {truckLabel(t, loadDay, holidayLoad, swapLoadOnSet, swapRouteSet)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <button
              className="btn-primary w-full"
              disabled={!routeTruck || !loadOnTruck || createSwap.isPending}
              onClick={handleAdd}
            >
              {createSwap.isPending ? "Saving…" : "Add Swap"}
            </button>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-5 py-3">
          <button className="btn-ghost w-full text-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
