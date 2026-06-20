/**
 * Run Day Wizard (5-step Setup Day modal). Extracted from RunDay.tsx.
 *
 * Steps: Run Mode → Dust Garments → Route Swaps → Trucks Not Here → Daily Notes.
 */
import { useState } from "react";
import clsx from "clsx";
import {
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
  useUpsertSetting,
  useUpsertTruckState,
} from "../../api/hooks";
import { workdayNumbers } from "../../components/Clock";
import type { TruckWithState } from "../../types";
import { effectiveStatus, getSwapHistory, isScheduledOff, recordSwapHistory } from "../../utils/truckStatus";

export default function RunDayWizard({
  runDate,
  board,
  loadDay,
  unloadsDay,
  onClose,
}: {
  runDate: string;
  board: TruckWithState[];
  loadDay: number;
  unloadsDay: number;
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

  // Counts per side, derived from the actual fleet roster.
  // Base = trucks scheduled to run that ship day normally.
  // Extra = trucks normally off for that ship day (added by holiday).
  const loadBase = board.filter(
    (t) => t.truck_type !== "Spare" && !isScheduledOff(t, loadDay),
  ).length;
  const loadExtra = board.filter(
    (t) => t.truck_type !== "Spare" && isScheduledOff(t, loadDay),
  ).length;
  const unloadBase = board.filter(
    (t) => t.truck_type !== "Spare" && !isScheduledOff(t, unloadsDay),
  ).length;
  const unloadExtra = board.filter(
    (t) => t.truck_type !== "Spare" && isScheduledOff(t, unloadsDay),
  ).length;
  const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
  const upsert = useUpsertTruckState();
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  const [notesText, setNotesText] = useState<string | null>(null);
  const setDailyNotes = useSetDailyNotes();
  const setWizardCompleted = useSetWizardCompleted();
  const upsertSetting = useUpsertSetting();

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
  // Per-OOS-truck "load on" selections (auto-saved when set)
  const [oosLoadOns, setOosLoadOns] = useState<Record<number, string>>({});

  const { loadDay: todayLoad } = workdayNumbers(new Date(`${runDate}T12:00:00`));
  const prevDay = todayLoad === 1 ? 5 : todayLoad - 1;
  const returningTrucks = board.filter(
    (t) =>
      t.truck_type !== "Spare" &&
      isScheduledOff(t, prevDay) &&
      !isScheduledOff(t, loadDay),
  );
  const spareTrucks = board.filter((t) => t.truck_type === "Spare");
  const specialTrucks = [...returningTrucks, ...spareTrucks].filter(
    (t, i, arr) => arr.findIndex((x) => x.truck_number === t.truck_number) === i,
  );
  // Wizard always overrides — including workflow-touched trucks
  const canWizardMutateTruck = (_t: TruckWithState) => true;
  const editableDustTrucks = dustTrucks.filter(canWizardMutateTruck);
  const editableSpecialTrucks = specialTrucks.filter(canWizardMutateTruck);
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
      editableDustTrucks.map((t) =>
        upsert.mutateAsync({
          truck_number: t.truck_number,
          run_date: runDate,
          has_dust_garment: dustSelected.has(t.truck_number),
          state_source: "wizard",
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
      recordSwapHistory(rt, lo);
      setSwapRoute("");
      setSwapLoadOn("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setSwapError(e?.response?.data?.detail ?? "Failed to save swap.");
    }
  }

  async function addOosSwap(routeTruck: number, loadOnTruck: number) {
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: routeTruck, load_on_truck: loadOnTruck, two_way: false });
      recordSwapHistory(routeTruck, loadOnTruck);
      setOosLoadOns((prev) => { const n = { ...prev }; delete n[routeTruck]; return n; });
    } catch (err: unknown) {
      // leave selection in place so user can retry or adjust
      console.error("OOS swap save failed", err);
    }
  }

  async function saveAbsentAndAdvance() {
    const tasks: Promise<unknown>[] = [];
    // Absent trucks: flag needs_checked (don't touch status — they may be unloaded, spare, etc.)
    for (const num of absentSelected) {
      const truck = specialTrucks.find((t) => t.truck_number === num);
      if (!truck) continue;
      tasks.push(upsert.mutateAsync({
        truck_number: num,
        run_date: runDate,
        needs_checked: true,
        wearers: truck.state?.wearers ?? 0,
        state_source: "wizard",
      }));
    }

    // Non-absent returning trucks: auto-set to unloaded.
    // These trucks were off yesterday and are back today — they were already
    // loaded/pushed the day before, so they return in an unloaded state.
    for (const t of returningTrucks) {
      if (!absentSelected.has(t.truck_number)) {
        tasks.push(upsert.mutateAsync({
          truck_number: t.truck_number,
          run_date: runDate,
          status: "unloaded",
          state_source: "wizard",
        }));
      }
    }

    await Promise.all(tasks);
    setStep(5);
  }

  async function saveNotesAndFinish() {
    await setDailyNotes.mutateAsync({ runDate, notes: notesText ?? dailyNotes });
    await upsertSetting.mutateAsync({ key: `day_setup_source_${runDate}`, value: "wizard" });
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
              <p className="text-center text-xl font-extrabold text-slate-100">Set today's run mode.</p>
              <p className="text-center text-xs text-slate-400">
                Load and Unload can run independently on holiday. Load is for tomorrow's ship,
                Unload is for today's ship returning.
              </p>

              {/* Master shortcut: Normal / Holiday (sets both sides at once) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-sm font-bold transition-colors",
                    !holidayMode && !holidayLoad && !holidayUnload
                      ? "border-blue-500 bg-blue-900/40 text-blue-200"
                      : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    await Promise.all([
                      setHolidayMode.mutateAsync({ runDate, holiday: false }),
                      setHolidayLoad.mutateAsync({ runDate, value: false }),
                      setHolidayUnload.mutateAsync({ runDate, value: false }),
                    ]);
                  }}
                  disabled={setHolidayMode.isPending || setHolidayLoad.isPending || setHolidayUnload.isPending}
                >
                  All Normal
                </button>
                <button
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-sm font-bold transition-colors",
                    holidayMode && holidayLoad && holidayUnload
                      ? "border-amber-500 bg-amber-900/40 text-amber-200"
                      : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    await Promise.all([
                      setHolidayMode.mutateAsync({ runDate, holiday: true }),
                      setHolidayLoad.mutateAsync({ runDate, value: true }),
                      setHolidayUnload.mutateAsync({ runDate, value: true }),
                    ]);
                  }}
                  disabled={setHolidayMode.isPending || setHolidayLoad.isPending || setHolidayUnload.isPending}
                >
                  All Holiday
                </button>
              </div>

              {/* Per-side independent toggles */}
              <div className="space-y-2">
                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                    holidayLoad
                      ? "border-amber-500 bg-amber-950/30"
                      : "border-slate-600 bg-slate-800 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    const next = !holidayLoad;
                    await setHolidayLoad.mutateAsync({ runDate, value: next });
                    // Keep master flag in sync (true if either side is holiday)
                    await setHolidayMode.mutateAsync({ runDate, holiday: next || holidayUnload });
                  }}
                  disabled={setHolidayLoad.isPending}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-slate-100">
                      Load &mdash; for {DAY_NAMES[loadDay] ?? `Day ${loadDay}`}'s ship
                    </span>
                    <span className={clsx(
                      "rounded px-2 py-0.5 text-xs font-bold",
                      holidayLoad ? "bg-amber-500/80 text-amber-50" : "bg-slate-600 text-slate-200",
                    )}>
                      {holidayLoad ? "HOLIDAY" : "NORMAL"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {holidayLoad
                      ? <>Loading <span className="font-bold text-amber-200">{loadBase + loadExtra}</span> routes ({loadBase} scheduled + <span className="font-bold text-amber-300">{loadExtra} extra</span>)</>
                      : <>Loading <span className="font-bold text-slate-200">{loadBase}</span> scheduled routes ({loadExtra} off)</>}
                  </div>
                </button>

                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                    holidayUnload
                      ? "border-amber-500 bg-amber-950/30"
                      : "border-slate-600 bg-slate-800 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    const next = !holidayUnload;
                    await setHolidayUnload.mutateAsync({ runDate, value: next });
                    await setHolidayMode.mutateAsync({ runDate, holiday: next || holidayLoad });
                  }}
                  disabled={setHolidayUnload.isPending}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-slate-100">
                      Unload &mdash; from {DAY_NAMES[unloadsDay] ?? `Day ${unloadsDay}`}'s ship
                    </span>
                    <span className={clsx(
                      "rounded px-2 py-0.5 text-xs font-bold",
                      holidayUnload ? "bg-amber-500/80 text-amber-50" : "bg-slate-600 text-slate-200",
                    )}>
                      {holidayUnload ? "HOLIDAY" : "NORMAL"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {holidayUnload
                      ? <>Unloading <span className="font-bold text-amber-200">{unloadBase + unloadExtra}</span> routes ({unloadBase} scheduled + <span className="font-bold text-amber-300">{unloadExtra} extra</span>){usedSpares.length > 0 && <> + {usedSpares.length} spare{usedSpares.length !== 1 ? "s" : ""}</>}</>
                      : <>Unloading <span className="font-bold text-slate-200">{unloadBase}</span> scheduled routes{usedSpares.length > 0 && <> + {usedSpares.length} spare{usedSpares.length !== 1 ? "s" : ""}</>}</>}
                  </div>
                </button>
              </div>

              {holidayLoad !== holidayUnload && (
                <div className="rounded-md border border-blue-700/40 bg-blue-950/20 px-3 py-2 text-xs text-blue-200">
                  <span className="font-bold">Asymmetric day:</span> only one side is on holiday.
                  This happens entering/leaving a holiday week (e.g.&nbsp;Fri load=holiday, Mon unload=holiday).
                </div>
              )}

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
              {editableDustTrucks.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No dust trucks in fleet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {editableDustTrucks.map((t) => (
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
          {step === 3 && (() => {
            // OOS trucks that don't yet have a swap assigned
            const swappedRoutes = new Set(swaps.map((s) => s.route_truck));
            const unswappedOos = board.filter(
              (t) => t.truck_type !== "Spare" && t.state?.status === "oos" && !swappedRoutes.has(t.truck_number),
            ).sort((a, b) => a.truck_number - b.truck_number);
            return (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              <p className="text-center text-xl font-extrabold text-slate-100">Set any route swaps.</p>
              <p className="text-center text-xs text-slate-400">Route swaps: one truck loads another's route today.</p>

              {/* OOS trucks needing a covering truck */}
              {unswappedOos.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                    OOS — Select covering truck
                  </p>
                  {unswappedOos.map((t) => (
                    <div key={t.truck_number} className="flex items-center gap-2 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-2">
                      <span className="text-sm font-bold text-amber-300 whitespace-nowrap">
                        #{t.truck_number} <span className="text-[10px] font-semibold text-amber-500">OOS</span>
                      </span>
                      <span className="text-slate-500 text-sm">→</span>
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
                        {(() => {
                          const sorted = [...board].sort((a, b) => a.truck_number - b.truck_number);
                          const lastUsedNums = getSwapHistory(t.truck_number);
                          const lastUsed = lastUsedNums.map((n) => sorted.find((x) => x.truck_number === n)).filter(Boolean) as typeof sorted;
                          const spareTrucks = sorted.filter((x) => x.truck_type === "Spare");
                          const offTrucks = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, loadDay, holidayLoad) === "off");
                          const swappedRouteSet = new Set(swaps.map((s) => s.route_truck));
                          const oosRouteless = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, loadDay, holidayLoad) === "oos" && swappedRouteSet.has(x.truck_number) && x.truck_number !== t.truck_number);
                          const otherTrucks = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, loadDay, holidayLoad) !== "off" && effectiveStatus(x, loadDay, holidayLoad) !== "oos");
                          return (
                            <>
                              {lastUsed.length > 0 && (
                                <optgroup label="Last Used">
                                  {lastUsed.map((x) => (
                                    <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — {x.truck_type === "Spare" ? "Spare" : (x.state?.status ?? "dirty")}</option>
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
                                <optgroup label={`Off — Day ${loadDay}`}>
                                  {offTrucks.map((x) => (
                                    <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — Off</option>
                                  ))}
                                </optgroup>
                              )}
                              {oosRouteless.length > 0 && (
                                <optgroup label="OOS — route covered (available)">
                                  {oosRouteless.map((x) => (
                                    <option key={x.truck_number} value={x.truck_number}>#{x.truck_number} — OOS / route covered</option>
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
                            </>
                          );
                        })()}
                      </select>
                    </div>
                  ))}
                </div>
              )}

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
                      {(() => {
                        const sorted = [...board].sort((a, b) => a.truck_number - b.truck_number);
                        const routeNum = parseInt(swapRoute);
                        const lastUsedNums = !isNaN(routeNum) ? getSwapHistory(routeNum) : [];
                        const lastUsed = lastUsedNums.map((n) => sorted.find((x) => x.truck_number === n)).filter(Boolean) as typeof sorted;
                        const spareTrucks = sorted.filter((t) => t.truck_type === "Spare");
                        const offTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "off");
                        // OOS trucks whose route is already covered are routeless and available
                        const swappedRouteSet = new Set(swaps.map((s) => s.route_truck));
                        const oosRouteless = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swappedRouteSet.has(t.truck_number));
                        const oosUncovered = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swappedRouteSet.has(t.truck_number));
                        const otherTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "off" && effectiveStatus(t, loadDay, holidayLoad) !== "oos");
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
                              <optgroup label={`Off — Day ${loadDay}`}>
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
            );
          })()}

          {/* Step 4: Trucks Not Here */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">What trucks are NOT here?</p>
              <p className="text-center text-xs text-slate-400">Select returning or spare trucks that are absent today.</p>
              {editableSpecialTrucks.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No returning or spare trucks found.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {editableSpecialTrucks.map((t) => (
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
