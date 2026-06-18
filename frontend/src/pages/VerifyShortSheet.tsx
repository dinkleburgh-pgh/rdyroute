/**
 * Verify Short Sheet — check off route trucks as you verify each one was written up.
 * Shows what's remaining so you can catch anything that was missed.
 */
import { useMemo, useState, useEffect, useCallback } from "react";
import { CheckCircle2, Circle, RotateCcw, ClipboardCheck } from "lucide-react";
import clsx from "clsx";
import PageHeader from "../components/PageHeader";
import { useFleet } from "../api/hooks";
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

function storageKey(dateStr: string, day: number) {
  return `verify_short_sheet_${dateStr}_d${day}`;
}

function loadChecked(dateStr: string, day: number): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(dateStr, day));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set<number>(parsed);
  } catch {
    // ignore
  }
  return new Set();
}

function saveChecked(dateStr: string, day: number, checked: Set<number>) {
  try {
    localStorage.setItem(storageKey(dateStr, day), JSON.stringify([...checked]));
  } catch {
    // ignore
  }
}

export default function VerifyShortSheet() {
  const { data: fleet } = useFleet(false);
  const { loadDay: todayLoadDay } = useMemo(() => workdayNumbers(), []);
  const dateStr = todayIso();

  const [selectedDay, setSelectedDay] = useState<number>(todayLoadDay);
  const [checked, setChecked] = useState<Set<number>>(() => loadChecked(dateStr, todayLoadDay));

  // Reload checked state from localStorage when day changes
  useEffect(() => {
    setChecked(loadChecked(dateStr, selectedDay));
  }, [selectedDay, dateStr]);

  // Persist on every change
  useEffect(() => {
    saveChecked(dateStr, selectedDay, checked);
  }, [checked, dateStr, selectedDay]);

  // All non-spare trucks running on the selected day
  const runningTrucks = useMemo(() => {
    if (!fleet) return [];
    return fleet
      .filter((t) => t.is_active && t.truck_type !== "Spare" && !isScheduledOff(t, selectedDay))
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [fleet, selectedDay]);

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
            Load Day
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
              Every scheduled route for {DAY_LABELS[selectedDay]} has been written up.
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
