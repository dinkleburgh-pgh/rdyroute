/**
 * The route's last audit return, on the Load side (see utils/lastReturn.ts).
 *
 * Loud returns (the route's last load, or the same weekday) render as a teal
 * block; quiet ones, and the `line` variant, as one muted line. Teal is used on
 * no other load surface, so it never reads as garments (amber), NOGs (rose),
 * Up next (sky) or an alarm (red).
 */
import clsx from "clsx";
import { History } from "lucide-react";
import { useItemDisplayName } from "../shorts/HierarchyPicker";
import { fmtReturnDate, type LastReturn } from "../../utils/lastReturn";

export default function ReturnReminder({
  ret,
  variant = "block",
  big = false,
  className,
}: {
  ret: LastReturn | null;
  variant?: "block" | "line";
  /** Larger type — the Load Display's notes rail. */
  big?: boolean;
  className?: string;
}) {
  const itemDisplayName = useItemDisplayName();
  if (!ret) return null;
  const loud = ret.tone === "loud";
  const named = (n: number) => ret.items.slice(0, n).map((i) => `${itemDisplayName(i.label)} ×${i.qty}`);
  const more = (n: number) => (ret.items.length > n ? ` +${ret.items.length - n} more` : "");

  if (variant === "line" || !loud) {
    return (
      <p
        className={clsx(
          "flex items-center gap-1.5 leading-snug",
          big ? "text-sm" : "text-xs",
          loud ? "text-teal-300" : "text-ink-muted",
          className,
        )}
      >
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          Last return {fmtReturnDate(ret.runDate)} · {named(3).join(", ")}
          {more(3)}
        </span>
      </p>
    );
  }

  const otherTrucks = ret.trucks.length > 0 && !ret.trucks.includes(ret.route);
  return (
    <div className={clsx("rounded-lg border border-teal-500/40 bg-teal-500/[0.08] px-3 py-2.5", className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-teal-300">
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Last return · {fmtReturnDate(ret.runDate)}</span>
        {otherTrucks && <span>· on #{ret.trucks.join(", #")}</span>}
        {ret.reason && <span>· {ret.reason}</span>}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className={clsx("min-w-0 font-bold text-ink", big ? "text-xl leading-snug" : "text-[15px]")}>
          {named(4).join(" · ")}
          {more(4)}
        </p>
        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">{ret.total} pcs</span>
      </div>
      {ret.notes.slice(0, 2).map((n) => (
        <p key={n} className={clsx("mt-0.5 italic text-ink-soft", big ? "text-base" : "text-[13px]")}>
          “{n}”
        </p>
      ))}
    </div>
  );
}

/** A short " · Last return Mon" tag for dock slot sub-lines — loud returns only. */
export function ReturnTag({ ret }: { ret: LastReturn | null }) {
  if (ret?.tone !== "loud") return null;
  return <span className="font-semibold text-teal-300"> · Last return {fmtReturnDate(ret.runDate, "EEE")}</span>;
}
