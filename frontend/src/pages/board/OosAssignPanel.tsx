/**
 * The OOS drill page's whole job (extracted from Board.tsx): the covered
 * display, tap-to-assign, and the picker itself, hosted inside a quiet tile's
 * `extra` slot.
 */
import { useMemo } from "react";
import clsx from "clsx";
import {
  useAssignSpare,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  useReturnSpare,
  useRouteSwaps,
  useSpareAssignments,
} from "../../api/hooks";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS } from "./constants";
import { effectiveStatus, getSwapHistory, isScheduledOff, recordSwapHistory } from "../../utils/truckStatus";
import type { TruckStatus, TruckWithState } from "../../types";

export interface OosAssignPanelProps {
  truck: TruckWithState;
  runDate: string;
  runDayNum: number;
  board: TruckWithState[];
  coveringTruckByRoute: Map<number, { num: number; status?: TruckStatus }>;
  oosAssignOpen: Set<number>;
  setOosAssignOpen: React.Dispatch<React.SetStateAction<Set<number>>>;
  oosCardSelects: Record<number, string>;
  setOosCardSelects: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  renderRemoveFromOos: (truck: TruckWithState, compact?: boolean) => React.ReactNode;
  oosActionPending: boolean;
}

export default function OosAssignPanel({
  truck,
  runDate,
  runDayNum,
  board,
  coveringTruckByRoute,
  oosAssignOpen,
  setOosAssignOpen,
  oosCardSelects,
  setOosCardSelects,
  renderRemoveFromOos,
  oosActionPending,
}: OosAssignPanelProps) {
  const data = board;
  const { data: spareAssignments = [] } = useSpareAssignments(runDate, false);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const assignSpare = useAssignSpare();
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const returnSpare = useReturnSpare();

    const cov = coveringTruckByRoute.get(truck.truck_number);
    const spareAsgn = spareAssignments.find((a) => a.covering_route_truck === truck.truck_number);
    const swap = routeSwaps.find((s) => s.route_truck === truck.truck_number);
    const isOpen = oosAssignOpen.has(truck.truck_number);

    // Covered display yields to the picker when the user hits
    // Reassign (isOpen) — otherwise the read-only historical
    // fallback would keep re-showing coverage and the picker
    // could never open.
    if (cov && !isOpen) {
      return (
        <div
          className="mt-1 border-t border-hairline pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-muted">Covered by</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2.5 py-0.5 text-sm font-bold text-sky-300 ring-1 ring-sky-700/40">
                #{cov.num}
              </span>
              {cov.status && (
                <span className={clsx("badge text-[10px] py-0", STATUS_BG[cov.status], STATUS_BADGE_TEXT[cov.status])}>
                  {STATUS_LABELS[cov.status]}
                </span>
              )}
            </div>
            {/* Reassign: drop this cover and reopen the picker, keeping the truck OOS. */}
            <button
              className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-ink-muted hover:bg-track hover:text-ink-soft disabled:opacity-40"
              disabled={oosActionPending}
              onClick={() => {
                if (spareAsgn) returnSpare.mutate(spareAsgn.id);
                else if (swap) deleteSwap.mutate({ id: swap.id, runDate });
                setOosAssignOpen((prev) => new Set(prev).add(truck.truck_number));
              }}
            >
              Reassign
            </button>
          </div>
          {/* Remove from OOS: truck is back — clear OOS + free the cover. */}
          <div className="mt-2">{renderRemoveFromOos(truck)}</div>
        </div>
      );
    }

    if (!isOpen) {
      return (
        <div className="mt-1 space-y-1.5 border-t border-hairline pt-2">
          {/* The extra block sits outside the tile's button now, so
              this hint carries its own click instead of bubbling. */}
          <button
            type="button"
            className="block w-full text-center"
            onClick={() => setOosAssignOpen((prev) => new Set(prev).add(truck.truck_number))}
          >
            <span className="text-[11px] font-semibold text-blue-400">Tap to assign →</span>
          </button>
          {/* Remove from OOS without ever covering it (truck came back). */}
          {renderRemoveFromOos(truck, true)}
        </div>
      );
    }

    const sorted = [...(data ?? [])].sort((a, b) => a.truck_number - b.truck_number);
    const lastUsedNums = getSwapHistory(truck.truck_number);
    const lastUsed = lastUsedNums.map((n) => sorted.find((x) => x.truck_number === n)).filter(Boolean) as typeof sorted;
    const spareTrucks = sorted.filter((x) => x.truck_type === "Spare");
    // Off group is SCHEDULE-based: a scheduled-off truck stays a
    // candidate even when flags (needs-check, coverage, loaded)
    // stop effectiveStatus from displaying it as "off".
    const offTrucks = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, runDayNum, holidayLoad) !== "oos" && !holidayLoad && isScheduledOff(x, runDayNum));
    const otherTrucks = sorted.filter((x) => {
      if (x.truck_type === "Spare") return false;
      if (effectiveStatus(x, runDayNum, holidayLoad) === "oos") return false;
      return holidayLoad || !isScheduledOff(x, runDayNum);
    });

    return (
      <div
        className="mt-1 space-y-2 border-t border-hairline pt-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-1.5">
          <select
            className="input flex-1 text-xs"
            value={oosCardSelects[truck.truck_number] ?? ""}
            onChange={(e) => setOosCardSelects((p) => ({ ...p, [truck.truck_number]: e.target.value }))}
          >
            <option value="">— assign truck —</option>
            {lastUsed.length > 0 && (
              <optgroup label="Last Used">
                {lastUsed.map((x) => (
                  <option key={x.truck_number} value={x.truck_number}>
                    #{x.truck_number} — {x.truck_type === "Spare" ? "Spare" : (x.state?.status ?? "dirty")}
                  </option>
                ))}
              </optgroup>
            )}
            {spareTrucks.length > 0 && (
              <optgroup label="Spare Trucks">
                {spareTrucks.map((x) => (
                  <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Spare</option>
                ))}
              </optgroup>
            )}
            {offTrucks.length > 0 && (
              <optgroup label={`Off — Day ${runDayNum}`}>
                {offTrucks.map((x) => (
                  <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Off</option>
                ))}
              </optgroup>
            )}
            {otherTrucks.length > 0 && (
              <optgroup label="Other">
                {otherTrucks.map((x) => (
                  <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} ({x.state?.status ?? "dirty"})</option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            className="rounded-lg bg-green-700 px-3 text-xs font-semibold disabled:opacity-50"
            disabled={
              !oosCardSelects[truck.truck_number] ||
              assignSpare.isPending || createSwap.isPending
            }
            onClick={async () => {
              const pickedNum = Number(oosCardSelects[truck.truck_number]);
              const picked = (data ?? []).find((x) => x.truck_number === pickedNum);
              if (picked?.truck_type === "Spare") {
                await assignSpare.mutateAsync({
                  run_date: runDate,
                  spare_truck_number: pickedNum,
                  covering_route_truck: truck.truck_number,
                });
              } else {
                await createSwap.mutateAsync({
                  run_date: runDate,
                  route_truck: truck.truck_number,
                  load_on_truck: pickedNum,
                  two_way: false,
                });
              }
              recordSwapHistory(truck.truck_number, pickedNum);
              setOosCardSelects((p) => { const next = { ...p }; delete next[truck.truck_number]; return next; });
              setOosAssignOpen((prev) => { const next = new Set(prev); next.delete(truck.truck_number); return next; });
            }}
          >
            {assignSpare.isPending || createSwap.isPending ? "…" : "Assign"}
          </button>
        </div>
        {/* Or skip assigning — the truck is back in service. */}
        {renderRemoveFromOos(truck, true)}
      </div>
    );
  }
