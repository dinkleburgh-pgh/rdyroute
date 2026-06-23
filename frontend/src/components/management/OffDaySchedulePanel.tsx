import { useMemo, useState } from "react";
import { useFleet } from "../../api/hooks";
import { isScheduledOff } from "../../utils/truckStatus";
import { workdayNumbers } from "../Clock";
import clsx from "clsx";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TYPE_SHORT: Record<string, string> = { Dust: "(D)", Uniform: "(U)" };

export default function OffDaySchedulePanel() {
  const { data: fleet } = useFleet(false);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [pinnedRow, setPinnedRow] = useState<number | null>(null);
  const [pinnedDay, setPinnedDay] = useState<number | null>(null);

  const rows = useMemo(() => {
    if (!fleet) return [];
    return fleet
      .filter((t) => t.truck_type !== "Spare")
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [fleet]);

  const { loadDay, unloadsDay } = workdayNumbers();

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
    if (activeRow === truck) return true;
    if (activeDay === day) return true;
    return false;
  }

  function togglePinRow(truck: number) {
    setPinnedRow((prev) => (prev === truck ? null : truck));
  }

  function togglePinDay(day: number) {
    setPinnedDay((prev) => (prev === day ? null : day));
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800 text-left text-xs uppercase tracking-widest text-slate-400">
            <th className="sticky left-0 z-10 border border-slate-700/50 bg-slate-800 px-1 py-1.5 text-center">Route</th>
            {[1, 2, 3, 4, 5].map((day) => (
              <th
                key={day}
                className={clsx(
                  "border border-slate-700/50 px-1 py-1 text-center transition-colors",
                  pinnedDay === day && "bg-blue-900/30",
                  day === loadDay && "ring-2 ring-blue-500/40 animate-pulse",
                  day === unloadsDay && "ring-2 ring-emerald-500/40 animate-pulse",
                )}
                onMouseEnter={() => setHoveredDay(day)}
                onMouseLeave={() => setHoveredDay(null)}
                onClick={() => togglePinDay(day)}
              >
                <div className="font-semibold text-slate-300">Day {day}</div>
                <div className="text-[10px] font-normal text-slate-500">{DAY_LABELS[day - 1]}
                  {day === loadDay && <span className="ml-1 text-blue-400">L</span>}
                  {day === unloadsDay && <span className="ml-1 text-emerald-400">U</span>}
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
                className={clsx(
                  "transition-colors",
                  i % 2 === 1 && "bg-slate-800/20",
                )}
              >
                <td
                  className={clsx(
                    "sticky left-0 z-10 border border-slate-700/50 bg-slate-900 px-1 py-1.5 text-center font-bold text-slate-200 transition-colors",
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
                  return (
                    <td
                      key={day}
                      className={clsx(
                        "border border-slate-700/50 px-1 py-1 text-center font-mono text-xs font-semibold transition-all",
                        off
                          ? highlight
                            ? "bg-red-700/60 text-red-200"
                            : "bg-red-900/60 text-red-400"
                          : highlight
                            ? "bg-slate-800/50 text-slate-500"
                            : day === loadDay
                              ? "text-blue-300 bg-blue-900/30 ring-1 ring-inset ring-blue-500/30 font-bold"
                              : day === unloadsDay
                                ? "text-emerald-300 bg-emerald-900/30 ring-1 ring-inset ring-emerald-500/30 font-bold"
                                : "text-slate-700",
                      )}
                    >
                      {off ? "OFF" : "RUN"}
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
                      day === loadDay
                        ? "bg-blue-900/30 text-blue-300"
                        : day === unloadsDay
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
          <span className="text-blue-400">{runningToday}</span> running <span className="text-blue-400">Day {loadDay}</span> · <span className="text-emerald-400">{rows.filter((t) => !isScheduledOff(t, unloadsDay)).length}</span> unloading <span className="text-emerald-400">Day {unloadsDay}</span> · {rows.length} total route trucks
        </div>
      )}
    </div>
  );
}
