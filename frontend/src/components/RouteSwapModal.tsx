/**
 * RouteSwapModal — standalone route swap management dialog.
 *
 * Shows all current swaps for today with one-click delete,
 * and an add-swap form with smart truck grouping.
 *
 * Accessible from the sidebar "Route Swap" button.
 */
import { useState } from "react";
import clsx from "clsx";
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
  const [twoWay, setTwoWay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sets for quick lookups
  const swapRouteSet = new Set(swaps.map((s) => s.route_truck));
  const swapLoadOnSet = new Set(swaps.map((s) => s.load_on_truck));

  // Detect two-way pairs (both directions exist)
  function reciprocal(s: RouteSwap): RouteSwap | undefined {
    return swaps.find((r) => r.route_truck === s.load_on_truck && r.load_on_truck === s.route_truck);
  }

  // Deduplicate two-way pairs so we only show them once
  const shownIds = new Set<number>();
  const swapRows: Array<{ primary: RouteSwap; paired?: RouteSwap }> = [];
  for (const s of swaps) {
    if (shownIds.has(s.id)) continue;
    shownIds.add(s.id);
    const pair = reciprocal(s);
    if (pair && !shownIds.has(pair.id)) {
      shownIds.add(pair.id);
      swapRows.push({ primary: s, paired: pair });
    } else {
      swapRows.push({ primary: s });
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
      await createSwap.mutateAsync({ run_date: runDate, route_truck: rt, load_on_truck: lo, two_way: twoWay });
      setRouteTruck("");
      setLoadOnTruck("");
      setTwoWay(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "Failed to save swap.");
    }
  }

  function handleDelete(s: RouteSwap, alsoReciprocal: boolean) {
    deleteSwap.mutate({ id: s.id, runDate, alsoReciprocal });
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
            {swapsLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : swapRows.length === 0 ? (
              <p className="rounded-md border border-slate-700 bg-slate-800/50 px-4 py-3 text-center text-sm text-slate-500">
                No swaps set for today.
              </p>
            ) : (
              <div className="space-y-2">
                {swapRows.map(({ primary, paired }) => (
                  <div
                    key={primary.id}
                    className={clsx(
                      "flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
                      paired
                        ? "border-purple-700/50 bg-purple-950/20"
                        : "border-blue-800/40 bg-blue-950/15",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      {paired ? (
                        // Two-way pair
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="text-purple-200">#{primary.route_truck}</span>
                          <span className="text-slate-500 text-xs">⇄</span>
                          <span className="text-purple-200">#{primary.load_on_truck}</span>
                          <span className="ml-1 rounded-full bg-purple-800/50 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                            2-way
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-red-400">#{primary.route_truck}</span>
                          <span className="text-slate-500 text-xs">→</span>
                          <span className="font-semibold text-blue-300">#{primary.load_on_truck}</span>
                          <span className="text-xs text-slate-500">loads route</span>
                        </div>
                      )}
                    </div>
                    <button
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                      disabled={deleteSwap.isPending}
                      onClick={() => handleDelete(primary, !!paired)}
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

            {/* Two-way toggle */}
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <div
                className={clsx(
                  "relative h-5 w-9 rounded-full transition-colors",
                  twoWay ? "bg-purple-600" : "bg-slate-600",
                )}
                onClick={() => setTwoWay((v) => !v)}
              >
                <span
                  className={clsx(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    twoWay ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </div>
              <span className="text-sm text-slate-300">
                Two-way swap
                <span className="ml-1 text-xs text-slate-500">(each loads the other's route)</span>
              </span>
            </label>

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
