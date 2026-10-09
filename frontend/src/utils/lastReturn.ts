/**
 * "Last return" — what a route sent back on its most recent audit, reminded on
 * that route's next loads.
 *
 * Every audit entry is a return; there is no flag to remember to set. An entry
 * is filed under its ROUTE (route_override, else the audited truck) and dated
 * by its run_date. A truck loading tonight shows the newest return of the route
 * it is carrying, from the last LAST_RETURN_DAYS days, strictly before tonight
 * — an audit logged during tonight's load starts reminding from the next day.
 * Nothing is acknowledged: a newer return of the route replaces it, it ages out
 * of the window, or the auditor mutes the row on the Audit page.
 *
 * Mute = warning_applied && !warn_on_next_load. Legacy rows flagged
 * warn_on_next_load always count.
 */
import { differenceInCalendarDays, format } from "date-fns";
import { workdayNumbers } from "../components/Clock";
import { isScheduledOff, previousRunDate } from "./truckStatus";
import type { AuditEntry } from "../types";

export const LAST_RETURN_DAYS = 14;
export const RETURN_HISTORY_DAYS = 90;

export interface ReturnItem {
  label: string;
  qty: number;
  muted: boolean;
}

export interface ReturnDay {
  route: number;
  runDate: string;
  items: ReturnItem[];
  /** Pieces that still remind (muted rows excluded). */
  total: number;
  notes: string[];
  /** Physical trucks the entries were logged against. */
  trucks: number[];
}

export type ReturnReason = "last load" | "same day last week" | "same day 2 weeks ago";

export interface LastReturn extends ReturnDay {
  tone: "loud" | "quiet";
  reason: ReturnReason | null;
}

export const routeOf = (e: AuditEntry): number => e.route_override ?? e.truck_number;

export const isMuted = (e: AuditEntry): boolean =>
  e.warning_applied === true && e.warn_on_next_load === false;

/** Entries grouped per (route, run_date), newest day first, then by route. */
export function groupReturnDays(entries: AuditEntry[]): ReturnDay[] {
  const sorted = [...entries].sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : 0));
  const groups = new Map<string, { day: ReturnDay; perItem: Map<string, { qty: number; allMuted: boolean }> }>();
  for (const e of sorted) {
    const route = routeOf(e);
    const key = `${route}|${e.run_date}`;
    let g = groups.get(key);
    if (!g) {
      g = { day: { route, runDate: e.run_date, items: [], total: 0, notes: [], trucks: [] }, perItem: new Map() };
      groups.set(key, g);
    }
    const muted = isMuted(e);
    const item = g.perItem.get(e.item_label) ?? { qty: 0, allMuted: true };
    item.qty += e.quantity;
    item.allMuted = item.allMuted && muted;
    g.perItem.set(e.item_label, item);
    if (!muted) g.day.total += e.quantity;
    const note = e.note?.trim();
    if (note && !g.day.notes.includes(note)) g.day.notes.push(note);
    if (!g.day.trucks.includes(e.truck_number)) g.day.trucks.push(e.truck_number);
  }
  const days = [...groups.values()].map(({ day, perItem }) => ({
    ...day,
    items: [...perItem.entries()]
      .map(([label, v]) => ({ label, qty: v.qty, muted: v.allMuted }))
      .sort((a, b) => b.qty - a.qty),
    trucks: [...day.trucks].sort((a, b) => a - b),
  }));
  return days.sort((a, b) => (a.runDate === b.runDate ? a.route - b.route : a.runDate < b.runDate ? 1 : -1));
}

/** Each route's newest non-muted return day. */
export function lastReturnByRoute(entries: AuditEntry[]): Map<number, ReturnDay> {
  const out = new Map<number, ReturnDay>();
  for (const day of groupReturnDays(entries.filter((e) => !isMuted(e)))) {
    if (!out.has(day.route)) out.set(day.route, day);
  }
  return out;
}

/**
 * The route's own previous load date: the plant's previous operating day,
 * stepped back over the nights this route is scheduled off. Most routes skip
 * one load day a week, so on the load after that night the plant's "yesterday"
 * is not the route's — its last load was the night before.
 */
export function routePrevLoadDate(
  routeTruck: { scheduled_off_days: number[] } | null | undefined,
  prevDay: string,
): string {
  if (!routeTruck || (routeTruck.scheduled_off_days ?? []).length === 0) return prevDay;
  let d = prevDay;
  for (let i = 0; i < 7; i++) {
    if (!isScheduledOff(routeTruck, workdayNumbers(new Date(`${d}T12:00:00`)).loadDay)) return d;
    d = previousRunDate(d);
  }
  return prevDay;
}

/**
 * How loudly to remind. Loud when the return came off the route's own last
 * load (`lastLoadDate`, from routePrevLoadDate) or the same weekday (same
 * customers); otherwise a quiet one-liner.
 */
export function describeReturn(ret: ReturnDay, runDate: string, lastLoadDate: string): LastReturn {
  const tonight = new Date(`${runDate}T12:00:00`);
  const then = new Date(`${ret.runDate}T12:00:00`);
  // On or after the route's last scheduled load: a return logged on a night
  // it ran unscheduled (holiday, covering) is just as fresh.
  if (ret.runDate >= lastLoadDate) return { ...ret, tone: "loud", reason: "last load" };
  if (tonight.getDay() === then.getDay()) {
    const age = differenceInCalendarDays(tonight, then);
    return { ...ret, tone: "loud", reason: age <= 7 ? "same day last week" : "same day 2 weeks ago" };
  }
  return { ...ret, tone: "quiet", reason: null };
}

export function fmtReturnDate(iso: string, pattern = "EEE MMM d"): string {
  return format(new Date(`${iso}T12:00:00`), pattern);
}
