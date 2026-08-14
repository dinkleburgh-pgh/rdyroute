import { format, parseISO } from "date-fns";
import { useWearerDefaultsReview } from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { can } from "../../utils/permissions";
import { currentSheetPeriod, formatSheetPeriod, monthsBehind } from "../../utils/dates";
import { STALE_MONTHS_BEHIND } from "../../utils/wearerDefaults";

/**
 * "Which month's wearer sheets are these, and who confirmed them."
 *
 * The numbers on the batching screen come from paper that arrives once a month.
 * Weeks later, the person batching has no way to tell whether they are this
 * month's numbers or last quarter's — so this is a permanent byline at the
 * point of use, not a warning that only fires when something is wrong.
 *
 * Three states, and the difference between them is colour and wording only:
 *   current            → one quiet line naming who confirmed and when
 *   stale, can edit    → amber, with a way in
 *   stale, can't edit  → amber wording, no call to action (they'd 403 on save)
 *
 * No red tier at any age. Red is spoken for by overbatching and the capacity
 * ramp, and on the day this ships every install is unconfirmed — a red banner
 * everywhere at once reads as breakage, not as a task. Escalation past a month
 * goes in the words ("3 months behind"), never the colour.
 *
 * Renders nothing while settings are still loading, so it can be dropped in
 * anywhere without a layout jump.
 */
export default function WearerSheetStatus({
  onOpen,
  className,
}: {
  /** Opens the editor. Omit on surfaces that don't own one — the CTA is then dropped. */
  onOpen?: () => void;
  className?: string;
}) {
  const review = useWearerDefaultsReview();
  const { user } = useAuth();
  const canEdit = can(user?.role, "edit:wearer-defaults");

  const behind = monthsBehind(review?.period);
  const stale = review == null || behind == null || behind >= STALE_MONTHS_BEHIND;

  if (!stale && review) {
    // Current month: quiet line, but the month, the date and the name are the
    // three things anyone actually reads off it, so they carry the colour.
    return (
      <p className={className ?? "text-[11px] text-slate-500"}>
        <span className="font-bold text-slate-200">{formatSheetPeriod(review.period)}</span>
        {" sheets · confirmed "}
        <span className="font-semibold text-slate-300">{fmt(review.confirmed_at)}</span>
        {" by "}
        <span className="font-semibold text-sky-300">{review.confirmed_by_display || "unknown"}</span>
      </p>
    );
  }

  const behindLine =
    review == null
      ? "No confirmation on record — nobody has checked these against a paper sheet yet."
      : `On file: ${formatSheetPeriod(review.period)}, confirmed by ${review.confirmed_by_display || "unknown"} on ${fmt(review.confirmed_at)}.` +
        (behind != null && behind > 1 ? ` That is ${behind} months behind.` : "");

  // A loader who cannot save shouldn't be handed a task — same facts, no box,
  // no button.
  if (!canEdit) {
    return (
      <p className={className ?? "text-[11px] text-amber-200/70"}>
        {formatSheetPeriod(currentSheetPeriod())} wearer sheets not confirmed. {behindLine}
      </p>
    );
  }

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-2"
      }
    >
      <span className="rounded-pill bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
        Wearer sheets
      </span>
      <span className="text-xs font-semibold text-amber-200">
        {formatSheetPeriod(currentSheetPeriod())} not confirmed.
      </span>
      <span className="text-xs text-amber-200/70">{behindLine}</span>
      {onOpen && (
        <button type="button" className="btn-ghost ml-auto shrink-0 text-xs" onClick={onOpen}>
          Open editor
        </button>
      )}
    </div>
  );
}

/**
 * An instant, in the reader's locale.
 *
 * Deliberately not formatRunDate: that regex-slices the date off the front of
 * the string, which drops the time and ignores the UTC offset — dating a 9pm
 * edit to the next morning.
 */
function fmt(iso: string): string {
  try {
    return format(parseISO(iso), "PPp");
  } catch {
    return iso;
  }
}
