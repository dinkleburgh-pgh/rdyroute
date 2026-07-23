/**
 * Previous Day Coverage — management-panel port of the Fleet page's
 * "Previous Day Coverage" modal (Board.tsx), which is the canonical tool:
 * record who covered a route on the PREVIOUS run day so returning loads are
 * unloaded as the right route (surfaces on Day Overview, Unload board, and
 * Reminders). Spare covers become spare assignments; route-truck covers
 * become one-way route swaps — same branching, guards, and removal actions
 * as the Fleet modal. (Replaces the old "copy spare coverages onto today"
 * behavior, which wrote to the wrong day.)
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeftRight } from "lucide-react";
import {
  useAssignSpare,
  useBoard,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useReturnSpare,
  useRouteSwaps,
  useSpareAssignments,
} from "../../api/hooks";
import { todayIso } from "../../api/client";
import { previousRunDate, recordSwapHistory } from "../../utils/truckStatus";

export default function PrevDayCoveragePanel() {
  const runDate = todayIso();
  const prevRunDate = useMemo(() => previousRunDate(runDate), [runDate]);
  const prevLabel = format(new Date(`${prevRunDate}T12:00:00`), "EEE MMM d");

  const { data: board = [] } = useBoard(runDate);
  const { data: prevSwaps = [] } = useRouteSwaps(prevRunDate);
  const { data: prevSpares = [] } = useSpareAssignments(prevRunDate, false);
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const assignSpare = useAssignSpare();
  const returnSpare = useReturnSpare();

  const [route, setRoute] = useState("");
  const [truck, setTruck] = useState("");
  const [error, setError] = useState<string | null>(null);

  const routeTrucks = useMemo(
    () => board.filter((x) => x.truck_type !== "Spare").sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );
  const spares = useMemo(
    () => board.filter((x) => x.truck_type === "Spare").sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );
  const activePrevSpares = prevSpares.filter((s) => !s.returned);

  async function addCoverage() {
    const routeNum = parseInt(route, 10);
    const coverNum = parseInt(truck, 10);
    if (!Number.isFinite(routeNum) || !Number.isFinite(coverNum)) {
      setError("Pick a route and a covering truck.");
      return;
    }
    if (routeNum === coverNum) {
      setError("A truck can't cover its own route.");
      return;
    }
    const coverIsSpare = board.find((x) => x.truck_number === coverNum)?.truck_type === "Spare";
    try {
      if (coverIsSpare) {
        await assignSpare.mutateAsync({
          run_date: prevRunDate,
          spare_truck_number: coverNum,
          covering_route_truck: routeNum,
        });
      } else {
        await createSwap.mutateAsync({
          run_date: prevRunDate,
          route_truck: routeNum,
          load_on_truck: coverNum,
          two_way: false,
        });
      }
      recordSwapHistory(routeNum, coverNum);
      setRoute("");
      setTruck("");
      setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "Failed to save coverage.");
    }
  }

  return (
    <div className="card space-y-4">
      <p className="text-sm text-ink-soft">
        Record who covered a route on the previous run day
        {" "}(<span className="font-semibold text-ink">{prevLabel}</span>).
        This surfaces on the Day Overview, Unload board, and Reminders so returning loads
        are unloaded as the right route.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Route covered</label>
          <select className="input w-full" value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="">— pick route —</option>
            {routeTrucks.map((x) => (
              <option key={x.truck_number} value={x.truck_number}>#{x.truck_number}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Covered by</label>
          <select className="input w-full" value={truck} onChange={(e) => setTruck(e.target.value)}>
            <option value="">— pick covering truck —</option>
            <optgroup label="Spares">
              {spares.map((x) => (
                <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Spare</option>
              ))}
            </optgroup>
            <optgroup label="Route trucks">
              {routeTrucks
                .filter((x) => String(x.truck_number) !== route)
                .map((x) => (
                  <option key={x.truck_number} value={x.truck_number}>#{x.truck_number}</option>
                ))}
            </optgroup>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex justify-end">
        <button
          className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-60"
          disabled={createSwap.isPending || assignSpare.isPending || route === "" || truck === ""}
          onClick={addCoverage}
        >
          {createSwap.isPending || assignSpare.isPending ? "Saving…" : "Add Coverage"}
        </button>
      </div>

      {/* Existing previous-day coverage */}
      <div className="border-t border-hairline pt-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Set for {prevLabel}
        </div>
        {prevSwaps.length === 0 && activePrevSpares.length === 0 ? (
          <p className="text-sm text-ink-faint">No coverage recorded for the previous day yet.</p>
        ) : (
          <div className="space-y-1.5">
            {prevSwaps
              .slice()
              .sort((a, b) => a.route_truck - b.route_truck)
              .map((s) => (
                <div key={`sw-${s.id}`} className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-sm">
                  <span className="font-black text-red-300">#{s.route_truck}</span>
                  <ArrowLeftRight className="h-3.5 w-3.5 text-ink-faint" />
                  <span className="font-black text-amber-200">#{s.load_on_truck}</span>
                  <button
                    className="ml-auto rounded px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-surface-3 hover:text-red-300"
                    onClick={() => deleteSwap.mutate({ id: s.id, runDate: prevRunDate })}
                  >
                    Remove
                  </button>
                </div>
              ))}
            {activePrevSpares
              .slice()
              .sort((a, b) => a.covering_route_truck - b.covering_route_truck)
              .map((s) => (
                <div key={`sp-${s.id}`} className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-sm">
                  <span className="font-black text-red-300">#{s.covering_route_truck}</span>
                  <ArrowLeftRight className="h-3.5 w-3.5 text-ink-faint" />
                  <span className="font-black text-cyan-200">
                    #{s.spare_truck_number}
                    <span className="ml-1 text-[10px] text-ink-faint">spare</span>
                  </span>
                  <button
                    className="ml-auto rounded px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-surface-3 hover:text-red-300"
                    onClick={() => returnSpare.mutate(s.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
