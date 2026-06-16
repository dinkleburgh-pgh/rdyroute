import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { Clock, Calendar, Check } from "lucide-react";
import {
  useBoard,
  useDailyNotes,
  useHolidayLoad,
  useHolidayUnload,
  useSetDailyNotes,
  useUpsertTruckState,
  useLoadDayOverride,
  useUnloadsDayOverride,
  useTruckNotes,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { TruckNote, TruckStatus, TruckWithState } from "../types";
import {
  buildOperationalDayContext,
  countLoaded,
  countUnloadedFromContext,
  effectiveOperationalStatus,
  effectiveStatus,
  isScheduledOff,
} from "../utils/truckStatus";
import { STATUS_BG, STATUS_TEXT, STATUS_LABELS, DustGarmentIcon } from "./runday/constants";
import TruckCard from "./runday/TruckCard";
import RunDayWizard from "./runday/RunDayWizard";

const UNLOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, unfinished: 1, shop: 2, in_progress: 3, unloaded: 4, loaded: 5, oos: 6, off: 7,
};
const LOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, unfinished: 1, unloaded: 2, shop: 3, in_progress: 4, loaded: 5, oos: 6, off: 7,
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
  const { data: allNotes = [] } = useTruckNotes({ activeOnly: true });
  const today = todayIso();
  const notesByTruck = useMemo(() => {
    const map = new Map<number, TruckNote[]>();
    for (const n of allNotes) {
      if (!n.is_active) continue;
      if (n.note_type === "one_off" && n.expires_on && n.expires_on < today) continue;
      const arr = map.get(n.truck_number) ?? [];
      arr.push(n);
      map.set(n.truck_number, arr);
    }
    return map;
  }, [allNotes, today]);
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

  // Shift notes — visible inline on the main page, editable by supervisors+
  const { user } = useAuth();
  const canEditNotes = ["admin", "fleet", "supervisor", "lead", "atl"].includes(user?.role ?? "");
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  const setDailyNotesMutation = useSetDailyNotes();
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const unloadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
            (holidayUnload || !isScheduledOff(t, unloadsDay)),
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
            (holidayLoad || !isScheduledOff(t, loadDay)),
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

  const unloadContext = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload, true),
    [board, unloadsDay, holidayUnload],
  );
  const unloadTotal = unloadContext.activeTrucks.length;
  const unloadDone = useMemo(
    () => countUnloadedFromContext(unloadContext),
    [unloadContext],
  );
  const unloadSpareCount = unloadContext.activeTrucks.filter((t) => t.truck_type === "Spare").length;

  // On holiday, two days' worth of routes are loaded/unloaded in one shift.
  // The "second" day is the PREVIOUS ship day (Mon → Fri wraps back).
  const loadDay2 = loadDay === 1 ? 5 : loadDay - 1;
  const unloadsDay2 = unloadsDay === 1 ? 5 : unloadsDay - 1;
  // Trucks off on loadDay (the normal load day) OR the day after (the holiday-affected next day)
  // are both treated as the Day 3 catch-up batch in holiday load mode.
  const loadNextDay = loadDay === 5 ? 1 : loadDay + 1;

  const loadContext = useMemo(
    () => buildOperationalDayContext(board, loadDay, holidayLoad, false),
    [board, loadDay, holidayLoad],
  );
  const loadTotal = loadContext.activeTrucks.length;
  const loadDone = useMemo(
    () => countLoaded(board, loadDay, holidayLoad, unloadsDay, holidayUnload),
    [board, loadDay, unloadsDay, holidayLoad, holidayUnload],
  );
  const loadSpareCount = loadContext.activeTrucks.filter((t) => t.truck_type === "Spare").length;

  // Map from route truck number → the truck covering its route today.
  // Includes spare-type trucks (via oos_spare_route or route_swap_route) AND
  // non-spare trucks assigned via a route swap.  Spares are hidden from the
  // grid; non-spare covering trucks still render their own card.
  const coveringTruckMap = useMemo(
    () =>
      new Map<number, TruckWithState>(
        board
          .filter((t) => t.route_swap_route != null || t.state?.oos_spare_route != null)
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

      {/* Shift Handoff Notes */}
      {(dailyNotes || canEditNotes) && (
        <div className={clsx(
          "rounded-xl border px-4 py-3",
          dailyNotes
            ? "border-amber-700/40 bg-amber-950/20"
            : "border-slate-700/40 bg-slate-800/20",
        )}>
          <div className="mb-1.5 flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">Shift Notes</span>
            {canEditNotes && !notesEditing && (
              <button
                type="button"
                onClick={() => { setNotesDraft(dailyNotes); setNotesEditing(true); }}
                className="ml-auto rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
              >
                Edit
              </button>
            )}
          </div>
          {notesEditing ? (
            <div className="space-y-2">
              <textarea
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                rows={3}
                placeholder="Add shift handoff notes for the next team…"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={setDailyNotesMutation.isPending}
                  onClick={async () => {
                    await setDailyNotesMutation.mutateAsync({ runDate, notes: notesDraft });
                    setNotesEditing(false);
                  }}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setNotesEditing(false)}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : dailyNotes ? (
            <p className="whitespace-pre-wrap text-sm text-amber-100/90">{dailyNotes}</p>
          ) : (
            <p className="text-xs text-slate-500 italic">No shift notes for today. Click Edit to add.</p>
          )}
        </div>
      )}

      <section>
        <button
          type="button"
          onClick={() => setUnloadCollapsed((c) => { const next = !c; localStorage.setItem("runday:unloadCollapsed", next ? "1" : "0"); return next; })}
          className="mb-3 flex min-h-[44px] w-full items-center gap-3 text-left"
        >
          <Calendar
            className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", unloadCollapsed && "-rotate-90")}
          />
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
            // Spare-type covering trucks are absorbed into their OOS route truck's card.
            .filter((t) => !(t.truck_type === "Spare" && (t.route_swap_route != null || t.state?.oos_spare_route != null)))
            .map((t) => {
              const coveringTruck =
                t.state?.status === "oos" ? coveringTruckMap.get(t.truck_number) : undefined;
              const ownRaw = effectiveStatus(t, unloadsDay, holidayUnload);
              // When OOS and covered, reflect the covering truck's lifecycle status.
              const raw = coveringTruck
                ? effectiveStatus(coveringTruck, unloadsDay, holidayUnload)
                : ownRaw;
              // The unload lifecycle ends at "Unloaded". Once a truck moves on
              // to "Loaded" (start of the load lifecycle), keep displaying it
              // as Unloaded here so the unload board doesn't flip its badge.
              const status: TruckStatus = raw === "loaded" ? "unloaded" : raw;
              const truckUnloadDay = holidayUnload
                ? isScheduledOff(t, unloadsDay) ? unloadsDay2 : unloadsDay
                : unloadsDay;
              return (
                <TruckCard
                  key={t.truck_number}
                  t={t}
                  status={status}
                  done={isUnloadDone(raw)}
                  coveringSpare={coveringTruck}
                  dayNum={truckUnloadDay}
                  isExtraDay={truckUnloadDay === unloadsDay2}
                  notes={notesByTruck.get(t.truck_number)}
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
          <Check
            className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", loadCollapsed && "-rotate-90")}
          />
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
            // Spare-type covering trucks are absorbed into their OOS route truck's card.
            .filter((t) => !(t.truck_type === "Spare" && (t.route_swap_route != null || t.state?.oos_spare_route != null)))
            .map((t) => {
              const coveringTruck =
                t.state?.status === "oos" ? coveringTruckMap.get(t.truck_number) : undefined;
              // When OOS and covered, reflect the covering truck's lifecycle status.
              const status = coveringTruck
                ? effectiveStatus(coveringTruck, loadDay, holidayLoad)
                : effectiveStatus(t, loadDay, holidayLoad);
              const truckLoadDay = holidayLoad
                ? (isScheduledOff(t, loadDay) || isScheduledOff(t, loadNextDay)) ? loadDay2 : loadDay
                : loadDay;
              return (
                <TruckCard
                  key={t.truck_number}
                  t={t}
                  status={status}
                  done={isLoadDone(status)}
                  coveringSpare={coveringTruck}
                  dayNum={truckLoadDay}
                  isExtraDay={truckLoadDay === loadDay2}
                  notes={notesByTruck.get(t.truck_number)}
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
