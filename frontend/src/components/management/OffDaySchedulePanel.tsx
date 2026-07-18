import { useMemo, useState } from "react";
import { Lock, Pencil } from "lucide-react";
import { useFleet, useHolidayLoad, useHolidayUnload, useUpdateTruck } from "../../api/hooks";
import { isScheduledOff, previousWorkday } from "../../utils/truckStatus";
import { workdayNumbers } from "../Clock";
import { todayIso } from "../../api/client";
import clsx from "clsx";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TYPE_SHORT: Record<string, string> = { Dust: "(D)", Uniform: "(U)" };

export default function OffDaySchedulePanel({ compact }: { compact?: boolean }) {
  const { data: fleet } = useFleet(false);
  const updateTruck = useUpdateTruck();
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [pinnedRow, setPinnedRow] = useState<number | null>(null);
  const [pinnedDay, setPinnedDay] = useState<number | null>(null);
  // Track saving state per (truck, day) key so cells show feedback individually
  const [saving, setSaving] = useState<Set<string>>(new Set());
  // Cells are LIVE mutations — locked by default so a stray tap can't silently
  // change a truck's schedule. The Edit Schedule toggle arms them.
  const [editing, setEditing] = useState(false);

  const rows = useMemo(() => {
    if (!fleet) return [];
    return fleet
      .filter((t) => t.truck_type !== "Spare")
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [fleet]);

  const { loadDay, unloadsDay } = workdayNumbers();
  const runDate = todayIso();
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);

  // On a holiday two ship days run in one shift: load also gets ahead on the
  // next ship day (loadDay+1), unload also catches up on the previous ship day
  // (unloadsDay-1). Track every active load/unload day so the compact view and
  // highlighting include the holiday's extra day.
  const loadNextDay = loadDay === 5 ? 1 : loadDay + 1;
  const unloadPrevDay = previousWorkday(unloadsDay);
  const loadDays = holidayLoad ? [loadDay, loadNextDay] : [loadDay];
  const unloadDays = holidayUnload ? [unloadsDay, unloadPrevDay] : [unloadsDay];
  const isLoadDay = (d: number) => loadDays.includes(d);
  const isUnloadDay = (d: number) => unloadDays.includes(d);
  const showInCompact = (d: number) => isLoadDay(d) || isUnloadDay(d);

  const runningToday = useMemo(
    () => rows.filter((t) => !isScheduledOff(t, loadDay)).length,
    [rows, loadDay],
  );

  const perDayCount = useMemo(
    () => [1, 2, 3, 4, 5].map((day) => rows.filter((t) => !isScheduledOff(t, day)).length),
    [rows],
  );

  const activeRow = pinnedRow ?? hoveredRow;
  const activeDay = pinnedDay ?? hoveredDay;

  function isActive(truck: number, day: number): boolean {
    return activeRow === truck || activeDay === day;
  }

  function togglePinRow(truck: number) {
    setPinnedRow((prev) => (prev === truck ? null : truck));
  }

  function togglePinDay(day: number) {
    setPinnedDay((prev) => (prev === day ? null : day));
  }

  async function toggleOffDay(truckNumber: number, day: number, currentOffDays: number[]) {
    if (!editing) return;
    const key = `${truckNumber}-${day}`;
    if (saving.has(key)) return;
    setSaving((s) => new Set(s).add(key));
    const next = currentOffDays.includes(day)
      ? currentOffDays.filter((d) => d !== day)
      : [...currentOffDays, day].sort((a, b) => a - b);
    try {
      await updateTruck.mutateAsync({ truck_number: truckNumber, scheduled_off_days: next });
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {editing
            ? "Editing — click any cell to toggle that truck's off day. Changes save immediately."
            : "Schedule is locked so a stray tap can't change it. Tap Edit Schedule to make changes."}
        </p>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={clsx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors",
            editing
              ? "border-amber-500/60 bg-amber-900/40 text-amber-300 hover:bg-amber-900/60"
              : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
          )}
        >
          {editing ? <Lock className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          {editing ? "Done — Lock" : "Edit Schedule"}
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-left text-xs uppercase tracking-widest text-slate-400">
              <th className="sticky left-0 z-10 border border-slate-700/50 bg-slate-800 px-1 py-1.5 text-center">Route</th>
              {[1, 2, 3, 4, 5].map((day) => (
                <th
                  key={day}
                  className={clsx(
                    "border border-slate-700/50 px-1 py-1 text-center transition-colors cursor-pointer select-none",
                    pinnedDay === day && "bg-blue-900/30",
                    isLoadDay(day) && "ring-2 ring-blue-500/40 animate-pulse",
                    isUnloadDay(day) && "ring-2 ring-emerald-500/40 animate-pulse",
                    compact && !showInCompact(day) && "hidden md:table-cell",
                  )}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  onClick={() => togglePinDay(day)}
                >
                  <div className="font-semibold text-slate-300">Day {day}</div>
                  <div className="text-[10px] font-normal text-slate-500">
                    {DAY_LABELS[day - 1]}
                    {isLoadDay(day) && <span className="ml-1 text-blue-400">L</span>}
                    {isUnloadDay(day) && <span className="ml-1 text-emerald-400">U</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="border border-slate-700/50 px-1 py-10 text-center text-xs text-slate-500">
                  No active route trucks found.
                </td>
              </tr>
            ) : (
              rows.map((t, i) => (
                <tr
                  key={t.truck_number}
                  className={clsx("transition-colors", i % 2 === 1 && "bg-slate-800/20")}
                >
                  <td
                    className={clsx(
                      "sticky left-0 z-10 border border-slate-700/50 bg-slate-900 px-1 py-1.5 text-center font-bold text-slate-200 transition-colors cursor-pointer select-none",
                      activeRow === t.truck_number && "!bg-blue-900/30",
                    )}
                    onMouseEnter={() => setHoveredRow(t.truck_number)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => togglePinRow(t.truck_number)}
                  >
                    #{t.truck_number} {TYPE_SHORT[t.truck_type] ?? ""}
                  </td>
                  {[1, 2, 3, 4, 5].map((day) => {
                    const off = isScheduledOff(t, day);
                    const highlight = isActive(t.truck_number, day);
                    const key = `${t.truck_number}-${day}`;
                    const isSaving = saving.has(key);
                    return (
                      <td
                        key={day}
                        onClick={() => toggleOffDay(t.truck_number, day, t.scheduled_off_days ?? [])}
                        className={clsx(
                          "border border-slate-700/50 px-1 py-1 text-center font-mono text-xs font-semibold transition-all select-none",
                          editing ? "cursor-pointer" : "cursor-default",
                          compact && !showInCompact(day) && "hidden md:table-cell",
                          isSaving
                            ? "opacity-40"
                            : off
                              ? highlight
                                ? clsx("bg-red-900/50 text-red-300 opacity-100", editing && "hover:bg-emerald-900/40")
                                : clsx("bg-red-900/30 text-red-300/60 opacity-40", editing && "hover:opacity-80 hover:bg-red-900/50")
                              : highlight
                                ? "bg-slate-800/50 text-slate-500"
                                : isLoadDay(day)
                                  ? clsx("text-blue-300 bg-blue-900/30 ring-1 ring-inset ring-blue-500/30 font-bold", editing && "hover:bg-red-900/30 hover:text-red-300/80")
                                  : isUnloadDay(day)
                                    ? clsx("text-emerald-300 bg-emerald-900/30 ring-1 ring-inset ring-emerald-500/30 font-bold", editing && "hover:bg-red-900/30 hover:text-red-300/80")
                                    : clsx("bg-emerald-900/40 text-emerald-300", editing && "hover:bg-red-900/30 hover:text-red-300/80"),
                        )}
                      >
                        {isSaving ? "…" : off ? "OFF" : "RUN"}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-800/60 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <td className="sticky left-0 z-10 border border-slate-700/50 bg-slate-800/80 px-1 py-1.5 text-center text-[10px] text-slate-500">
                  Total
                </td>
                {perDayCount.map((count, i) => {
                  const day = i + 1;
                  return (
                    <td
                      key={day}
                      className={clsx(
                        "border border-slate-700/50 px-1 py-1.5 text-center font-mono tabular-nums transition-colors",
                        compact && !showInCompact(day) && "hidden md:table-cell",
                        isLoadDay(day)
                          ? "bg-blue-900/30 text-blue-300"
                          : isUnloadDay(day)
                          ? "bg-emerald-900/30 text-emerald-300"
                          : "text-slate-300",
                      )}
                    >
                      {count}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length > 0 && (
          <div className="border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-500">
            <span className="text-blue-400">{runningToday}</span> running <span className="text-blue-400">Day {loadDay}{holidayLoad ? `+${loadNextDay}` : ""}</span> · <span className="text-emerald-400">{rows.filter((t) => !isScheduledOff(t, unloadsDay)).length}</span> unloading <span className="text-emerald-400">Day {unloadsDay}{holidayUnload ? `+${unloadPrevDay}` : ""}</span> · {rows.length} total route trucks
          </div>
        )}
      </div>
    </div>
  );
}
