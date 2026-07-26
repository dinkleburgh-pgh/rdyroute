const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// The app runs on US Eastern wall-clock (DST-aware — EDT/EST). Fixing this here
// keeps the operational run date, the 6am shift rollover, and clock displays
// consistent on every device, not just ones whose OS timezone is Eastern.
export const APP_TIMEZONE = "America/New_York";

/**
 * "Now" as a Date whose LOCAL fields (getHours/getDate/getDay/…) equal the
 * current wall-clock time in US Eastern. The app's operational-date logic reads
 * local Date fields, so feeding it this makes "today" and the shift boundaries
 * resolve in Eastern regardless of the device's own timezone.
 */
export function easternNow(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const hour = g("hour") % 24; // hour12:false can render midnight as "24"
  return new Date(g("year"), g("month") - 1, g("day"), hour, g("minute"), g("second"));
}

/**
 * Format an instant (epoch seconds, or a Date) as Eastern wall-clock time,
 * e.g. "9:05 AM" — so stored timestamps read the same on any device.
 */
export function formatEasternTime(epochSecOrDate: number | Date): string {
  const d = typeof epochSecOrDate === "number" ? new Date(epochSecOrDate * 1000) : epochSecOrDate;
  return d.toLocaleTimeString("en-US", {
    timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit",
  });
}

/**
 * Format an ISO date string (YYYY-MM-DD, e.g. a run_date) for display as
 * month-first, year-last — "Jun 26, 2026" — instead of the year-first ISO form.
 * Parses the string directly (no Date object) to avoid timezone shifts.
 * Returns "" for empty input and the original string if it isn't an ISO date.
 */
export function formatRunDate(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}
