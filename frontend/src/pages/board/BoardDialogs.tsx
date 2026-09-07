/**
 * The Board's coverage/off dialogs, extracted from Board.tsx: off-tomorrow
 * coverage, spare-coverage pick, previous-day coverage entry, the OOS
 * confirm, the off-truck-loaded finalizer, load-confirm and the hold alert.
 *
 * Queries and mutations are instantiated here (they share React Query's cache
 * with the page, so behaviour is unchanged); only genuine page STATE and the
 * two Board-scoped actions cross the props boundary.
 */
import { useMemo } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import Modal from "../../components/Modal";
import StartLoadModal from "./StartLoadModal";
import { errorDetail } from "../../api/errors";
import {
  useAssignSpare,
  useBoard,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useHolidayLoad,
  useReturnSpare,
  useRouteSwaps,
  useSpareAssignments,
  useUpdateTruck,
  useUpsertTruckState,
} from "../../api/hooks";
import { effectiveStatus, previousRunDate, recordSwapHistory } from "../../utils/truckStatus";
import type { TruckWithState } from "../../types";

export interface BoardDialogsProps {
  runDate: string;
  runDayNum: number;
  inProgressTruck: TruckWithState | null;
  offCoverageTruck: TruckWithState | null;
  setOffCoverageTruck: (t: TruckWithState | null) => void;
  offCoverageLoadOn: string;
  setOffCoverageLoadOn: (v: string) => void;
  offCoverageError: string | null;
  setOffCoverageError: (v: string | null) => void;
  spareCoverageTruck: TruckWithState | null;
  setSpareCoverageTruck: (t: TruckWithState | null) => void;
  spareCoverageRoute: string;
  setSpareCoverageRoute: (v: string) => void;
  spareCoverageError: string | null;
  setSpareCoverageError: (v: string | null) => void;
  prevCovOpen: boolean;
  setPrevCovOpen: (v: boolean) => void;
  prevCovRoute: string;
  setPrevCovRoute: (v: string) => void;
  prevCovTruck: string;
  setPrevCovTruck: (v: string) => void;
  prevCovError: string | null;
  setPrevCovError: (v: string | null) => void;
  pendingOosTruck: TruckWithState | null;
  setPendingOosTruck: (t: TruckWithState | null) => void;
  pendingOffLoadTruck: TruckWithState | null;
  setPendingOffLoadTruck: (t: TruckWithState | null) => void;
  pendingOffLoadRoute: string;
  setPendingOffLoadRoute: (v: string) => void;
  pendingOffLoadError: string | null;
  setPendingOffLoadError: (v: string | null) => void;
  confirmTruck: TruckWithState | null;
  setConfirmTruck: (t: TruckWithState | null) => void;
  holdAlertTruck: TruckWithState | null;
  setHoldAlertTruck: (t: TruckWithState | null) => void;
  finalizeOffTruckAsLoaded: (mode: "route" | "special") => void;
  startLoad: (t: TruckWithState) => Promise<void>;
}

export default function BoardDialogs({
  runDate,
  runDayNum,
  inProgressTruck,
  offCoverageTruck,
  setOffCoverageTruck,
  offCoverageLoadOn,
  setOffCoverageLoadOn,
  offCoverageError,
  setOffCoverageError,
  spareCoverageTruck,
  setSpareCoverageTruck,
  spareCoverageRoute,
  setSpareCoverageRoute,
  spareCoverageError,
  setSpareCoverageError,
  prevCovOpen,
  setPrevCovOpen,
  prevCovRoute,
  setPrevCovRoute,
  prevCovTruck,
  setPrevCovTruck,
  prevCovError,
  setPrevCovError,
  pendingOosTruck,
  setPendingOosTruck,
  pendingOffLoadTruck,
  setPendingOffLoadTruck,
  pendingOffLoadRoute,
  setPendingOffLoadRoute,
  pendingOffLoadError,
  setPendingOffLoadError,
  confirmTruck,
  setConfirmTruck,
  holdAlertTruck,
  setHoldAlertTruck,
  finalizeOffTruckAsLoaded,
  startLoad,
}: BoardDialogsProps) {
  const navigate = useNavigate();
  const { data } = useBoard(runDate);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate, false);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const prevRunDate = useMemo(() => previousRunDate(runDate), [runDate]);
  const { data: prevSwaps = [] } = useRouteSwaps(prevRunDate);
  const { data: prevSpares = [] } = useSpareAssignments(prevRunDate, false);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const upsert = useUpsertTruckState();
  const updateTruck = useUpdateTruck();
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const assignSpare = useAssignSpare();
  const returnSpare = useReturnSpare();

  return (
    <>
      {offCoverageTruck && (
        <Modal open onClose={() => { setOffCoverageTruck(null); setOffCoverageLoadOn(""); setOffCoverageError(null); }} size="md">
            <h3 className="mb-1 text-base font-semibold">
              Route #{offCoverageTruck.truck_number} is off tomorrow
            </h3>
            <p className="mb-4 text-sm text-ink-muted">
              This route is not scheduled for the next load day. Assign the truck or spare
              that will cover it so the load can proceed. Coverage is required.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Covering truck (required)</label>
                <select
                  className="input"
                  value={offCoverageLoadOn}
                  onChange={(e) => setOffCoverageLoadOn(e.target.value)}
                >
                  <option value="">— pick covering truck —</option>
                  <optgroup label="Spares">
                    {(data ?? [])
                      .filter((x) => x.truck_type === "Spare")
                      .sort((a, b) => a.truck_number - b.truck_number)
                      .map((x) => (
                        <option key={x.truck_number} value={x.truck_number}>
                          #{x.truck_number} — Spare
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Route trucks">
                    {(data ?? [])
                      .filter((x) => x.truck_type !== "Spare" && x.truck_number !== offCoverageTruck.truck_number)
                      .sort((a, b) => a.truck_number - b.truck_number)
                      .map((x) => (
                        <option key={x.truck_number} value={x.truck_number}>
                          #{x.truck_number} ({effectiveStatus(x, runDayNum, holidayLoad)})
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
              {offCoverageError && (
                <p className="text-sm text-red-400">{offCoverageError}</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => { setOffCoverageTruck(null); setOffCoverageLoadOn(""); setOffCoverageError(null); }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60 transition-colors"
                disabled={createSwap.isPending || offCoverageLoadOn === ""}
                onClick={async () => {
                  const loadOnNum = parseInt(offCoverageLoadOn, 10);
                  if (!Number.isFinite(loadOnNum)) {
                    setOffCoverageError("Select a covering truck first.");
                    return;
                  }
                  try {
                    await createSwap.mutateAsync({
                      run_date: runDate,
                      route_truck: offCoverageTruck.truck_number,
                      load_on_truck: loadOnNum,
                      two_way: false,
                    });
                    const t = offCoverageTruck;
                    setOffCoverageTruck(null);
                    setOffCoverageLoadOn("");
                    setOffCoverageError(null);
                    setConfirmTruck(t);
                  } catch (err: unknown) {
                                        setOffCoverageError(errorDetail(err) ?? "Failed to create coverage.");
                  }
                }}
              >
                {createSwap.isPending ? "Saving…" : "Assign Coverage & Start Loading"}
              </button>
            </div>
                  </Modal>
      )}

      {spareCoverageTruck && (
        <Modal open onClose={() => { setSpareCoverageTruck(null); setSpareCoverageRoute(""); setSpareCoverageError(null); }} size="md">
            <h3 className="mb-1 text-base font-semibold">
              Spare #{spareCoverageTruck.truck_number} — which route is it covering?
            </h3>
            <p className="mb-4 text-sm text-ink-muted">
              A spare only loads to cover another truck's route. Pick the route it's running
              so the load can proceed. Coverage is required.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Route to cover (required)</label>
                <select
                  className="input"
                  value={spareCoverageRoute}
                  onChange={(e) => setSpareCoverageRoute(e.target.value)}
                >
                  <option value="">— pick route —</option>
                  {(data ?? [])
                    .filter((x) =>
                      x.truck_type !== "Spare" &&
                      x.truck_number !== spareCoverageTruck.truck_number &&
                      !routeSwaps.some((s) => s.route_truck === x.truck_number) &&
                      !spareAssignments.some((a) => a.covering_route_truck === x.truck_number && !a.returned)
                    )
                    .sort((a, b) => a.truck_number - b.truck_number)
                    .map((x) => (
                      <option key={x.truck_number} value={x.truck_number}>
                        #{x.truck_number} ({effectiveStatus(x, runDayNum, holidayLoad)})
                      </option>
                    ))}
                </select>
              </div>
              {spareCoverageError && (
                <p className="text-sm text-red-400">{spareCoverageError}</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => { setSpareCoverageTruck(null); setSpareCoverageRoute(""); setSpareCoverageError(null); }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60 transition-colors"
                disabled={assignSpare.isPending || spareCoverageRoute === ""}
                onClick={async () => {
                  const routeNum = parseInt(spareCoverageRoute, 10);
                  if (!Number.isFinite(routeNum)) {
                    setSpareCoverageError("Pick a route to cover first.");
                    return;
                  }
                  try {
                    // Spare cover → SpareAssignment (the canonical spare path),
                    // matching the OOS-card assign flow above.
                    await assignSpare.mutateAsync({
                      run_date: runDate,
                      spare_truck_number: spareCoverageTruck.truck_number,
                      covering_route_truck: routeNum,
                    });
                    const t = spareCoverageTruck;
                    setSpareCoverageTruck(null);
                    setSpareCoverageRoute("");
                    setSpareCoverageError(null);
                    setConfirmTruck(t);
                  } catch (err: unknown) {
                                        setSpareCoverageError(errorDetail(err) ?? "Failed to assign coverage.");
                  }
                }}
              >
                {assignSpare.isPending ? "Saving…" : "Assign Route & Start Loading"}
              </button>
            </div>
                  </Modal>
      )}

      {prevCovOpen && (
        <Modal open onClose={() => { setPrevCovOpen(false); setPrevCovRoute(""); setPrevCovTruck(""); setPrevCovError(null); }} size="md">
            <h3 className="mb-1 text-base font-semibold">Previous Day Coverage</h3>
            <p className="mb-4 text-sm text-ink-muted">
              Record who covered a route on the previous run day
              {" "}(<span className="font-semibold text-ink-soft">{format(new Date(`${prevRunDate}T12:00:00`), "EEE MMM d")}</span>).
              This surfaces on the Day Overview, Unload board, and Reminders so returning loads are unloaded as the right route.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Route covered</label>
                <select className="input" value={prevCovRoute} onChange={(e) => setPrevCovRoute(e.target.value)}>
                  <option value="">— pick route —</option>
                  {(data ?? [])
                    .filter((x) => x.truck_type !== "Spare")
                    .sort((a, b) => a.truck_number - b.truck_number)
                    .map((x) => (
                      <option key={x.truck_number} value={x.truck_number}>#{x.truck_number}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label">Covered by</label>
                <select className="input" value={prevCovTruck} onChange={(e) => setPrevCovTruck(e.target.value)}>
                  <option value="">— pick covering truck —</option>
                  <optgroup label="Spares">
                    {(data ?? [])
                      .filter((x) => x.truck_type === "Spare")
                      .sort((a, b) => a.truck_number - b.truck_number)
                      .map((x) => (
                        <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Spare</option>
                      ))}
                  </optgroup>
                  <optgroup label="Route trucks">
                    {(data ?? [])
                      .filter((x) => x.truck_type !== "Spare" && String(x.truck_number) !== prevCovRoute)
                      .sort((a, b) => a.truck_number - b.truck_number)
                      .map((x) => (
                        <option key={x.truck_number} value={x.truck_number}>#{x.truck_number}</option>
                      ))}
                  </optgroup>
                </select>
              </div>
              {prevCovError && <p className="text-sm text-red-400">{prevCovError}</p>}
              <div className="flex justify-end">
                <button
                  className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60 transition-colors"
                  disabled={createSwap.isPending || assignSpare.isPending || prevCovRoute === "" || prevCovTruck === ""}
                  onClick={async () => {
                    const route = parseInt(prevCovRoute, 10);
                    const cover = parseInt(prevCovTruck, 10);
                    if (!Number.isFinite(route) || !Number.isFinite(cover)) { setPrevCovError("Pick a route and a covering truck."); return; }
                    if (route === cover) { setPrevCovError("A truck can't cover its own route."); return; }
                    const coverIsSpare = (data ?? []).find((x) => x.truck_number === cover)?.truck_type === "Spare";
                    try {
                      if (coverIsSpare) {
                        await assignSpare.mutateAsync({ run_date: prevRunDate, spare_truck_number: cover, covering_route_truck: route });
                      } else {
                        await createSwap.mutateAsync({ run_date: prevRunDate, route_truck: route, load_on_truck: cover, two_way: false });
                      }
                      recordSwapHistory(route, cover);
                      setPrevCovRoute(""); setPrevCovTruck(""); setPrevCovError(null);
                    } catch (err: unknown) {
                                            setPrevCovError(errorDetail(err) ?? "Failed to save coverage.");
                    }
                  }}
                >
                  {(createSwap.isPending || assignSpare.isPending) ? "Saving…" : "Add Coverage"}
                </button>
              </div>
            </div>

            {/* Existing previous-day coverage */}
            <div className="mt-4 border-t border-hairline pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Set for {format(new Date(`${prevRunDate}T12:00:00`), "EEE MMM d")}
              </div>
              {(prevSwaps.length === 0 && prevSpares.filter((s) => !s.returned).length === 0) ? (
                <p className="text-sm text-ink-muted">No coverage recorded for the previous day yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {prevSwaps.slice().sort((a, b) => a.route_truck - b.route_truck).map((s) => (
                    <div key={`sw-${s.id}`} className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2.5 py-1.5 text-sm">
                      <span className="font-black text-red-300">#{s.route_truck}</span>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-ink-faint" />
                      <span className="font-black text-amber-200">#{s.load_on_truck}</span>
                      <button
                        className="ml-auto rounded px-2 py-0.5 text-xs text-red-400 hover:bg-track hover:text-red-300"
                        onClick={() => deleteSwap.mutate({ id: s.id, runDate: prevRunDate })}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {prevSpares.filter((s) => !s.returned).sort((a, b) => a.covering_route_truck - b.covering_route_truck).map((s) => (
                    <div key={`sp-${s.id}`} className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2.5 py-1.5 text-sm">
                      <span className="font-black text-red-300">#{s.covering_route_truck}</span>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-ink-faint" />
                      <span className="font-black text-cyan-200">#{s.spare_truck_number}<span className="ml-1 text-[10px] text-ink-muted">spare</span></span>
                      <button
                        className="ml-auto rounded px-2 py-0.5 text-xs text-red-400 hover:bg-track hover:text-red-300"
                        onClick={() => returnSpare.mutate(s.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="btn-ghost"
                onClick={() => { setPrevCovOpen(false); setPrevCovRoute(""); setPrevCovTruck(""); setPrevCovError(null); }}
              >
                Done
              </button>
            </div>
                  </Modal>
      )}

      {pendingOosTruck && (
        <Modal open onClose={() => setPendingOosTruck(null)} size="sm">
            <h3 className="mb-1 text-base font-semibold">Mark Truck #{pendingOosTruck.truck_number} as OOS?</h3>
            <p className="mb-4 text-sm text-ink-muted">
              Out of Service means this truck is unavailable for today's run and needs coverage.
              This is not a routine status change.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setPendingOosTruck(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
                onClick={() => {
                  updateTruck.mutate({
                    truck_number: pendingOosTruck.truck_number,
                    is_oos: true,
                  });
                  // Dev behavior: marking OOS moves the truck straight to
                  // "unloaded" so its route counts as done on the unload board
                  // (the route still runs — it gets covered). The is_oos flag is
                  // kept, so the board still shows it as OOS and coverage works.
                  // (Future: replace this with a notice telling unload to unload it.)
                  upsert.mutate({
                    truck_number: pendingOosTruck.truck_number,
                    run_date: runDate,
                    status: "unloaded",
                    wearers: pendingOosTruck.state?.wearers ?? 0,
                  });
                  setPendingOosTruck(null);
                }}
              >
                Confirm OOS
              </button>
            </div>
                  </Modal>
      )}

      {pendingOffLoadTruck && (
        <Modal open onClose={() => { setPendingOffLoadTruck(null); setPendingOffLoadRoute(""); setPendingOffLoadError(null); }} size="md">
            <h3 className="mb-1 text-base font-semibold">
              Truck #{pendingOffLoadTruck.truck_number} is off-schedule
            </h3>
            <p className="mb-4 text-sm text-ink-muted">
              This truck is not scheduled today. Select the route it ran, or just mark it
              as <span className="font-semibold text-amber-300">Ran Special</span> if no specific
              route applies. Either way the truck will be marked Loaded and the note saved.
            </p>

            <div className="space-y-3">
              <div>
                <label className="label">Route it ran (optional)</label>
                <select
                  className="input"
                  value={pendingOffLoadRoute}
                  onChange={(e) => setPendingOffLoadRoute(e.target.value)}
                >
                  <option value="">- pick route truck -</option>
                  {(data ?? [])
                    .filter((x) => x.truck_type !== "Spare" && x.truck_number !== pendingOffLoadTruck.truck_number)
                    .sort((a, b) => a.truck_number - b.truck_number)
                    .map((x) => (
                      <option key={x.truck_number} value={x.truck_number}>
                        #{x.truck_number} ({effectiveStatus(x, runDayNum, holidayLoad)})
                      </option>
                    ))}
                </select>
              </div>

              {pendingOffLoadError && (
                <p className="text-sm text-red-400">{pendingOffLoadError}</p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => {
                  setPendingOffLoadTruck(null);
                  setPendingOffLoadRoute("");
                  setPendingOffLoadError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
                disabled={upsert.isPending}
                onClick={() => finalizeOffTruckAsLoaded("special")}
              >
                Ran Special (no route)
              </button>
              <button
                className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 transition-colors disabled:opacity-60"
                disabled={upsert.isPending || pendingOffLoadRoute === ""}
                onClick={() => finalizeOffTruckAsLoaded("route")}
              >
                Save with Route
              </button>
            </div>
                  </Modal>
      )}
      {confirmTruck && (
        <StartLoadModal
          truck={confirmTruck}
          blockedBy={inProgressTruck ?? null}
          busy={upsert.isPending}
          onConfirm={async () => {
            await startLoad(confirmTruck);
            setConfirmTruck(null);
            navigate("/board?status=in_progress");
          }}
          onClose={() => setConfirmTruck(null)}
        />
      )}
      {holdAlertTruck && (
        <Modal open onClose={() => setHoldAlertTruck(null)} size="sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-900/60 text-sm">&#x1f512;</span>
              <h3 className="text-base font-semibold">Truck #{holdAlertTruck.truck_number} is on Hold</h3>
            </div>
            <p className="mb-4 text-sm text-ink-muted">
              This truck has been flagged as "Do Not Load". Check with a Fleet Supervisor before proceeding.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-md bg-track px-4 py-1.5 text-sm font-semibold text-ink-soft hover:bg-track transition"
                onClick={() => {
                  setHoldAlertTruck(null);
                  navigate(`/fleet?truck=${holdAlertTruck.truck_number}`);
                }}
              >
                View Details
              </button>
              <button
                className="btn-ghost"
                onClick={() => setHoldAlertTruck(null)}
              >
                OK
              </button>
            </div>
                  </Modal>
      )}
    </>
  );
}
