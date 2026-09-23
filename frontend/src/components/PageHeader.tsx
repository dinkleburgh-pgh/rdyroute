import type { ReactNode } from "react";
import clsx from "clsx";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type PageHeaderProps = {
  title: string;
  /** Sits beside the title at every width (e.g. a LIVE pill, "N to go"). */
  titleBadge?: ReactNode;
  /**
   * Live data only — never static copy. Shown at every width in the space the
   * old subtitle wasted; clips before it wraps. Day NUMBERS stay out of here:
   * the top bar's L#/U# chips own them.
   */
  meta?: ReactNode;
  /** Rendered at EVERY width — no page renders its own mobile duplicate. */
  actions?: ReactNode;
  className?: string;
};

/**
 * One slim row: title · badge · live meta · actions. The whole band is
 * ~44px — the old three-tier header (eyebrow / 3xl title / subtitle) spent
 * ~117px of desktop and ~63px of phone on text nobody reads twice, while
 * hiding the actions on phones so pages grew duplicate button bars.
 * flex-wrap is the overflow safety valve: an oversized action set wraps to a
 * second row on a narrow phone instead of clipping.
 */
export default function PageHeader({
  title,
  titleBadge,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  useDocumentTitle(title);
  return (
    <div
      className={clsx(
        "border-b border-hairline bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_36%),linear-gradient(180deg,rgba(2,6,23,0.6),rgba(15,23,42,0.4))] px-3 py-2 md:px-6 md:py-2.5",
        className,
      )}
    >
      <div className="flex min-h-[30px] flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h2 className="shrink-0 text-xl font-black leading-none tracking-tight text-ink">
          {title}
        </h2>
        {titleBadge}
        {meta && (
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-ink-muted">
            {meta}
          </span>
        )}
        {actions && (
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

const TONE_DOT: Record<string, string> = {
  dirty: "bg-st-dirty",
  unloaded: "bg-st-unloaded",
  loaded: "bg-st-loaded",
  inprogress: "bg-st-inprogress",
};

/** One live number in a header meta line: mono value, tiny label, optional status dot. */
export function Stat({
  value,
  label,
  tone,
}: {
  value: ReactNode;
  label?: string;
  tone?: keyof typeof TONE_DOT;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      {tone && <span className={clsx("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />}
      <span className="font-mono font-semibold tabular-nums text-ink-soft">{value}</span>
      {label && <span>{label}</span>}
    </span>
  );
}

/** The dot between Stats in a meta line. */
export function Sep() {
  return <span className="shrink-0 text-ink-faint">·</span>;
}
