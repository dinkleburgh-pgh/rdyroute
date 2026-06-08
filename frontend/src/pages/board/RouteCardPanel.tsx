/**
 * Route Card panel (fleet mode only). Lets fleet assign spares/other trucks to
 * cover OOS routes. Extracted from Board.tsx.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { RouteSwap, SpareAssignment, TruckStatus, TruckWithState } from "../../types";
import {
  useAssignSpare,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  useReturnSpare,
  useRouteSwaps,
  useSpareAssignments,
} from "../../api/hooks";
import { workdayNumbers } from "../../components/Clock";
import { effectiveStatus, getSwapHistory, recordSwapHistory } from "../../utils/truckStatus";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS } from "./constants";

export default function RouteCardPanel({ data, runDate, startExpanded = false }: { data: TruckWithState[]; runDate: string; startExpanded?: boolean }) {
  const [collapsed, setCollapsed] = useState(!startExpanded);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [selectedSpare, setSelectedSpare] = useState<number | "">("");

  const { data: assignments = [] } = useSpareAssignments(runDate, false);
  const { data: swaps = [] } = useRouteSwaps(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const assignSpare = useAssignSpare();
  const returnSpare = useReturnSpare();
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();

  const loadDayNum = useMemo(() => {
    const [y, m, d] = runDate.split("-").map(Number);
    return workdayNumbers(new Date(y, m - 1, d)).loadDay;
  }, [runDate]);

  const oosRoutes = useMemo(
    () => data.filter((t) => t.is_oos || (t.state?.status ?? "dirty") === "oos"),
    [data],
  );

  const assignmentByRoute = useMemo(
    () => new Map<number, SpareAssignment>(assignments.map((a) => [a.covering_route_truck, a])),
    [assignments],
  );

  // Route swaps from the Setup Day wizard also count as coverage
  const swapByRoute = useMemo(
    () => new Map<number, RouteSwap>(swaps.map((s) => [s.route_truck, s])),
    [swaps],
  );

  const spareByNumber = useMemo(
    () => new Map(data.filter((t) => t.truck_type === "Spare").map((t) => [t.truck_number, t])),
    [data],
  );

  const unassignedCount = oosRoutes.filter(
    (t) => !assignmentByRoute.has(t.truck_number) && !swapByRoute.has(t.truck_number),
  ).length;

  if (oosRoutes.length === 0) return null;

  async function handleAssign() {
    if (selectedRoute == null || selectedSpare === "") return;
    const pickedNum = Number(selectedSpare);
    const picked = data.find((t) => t.truck_number === pickedNum);
    // Spares use the SpareAssignment system (preserves return workflow);
    // off / other trucks use route_swap, matching the RunDay wizard.
    if (picked?.truck_type === "Spare") {
      await assignSpare.mutateAsync({
        run_date: runDate,
        spare_truck_number: pickedNum,
        covering_route_truck: selectedRoute,
      });
    } else {
      await createSwap.mutateAsync({
        run_date: runDate,
        route_truck: selectedRoute,
        load_on_truck: pickedNum,
        two_way: false,
      });
    }
    recordSwapHistory(selectedRoute, pickedNum);
    setSelectedRoute(null);
    setSelectedSpare("");
  }

  return (
    <>
      <div className="card p-4">
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setCollapsed((c) => !c)}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">Route Card</span>
            {unassignedCount > 0 && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                {unassignedCount} need{unassignedCount === 1 ? "s" : ""} assignment
              </span>
            )}
            {unassignedCount === 0 && (
              <span className="rounded-full bg-green-700 px-2 py-0.5 text-xs font-bold text-white">
                All covered
              </span>
            )}
          </div>
          <span className="text-slate-400 text-sm">{collapsed ? "▶" : "▼"}</span>
        </button>

        {!collapsed && (
          <div className="mt-3 space-y-2">
            {oosRoutes.map((t) => {
              const assignment = assignmentByRoute.get(t.truck_number);
              const swap = !assignment ? swapByRoute.get(t.truck_number) : undefined;
              const coveringTruckNum = assignment?.spare_truck_number ?? swap?.load_on_truck;
              const spareTruck = coveringTruckNum != null ? spareByNumber.get(coveringTruckNum) : undefined;
              const spareStatus = spareTruck?.state?.status as TruckStatus | undefined;
              const spareActive = spareStatus === "loaded" || spareStatus === "in_progress";
              const isCovered = assignment != null || swap != null;
              return (
                <div
                  key={t.truck_number}
                  className={clsx(
                    "rounded-lg bg-slate-800 px-3 py-2",
                    !spareStatus && selectedRoute === t.truck_number && "ring-2 ring-blue-500",
                    spareStatus === "loaded" && "ring-2 ring-blue-600",
                    spareStatus === "in_progress" && "ring-2 ring-amber-500",
                    spareStatus === "unloaded" && "ring-2 ring-green-600",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">#{t.truck_number}</span>
                      <span className={clsx("badge", STATUS_BG["oos"])}>OOS</span>
                      {isCovered ? (
                        <>
                          <span className="text-xs font-medium text-green-400">
                            Spare #{coveringTruckNum}
                          </span>
                          {spareStatus && (
                            <span className={clsx("badge", STATUS_BG[spareStatus], STATUS_BADGE_TEXT[spareStatus])}>
                              {STATUS_LABELS[spareStatus]}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-amber-400">Needs assignment</span>
                      )}
                    </div>
                    {isCovered && !spareActive ? (
                      <button
                        className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300"
                        disabled={returnSpare.isPending || deleteSwap.isPending}
                        onClick={() => {
                          if (assignment) returnSpare.mutate(assignment.id);
                          else if (swap) deleteSwap.mutate({ id: swap.id, runDate });
                        }}
                      >
                        Unassign
                      </button>
                    ) : !isCovered ? (
                      <button
                        className="rounded bg-blue-700 px-2 py-1 text-xs font-medium hover:bg-blue-600"
                        onClick={() => {
                          setSelectedRoute((curr) => (curr === t.truck_number ? null : t.truck_number));
                          setSelectedSpare("");
                        }}
                      >
                        {selectedRoute === t.truck_number ? "Close" : "Assign"}
                      </button>
                    ) : null}
                  </div>

                  {!isCovered && selectedRoute === t.truck_number && (
                    <div className="mt-2 border-t border-slate-700 pt-2">
                      <label className="label">Pick truck</label>
                      <div className="flex gap-2">
                        <select
                          className="input flex-1"
                          value={selectedSpare}
                          onChange={(e) => setSelectedSpare(e.target.value === "" ? "" : Number(e.target.value))}
                        >
                          <option value="">— truck —</option>
                          {(() => {
                            const sorted = [...data].sort((a, b) => a.truck_number - b.truck_number);
                            const lastUsedNums = selectedRoute != null ? getSwapHistory(selectedRoute) : [];
                            const lastUsed = lastUsedNums.map((n) => sorted.find((x) => x.truck_number === n)).filter(Boolean) as typeof sorted;
                            const spareTrucks = sorted.filter((t) => t.truck_type === "Spare");
                            const offTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDayNum, holidayLoad) === "off");
                            const otherTrucks = sorted.filter((t) => {
                              if (t.truck_type === "Spare") return false;
                              const s = effectiveStatus(t, loadDayNum, holidayLoad);
                              return s !== "off" && s !== "oos";
                            });
                            return (
                              <>
                                {lastUsed.length > 0 && (
                                  <optgroup label="Last Used">
                                    {lastUsed.map((t) => (
                                      <option key={t.truck_number} value={t.truck_number}>
                                        #{t.truck_number} — {t.truck_type === "Spare" ? "Spare" : (t.state?.status ?? "dirty")}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {spareTrucks.length > 0 && (
                                  <optgroup label="Spare Trucks">
                                    {spareTrucks.map((t) => (
                                      <option key={t.truck_number} value={t.truck_number}>
                                        #{t.truck_number} — Spare
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {offTrucks.length > 0 && (
                                  <optgroup label={`Off — Day ${loadDayNum}`}>
                                    {offTrucks.map((t) => (
                                      <option key={t.truck_number} value={t.truck_number}>
                                        #{t.truck_number} — Off
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {otherTrucks.length > 0 && (
                                  <optgroup label="Other">
                                    {otherTrucks.map((t) => (
                                      <option key={t.truck_number} value={t.truck_number}>
                                        #{t.truck_number} ({t.state?.status ?? "dirty"})
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </>
                            );
                          })()}
                        </select>
                        <button
                          className="rounded-lg bg-green-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                          disabled={selectedSpare === "" || assignSpare.isPending || createSwap.isPending}
                          onClick={handleAssign}
                        >
                          {assignSpare.isPending || createSwap.isPending ? "Assigning..." : "Assign"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
