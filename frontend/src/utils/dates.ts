const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
