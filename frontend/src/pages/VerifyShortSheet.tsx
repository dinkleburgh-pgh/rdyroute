/**
 * Verify Short Sheet — check off route trucks as you verify each one was written up.
 * Shows what's remaining so you can catch anything that was missed.
 */
import { useMemo, useState, useEffect, useCallback } from "react";
import { CheckCircle2, Circle, RotateCcw, ClipboardCheck } from "lucide-react";
import clsx from "clsx";
import PageHeader from "../components/PageHeader";
import { useFleet, useHolidayLoad } from "../api/hooks";
import { isScheduledOff } from "../utils/truckStatus";
import { workdayNumbers } from "../components/Clock";
import { todayIso } from "../api/client";

const TYPE_LABEL: Record<string, string> = {
  Dust: "Dust",
  Uniform: "Uniform",
  Spare: "Spare",
};

const DAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
};

function storageKey(dateStr: string, day: number, holiday: boolean, secondDay: number) {
  return holiday
    ? `verify_short_sheet_${dateStr}_h${day}_${secondDay}`
    : `verify_short_sheet_${dateStr}_d${day}`;
}

function loadChecked(dateStr: string, day: number, holiday: boolean, secondDay: number): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(dateStr, day, holiday, secondDay));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set<number>(parsed);
  } catch {
    // ignore
  }
  return new Set();
}

function saveChecked(dateStr: string, day: number, holiday: boolean, secondDay: number, checked: Set<number>) {
  try {
    localStorage.setItem(storageKey(dateStr, day, holiday, secondDay), JSON.stringify([...checked]));
  } catch {
    // ignore
  }
}

export default function VerifyShortSheet() {
  const { data: fleet } = useFleet(false);
  const { loadDay: todayLoadDay } = useMemo(() => workdayNumbers(), []);
  const dateStr = todayIso();

  // Auto-detect holiday from the actual load-day holiday setting. The toggle
  // still lets the user override; once they tap it we stop auto-syncing.
  const { data: detectedHoliday = false } = useHolidayLoad(dateStr);
  const [selectedDay, setSelectedDay] = useState<number>(todayLoadDay);
  const [holiday, setHoliday] = useState<boolean>(false);
  const [holidayTouched, setHolidayTouched] = useState<boolean>(false);
  const [secondDay, setSecondDay] = useState<number>(todayLoadDay === 5 ? 1 : todayLoadDay + 1);

  useEffect(() => {
    if (!holidayTouched) setHoliday(detectedHoliday);
  }, [detectedHoliday, holidayTouched]);
  const [checked, setChecked] = useState<Set<number>>(() => loadChecked(dateStr, todayLoadDay, false, secondDay));

  // Reload checked state from localStorage when the day / holiday selection changes
  useEffect(() => {
    setChecked(loadChecked(dateStr, selectedDay, holiday, secondDay));
  }, [selectedDay, dateStr, holiday, secondDay]);

  // Persist on every change
  useEffect(() => {
    saveChecked(dateStr, selectedDay, holiday, secondDay, checked);
  }, [checked, dateStr, selectedDay, holiday, secondDay]);

  // The route trucks that make up the short sheet.
  //  - Normal: just the trucks running on the selected (main) day.
  //  - Holiday: the full sheet (38) — main-day routes PLUS the routes off the
  //    main day, which run on the second day to make up the total.
  const runningTrucks = useMemo(() => {
    if (!fleet) return [];
    return fleet
      .filter(
        (t) =>
          t.is_active &&
          t.truck_type !== "Spare" &&
          (holiday || !isScheduledOff(t, selectedDay)),
      )
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [fleet, selectedDay, holiday]);

  // In holiday mode, which day a route belongs to: main day if it runs then,
  // otherwise the second (catch-up) day.
  const routeDay = useCallback(
    (truckNum: number): number => {
      const t = fleet?.find((x) => x.truck_number === truckNum);
      if (!holiday || !t) return selectedDay;
      return isScheduledOff(t, selectedDay) ? secondDay : selectedDay;
    },
    [fleet, holiday, selectedDay, secondDay],
  );

  const notDone = useMemo(
    () => runningTrucks.filter((t) => !checked.has(t.truck_number)),
    [runningTrucks, checked],
  );
  const done = useMemo(
    () => runningTrucks.filter((t) => checked.has(t.truck_number)),
    [runningTrucks, checked],
  );

  const toggle = useCallback((truckNum: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(truckNum)) {
        next.delete(truckNum);
      } else {
        next.add(truckNum);
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setChecked(new Set());
  }, []);

  const allDone = notDone.length === 0 && runningTrucks.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Verify Short Sheet"
        subtitle="Tap each route as you confirm it was written up."
        centerMobile={false}
        actions={
          checked.size > 0 ? (
            <button
              onClick={reset}
              className="hidden md:flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          ) : undefined
        }
      />

      <div className="p-3 md:p-6 space-y-4">
        {/* Day selector */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted shrink-0">
            {holiday ? "Main Day" : "Load Day"}
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {([1, 2, 3, 4, 5] as const).map((day) => (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  selectedDay === day
                    ? "border-indigo-500/60 bg-indigo-500/15 text-[#7cc4ff]"
                    : "border-hairline bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink",
                  day === todayLoadDay && selectedDay !== day && "border-indigo-500/25",
                )}
              >
                {DAY_LABELS[day]}
                {day === todayLoadDay && (
                  <span className="ml-1 text-[8px] font-normal opacity-60">today</span>
                )}
              </button>
            ))}
            <button
              onClick={() => { setHolidayTouched(true); setHoliday((h) => !h); }}
              className={clsx(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                holiday
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                  : "border-hairline bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
            >
              Holiday{!holidayTouched && detectedHoliday ? " (auto)" : ""}
            </button>
            {checked.size > 0 && (
              <button
                onClick={reset}
                className="flex md:hidden items-center gap-1 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Second-day selector — holiday only. The routes off the main day run
            on this day to make up the full short sheet. */}
        {holiday && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted shrink-0">
              Second Day
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {([1, 2, 3, 4, 5] as const).map((day) => (
                <button
                  key={day}
                  onClick={() => setSecondDay(day)}
                  disabled={day === selectedDay}
                  className={clsx(
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    secondDay === day
                      ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                      : "border-hairline bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink",
                    day === selectedDay && "opacity-30 cursor-not-allowed",
                  )}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Summary bar */}
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div
                className={clsx(
                  "text-3xl font-black leading-none tabular-nums",
                  allDone
                    ? "text-emerald-400"
                    : notDone.length <= 2
                      ? "text-amber-400"
                      : "text-ink",
                )}
              >
                {notDone.length}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-ink-muted">
                Remaining
              </div>
            </div>
            <div className="h-10 w-px bg-hairline" />
            <div className="text-center">
              <div className="text-3xl font-black leading-none tabular-nums text-emerald-400">
                {done.length}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-ink-muted">
                Written Up
              </div>
            </div>
            <div className="h-10 w-px bg-hairline" />
            <div className="text-center">
              <div className="text-3xl font-black leading-none tabular-nums text-ink-soft">
                {runningTrucks.length}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-ink-muted">
                Scheduled
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="hidden sm:flex flex-1 max-w-xs flex-col gap-1.5">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={clsx(
                  "h-full rounded-full transition-all duration-300",
                  allDone ? "bg-emerald-500" : "bg-indigo-500",
                )}
                style={{
                  width:
                    runningTrucks.length > 0
                      ? `${(done.length / runningTrucks.length) * 100}%`
                      : "0%",
                }}
              />
            </div>
            <div className="text-right text-[10px] text-ink-muted tabular-nums">
              {runningTrucks.length > 0
                ? `${Math.round((done.length / runningTrucks.length) * 100)}%`
                : "—"}
            </div>
          </div>
        </div>

        {/* All done state */}
        {allDone && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 flex flex-col items-center gap-2 text-center">
            <ClipboardCheck className="h-8 w-8 text-emerald-400" />
            <p className="text-base font-semibold text-emerald-300">All routes verified</p>
            <p className="text-sm text-ink-muted">
              {holiday
                ? `All ${runningTrucks.length} routes for the holiday (${DAY_LABELS[selectedDay]} + ${DAY_LABELS[secondDay]}) have been written up.`
                : `Every scheduled route for ${DAY_LABELS[selectedDay]} has been written up.`}
            </p>
          </div>
        )}

        {/* Not written up */}
        {notDone.length > 0 && (
          <section>
            <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Not Written Up · {notDone.length}
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {notDone.map((truck) => (
                <button
                  key={truck.truck_number}
                  onClick={() => toggle(truck.truck_number)}
                  className={clsx(
                    "group flex flex-col items-center justify-center gap-1 rounded-xl border py-4 px-2 text-center transition-all active:scale-95",
                    "border-amber-500/40 bg-amber-500/5 hover:border-amber-400/70 hover:bg-amber-500/10",
                  )}
                >
                  <span className="text-2xl font-black leading-none tabular-nums text-ink">
                    {truck.truck_number}
                  </span>
                  <span className="text-[10px] text-ink-muted">
                    {TYPE_LABEL[truck.truck_type] ?? truck.truck_type}
                  </span>
                  {holiday && (
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                        routeDay(truck.truck_number) === selectedDay
                          ? "bg-indigo-500/20 text-[#7cc4ff]"
                          : "bg-amber-500/20 text-amber-300",
                      )}
                    >
                      {DAY_LABELS[routeDay(truck.truck_number)]}
                    </span>
                  )}
                  <Circle className="mt-1 h-4 w-4 text-amber-500/50 group-hover:text-amber-400 transition-colors" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Written up */}
        {done.length > 0 && (
          <section>
            <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Written Up · {done.length}
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {done.map((truck) => (
                <button
                  key={truck.truck_number}
                  onClick={() => toggle(truck.truck_number)}
                  className={clsx(
                    "group flex flex-col items-center justify-center gap-1 rounded-xl border py-4 px-2 text-center transition-all active:scale-95",
                    "border-emerald-500/30 bg-emerald-500/8 hover:border-emerald-400/50 hover:bg-emerald-500/12 opacity-70 hover:opacity-100",
                  )}
                >
                  <span className="text-2xl font-black leading-none tabular-nums text-ink-soft">
                    {truck.truck_number}
                  </span>
                  <span className="text-[10px] text-ink-muted">
                    {TYPE_LABEL[truck.truck_type] ?? truck.truck_type}
                  </span>
                  {holiday && (
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                        routeDay(truck.truck_number) === selectedDay
                          ? "bg-indigo-500/20 text-[#7cc4ff]"
                          : "bg-amber-500/20 text-amber-300",
                      )}
                    >
                      {DAY_LABELS[routeDay(truck.truck_number)]}
                    </span>
                  )}
                  <CheckCircle2 className="mt-1 h-4 w-4 text-emerald-500 transition-colors" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {runningTrucks.length === 0 && fleet && (
          <div className="rounded-xl border border-hairline bg-surface px-4 py-10 text-center text-sm text-ink-muted">
            No route trucks scheduled to run on {DAY_LABELS[selectedDay]}.
          </div>
        )}
      </div>
    </>
  );
}
