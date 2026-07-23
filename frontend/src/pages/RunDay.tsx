import { useMemo, useState } from "react";
import clsx from "clsx";
import { Clock, Calendar, Check, ArrowLeftRight } from "lucide-react";
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
  useOpenSpareAssignments,
  usePrevDayCarriers,
  useRouteSwapLog,
  useSettings,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { TruckNote, TruckStatus, TruckWithState } from "../types";
import {
  buildHistoricalCoverageFallback,
  buildOperationalDayContext,
  buildPrevDayCoverage,
  countLoaded,
  countUnloadedFromContext,
  effectiveOperationalStatus,
  effectiveStatus,
  getCoverageRouteNumber,
  isScheduledOff,
  previousWorkday,
  takenOverRouteNumber,
} from "../utils/truckStatus";
import { STATUS_BG, STATUS_TEXT, STATUS_LABELS, DustGarmentIcon } from "./runday/constants";
import { formatRunDate } from "../utils/dates";
import TruckCard from "./runday/TruckCard";

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

  const [unloadCollapsed, setUnloadCollapsed] = useState(
    () => localStorage.getItem("runday:unloadCollapsed") === "1",
  );
  const [loadCollapsed, setLoadCollapsed] = useState(
    () => localStorage.getItem("runday:loadCollapsed") === "1",
  );
  // Shift notes — visible inline on the main page, editable by supervisors+
  const { user } = useAuth();
  const canEditNotes = ["admin", "fleet", "supervisor", "lead", "atl"].includes(user?.role ?? "");
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  const setDailyNotesMutation = useSetDailyNotes();
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  // Shift Notes can be toggled off in Operations settings (default on).
  const { data: settings = [] } = useSettings();
  const shiftNotesEnabled = settings.find((s) => s.key === "shift_notes_enabled")?.value !== false;

  const { data: swapLog = [] } = useRouteSwapLog(60);
  const { data: openSpareAssignments = [] } = useOpenSpareAssignments();

  // Map from route truck number → the truck covering its route today.
  // Includes spare-type trucks (via oos_spare_route or route_swap_route) AND
  // non-spare trucks assigned via a route swap.  Spares are hidden from the
  // grid; non-spare covering trucks still render their own card.
  //
  // Also folds in the read-only historical fallback: an is_oos route truck
  // with no LIVE coverage today (nobody has re-confirmed the swap yet this
  // shift) is still represented by whoever covered it most recently, per the
  // route-swap log — it didn't suddenly become dirty just because today's
  // coverage record lapsed. Matches Board.tsx/the sidebar so all three agree.
  const coveringTruckMap = useMemo(() => {
    const boardByNum = new Map(board.map((t) => [t.truck_number, t]));
    const m = new Map<number, TruckWithState>(
      board
        .filter((t) => t.route_swap_route != null || t.state?.oos_spare_route != null)
        .map((t) => [(t.route_swap_route ?? t.state!.oos_spare_route) as number, t]),
    );
    const fallback = buildHistoricalCoverageFallback(board, openSpareAssignments, swapLog, runDate);
    for (const [route, truckNum] of fallback) {
      if (m.has(route)) continue;
      const cover = boardByNum.get(truckNum);
      if (cover) m.set(route, cover);
    }
    return m;
  }, [board, swapLog, openSpareAssignments, runDate]);

  // The status a card actually displays, used for sorting so the order matches
  // the visible badge:
  //  - an OOS route that's covered reflects its covering truck's status, and
  //  - an "off" truck that physically came back dirty/unloaded shows that
  //    underlying badge (a dirty truck still needs unloading even if it's off
  //    the next load day), so sort it by that — keeping dirty trucks at the top.
  function displayStatusFor(t: TruckWithState, dayNum: number, holiday: boolean, role: "load" | "unload" = "load"): TruckStatus {
    const covRaw = t.state?.status === "oos" ? coveringTruckMap.get(t.truck_number) : undefined;
    // Unload side: only a SPARE cover stands in. A route-truck carrier's
    // same-day coverage describes TOMORROW's load — the covered truck ran
    // its route today and sorts/displays by its own physical state.
    const cov = role === "unload" && covRaw?.truck_type !== "Spare" ? undefined : covRaw;
    const base = cov ?? t;
    const eff = effectiveStatus(base, dayNum, holiday);
    if (eff === "off" && (base.state?.status === "dirty" || base.state?.status === "unloaded")) {
      return base.state.status as TruckStatus;
    }
    return eff;
  }

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
          const sa = displayStatusFor(a, unloadsDay, holidayUnload, "unload");
          const sb = displayStatusFor(b, unloadsDay, holidayUnload, "unload");
          const ka: TruckStatus = sa === "loaded" ? "unloaded" : sa;
          const kb: TruckStatus = sb === "loaded" ? "unloaded" : sb;
          const oa = UNLOAD_SORT[ka] ?? 9;
          const ob = UNLOAD_SORT[kb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, unloadsDay, holidayUnload, coveringTruckMap],
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
          const sa = displayStatusFor(a, loadDay, holidayLoad);
          const sb = displayStatusFor(b, loadDay, holidayLoad);
          const oa = LOAD_SORT[sa] ?? 9;
          const ob = LOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, loadDay, holidayLoad, coveringTruckMap],
  );

  // Unload active trucks = exactly the routes running on unloadsDay per Fleet Schedule.
  // Uses buildOperationalDayContext (same as loadContext) so the count is consistent:
  // one entry per running route (covering spare replaces its OOS route truck).
  const unloadContext = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload ?? false, false, "unload"),
    [board, unloadsDay, holidayUnload],
  );
  const unloadActiveTrucks = unloadContext.activeTrucks;
  const unloadTotal = unloadActiveTrucks.length;
  // Shared counter so pure day-init seeds count as pending, not done —
  // same rule as the sidebar and Load page unload bars. Prev-day carriers
  // credit a covered route once its carrier is unloaded.
  const prevDayCarriers = usePrevDayCarriers(runDate, board);
  const unloadDone = useMemo(
    () => countUnloadedFromContext(unloadContext, prevDayCarriers),
    [unloadContext, prevDayCarriers],
  );
  const unloadSpareCount = unloadActiveTrucks.filter((t) => t.truck_type === "Spare").length;

  // On holiday, two days' worth of routes run in one shift.
  // Unload catches up on the PREVIOUS ship day; load gets ahead on the NEXT
  // ship day. So unload's second day is unloadsDay-1, load's is loadDay+1
  // (matches the sidebar/board "Day N + N+1" load label).
  const unloadsDay2 = previousWorkday(unloadsDay);
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

  // Today's live coverages (shown with the Load section): each route being
  // covered, the truck covering it, whether that's a spare or a route swap.
  const coverages = useMemo(() => {
    const byNum = new Map(board.map((t) => [t.truck_number, t]));
    return [...coveringTruckMap.entries()]
      .map(([routeNum, cover]) => ({
        routeNum,
        routeTruck: byNum.get(routeNum),
        cover,
        kind: (cover.truck_type === "Spare" ? "spare" : "swap") as "spare" | "swap",
        coverStatus: effectiveStatus(cover, loadDay, holidayLoad),
      }))
      .sort((a, b) => a.routeNum - b.routeNum);
  }, [board, coveringTruckMap, loadDay, holidayLoad]);

  // The previous OPERATING day, stepping over the weekend — Monday's unload is
  // Friday's load, so the prior run day is the most recent weekday before today.
  const prevRunDate = useMemo(() => {
    const d = new Date(`${runDate}T12:00:00`);
    do {
      d.setDate(d.getDate() - 1);
    } while (d.getDay() === 0 || d.getDay() === 6); // skip Sun(0)/Sat(6)
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, [runDate]);

  // Previous load-day coverage (shown with the Unload section as a reminder):
  // the trucks being unloaded today were loaded on the prior run day, so surface
  // who covered which route then. Uses the shared buildPrevDayCoverage (same as
  // the Unload page and Note Cards) — coverage from the ACTUAL previous run day
  // only, so a swap from last week can't stick around on days with no coverage.
  const prevCoverage = useMemo(() => buildPrevDayCoverage(swapLog, prevRunDate), [swapLog, prevRunDate]);

  // Lookups so the Unload grid can show each route's covering truck from the
  // PREVIOUS load day (what's being unloaded today was covered then).
  const boardByNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);
  const prevCoverByRoute = useMemo(
    () => new Map(prevCoverage.items.map((c) => [c.route, c.loadOn])),
    [prevCoverage],
  );
  // Covering spares from the previous load day — rendered in place of the route
  // they covered, so drop their standalone card from the unload grid.
  const prevSpareCoverNums = useMemo(() => {
    const s = new Set<number>();
    for (const c of prevCoverage.items) {
      if (boardByNum.get(c.loadOn)?.truck_type === "Spare") s.add(c.loadOn);
    }
    return s;
  }, [prevCoverage, boardByNum]);

  return (
    <>
      {/* Page header — matches PageHeader component style */}
      <div className="border-b border-hairline bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_36%),linear-gradient(180deg,rgba(2,6,23,0.6),rgba(15,23,42,0.4))] px-3 py-3 md:px-6 md:py-4">
        <div>
          <span
            className="hidden md:inline-flex rounded-pill border px-[10px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[#7cc4ff]"
            style={{ borderColor: "rgba(56,189,248,0.22)", background: "rgba(56,189,248,0.10)" }}
          >
            Operations
          </span>
          <h2 className="mt-2 text-3xl font-black leading-none tracking-tight text-indigo-400 md:text-[1.75rem]">
            Day Overview
          </h2>
          <p className="mt-1.5 text-[13.5px] text-ink-muted">
            {formatRunDate(runDate)} · Unload Day {unloadsDay} · Load Day {loadDay}
          </p>
        </div>
      </div>
      <div className="space-y-6 p-4 md:p-6">

      {/* Shift Handoff Notes — toggleable in Operations settings */}
      {shiftNotesEnabled && (dailyNotes || canEditNotes) && (
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
        {/* Reminder: coverage that was in place on the previous load day — the
            loads now being unloaded today were covered by these trucks. */}
        {prevCoverage.items.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                Previous load-day coverage
              </span>
              <span className="text-[10px] text-amber-500/70">({formatRunDate(prevCoverage.date)})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {prevCoverage.items.map((c) => (
                <span
                  key={c.route}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-700/30 bg-slate-900/50 px-2 py-0.5 text-xs"
                >
                  <span className="font-black text-red-300">#{c.route}</span>
                  <ArrowLeftRight className="h-3 w-3 text-slate-600" />
                  <span className="font-black text-amber-200">#{c.loadOn}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {unloadTrucks
            // UNLOAD side: a takeover describes where the NEXT load rides —
            // it doesn't change who ran today. Route-truck carriers therefore
            // render AS THEMSELVES here (their own route ran), and only true
            // Spares (no route of their own) render in place of the route
            // they cover. Dropping any takeover carrier hid #87 entirely and
            // collapsed #4/#62 into their carriers' cards (25 cards vs the
            // 28/28 header, 2026-07-19).
            .filter((t) =>
              !(t.truck_type === "Spare" && getCoverageRouteNumber(t) != null) &&
              !prevSpareCoverNums.has(t.truck_number),
            )
            .map((t) => {
              // Unload reflects the PREVIOUS load day: prefer who covered this
              // route then (if known), falling back to today's coverage.
              const prevCoverNum = prevCoverByRoute.get(t.truck_number);
              const prevCover = prevCoverNum != null ? boardByNum.get(prevCoverNum) : undefined;
              // A truck can be OOS via the is_oos flag while its status reads
              // dirty/unloaded, so substitute whenever coverage exists for the
              // route rather than gating on status === "oos".
              const todayCover = coveringTruckMap.get(t.truck_number);
              const coveringTruck = prevCover ?? todayCover;
              // Only a SPARE cover substitutes on the unload side — a
              // route-truck carrier ran its own route today and renders its
              // own card, so the covered route's truck keeps its slot too.
              const spareCover = coveringTruck?.truck_type === "Spare" ? coveringTruck : undefined;
              const displayTruck = spareCover ?? t;
              const ownRaw = effectiveStatus(displayTruck, unloadsDay, holidayUnload);
              // A non-spare cover's status substitutes ONLY when it covered the
              // PREVIOUS load day (the covered truck genuinely didn't run and
              // its cover's unload progress is its progress). A cover entered
              // TODAY describes tomorrow's load — the covered truck ran today
              // and must show its own pending state (32 cards read done while
              // the bar said 29/32, 2026-07-22).
              const raw = !spareCover && prevCover
                ? effectiveStatus(prevCover, unloadsDay, holidayUnload)
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
                  key={displayTruck.truck_number}
                  t={displayTruck}
                  status={status}
                  done={isUnloadDone(raw)}
                  coveringSpare={spareCover ? undefined : coveringTruck}
                  coversRoute={spareCover ? t.truck_number : undefined}
                  dayNum={truckUnloadDay}
                  isExtraDay={truckUnloadDay === unloadsDay2}
                  notes={notesByTruck.get(displayTruck.truck_number)}
                  context="unload"
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
            Load &mdash; Day {loadDay}{holidayLoad ? ` + ${loadNextDay}` : ""}
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
        {/* Today's live coverages — who is covering which route on this load day. */}
        {coverages.length > 0 && (
          <div className="mb-3 rounded-lg border border-sky-800/40 bg-sky-950/15 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">Coverages</span>
              <span className="rounded-full bg-sky-800/50 px-2 py-0.5 text-[10px] font-bold text-sky-200">{coverages.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {coverages.map((c) => {
                const routeOos = c.routeTruck?.state?.status === "oos" || c.routeTruck?.is_oos;
                return (
                  <div
                    key={c.routeNum}
                    className="flex items-center gap-2 rounded-md border border-sky-800/30 bg-slate-900/50 px-2.5 py-1.5"
                  >
                    <span className="text-sm font-black text-red-400">#{c.routeNum}</span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-red-400/70">
                      {routeOos ? "OOS" : "swap"}
                    </span>
                    <ArrowLeftRight className="h-3 w-3 shrink-0 text-slate-600" />
                    <span className="text-sm font-black text-sky-300">#{c.cover.truck_number}</span>
                    <span className="rounded-full bg-sky-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300 ring-1 ring-sky-700/40">
                      {c.kind === "spare" ? "Spare" : "Route"}
                    </span>
                    <span
                      className={clsx(
                        "ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold text-white",
                        STATUS_BG[c.coverStatus],
                      )}
                    >
                      {STATUS_LABELS[c.coverStatus]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {loadTrucks
            // Covering trucks (ANY type carrying a takeover) are rendered in
            // place of the route they cover (below) — drop the standalone card.
            .filter((t) => takenOverRouteNumber(t) == null)
            .map((t) => {
              // A truck can be OOS via the is_oos flag while its status reads
              // dirty/unloaded, so substitute whenever coverage exists for the
              // route rather than gating on status === "oos".
              const coveringTruck = coveringTruckMap.get(t.truck_number);
              // Once a truck takes over an OOS route (any type), show the
              // cover's card instead of the empty OOS truck.
              const spareCover =
                coveringTruck && takenOverRouteNumber(coveringTruck) === t.truck_number
                  ? coveringTruck
                  : coveringTruck?.truck_type === "Spare" ? coveringTruck : undefined;
              const displayTruck = spareCover ?? t;
              const status = !spareCover && coveringTruck
                ? effectiveStatus(coveringTruck, loadDay, holidayLoad)
                : effectiveStatus(displayTruck, loadDay, holidayLoad);
              const truckLoadDay = holidayLoad
                ? isScheduledOff(t, loadDay) ? loadNextDay : loadDay
                : loadDay;
              return (
                <TruckCard
                  key={displayTruck.truck_number}
                  t={displayTruck}
                  status={status}
                  done={isLoadDone(status)}
                  coveringSpare={spareCover ? undefined : coveringTruck}
                  coversRoute={spareCover ? t.truck_number : undefined}
                  dayNum={truckLoadDay}
                  isExtraDay={truckLoadDay === loadNextDay}
                  notes={notesByTruck.get(displayTruck.truck_number)}
                  context="load"
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
