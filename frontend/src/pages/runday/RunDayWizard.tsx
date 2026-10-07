/**
 * Run Day Wizard (5-step Setup Day modal). Extracted from RunDay.tsx.
 *
 * Steps: Run Mode → Garments & NOGs → Route Swaps → Trucks Not Here → Daily Notes.
 */
import { useState, useMemo } from "react";
import clsx from "clsx";
import {
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useDailyNotes,
  useHolidayLoad,
  useHolidayMode,
  useHolidayUnload,
  useRouteSwaps,
  useSpareAssignments,
  useDeleteSpare,
  useSetDailyNotes,
  useSetHolidayLoad,
  useSetHolidayMode,
  useSetHolidayUnload,
  useSetWizardCompleted,
  usePrevDayCarriers,
  usePrevDaySplitHelpers,
  useUpsertSetting,
  useUpsertTruckState,
} from "../../api/hooks";
import { useApplyDayGap, useDayGap } from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { format } from "date-fns";
import { workdayNumbers } from "../../components/Clock";
import { useToast } from "../../contexts/ToastContext";
import type { TruckWithState } from "../../types";
import { effectiveStatus, getCoverageRouteNumber, getSwapHistory, isScheduledOff, previousWorkday, recordSwapHistory } from "../../utils/truckStatus";
import { errorDetail } from "../../api/errors";
import Modal from "../../components/Modal";
import { ChipGroup, StepHeading, WizardFooter, WizardHeader } from "./wizard/parts";
import { RAN_AHEAD, addNoteToken, hasRanAhead, removeNoteToken } from "../../utils/offNote";

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
  const toast = useToast();
  const { user } = useAuth();
  // Mirrors the backend's _ADMIN_ROLES gate on POST /trucks/day-gap.
  const canApplyGap = ["admin", "fleet", "supervisor"].includes(user?.role ?? "");
  // Unlogged workdays since the last day the app was used. Unmarked days count
  // as normal run days (trucks come back dirty per the schedule); marking one
  // closed and applying reseeds today's board with that day skipped.
  const { data: dayGap } = useDayGap(runDate);
  const applyDayGap = useApplyDayGap();
  const gapDays = dayGap?.gap_days ?? [];
  const [closedPicks, setClosedPicks] = useState<Set<string> | null>(null);
  const pickedClosed = closedPicks ?? new Set(gapDays.filter((d) => d.closed).map((d) => d.date));
  function toggleClosed(iso: string) {
    const next = new Set(pickedClosed);
    if (next.has(iso)) next.delete(iso); else next.add(iso);
    setClosedPicks(next);
  }
  const gapDirty =
    closedPicks != null &&
    (gapDays.some((d) => pickedClosed.has(d.date) !== d.closed));
  async function applyGap() {
    try {
      const res = await applyDayGap.mutateAsync({
        run_date: runDate,
        closed_dates: [...pickedClosed],
      });
      setClosedPicks(null);
      if (res.reseeded) toast.success("Closed days saved — today's board reseeded.");
      else if (res.reason === "day-already-worked")
        toast.push("Closed days saved, but today already has work on it — use Management → Reset Day to rebuild.", "info");
      else toast.success("Closed days saved.");
    } catch {
      // The global mutation onError already toasts the failure — this catch
      // only stops the rejection from bubbling out of the click handler.
    }
  }
  const gapDayLabel = (iso: string) => format(new Date(`${iso}T12:00:00`), "EEE MMM d");
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
  // OOS trucks are still counted — a scheduled route always runs (it gets
  // covered), so excluding OOS would undercount the routes (e.g. 27 vs 28).
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

  // NOGs — trucks sending Not-Our-Garments back out today. Set at the start
  // of the day like the F.S. garments; the Load page strip then tracks them
  // out the door. Any active route truck qualifies; a flagged spare (from the
  // status sheet) stays visible so it can be cleared here too.
  const nogsCandidates = useMemo(
    () =>
      board
        .filter((t) => t.is_active && (t.truck_type !== "Spare" || t.state?.has_nogs === true))
        .sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );
  const [nogsSelected, setNogsSelected] = useState<Set<number> | null>(null);
  const nogsPicked =
    nogsSelected ??
    new Set(nogsCandidates.filter((t) => t.state?.has_nogs === true).map((t) => t.truck_number));
  function toggleNogs(num: number) {
    const next = new Set(nogsPicked);
    if (next.has(num)) next.delete(num); else next.add(num);
    setNogsSelected(next);
  }

  const { data: swaps = [] } = useRouteSwaps(runDate);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate);
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const returnSpare = useDeleteSpare();

  // Active coverages, unioned across EVERY source so none are missed:
  //  - the board's resolved coverage for the current run day (route_swap_route /
  //    oos_spare_route) — reflects recurring rules and the day rollover,
  //  - the raw route_swaps (Setup Day mechanism), and
  //  - the non-returned spare_assignments (the Route Swaps modal's source).
  // Deduped by route→load; each row keeps whatever underlying ids exist so the
  // ✕ clears the right record(s). A board-only coverage with no raw id can't be
  // removed here, but it still shows so the list is never short.
  const coverages = useMemo(() => {
    const out: { key: string; route_truck: number; load_on_truck: number; swapId?: number; spareId?: number; split?: boolean }[] = [];
    const upsert = (route: number, load: number, patch: { swapId?: number; spareId?: number; split?: boolean }) => {
      const ex = out.find((o) => o.route_truck === route && o.load_on_truck === load);
      if (ex) Object.assign(ex, patch);
      else out.push({ key: `cov-${route}-${load}`, route_truck: route, load_on_truck: load, ...patch });
    };
    for (const t of board) {
      const route = t.route_swap_route ?? t.state?.oos_spare_route;
      if (route != null) upsert(route, t.truck_number, {});
    }
    for (const s of swaps) upsert(s.route_truck, s.load_on_truck, { swapId: s.id, split: s.is_split === true });
    for (const a of spareAssignments.filter((a) => !a.returned)) upsert(a.covering_route_truck, a.spare_truck_number, { spareId: a.id });
    return out.sort((a, b) => a.route_truck - b.route_truck);
  }, [board, swaps, spareAssignments]);
  const coveredRouteSet = useMemo(() => new Set(coverages.map((c) => c.route_truck)), [coverages]);
  const [swapRoute, setSwapRoute] = useState<string>("");
  const [swapLoadOn, setSwapLoadOn] = useState<string>("");
  // Split load: the route truck still RUNS — the helper only carries its
  // overflow. Same createSwap call, split flag on (the Route Swaps modal's
  // old checkbox, restored here after the wizard redesign dropped it).
  const [swapSplit, setSwapSplit] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  // Per-OOS-truck "load on" selections (auto-saved when set)
  const [oosLoadOns, setOosLoadOns] = useState<Record<number, string>>({});

  const { loadDay: todayLoad } = workdayNumbers(new Date(`${runDate}T12:00:00`));
  // "Yesterday" must skip plant-closed gap days: a truck scheduled off on a
  // closed day's number never sat out a run day at all, so the returning-
  // trucks list would otherwise clean trucks that are genuinely dirty.
  const prevDay = useMemo(() => {
    let d = previousWorkday(todayLoad);
    for (const g of gapDays) if (g.closed) d = previousWorkday(d);
    return d;
  }, [todayLoad, gapDays]);

  // Trucks that physically RAN yesterday despite being off the schedule —
  // because they carried someone else's route, or took a split's overflow.
  // The swap log is the only record: the live board carries no marker the
  // morning after.
  const prevCarriers = usePrevDayCarriers(runDate, board);
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const ranYesterday = useMemo(() => {
    const s = new Set<number>(prevSplitHelpers);
    for (const carrier of prevCarriers.values()) s.add(carrier.truck_number);
    return s;
  }, [prevCarriers, prevSplitHelpers]);

  // "Returning" = off yesterday, on today, so it comes back clean. That's only
  // true if it actually SAT yesterday. A truck off the schedule that still ran
  // coverage or a split came back dirty like any other, and cleaning it here
  // erased real unload work (55 as a split helper and 57 covering route 7 were
  // both wiped this way on 2026-07-30).
  const returningTrucks = board.filter(
    (t) =>
      t.truck_type !== "Spare" &&
      isScheduledOff(t, prevDay) &&
      !isScheduledOff(t, loadDay) &&
      !ranYesterday.has(t.truck_number),
  );
  const spareTrucks = board.filter((t) => t.truck_type === "Spare");
  const specialTrucks = [...returningTrucks, ...spareTrucks].filter(
    (t, i, arr) => arr.findIndex((x) => x.truck_number === t.truck_number) === i,
  );
  const editableDustTrucks = dustTrucks;
  const editableSpecialTrucks = specialTrucks;
  const [absentSelected, setAbsentSelected] = useState<Set<number>>(new Set());
  // "Ran ahead" — trucks skipping TONIGHT'S load (holiday weeks run trucks on
  // their off days, so their next load is already done). Seeded from the
  // sentinel so re-running Setup Day shows what's already flagged.
  const ranAheadCandidates = useMemo(
    () =>
      board
        .filter(
          (t) =>
            // A flagged truck ALWAYS shows, whatever else it is — this grid
            // must be able to clear a wrong flag. (Truck 75 got flagged while
            // carrying a route via recurring coverage, and the carrier
            // exclusion below made the flag uncleatable here.)
            hasRanAhead(t.state?.off_note) ||
            (t.truck_type !== "Spare" &&
              t.is_active &&
              getCoverageRouteNumber(t) == null &&
              (holidayLoad || !isScheduledOff(t, loadDay)) &&
              ["unloaded", "dirty", "unfinished"].includes(t.state?.status ?? "")),
        )
        .sort((a, b) => a.truck_number - b.truck_number),
    [board, holidayLoad, loadDay],
  );
  const [ranAheadSelected, setRanAheadSelected] = useState<Set<number> | null>(null);
  const ranAheadPicked =
    ranAheadSelected ??
    new Set(ranAheadCandidates.filter((t) => hasRanAhead(t.state?.off_note)).map((t) => t.truck_number));
  function toggleRanAhead(num: number) {
    const next = new Set(ranAheadPicked);
    if (next.has(num)) next.delete(num); else next.add(num);
    setRanAheadSelected(next);
  }

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
    const tasks: Promise<unknown>[] = editableDustTrucks.map((t) =>
      upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        has_dust_garment: dustSelected.has(t.truck_number),
        state_source: "wizard",
      }),
    );
    // NOGs: delta-only writes — the grid spans the whole fleet, and stamping
    // forty untouched rows "wizard" would make every day look human-edited.
    if (nogsSelected != null) {
      for (const t of nogsCandidates) {
        const was = t.state?.has_nogs === true;
        const now = nogsPicked.has(t.truck_number);
        if (was === now) continue;
        tasks.push(upsert.mutateAsync({
          truck_number: t.truck_number,
          run_date: runDate,
          has_nogs: now,
          // Echo the current status so the create fallback on a row-less truck
          // can't invent a status change through a flag-only write.
          ...(t.state ? { status: t.state.status, wearers: t.state.wearers } : {}),
          state_source: "wizard",
        }));
      }
    }
    await Promise.all(tasks);
    setStep(3);
  }

  async function addSwap() {
    const rt = parseInt(swapRoute);
    const lo = parseInt(swapLoadOn);
    if (isNaN(rt) || isNaN(lo)) { setSwapError("Enter valid truck numbers."); return; }
    if (rt === lo) { setSwapError("Route truck and load-on truck must be different."); return; }
    setSwapError(null);
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: rt, load_on_truck: lo, two_way: false, split: swapSplit });
      recordSwapHistory(rt, lo);
      setSwapRoute("");
      setSwapLoadOn("");
      setSwapSplit(false);
    } catch (err: unknown) {
            setSwapError(errorDetail(err) ?? "Failed to save swap.");
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
    // Absent trucks: raise Needs Checked and touch NOTHING else.
    //
    // This used to park them at "unloaded" (spares at "spare"), which closed
    // the job before anyone had been near the truck — it dropped out of the
    // crew's work list and out of the unload denominator, and the only thing
    // left pointing at it was a badge nobody was hunting for. It also cost
    // real load work: truck 88 went loaded -> unloaded through here on
    // 2026-07-16 and had to be put back by hand.
    //
    // Saying "this truck isn't here yet" is an observation, not a decision
    // about where it is in its day, so the status stays exactly as it was and
    // the flag does the talking.
    for (const num of absentSelected) {
      const truck = specialTrucks.find((t) => t.truck_number === num);
      if (!truck) continue;
      tasks.push(upsert.mutateAsync({
        truck_number: num,
        run_date: runDate,
        needs_checked: true,
        // Echo the CURRENT status rather than omitting it: on the rare truck
        // with no row yet, the create fallback would otherwise default the row
        // to "dirty" — inventing a status change through the one path that is
        // supposed to make none. A spare with no row gets "spare" for the same
        // reason (dirty would invent unload work it never had).
        ...(truck.state
          ? { status: truck.state.status, wearers: truck.state.wearers }
          : truck.truck_type === "Spare"
            ? { status: "spare" as const }
            : {}),
        state_source: "wizard",
      }));
    }

    // Non-absent returning trucks: auto-set to unloaded.
    // These trucks were off yesterday and are back today — they were already
    // loaded/pushed the day before, so they return in an unloaded state.
    // Guard: don't downgrade a truck that's already further along this shift —
    // re-running Setup Day must not reset in-progress/loaded work back to unloaded.
    for (const t of returningTrucks) {
      if (absentSelected.has(t.truck_number)) continue;
      if (t.state?.status === "in_progress" || t.state?.status === "loaded") continue;
      tasks.push(upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "unloaded",
        state_source: "wizard",
      }));
    }

    // Ran-ahead toggles: sentinel only, status echoed — the truck keeps its
    // morning unload work and just leaves tonight's load roster.
    if (ranAheadSelected != null) {
      for (const t of ranAheadCandidates) {
        const was = hasRanAhead(t.state?.off_note);
        const now = ranAheadPicked.has(t.truck_number);
        if (was === now) continue;
        tasks.push(upsert.mutateAsync({
          truck_number: t.truck_number,
          run_date: runDate,
          off_note: now
            ? addNoteToken(t.state?.off_note, RAN_AHEAD)
            : removeNoteToken(t.state?.off_note, RAN_AHEAD),
          ...(t.state ? { status: t.state.status, wearers: t.state.wearers } : {}),
          state_source: "wizard",
        }));
      }
    }

    // allSettled, not all: the server now rejects a wizard write that would undo
    // load work, and one such 409 must not abort the rest of the step. A truck
    // being skipped is the guard doing its job, so it is reported, not thrown.
    const results = await Promise.allSettled(tasks);
    const skipped = results.filter((r) => r.status === "rejected").length;
    if (skipped > 0) {
      toast.info(
        `${skipped} truck${skipped === 1 ? "" : "s"} left as ${skipped === 1 ? "it is" : "they are"} — ` +
        "already loaded or in progress for today.",
      );
    }
    setStep(5);
  }

  async function saveNotesAndFinish() {
    await setDailyNotes.mutateAsync({ runDate, notes: notesText ?? dailyNotes });
    await upsertSetting.mutateAsync({ key: `day_setup_source_${runDate}`, value: "wizard" });
    await setWizardCompleted.mutateAsync(runDate);
    onClose();
  }

  const dateLabel = format(new Date(`${runDate}T12:00:00`), "EEE, MMM d");
  const footerPending = step === 2 || step === 4 ? upsert.isPending : step === 5 ? setDailyNotes.isPending : false;
  const nextByStep: Record<number, () => void> = {
    1: () => setStep(2),
    2: saveDustAndAdvance,
    3: () => setStep(4),
    4: saveAbsentAndAdvance,
    5: saveNotesAndFinish,
  };
  const setAll = (setter: (s: Set<number>) => void, nums: number[]) => (all: boolean) =>
    setter(new Set(all ? nums : []));

  return (
    <Modal open onClose={onClose} size="md" bodyClassName="">
        <WizardHeader step={step} dateLabel={dateLabel} onClose={onClose} onJump={setStep} />

        <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto px-5 pb-5">
          {/* Step 1: Run Mode */}
          {step === 1 && (
            <div className="space-y-4">
              {gapDays.length > 0 && (
                <div className="space-y-2 rounded-lg border border-[rgba(245,158,11,0.30)] bg-[rgba(245,158,11,0.08)] p-3">
                  <p className="text-sm font-bold text-[#fbbf5c]">
                    The app wasn't used on {gapDays.length} workday{gapDays.length === 1 ? "" : "s"}
                    {dayGap?.prev_data_date ? ` since ${gapDayLabel(dayGap.prev_data_date)}` : ""}.
                  </p>
                  <p className="text-xs text-ink-muted">
                    Unmarked days count as normal run days — trucks come back dirty per the
                    schedule. Tap any day the plant was closed{canApplyGap ? ", then apply" : " (a supervisor applies this)"}.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {gapDays.map((d) => (
                      <button
                        key={d.date}
                        type="button"
                        disabled={!canApplyGap}
                        onClick={() => toggleClosed(d.date)}
                        className={clsx(
                          "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                          pickedClosed.has(d.date)
                            ? "border-red-500/50 bg-red-900/40 text-red-200"
                            : "border-hairline bg-surface-2 text-ink-soft",
                          canApplyGap && "hover:bg-track",
                        )}
                      >
                        {gapDayLabel(d.date)}
                        {pickedClosed.has(d.date) ? " · closed" : ""}
                      </button>
                    ))}
                  </div>
                  {canApplyGap && (gapDirty || gapDays.some((d) => d.closed)) && (
                    <button
                      type="button"
                      onClick={applyGap}
                      disabled={applyDayGap.isPending || !gapDirty}
                      className="btn-primary w-full rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                    >
                      {applyDayGap.isPending ? "Applying…" : "Apply closed days & reseed today"}
                    </button>
                  )}
                </div>
              )}
              <StepHeading
                title="Set today's run mode."
                help="Load and Unload can run independently on holiday. Load is for tomorrow's ship, Unload is for today's ship returning."
              />

              {/* Master shortcut: Normal / Holiday (sets both sides at once) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-sm font-bold transition-colors",
                    !holidayMode && !holidayLoad && !holidayUnload
                      ? "border-blue-500 bg-blue-900/40 text-blue-200"
                      : "border-hairline bg-surface-2 text-ink-soft hover:bg-track",
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
                      : "border-hairline bg-surface-2 text-ink-soft hover:bg-track",
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
                      : "border-hairline bg-surface-2 hover:bg-track",
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
                    <span className="text-base font-bold text-ink">
                      Load &mdash; for {DAY_NAMES[loadDay] ?? `Day ${loadDay}`}'s ship
                    </span>
                    <span className={clsx(
                      "rounded px-2 py-0.5 text-xs font-bold",
                      holidayLoad ? "bg-amber-500/80 text-amber-50" : "bg-track text-ink-soft",
                    )}>
                      {holidayLoad ? "HOLIDAY" : "NORMAL"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {holidayLoad
                      ? <>Loading <span className="font-bold text-amber-200">{loadBase + loadExtra}</span> routes ({loadBase} scheduled + <span className="font-bold text-amber-300">{loadExtra} extra</span>)</>
                      : <>Loading <span className="font-bold text-ink-soft">{loadBase}</span> scheduled routes ({loadExtra} off)</>}
                  </div>
                </button>

                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                    holidayUnload
                      ? "border-amber-500 bg-amber-950/30"
                      : "border-hairline bg-surface-2 hover:bg-track",
                  )}
                  onClick={async () => {
                    const next = !holidayUnload;
                    await setHolidayUnload.mutateAsync({ runDate, value: next });
                    await setHolidayMode.mutateAsync({ runDate, holiday: next || holidayLoad });
                  }}
                  disabled={setHolidayUnload.isPending}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-ink">
                      Unload &mdash; from {DAY_NAMES[unloadsDay] ?? `Day ${unloadsDay}`}'s ship
                    </span>
                    <span className={clsx(
                      "rounded px-2 py-0.5 text-xs font-bold",
                      holidayUnload ? "bg-amber-500/80 text-amber-50" : "bg-track text-ink-soft",
                    )}>
                      {holidayUnload ? "HOLIDAY" : "NORMAL"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {holidayUnload
                      ? <>Unloading <span className="font-bold text-amber-200">{unloadBase + unloadExtra}</span> routes ({unloadBase} scheduled + <span className="font-bold text-amber-300">{unloadExtra} extra</span>){usedSpares.length > 0 && <> + {usedSpares.length} spare{usedSpares.length !== 1 ? "s" : ""}</>}</>
                      : <>Unloading <span className="font-bold text-ink-soft">{unloadBase}</span> scheduled routes{usedSpares.length > 0 && <> + {usedSpares.length} spare{usedSpares.length !== 1 ? "s" : ""}</>}</>}
                  </div>
                </button>
              </div>

              {holidayLoad !== holidayUnload && (
                <div className="rounded-md border border-blue-700/40 bg-blue-950/20 px-3 py-2 text-xs text-blue-200">
                  <span className="font-bold">Asymmetric day:</span> only one side is on holiday.
                  This happens entering/leaving a holiday week (e.g.&nbsp;Fri load=holiday, Mon unload=holiday).
                </div>
              )}
            </div>
          )}

          {/* Step 2: Garments & NOGs */}
          {step === 2 && (
            <div className="space-y-5">
              <StepHeading title="Garments & NOGs" help="Pick the trucks with garments, then the trucks sending NOGs out." />
              <ChipGroup
                title="F.S. trucks with garments"
                help="Tap each truck that came back with garments."
                tone="garments"
                trucks={editableDustTrucks.map((t) => t.truck_number)}
                selected={dustSelected}
                onToggle={toggleDust}
                onSetAll={setAll(setDustSelected, editableDustTrucks.map((t) => t.truck_number))}
                empty="No F.S. trucks in fleet."
              />
              {/* NOGs — set at the start of the day, exactly like the garments
                  above; the Load page's strip then tracks them out the door. */}
              <ChipGroup
                divider
                title="NOGs — not our garments"
                help="Tap trucks sending NOGs back out today."
                tone="nogs"
                trucks={nogsCandidates.map((t) => t.truck_number)}
                selected={nogsPicked}
                onToggle={toggleNogs}
                onSetAll={setAll(setNogsSelected, nogsCandidates.map((t) => t.truck_number))}
                scroll
              />
            </div>
          )}

          {/* Step 3: Route Swaps */}
          {step === 3 && (() => {
            // OOS trucks that don't yet have a swap assigned (covered via either
            // a route swap or a spare assignment).
            const swappedRoutes = coveredRouteSet;
            // Match the Fleet board's "Needs assignment" detection exactly: a
            // route truck is OOS via the is_oos FLAG (its status may read
            // dirty/unloaded), not only when status is literally "oos".
            const unswappedOos = board.filter(
              (t) => t.truck_type !== "Spare" && t.is_oos && !swappedRoutes.has(t.truck_number),
            ).sort((a, b) => a.truck_number - b.truck_number);
            return (
            <div className="space-y-3">
              <StepHeading title="Set any route swaps." help="One truck loads another's route today." />

              {/* OOS trucks needing a covering truck */}
              {unswappedOos.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                      Needs Assignment
                    </p>
                    <span className="rounded-full bg-amber-700/50 px-2 py-0.5 text-[10px] font-bold text-amber-300">{unswappedOos.length}</span>
                  </div>
                  {unswappedOos.map((t) => (
                    <div key={t.truck_number} className="flex items-center gap-2 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-2">
                      <span className="text-sm font-bold text-amber-300 whitespace-nowrap">
                        #{t.truck_number} <span className="text-[10px] font-semibold text-amber-500">OOS</span>
                      </span>
                      <span className="text-ink-muted text-sm">→</span>
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
                          // Schedule-based off group — matches RouteSwapModal.
                          const offTrucks = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, loadDay, holidayLoad) !== "oos" && !holidayLoad && isScheduledOff(x, loadDay));
                          const swappedRouteSet = coveredRouteSet;
                          const oosRouteless = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, loadDay, holidayLoad) === "oos" && swappedRouteSet.has(x.truck_number) && x.truck_number !== t.truck_number);
                          const otherTrucks = sorted.filter((x) => x.truck_type !== "Spare" && effectiveStatus(x, loadDay, holidayLoad) !== "oos" && (holidayLoad || !isScheduledOff(x, loadDay)));
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

              {coverages.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Active Route Swaps</p>
                    <span className="rounded-full bg-blue-800/60 px-2 py-0.5 text-[10px] font-bold text-blue-300">{coverages.length}</span>
                  </div>
                  {coverages.map((c) => (
                    <div key={c.key} className="flex items-center justify-between gap-2 rounded-md border border-blue-900/50 bg-blue-950/20 px-3 py-2">
                      <span className="text-sm font-bold text-ink-soft">
                        {c.split ? (
                          <>
                            Route <span className="text-amber-300">#{c.route_truck}</span>
                            <span className="mx-1 text-ink-muted">+</span>
                            <span className="text-amber-300">#{c.load_on_truck}</span>
                            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">split — route still runs</span>
                          </>
                        ) : (
                          <>
                            Route <span className="text-red-400">#{c.route_truck}</span>
                            <span className="mx-1 text-ink-muted">→</span>
                            Load On <span className="text-blue-300">#{c.load_on_truck}</span>
                          </>
                        )}
                      </span>
                      <button
                        className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-track disabled:opacity-40"
                        disabled={deleteSwap.isPending || returnSpare.isPending || (c.swapId == null && c.spareId == null)}
                        onClick={() => {
                          // Clear coverage from whichever mechanism(s) set it.
                          if (c.swapId != null) deleteSwap.mutate({ id: c.swapId, runDate, alsoReciprocal: false });
                          if (c.spareId != null) returnSpare.mutate(c.spareId);
                        }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-hairline bg-surface-2/50 p-3 space-y-2">
                <p className="text-xs font-semibold text-ink-muted">Add route swap</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-ink-muted mb-1">Route Truck</label>
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
                    <label className="block text-[10px] uppercase tracking-wide text-ink-muted mb-1">Load On</label>
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
                        // Schedule-based off group — matches RouteSwapModal.
                        const offTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "oos" && !holidayLoad && isScheduledOff(t, loadDay));
                        // OOS trucks whose route is already covered are routeless and available
                        const swappedRouteSet = coveredRouteSet;
                        const oosRouteless = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swappedRouteSet.has(t.truck_number));
                        const oosUncovered = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swappedRouteSet.has(t.truck_number));
                        const otherTrucks = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "oos" && (holidayLoad || !isScheduledOff(t, loadDay)));
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
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-amber-500"
                    checked={swapSplit}
                    onChange={(e) => { setSwapSplit(e.target.checked); setSwapError(null); }}
                  />
                  <span>
                    Split load — the route truck still runs; the second truck carries its overflow
                  </span>
                </label>
                {swapError && <p className="text-xs text-red-400">{swapError}</p>}
                <button
                  className={swapSplit ? "w-full rounded-lg border border-amber-500/50 bg-amber-500/15 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-50" : "w-full btn-primary text-sm"}
                  disabled={!swapRoute || !swapLoadOn || createSwap.isPending}
                  onClick={addSwap}
                >
                  {createSwap.isPending ? "Saving…" : swapSplit ? "Add Split Load" : "Add Swap"}
                </button>
              </div>
            </div>
            );
          })()}

          {/* Step 4: Trucks Not Here */}
          {step === 4 && (
            <div className="space-y-5">
              <StepHeading title="Trucks not here" help="They keep their current status. This only flags them Needs Checked." />
              <ChipGroup
                title="Returning & spare trucks that are absent"
                help="Tap each truck that isn't here today."
                tone="absent"
                trucks={editableSpecialTrucks.map((t) => t.truck_number)}
                selected={absentSelected}
                onToggle={toggleAbsent}
                onSetAll={setAll(setAbsentSelected, editableSpecialTrucks.map((t) => t.truck_number))}
                cols={3}
                empty="No returning or spare trucks found."
              />
              {ranAheadCandidates.length > 0 && (
                <ChipGroup
                  divider
                  title="Ran ahead — skip tonight's load"
                  help="Ran their route early this week (holiday double). They still unload as normal."
                  tone="ranAhead"
                  trucks={ranAheadCandidates.map((t) => t.truck_number)}
                  selected={ranAheadPicked}
                  onToggle={toggleRanAhead}
                  onSetAll={setAll(setRanAheadSelected, ranAheadCandidates.map((t) => t.truck_number))}
                  cols={3}
                />
              )}
            </div>
          )}

          {/* Step 5: Daily Notes + summary */}
          {step === 5 && (
            <div className="space-y-4">
              <StepHeading title="Notes for today" help="Anything the next shift should know." />
              <textarea
                className="input w-full resize-none text-sm"
                rows={4}
                placeholder="Enter any notes about today's run day…"
                value={notesText ?? dailyNotes}
                onChange={(e) => setNotesText(e.target.value)}
              />
              <dl className="grid grid-cols-3 gap-2">
                {[
                  ["loads", loadBase + (holidayLoad ? loadExtra : 0)],
                  ["unloads", unloadBase + (holidayUnload ? unloadExtra : 0)],
                  ["garments", dustSelected.size],
                  ["NOGs", nogsPicked.size],
                  ["absent", absentSelected.size],
                  ["swaps", coverages.length],
                ].map(([label, n]) => (
                  <div key={label} className="rounded-lg border border-hairline bg-surface-3 px-3 py-2">
                    <dd className="font-mono text-[22px] font-semibold leading-7 tabular-nums text-ink">{n}</dd>
                    <dt className="text-xs text-ink-muted">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <WizardFooter
          step={step}
          pending={footerPending}
          onBack={() => (step === 1 ? onClose() : setStep(step - 1))}
          onSkip={step === 2 ? () => setStep(3) : step === 4 ? () => setStep(5) : undefined}
          onNext={nextByStep[step]}
        />
    </Modal>
  );
}
