/**
 * Route Card panel (fleet mode only). Lets fleet assign spares/other trucks to
 * cover OOS routes. Extracted from Board.tsx.
 */
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
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
import { effectiveStatus, getSwapHistory, isScheduledOff, recordSwapHistory } from "../../utils/truckStatus";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS } from "./constants";

const STATUS_BORDER = { loaded: "border-l-blue-600", in_progress: "border-l-amber-500", unloaded: "border-l-green-600" } as const;

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
    () => data.filter((t) => {
      if (!t.is_oos && (t.state?.status ?? "dirty") !== "oos") return false;
      if (!holidayLoad && isScheduledOff(t, loadDayNum)) return false;
      return true;
    }),
    [data, loadDayNum, holidayLoad],
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

  const truckByNumber = useMemo(
    () => new Map(data.map((t) => [t.truck_number, t])),
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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="card p-4"
    >
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
        <motion.span
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.25 }}
          className="text-slate-400"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="route-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="mt-3 space-y-2 overflow-hidden"
          >
            {oosRoutes.map((t, i) => {
              const assignment = assignmentByRoute.get(t.truck_number);
              const swap = !assignment ? swapByRoute.get(t.truck_number) : undefined;
              const coveringTruckNum = assignment?.spare_truck_number ?? swap?.load_on_truck;
              const coveringTruck = coveringTruckNum != null ? truckByNumber.get(coveringTruckNum) : undefined;
              const coveringStatus = coveringTruck?.state?.status as TruckStatus | undefined;
              const coveringActive = coveringStatus === "loaded" || coveringStatus === "in_progress";
              const isCovered = assignment != null || swap != null;
              const borderKey = coveringStatus && coveringStatus in STATUS_BORDER ? coveringStatus as keyof typeof STATUS_BORDER : undefined;
              return (
                <motion.div
                  key={t.truck_number}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                  whileHover={{ scale: 1.01 }}
                  className={clsx(
                    "rounded-lg bg-slate-800 px-3 py-2 border-l-4",
                    borderKey ? STATUS_BORDER[borderKey] : "border-l-transparent",
                    selectedRoute === t.truck_number && "ring-2 ring-blue-500",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">#{t.truck_number}</span>
                      <span className={clsx("badge", STATUS_BG["oos"])}>OOS</span>
                      {isCovered ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-3 py-1 text-sm font-bold text-sky-300 ring-1 ring-sky-700/40">
                            Cov. #{coveringTruckNum}
                          </span>
                          {coveringStatus && (
                            <span className={clsx("badge", STATUS_BG[coveringStatus], STATUS_BADGE_TEXT[coveringStatus])}>
                              {STATUS_LABELS[coveringStatus]}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-amber-400">Needs assignment</span>
                      )}
                    </div>
                    {isCovered && !coveringActive ? (
                      <button
                        className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
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
                        className="rounded bg-blue-700 px-2 py-1 text-xs font-medium hover:bg-blue-600 transition-colors"
                        onClick={() => {
                          setSelectedRoute((curr) => (curr === t.truck_number ? null : t.truck_number));
                          setSelectedSpare("");
                        }}
                      >
                        {selectedRoute === t.truck_number ? "Close" : "Assign"}
                      </button>
                    ) : null}
                  </div>

                  <AnimatePresence>
                    {!isCovered && selectedRoute === t.truck_number && (
                      <motion.div
                        key="assign-picker"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="mt-2 overflow-hidden border-t border-slate-700 pt-2"
                      >
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
                            className="rounded-lg bg-green-700 px-3 py-2 text-xs font-semibold disabled:opacity-50 hover:bg-green-600 transition-colors"
                            disabled={selectedSpare === "" || assignSpare.isPending || createSwap.isPending}
                            onClick={handleAssign}
                          >
                            {assignSpare.isPending || createSwap.isPending ? "Assigning..." : "Assign"}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
