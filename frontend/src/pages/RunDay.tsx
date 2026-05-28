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
  useLoadDayOverride,
  useUnloadsDayOverride,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { TruckStatus, TruckWithState } from "../types";
import { effectiveStatus } from "../utils/truckStatus";

// Filled t-shirt silhouette — matches Board/Load pages.
function DustGarmentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="currentColor"
      stroke="none"
    >
      <path d="M11 4c.4 1.7 2.2 3 5 3s4.6-1.3 5-3l5.5 2.5a1 1 0 0 1 .5 1.3l-2 5a1 1 0 0 1-1.3.5L21 11.6V27a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V11.6l-2.7 1.7a1 1 0 0 1-1.3-.5l-2-5a1 1 0 0 1 .5-1.3L11 4z" />
    </svg>
  );
}

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

function isUnloadDone(s: TruckStatus) {
  return s === "unloaded" || s === "loaded";
}
function isLoadDone(s: TruckStatus) {
  return s === "loaded";
}

export default function RunDay() {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const { loadDay: computedLoadDay, unloadsDay: computedUnloadsDay } = workdayNumbers();
  const { data: loadDayOverride }    = useLoadDayOverride(runDate);
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const loadDay    = loadDayOverride    ?? computedLoadDay;
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [unloadCollapsed, setUnloadCollapsed] = useState(
    () => localStorage.getItem("runday:unloadCollapsed") === "1",
  );
  const [loadCollapsed, setLoadCollapsed] = useState(
    () => localStorage.getItem("runday:loadCollapsed") === "1",
  );
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
            (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
            (holidayUnload || !t.scheduled_off_days.includes(unloadsDay)),
        )
        .sort((a, b) => {
          // Clamp loaded→unloaded in unload sort: from this section's POV,
          // "loaded" is just a downstream state of "unloaded".
          const sa = effectiveStatus(a, unloadsDay, holidayUnload);
          const sb = effectiveStatus(b, unloadsDay, holidayUnload);
          const ka: TruckStatus = sa === "loaded" ? "unloaded" : sa;
          const kb: TruckStatus = sb === "loaded" ? "unloaded" : sb;
          const oa = UNLOAD_SORT[ka] ?? 9;
          const ob = UNLOAD_SORT[kb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    [board, unloadsDay, holidayUnload],
  );

  const loadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
            (holidayLoad || !t.scheduled_off_days.includes(loadDay)),
        )
        .sort((a, b) => {
          const sa = effectiveStatus(a, loadDay, holidayLoad);
          const sb = effectiveStatus(b, loadDay, holidayLoad);
          const oa = LOAD_SORT[sa] ?? 9;
          const ob = LOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    [board, loadDay, holidayLoad],
  );

  // Unload progress counts ROUTES, not trucks (same as Load). A spare covering
  // an OOS truck's route returns to unload in that route's slot.
  const unloadRouteTrucks = useMemo(
    () => unloadTrucks.filter((t) => t.truck_type !== "Spare"),
    [unloadTrucks],
  );
  const unloadedSpareRoutes = useMemo(
    () =>
      new Set(
        unloadTrucks
          .filter(
            (t) =>
              t.truck_type === "Spare" &&
              (t.route_swap_route != null || t.state?.oos_spare_route != null) &&
              isUnloadDone(effectiveStatus(t, unloadsDay, holidayUnload)),
          )
          .map((t) => (t.route_swap_route ?? t.state!.oos_spare_route) as number),
      ),
    [unloadTrucks, unloadsDay, holidayUnload],
  );
  const unloadTotal = unloadRouteTrucks.length;
  const unloadDone = unloadRouteTrucks.filter(
    (t) =>
      isUnloadDone(effectiveStatus(t, unloadsDay, holidayUnload)) ||
      unloadedSpareRoutes.has(t.truck_number),
  ).length;
  const unloadSpareCount = unloadTrucks.length - unloadRouteTrucks.length;

  // On holiday, two days' worth of routes are loaded/unloaded in one shift.
  // The "second" day is the PREVIOUS ship day (Mon → Fri wraps back).
  const loadDay2 = loadDay === 1 ? 5 : loadDay - 1;
  const unloadsDay2 = unloadsDay === 1 ? 5 : unloadsDay - 1;
  // Trucks off on loadDay (the normal load day) OR the day after (the holiday-affected next day)
  // are both treated as the Day 3 catch-up batch in holiday load mode.
  const loadNextDay = loadDay === 5 ? 1 : loadDay + 1;

  // Load progress counts ROUTES, not trucks. A spare covering an OOS truck's
  // route fills the same slot — it must not double-count against the total,
  // and a loaded spare marks its covered route as done.
  const loadRouteTrucks = useMemo(
    () => loadTrucks.filter((t) => t.truck_type !== "Spare"),
    [loadTrucks],
  );
  const loadedSpareRoutes = useMemo(
    () =>
      new Set(
        loadTrucks
          .filter(
            (t) =>
              t.truck_type === "Spare" &&
              (t.route_swap_route != null || t.state?.oos_spare_route != null) &&
              isLoadDone(effectiveStatus(t, loadDay, holidayLoad)),
          )
          .map((t) => (t.route_swap_route ?? t.state!.oos_spare_route) as number),
      ),
    [loadTrucks, loadDay, holidayLoad],
  );
  const loadTotal = loadRouteTrucks.length;
  const loadDone = loadRouteTrucks.filter(
    (t) =>
      isLoadDone(effectiveStatus(t, loadDay, holidayLoad)) ||
      loadedSpareRoutes.has(t.truck_number),
  ).length;
  const loadSpareCount = loadTrucks.length - loadRouteTrucks.length;

  // Map from route truck number → the spare that is covering it, for annotating
  // OOS truck cards without rendering a separate spare card.
  const coveringSpareMap = useMemo(
    () =>
      new Map<number, TruckWithState>(
        board
          .filter((t) => t.truck_type === "Spare" && (t.route_swap_route != null || t.state?.oos_spare_route != null))
          .map((t) => [(t.route_swap_route ?? t.state!.oos_spare_route) as number, t]),
      ),
    [board],
  );

  return (
    <>
      {wizardOpen && (
        <RunDayWizard
          runDate={runDate}
          board={board}
          loadDay={loadDay}
          unloadsDay={unloadsDay}
          onClose={() => setWizardOpen(false)}
        />
      )}
      <div className="space-y-6 p-4 md:p-6">
      {/* Page header */}
      <div className="text-center">
        <h2 className="text-3xl font-black tracking-tight text-indigo-400">Day Overview</h2>
        <p className="mx-auto mt-1.5 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-0.5 text-xs font-semibold text-slate-300">
          {runDate}
        </p>
      </div>
      <section>
        <button
          type="button"
          onClick={() => setUnloadCollapsed((c) => { const next = !c; localStorage.setItem("runday:unloadCollapsed", next ? "1" : "0"); return next; })}
          className="mb-3 flex min-h-[44px] w-full items-center gap-3 text-left"
        >
          <svg
            className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", unloadCollapsed && "-rotate-90")}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <h2 className="w-44 shrink-0 text-lg font-semibold text-slate-200">
            Unload &mdash; Day {holidayUnload ? `${unloadsDay2} + ` : ""}{unloadsDay}
          </h2>
          <span className="w-24 shrink-0 text-sm text-slate-400">
            {unloadDone} / {unloadTotal} done
            {unloadSpareCount > 0 && (
              <span className="ml-1 text-slate-500">· {unloadSpareCount} spare{unloadSpareCount === 1 ? "" : "s"}</span>
            )}
          </span>
          {unloadTotal > 0 && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((unloadDone / unloadTotal) * 100)}%` }}
              />
            </div>
          )}
        </button>
        <div
          style={{
            display: "grid",
            gridTemplateRows: unloadCollapsed ? "0fr" : "1fr",
            transition: "grid-template-rows 220ms ease",
          }}
        >
        <div style={{ overflow: "hidden" }}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {unloadTrucks
            // Covering spares are absorbed into their OOS route truck's card.
            .filter((t) => !(t.truck_type === "Spare" && (t.route_swap_route != null || t.state?.oos_spare_route != null)))
            .map((t) => {
              const coveringSpare =
                t.state?.status === "oos" ? coveringSpareMap.get(t.truck_number) : undefined;
              const ownRaw = effectiveStatus(t, unloadsDay, holidayUnload);
              // When OOS and covered, reflect the spare's lifecycle status.
              const raw = coveringSpare
                ? effectiveStatus(coveringSpare, unloadsDay, holidayUnload)
                : ownRaw;
              // The unload lifecycle ends at "Unloaded". Once a truck moves on
              // to "Loaded" (start of the load lifecycle), keep displaying it
              // as Unloaded here so the unload board doesn't flip its badge.
              const status: TruckStatus = raw === "loaded" ? "unloaded" : raw;
              const truckUnloadDay = holidayUnload
                ? (t.scheduled_off_days ?? []).includes(unloadsDay) ? unloadsDay2 : unloadsDay
                : undefined;
              return (
                <TruckCard
                  key={t.truck_number}
                  t={t}
                  status={status}
                  done={isUnloadDone(raw)}
                  coveringSpare={coveringSpare}
                  dayNum={truckUnloadDay}
                  isExtraDay={truckUnloadDay === unloadsDay2}
                />
              );
            })}
        </div>
        </div>
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => setLoadCollapsed((c) => { const next = !c; localStorage.setItem("runday:loadCollapsed", next ? "1" : "0"); return next; })}
          className="mb-3 flex min-h-[44px] w-full items-center gap-3 text-left"
        >
          <svg
            className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", loadCollapsed && "-rotate-90")}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <h2 className="w-44 shrink-0 text-lg font-semibold text-slate-200">
            Load &mdash; Day {holidayLoad ? `${loadDay2} + ` : ""}{loadDay}
          </h2>
          <span className="w-24 shrink-0 text-sm text-slate-400">
            {loadDone} / {loadTotal} done
            {loadSpareCount > 0 && (
              <span className="ml-1 text-slate-500">&middot; {loadSpareCount} spare{loadSpareCount === 1 ? "" : "s"}</span>
            )}
          </span>
          {loadTotal > 0 && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.round((loadDone / loadTotal) * 100)}%` }}
              />
            </div>
          )}
        </button>
        <div
          style={{
            display: "grid",
            gridTemplateRows: loadCollapsed ? "0fr" : "1fr",
            transition: "grid-template-rows 220ms ease",
          }}
        >
        <div style={{ overflow: "hidden" }}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {loadTrucks
            // Covering spares are absorbed into their OOS route truck's card.
            .filter((t) => !(t.truck_type === "Spare" && (t.route_swap_route != null || t.state?.oos_spare_route != null)))
            .map((t) => {
              const coveringSpare =
                t.state?.status === "oos" ? coveringSpareMap.get(t.truck_number) : undefined;
              // When OOS and covered, reflect the spare's lifecycle status.
              const status = coveringSpare
                ? effectiveStatus(coveringSpare, loadDay, holidayLoad)
                : effectiveStatus(t, loadDay, holidayLoad);
              const offDaysLoad = t.scheduled_off_days ?? [];
              const truckLoadDay = holidayLoad
                ? (offDaysLoad.includes(loadDay) || offDaysLoad.includes(loadNextDay)) ? loadDay2 : loadDay
                : undefined;
              return (
                <TruckCard
                  key={t.truck_number}
                  t={t}
                  status={status}
                  done={isLoadDone(status)}
                  coveringSpare={coveringSpare}
                  dayNum={truckLoadDay}
                  isExtraDay={truckLoadDay === loadDay2}
                />
              );
            })}
        </div>
        </div>
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
  coveringSpare,
  dayNum,
  isExtraDay,
}: {
  t: TruckWithState;
  status: TruckStatus;
  done: boolean;
  coveringSpare?: TruckWithState;
  dayNum?: number;
  isExtraDay?: boolean;
}) {
  return (
    <div
      className={clsx(
        "card relative flex flex-col items-center gap-1.5 p-3 text-center transition-opacity",
        done && "opacity-40",
        status === "in_progress" && "animate-pulse ring-2 ring-amber-400",
      )}
    >
      {t.truck_type === "Dust" && t.state?.has_dust_garment && (
        <span
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-full border border-amber-500/60 bg-amber-950/70 p-0.5"
          title="Garments assigned"
        >
          <DustGarmentIcon className="h-3.5 w-3.5 text-amber-300" />
        </span>
      )}
      <span
        className={clsx(
          "text-4xl font-extrabold tabular-nums leading-none",
          STATUS_TEXT[status],
        )}
      >
        {t.truck_number}
      </span>
      <span
        className={clsx(
          "rounded px-1.5 py-0.5 text-xs font-semibold text-white",
          STATUS_BG[status],
        )}
      >
        {STATUS_LABELS[status]}
      </span>
      <span className="text-xs text-slate-500">
        {t.truck_type}
        {coveringSpare && (
          <span className="text-sky-400"> · #{coveringSpare.truck_number}</span>
        )}
      </span>
      {dayNum != null && (
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            isExtraDay
              ? "bg-amber-900/60 text-amber-300"
              : "bg-blue-900/60 text-blue-300",
          )}
        >
          Day {dayNum}
        </span>
      )}
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
    (t) => t.truck_type !== "Spare" && !(t.scheduled_off_days ?? []).includes(loadDay),
  ).length;
  const loadExtra = board.filter(
    (t) => t.truck_type !== "Spare" && (t.scheduled_off_days ?? []).includes(loadDay),
  ).length;
  const unloadBase = board.filter(
    (t) => t.truck_type !== "Spare" && !(t.scheduled_off_days ?? []).includes(unloadsDay),
  ).length;
  const unloadExtra = board.filter(
    (t) => t.truck_type !== "Spare" && (t.scheduled_off_days ?? []).includes(unloadsDay),
  ).length;
  const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
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
  // Per-OOS-truck "load on" selections (auto-saved when set)
  const [oosLoadOns, setOosLoadOns] = useState<Record<number, string>>({});

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

  async function addOosSwap(routeTruck: number, loadOnTruck: number) {
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: routeTruck, load_on_truck: loadOnTruck, two_way: false });
      setOosLoadOns((prev) => { const n = { ...prev }; delete n[routeTruck]; return n; });
    } catch (err: unknown) {
      // leave selection in place so user can retry or adjust
      console.error("OOS swap save failed", err);
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
          {step === 3 && (() => {
            // OOS trucks that don't yet have a swap assigned
            const swappedRoutes = new Set(swaps.map((s) => s.route_truck));
            const unswappedOos = board.filter(
              (t) => t.truck_type !== "Spare" && t.state?.status === "oos" && !swappedRoutes.has(t.truck_number),
            ).sort((a, b) => a.truck_number - b.truck_number);
            const sortedSpares = board.filter((t) => t.truck_type === "Spare").sort((a, b) => a.truck_number - b.truck_number);
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
                        {sortedSpares.map((s) => (
                          <option key={s.truck_number} value={s.truck_number}>
                            #{s.truck_number} — Spare
                          </option>
                        ))}
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
                        const spareTrucks = sorted.filter((t) => t.truck_type === "Spare");
                        const offTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "off");
                        // OOS trucks whose route is already covered are routeless and available
                        const swappedRouteSet = new Set(swaps.map((s) => s.route_truck));
                        const oosRouteless = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swappedRouteSet.has(t.truck_number));
                        const oosUncovered = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swappedRouteSet.has(t.truck_number));
                        const otherTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "off" && effectiveStatus(t, loadDay, holidayLoad) !== "oos");
                        return (
                          <>
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
