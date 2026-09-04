/**
 * The one empty-state voice. ~40 empty states existed in five different
 * styles and voices ("Nothing yet." / "No items yet" / "None" / "All clear!"),
 * some at 2.3:1 contrast. One component, one tone, readable colour, and an
 * optional recovery action so the state is a doorway rather than a dead end.
 */
import type { ReactNode } from "react";
import clsx from "clsx";

export default function EmptyState({
  children,
  action,
  className,
  compact = false,
}: {
  /** The message — "No notes yet." Sentence case, terminal period. */
  children: ReactNode;
  /** Optional recovery action (a button/link), rendered after the message. */
  action?: ReactNode;
  className?: string;
  /** Inline row (for tight list slots) instead of the padded block. */
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        compact ? "flex flex-wrap items-center gap-2" : "flex flex-col items-center gap-2 py-6 text-center",
        className,
      )}
    >
      <p className="text-sm text-ink-muted">{children}</p>
      {action}
    </div>
  );
}
