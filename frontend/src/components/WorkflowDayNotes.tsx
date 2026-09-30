import { StickyNote } from "lucide-react";
import clsx from "clsx";
import { useActiveWorkflowNotes, type NoteScope } from "../api/hooks";

/**
 * The standing notes for a workflow, as they apply right now: the persistent
 * set (every run day) followed by the current workday's.
 *
 * These are the constraints that repeat every week — "69 must be in its own
 * batch", "62 and 95 have black napkins" — which used to live only on the paper
 * sheet. Edited on the Notes page.
 *
 * Styled as the note card it replaces: a warm card with a titled header strip
 * and one ruled line per note, in body-size type — this is read across a
 * dock, not scanned as metadata. Every-day notes wear a small tag so the
 * day-specific ones stand out without a second heading.
 *
 * Renders nothing when there is nothing to say, so it can be dropped onto any
 * surface without leaving an empty box behind.
 */
export default function WorkflowDayNotes({
  scope,
  day,
  className,
}: {
  scope: NoteScope;
  /** The workday this surface is working — unload day or load day. */
  day: number | null | undefined;
  className?: string;
}) {
  const { persistent, day: dayLines } = useActiveWorkflowNotes(scope, day);
  if (persistent.length === 0 && dayLines.length === 0) return null;

  const label = scope === "unload" ? "Unload" : "Load";

  return (
    <section
      className={clsx(
        "overflow-hidden rounded-xl border border-amber-500/30 bg-amber-950/20 shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5">
        <StickyNote className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200">
          {label} notes{day != null ? ` · Day ${day}` : ""}
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-amber-300/70">
          {persistent.length + dayLines.length}
        </span>
      </div>
      <ul className="divide-y divide-amber-500/10 px-4">
        {/* Persistent first: it is true regardless of which day this is. */}
        {persistent.map((l, i) => (
          <li key={`p${i}`} className="flex items-start gap-3 py-2.5">
            <span
              className="mt-[3px] shrink-0 rounded-[4px] bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-amber-200/90"
              title="Applies every day"
            >
              Every day
            </span>
            <span className="text-[15px] leading-snug text-ink">{l}</span>
          </li>
        ))}
        {dayLines.map((l, i) => (
          <li key={`d${i}`} className="flex items-start gap-3 py-2.5">
            <span className="mt-[9px] h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
            <span className="text-[15px] leading-snug text-ink">{l}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
