/**
 * The monthly wearer-sheet review marker.
 *
 * The five day-sheets are one paper artifact that arrives once a month, so the
 * thing worth recording is not "when did a number last change" but "who last
 * checked this month's sheets" — a fact that has to be recordable even when
 * nothing changed. That is stored as one AppSetting row whose value the server
 * stamps; see _stamp_wearer_defaults_review in routers/settings.py.
 *
 * Pure module (no React). The hooks that read it live in api/hooks.ts.
 */

export const WEARER_DEFAULTS_REVIEW_KEY = "wearer_defaults_review";

/**
 * How many whole months behind the confirmed period counts as stale.
 *
 * 1 means the nudge appears the day the calendar month rolls over. This is the
 * one knob to turn if it proves naggy — raise it to 2 to let the first month
 * pass in silence.
 */
export const STALE_MONTHS_BEHIND = 1;

/** Who stamped one day's sheet, and when. */
export interface WearerDayStamp {
  period: string;
  at: string;
  by: string;
  by_display: string;
}

export interface WearerDefaultsReview {
  version?: number;
  /** Service month the sheets were confirmed FOR, "YYYY-MM". */
  period: string;
  /** Instant of the confirmation, ISO 8601 with offset. */
  confirmed_at: string;
  confirmed_by: string;
  confirmed_by_display: string;
  confirmed_by_role?: string;
  /** Days whose numbers actually moved in that save. */
  changed_days: number[];
  /** Per-day authorship, carried forward across months. Keyed by day as a string. */
  days: Record<string, WearerDayStamp>;
}

function asStamp(v: unknown): WearerDayStamp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string" || typeof o.by !== "string") return null;
  return {
    period: typeof o.period === "string" ? o.period : "",
    at: o.at,
    by: o.by,
    by_display: typeof o.by_display === "string" && o.by_display ? o.by_display : o.by,
  };
}

/**
 * Parse the stored value defensively.
 *
 * SettingOut.value is typed `Any` and nothing validates the row at rest, so a
 * hand-edited or half-restored value has to degrade to "not confirmed yet"
 * rather than throw inside a render.
 */
export function parseWearerDefaultsReview(value: unknown): WearerDefaultsReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.period !== "string" || typeof o.confirmed_at !== "string") return null;
  if (!o.period || !o.confirmed_at) return null;

  const by = typeof o.confirmed_by === "string" ? o.confirmed_by : "";
  const days: Record<string, WearerDayStamp> = {};
  if (o.days && typeof o.days === "object" && !Array.isArray(o.days)) {
    for (const [k, v] of Object.entries(o.days as Record<string, unknown>)) {
      const s = asStamp(v);
      if (s) days[k] = s;
    }
  }

  return {
    version: typeof o.version === "number" ? o.version : undefined,
    period: o.period,
    confirmed_at: o.confirmed_at,
    confirmed_by: by,
    confirmed_by_display:
      typeof o.confirmed_by_display === "string" && o.confirmed_by_display
        ? o.confirmed_by_display
        : by,
    confirmed_by_role: typeof o.confirmed_by_role === "string" ? o.confirmed_by_role : undefined,
    changed_days: Array.isArray(o.changed_days)
      ? o.changed_days.map(Number).filter((n) => Number.isFinite(n))
      : [],
    days,
  };
}
