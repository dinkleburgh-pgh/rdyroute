import { useEffect, useState } from "react";

export interface ShiftInfo {
  name: "1st" | "2nd" | "3rd";
  label: string;
  hours: string;
}

export function currentShift(d = new Date()): ShiftInfo {
  const h = d.getHours();
  if (h >= 6 && h < 14) return { name: "1st", label: "1st Shift", hours: "6am – 2pm" };
  if (h >= 14 && h < 22) return { name: "2nd", label: "2nd Shift", hours: "2pm – 10pm" };
  return { name: "3rd", label: "3rd Shift", hours: "10pm – 6am" };
}

export default function Clock({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const shift = currentShift(now);
  if (compact) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-blue-400">
          {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-slate-700 text-slate-300">
          {shift.name}
        </span>
      </span>
    );
  }
  return (
    <div className="space-y-0.5">
      <span className="text-2xl font-bold tabular-nums text-blue-400">
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
      </span>
      <p className="text-xs font-semibold text-slate-400">{shift.label} · {shift.hours}</p>
    </div>
  );
}

export function todayLong(): string {
  return shiftRunDate().toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Returns the operational run date: backs up to the previous calendar day
 * if the current time is before 6am (still in 3rd shift).
 */
export function shiftRunDate(d = new Date()): Date {
  if (d.getHours() < 6) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  }
  return d;
}

/**
 * V1's ship_day_number: Mon=1..Fri=5, Sat/Sun→1.
 */
export function shipDayNumber(d: Date): number {
  const wd = d.getDay(); // Sun=0..Sat=6
  // JS Sun=0, Mon=1, ..., Sat=6 → V1 Mon=1..Fri=5
  if (wd >= 1 && wd <= 5) return wd;
  return 1;
}

/**
 * Returns { loadDay, unloadsDay } for the current operational run date.
 * Defaults to the shift-adjusted "now" so 3rd-shift workers (midnight–6am)
 * see the previous calendar day's run context automatically.
 * Pass an explicit date when computing from a specific run_date string.
 */
export function workdayNumbers(now = shiftRunDate()): { loadDay: number; unloadsDay: number } {
  const unloadsDay = shipDayNumber(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { loadDay: shipDayNumber(tomorrow), unloadsDay };
}
