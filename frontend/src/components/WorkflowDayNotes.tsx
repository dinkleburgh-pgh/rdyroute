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
    <div className={className ?? "rounded-xl border border-sky-700/40 bg-sky-950/20 px-3 py-2.5"}>
      <div className="mb-1.5 flex items-center gap-2">
        <StickyNote className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-400">
          {label} notes{day != null ? ` · Day ${day}` : ""}
        </span>
      </div>
      <ul className="space-y-0.5">
        {/* Persistent first: it is true regardless of which day this is. The
            muted marker distinguishes it from the day-specific lines without
            needing a second heading. */}
        {persistent.map((l, i) => (
          <li key={`p${i}`} className="flex gap-1.5 text-xs leading-relaxed text-ink-soft">
            <span className="shrink-0 text-ink-muted" title="Every day">◦</span>
            <span>{l}</span>
          </li>
        ))}
        {dayLines.map((l, i) => (
          <li key={`d${i}`} className={clsx("flex gap-1.5 text-xs leading-relaxed text-ink-soft")}>
            <span className="shrink-0 text-sky-500">•</span>
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
