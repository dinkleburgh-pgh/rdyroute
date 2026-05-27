import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  useBoard,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useDailyNotes,
  useHolidayLoad,
  useHolidayMode,
  useHolidayUnload,
  useRouteSwaps,
  useSetDailyNotes,
  useSetHolidayLoad,
  useSetHolidayMode,
  useSetHolidayUnload,
  useSetWizardCompleted,
  useUpsertTruckState,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { TruckStatus, TruckWithState } from "../types";

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  shop: "Shop",
  in_progress: "Loading",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};

const STATUS_BG: Record<TruckStatus, string> = {
  dirty: "bg-status-dirty",
  shop: "bg-status-shop",
  in_progress: "bg-status-inprogress",
  unloaded: "bg-status-unloaded",
  loaded: "bg-status-loaded",
  off: "bg-status-off",
  oos: "bg-status-oos",
  spare: "bg-status-spare",
};

const STATUS_TEXT: Record<TruckStatus, string> = {
  dirty: "text-status-dirty",
  shop: "text-status-shop",
  in_progress: "text-status-inprogress",
  unloaded: "text-status-unloaded",
  loaded: "text-status-loaded",
  off: "text-status-off",
  oos: "text-status-oos",
  spare: "text-white",
};

const UNLOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, shop: 1, in_progress: 2, unloaded: 3, loaded: 4, oos: 5, off: 6,
};
const LOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, unloaded: 1, shop: 2, in_progress: 3, loaded: 4, oos: 5, off: 6,
};

function effectiveStatus(
  t: TruckWithState,
  dayNum: number,
  holidayMode: boolean,
): TruckStatus {
  const raw = (t.state?.status ?? "dirty") as TruckStatus;
  if (
    !holidayMode &&
    t.truck_type !== "Spare" &&
    t.scheduled_off_days.includes(dayNum) &&
    (raw === "dirty" || raw === "unloaded")
  )
    return "off";
  return raw;
}

function isUnloadDone(s: TruckStatus) {
  return s === "unloaded" || s === "loaded";
}
function isLoadDone(s: TruckStatus) {
  return s === "loaded";
}

export default function RunDay() {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: holidayMode = false } = useHolidayMode(runDate);
  const { loadDay, unloadsDay } = workdayNumbers();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("setup") === "1") {
      setWizardOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const unloadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            t.truck_type !== "Spare" &&
            !t.scheduled_off_days.includes(unloadsDay),
        )
        .sort((a, b) => {
          const sa = effectiveStatus(a, unloadsDay, holidayMode);
          const sb = effectiveStatus(b, unloadsDay, holidayMode);
          const oa = UNLOAD_SORT[sa] ?? 9;
          const ob = UNLOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    [board, unloadsDay, holidayMode],
  );

  const loadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            (t.truck_type !== "Spare" || t.route_swap_route != null) &&
            !t.scheduled_off_days.includes(loadDay),
        )
        .sort((a, b) => {
          const sa = effectiveStatus(a, loadDay, holidayMode);
          const sb = effectiveStatus(b, loadDay, holidayMode);
          const oa = LOAD_SORT[sa] ?? 9;
          const ob = LOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    [board, loadDay, holidayMode],
  );

  const unloadDone = unloadTrucks.filter((t) =>
    isUnloadDone(effectiveStatus(t, unloadsDay, holidayMode)),
  ).length;
  const loadDone = loadTrucks.filter((t) =>
    isLoadDone(effectiveStatus(t, loadDay, holidayMode)),
  ).length;

  return (
    <>
      {wizardOpen && (
        <RunDayWizard
          runDate={runDate}
          board={board}
          loadDay={loadDay}
          onClose={() => setWizardOpen(false)}
        />
      )}
      <div className="space-y-6 p-4 md:p-6">
      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-slate-200">
            Unload &mdash; Day {unloadsDay}
          </h2>
          <span className="text-sm text-slate-400">
            {unloadDone} / {unloadTrucks.length} done
          </span>
          {unloadTrucks.length > 0 && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((unloadDone / unloadTrucks.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
          {unloadTrucks.map((t) => {
            const status = effectiveStatus(t, unloadsDay, holidayMode);
            return (
              <TruckCard key={t.truck_number} t={t} status={status} done={isUnloadDone(status)} />
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-slate-200">
            Load &mdash; Day {loadDay}
          </h2>
          <span className="text-sm text-slate-400">
            {loadDone} / {loadTrucks.length} done
          </span>
          {loadTrucks.length > 0 && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.round((loadDone / loadTrucks.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
          {loadTrucks.map((t) => {
            const status = effectiveStatus(t, loadDay, holidayMode);
            return (
              <TruckCard key={t.truck_number} t={t} status={status} done={isLoadDone(status)} />
            );
          })}
        </div>
      </section>
      </div>
    </>
  );
}

function TruckCard({
  t,
  status,
  done,
}: {
  t: TruckWithState;
  status: TruckStatus;
  done: boolean;
}) {
  return (
    <div
      className={clsx(
        "card flex flex-col items-center gap-1 p-2 text-center transition-opacity",
        done && "opacity-40",
      )}
    >
      <span
        className={clsx(
          "text-3xl font-extrabold tabular-nums leading-none",
          STATUS_TEXT[status],
        )}
      >
        {t.truck_number}
      </span>
      <span
        className={clsx(
          "rounded px-1 py-0.5 text-[10px] font-semibold text-white",
          STATUS_BG[status],
        )}
      >
        {STATUS_LABELS[status]}
      </span>
      <span className="text-[10px] text-slate-500">{t.truck_type}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Day Wizard (5-step modal)
// ---------------------------------------------------------------------------
function RunDayWizard({
  runDate,
  board,
  loadDay,
  onClose,
}: {
  runDate: string;
  board: TruckWithState[];
  loadDay: number;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const { data: holidayMode = false } = useHolidayMode(runDate);
  const setHolidayMode = useSetHolidayMode();
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const setHolidayLoad = useSetHolidayLoad();
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const setHolidayUnload = useSetHolidayUnload();
  const usedSpares = board.filter(
    (t) => t.truck_type === "Spare" && (t.state?.status === "unloaded" || t.state?.oos_spare_route != null),
  );
  const HOLIDAY_ROUTES = 38;
  const upsert = useUpsertTruckState();
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  const [notesText, setNotesText] = useState<string | null>(null);
  const setDailyNotes = useSetDailyNotes();
  const setWizardCompleted = useSetWizardCompleted();

  const dustTrucks = board.filter((t) => t.truck_type === "Dust");
  const [dustSelected, setDustSelected] = useState<Set<number>>(
    new Set(board.filter((t) => t.state?.has_dust_garment).map((t) => t.truck_number)),
  );

  const { data: swaps = [] } = useRouteSwaps(runDate);
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const [swapRoute, setSwapRoute] = useState<string>("");
  const [swapLoadOn, setSwapLoadOn] = useState<string>("");
  const [swapError, setSwapError] = useState<string | null>(null);

  const { loadDay: todayLoad } = workdayNumbers();
  const prevDay = todayLoad === 1 ? 5 : todayLoad - 1;
  const returningTrucks = board.filter(
    (t) =>
      t.truck_type !== "Spare" &&
      t.scheduled_off_days.includes(prevDay) &&
      !t.scheduled_off_days.includes(loadDay),
  );
  const spareTrucks = board.filter((t) => t.truck_type === "Spare");
  const specialTrucks = [...returningTrucks, ...spareTrucks].filter(
    (t, i, arr) => arr.findIndex((x) => x.truck_number === t.truck_number) === i,
  );
  const [absentSelected, setAbsentSelected] = useState<Set<number>>(new Set());

  function toggleDust(num: number) {
    setDustSelected((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  function toggleAbsent(num: number) {
    setAbsentSelected((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  async function saveDustAndAdvance() {
    await Promise.all(
      dustTrucks.map((t) =>
        upsert.mutateAsync({
          truck_number: t.truck_number,
          run_date: runDate,
          has_dust_garment: dustSelected.has(t.truck_number),
        }),
      ),
    );
    setStep(3);
  }

  async function addSwap() {
    const rt = parseInt(swapRoute);
    const lo = parseInt(swapLoadOn);
    if (isNaN(rt) || isNaN(lo)) { setSwapError("Enter valid truck numbers."); return; }
    if (rt === lo) { setSwapError("Route truck and load-on truck must be different."); return; }
    setSwapError(null);
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: rt, load_on_truck: lo, two_way: false });
      setSwapRoute("");
      setSwapLoadOn("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setSwapError(e?.response?.data?.detail ?? "Failed to save swap.");
    }
  }

  async function saveAbsentAndAdvance() {
    await Promise.all(
      [...absentSelected].map((num) =>
        upsert.mutateAsync({ truck_number: num, run_date: runDate, status: "dirty" }),
      ),
    );
    setStep(5);
  }

  async function saveNotesAndFinish() {
    await setDailyNotes.mutateAsync({ runDate, notes: notesText ?? dailyNotes });
    await setWizardCompleted.mutateAsync(runDate);
    onClose();
  }

  const STEP_TITLES = [
    "",
    "Step 1 of 5 — Run Mode",
    "Step 2 of 5 — Dust Garments",
    "Step 3 of 5 — Route Swaps",
    "Step 4 of 5 — Trucks Not Here",
    "Step 5 of 5 — Daily Notes",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <span className="text-sm font-bold uppercase tracking-wide text-slate-400">Setup Day</span>
          <span className="text-xs font-semibold text-blue-400">{STEP_TITLES[step]}</span>
          <button className="text-slate-500 hover:text-slate-300" onClick={onClose}>✕</button>
        </div>

        <div className="p-5">
          {/* Step 1: Run Mode */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">Choose today's run mode.</p>
              <p className="text-center text-xs text-slate-400">
                Normal keeps scheduled days off. Holiday runs all non-spare routes.
              </p>
              <div className="space-y-2">
                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-base font-bold transition-colors",
                    !holidayMode
                      ? "border-blue-500 bg-blue-900/40 text-blue-200"
                      : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    if (holidayMode) {
                      await setHolidayMode.mutateAsync({ runDate, holiday: false });
                      await setHolidayLoad.mutateAsync({ runDate, value: false });
                      await setHolidayUnload.mutateAsync({ runDate, value: false });
                    }
                    setStep(2);
                  }}
                  disabled={setHolidayMode.isPending}
                >
                  Normal {!holidayMode && "✓"}
                </button>
                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-base font-bold transition-colors",
                    holidayMode
                      ? "border-amber-500 bg-amber-900/40 text-amber-200"
                      : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    if (!holidayMode) {
                      await setHolidayMode.mutateAsync({ runDate, holiday: true });
                      await setHolidayLoad.mutateAsync({ runDate, value: true });
                      await setHolidayUnload.mutateAsync({ runDate, value: true });
                    }
                  }}
                  disabled={setHolidayMode.isPending || setHolidayLoad.isPending || setHolidayUnload.isPending}
                >
                  Holiday {holidayMode && "✓"}
                </button>
                {holidayMode && (
                  <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Which operations run holiday?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={clsx(
                          "rounded-lg border px-3 py-3 text-sm font-bold transition-colors",
                          holidayLoad ? "border-blue-500 bg-blue-900/40 text-blue-200" : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                        )}
                        onClick={() => setHolidayLoad.mutateAsync({ runDate, value: !holidayLoad })}
                        disabled={setHolidayLoad.isPending}
                      >
                        <div className="text-base">{holidayLoad ? "✓" : "+"} Load</div>
                        <div className="mt-1 text-[11px] font-normal opacity-70">{HOLIDAY_ROUTES} routes</div>
                      </button>
                      <button
                        className={clsx(
                          "rounded-lg border px-3 py-3 text-sm font-bold transition-colors",
                          holidayUnload ? "border-emerald-500 bg-emerald-900/40 text-emerald-200" : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                        )}
                        onClick={() => setHolidayUnload.mutateAsync({ runDate, value: !holidayUnload })}
                        disabled={setHolidayUnload.isPending}
                      >
                        <div className="text-base">{holidayUnload ? "✓" : "+"} Unload</div>
                        <div className="mt-1 text-[11px] font-normal opacity-70">
                          {HOLIDAY_ROUTES}{usedSpares.length > 0 && ` + ${usedSpares.length} spare${usedSpares.length !== 1 ? "s" : ""}`}
                          {" = "}{HOLIDAY_ROUTES + usedSpares.length} total
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={onClose}>Close</button>
                <button className="flex-1 btn-primary text-sm" onClick={() => setStep(2)}>Continue</button>
              </div>
            </div>
          )}

          {/* Step 2: Dust Garments */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">Select dust trucks with garments</p>
              <p className="text-center text-xs text-slate-400">Select which dust trucks have garments today.</p>
              {dustTrucks.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No dust trucks in fleet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {dustTrucks.map((t) => (
                    <button
                      key={t.truck_number}
                      className={clsx(
                        "rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors",
                        dustSelected.has(t.truck_number)
                          ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                          : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                      )}
                      onClick={() => toggleDust(t.truck_number)}
                    >
                      #{t.truck_number}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(1)}>Back</button>
                <button className="flex-1 btn-primary text-sm" disabled={upsert.isPending} onClick={saveDustAndAdvance}>Save & Continue</button>
              </div>
              <button className="w-full btn-ghost text-sm" onClick={() => setStep(3)}>Skip</button>
            </div>
          )}

          {/* Step 3: Route Swaps */}
          {step === 3 && (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              <p className="text-center text-xl font-extrabold text-slate-100">Set any route swaps.</p>
              <p className="text-center text-xs text-slate-400">Route swaps: one truck loads another's route today.</p>
              {swaps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Current Assignments</p>
                  {swaps.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-blue-900/50 bg-blue-950/20 px-3 py-2">
                      <span className="text-sm font-bold text-slate-200">
                        Route <span className="text-red-400">#{s.route_truck}</span>
                        <span className="mx-1 text-slate-500">→</span>
                        Load On <span className="text-blue-300">#{s.load_on_truck}</span>
                      </span>
                      <button
                        className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-slate-700"
                        disabled={deleteSwap.isPending}
                        onClick={() => deleteSwap.mutate({ id: s.id, runDate, alsoReciprocal: false })}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-400">Add route swap</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Route Truck</label>
                    <select
                      className="input w-full text-sm"
                      value={swapRoute}
                      onChange={(e) => { setSwapRoute(e.target.value); setSwapError(null); }}
                    >
                      <option value="">— route —</option>
                      {board
                        .filter((t) => t.truck_type !== "Spare")
                        .sort((a, b) => {
                          const aO = a.state?.status === "oos" ? 0 : 1;
                          const bO = b.state?.status === "oos" ? 0 : 1;
                          if (aO !== bO) return aO - bO;
                          return a.truck_number - b.truck_number;
                        })
                        .map((t) => (
                          <option key={t.truck_number} value={t.truck_number}>
                            #{t.truck_number} ({t.state?.status ?? "dirty"})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Load On</label>
                    <select
                      className="input w-full text-sm"
                      value={swapLoadOn}
                      onChange={(e) => { setSwapLoadOn(e.target.value); setSwapError(null); }}
                    >
                      <option value="">— truck —</option>
                      {board
                        .sort((a, b) => a.truck_number - b.truck_number)
                        .map((t) => {
                          const raw = t.state?.status ?? "dirty";
                          const isOff = !holidayMode && t.truck_type !== "Spare" && (t.scheduled_off_days ?? []).includes(loadDay) && (raw === "dirty" || raw === "unloaded");
                          return (
                            <option key={t.truck_number} value={t.truck_number}>
                              #{t.truck_number}{t.truck_type === "Spare" ? " (Spare)" : isOff ? " (Off)" : ""}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                </div>
                {swapError && <p className="text-xs text-red-400">{swapError}</p>}
                <button
                  className="w-full btn-primary text-sm"
                  disabled={!swapRoute || !swapLoadOn || createSwap.isPending}
                  onClick={addSwap}
                >
                  {createSwap.isPending ? "Saving…" : "Add Swap"}
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(2)}>Back</button>
                <button className="flex-1 btn-primary text-sm" onClick={() => setStep(4)}>Continue</button>
              </div>
            </div>
          )}

          {/* Step 4: Trucks Not Here */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">What trucks are NOT here?</p>
              <p className="text-center text-xs text-slate-400">Select returning or spare trucks that are absent today.</p>
              {specialTrucks.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No returning or spare trucks found.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {specialTrucks.map((t) => (
                    <button
                      key={t.truck_number}
                      className={clsx(
                        "rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors",
                        absentSelected.has(t.truck_number)
                          ? "border-red-500 bg-red-900/40 text-red-200"
                          : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                      )}
                      onClick={() => toggleAbsent(t.truck_number)}
                    >
                      #{t.truck_number}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(3)}>Back</button>
                <button className="flex-1 btn-primary text-sm" disabled={upsert.isPending} onClick={saveAbsentAndAdvance}>Save & Continue</button>
              </div>
              <button className="w-full btn-ghost text-sm" onClick={() => setStep(5)}>Skip</button>
            </div>
          )}

          {/* Step 5: Daily Notes */}
          {step === 5 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">Add any notes about today.</p>
              <textarea
                className="input w-full resize-none text-sm"
                rows={4}
                placeholder="Enter any notes about today's run day..."
                value={notesText ?? dailyNotes}
                onChange={(e) => setNotesText(e.target.value)}
              />
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(4)}>Back</button>
                <button className="flex-1 btn-primary text-sm" disabled={setDailyNotes.isPending} onClick={saveNotesAndFinish}>Save & Finish</button>
              </div>
              <button className="w-full btn-ghost text-sm" onClick={onClose}>Close without saving</button>
            </div>
          )}
        </div>

        {/* Step indicator dots */}
        <div className="flex justify-center gap-1.5 pb-4">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={clsx(
                "h-1.5 rounded-full transition-all",
                s === step ? "w-4 bg-blue-400" : s < step ? "w-1.5 bg-blue-700" : "w-1.5 bg-slate-700",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
