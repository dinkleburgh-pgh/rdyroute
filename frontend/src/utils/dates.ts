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

// ---------------------------------------------------------------------------
// Service months ("YYYY-MM")
//
// The wearer sheets arrive as a monthly artifact, so the month itself is a
// value the app stores and compares. Built on easternNow() so the month
// boundary lands where every other date in the app does, whatever the device
// timezone says.
// ---------------------------------------------------------------------------

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The current service month in Eastern, as "YYYY-MM". */
export function currentSheetPeriod(): string {
  const d = easternNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-08" → "August 2026". Returns the input unchanged if it isn't a period. */
export function formatSheetPeriod(period?: string | null): string {
  if (!period) return "";
  const m = PERIOD_RE.exec(period);
  if (!m) return period;
  return `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * How many whole calendar months `period` is behind now — 0 for the current
 * month, 1 the day the month rolls over. Null when the period is missing or
 * malformed.
 *
 * Whole months on purpose. Sheets arrive on no fixed date, so any "N days old"
 * rule fires while the paper is still in transit, which is how you train people
 * to ignore a warning.
 */
export function monthsBehind(period?: string | null, now: Date = easternNow()): number | null {
  if (!period) return null;
  const m = PERIOD_RE.exec(period);
  if (!m) return null;
  return (now.getFullYear() * 12 + now.getMonth() + 1) - (Number(m[1]) * 12 + Number(m[2]));
}

/**
 * The operational run date as a Date: backs up to the previous calendar day
 * before 6am (still 3rd shift), and freezes Sat/Sun to the preceding Friday —
 * the weekend is one continuous run period that rolls over at 6am Monday.
 * THE one implementation: todayIso() and Clock's workdayNumbers() both
 * delegate here (each used to carry its own copy of this algorithm).
 */
export function shiftRunDate(d = easternNow()): Date {
  let r = d.getHours() < 6
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
    : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = r.getDay(); // 0=Sun .. 6=Sat
  if (wd === 6) r = new Date(r.getFullYear(), r.getMonth(), r.getDate() - 1);
  else if (wd === 0) r = new Date(r.getFullYear(), r.getMonth(), r.getDate() - 2);
  return r;
}

/** Local YYYY-MM-DD of a Date (no timezone conversion). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
