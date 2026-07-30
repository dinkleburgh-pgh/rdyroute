import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * One collapsible section of the Notes page.
 *
 * The page holds three quite different things — unload notes, load notes, and
 * the per-truck board — so each is a labelled drawer rather than a run of
 * stacked panels. The heading is deliberately large: it is the only thing on
 * screen when everything is closed, and it is read at a glance from a dock
 * tablet, not studied.
 *
 * Controlled on purpose. The truck section has to open itself when the page is
 * deep-linked from a driver-note toast (/notes?truck=57), so open state belongs
 * to the caller.
 */
export default function NotesSection({
  title,
  subtitle,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  /** Shown as a pill when > 0 — says whether there's anything inside without
   *  needing to open it. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-800/40 md:px-5 md:py-5"
      >
        {icon && <span className="shrink-0 text-sky-400">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-black leading-tight tracking-tight text-slate-100 md:text-2xl">
            {title}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-slate-500 md:text-sm">
            {subtitle}
          </span>
        </span>
        {count != null && count > 0 && (
          <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-sm font-bold tabular-nums text-slate-300">
            {count}
          </span>
        )}
        <span
          className={clsx(
            "shrink-0 text-2xl leading-none text-slate-500 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        >
          ▸
        </span>
      </button>

      {open && <div className="border-t border-slate-700 px-4 py-4 md:px-5">{children}</div>}
    </section>
  );
}
