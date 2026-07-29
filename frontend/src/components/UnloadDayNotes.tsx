import { StickyNote } from "lucide-react";
import { useUnloadDayTemplate } from "../api/hooks";

/**
 * The standing notes off the paper unload sheet for a given unload day —
 * the constraints that repeat every week ("69 must be in its own batch",
 * "62 and 95 have black napkins"), which previously only existed on paper.
 *
 * Renders nothing when the day has no notes, so it can be dropped onto any
 * unload-side surface without leaving an empty box behind.
 */
export default function UnloadDayNotes({
  unloadsDay,
  className,
}: {
  unloadsDay: number | null | undefined;
  className?: string;
}) {
  const { notes } = useUnloadDayTemplate(unloadsDay);
  const lines = notes
    .split("\n")
    .map((l) => l.replace(/^\s*[*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  return (
    <div className={className ?? "rounded-xl border border-sky-700/40 bg-sky-950/20 px-3 py-2.5"}>
      <div className="mb-1.5 flex items-center gap-2">
        <StickyNote className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-400">
          Day {unloadsDay} sheet notes
        </span>
      </div>
      <ul className="space-y-0.5">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-soft">
            <span className="shrink-0 text-sky-500">•</span>
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
