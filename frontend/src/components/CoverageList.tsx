import clsx from "clsx";
import CoverageTag from "./CoverageTag";
import type { CoverageEntry } from "../utils/truckStatus";

/**
 * The one place coverage pills are rendered. Takes a normalized coverage list
 * (from useCoverageForRole / buildCoverageList) and renders CoverageTag chips,
 * so every surface — Load banner, Unload banner, Fleet, Report — reads
 * identically. Splits use the split variant; previous-day entries the prev
 * variant. Optionally groups Today / Previous day and flags recurring covers.
 */
export default function CoverageList({
  entries,
  grouped = false,
  isRecurring,
  emptyLabel,
  className,
}: {
  entries: CoverageEntry[];
  grouped?: boolean;
  isRecurring?: (e: CoverageEntry) => boolean;
  emptyLabel?: string;
  className?: string;
}) {
  if (entries.length === 0) {
    return emptyLabel ? <p className="text-xs text-ink-faint">{emptyLabel}</p> : null;
  }
  const chip = (e: CoverageEntry) => (
    <span key={`${e.route}-${e.cover}-${e.prev ? "p" : "t"}`} className="inline-flex items-center gap-1">
      <CoverageTag route={e.route} truck={e.cover} prev={e.prev} split={e.kind === "split"} />
      {isRecurring?.(e) && (
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">recurring</span>
      )}
      {e.kind === "swap-twoway" && (
        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300">2-way</span>
      )}
    </span>
  );
  if (!grouped) {
    return <div className={clsx("flex flex-wrap items-center gap-1.5", className)}>{entries.map(chip)}</div>;
  }
  const today = entries.filter((e) => !e.prev);
  const prev = entries.filter((e) => e.prev);
  return (
    <div className={clsx("space-y-2", className)}>
      {today.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint">Today</p>
          <div className="flex flex-wrap items-center gap-1.5">{today.map(chip)}</div>
        </div>
      )}
      {prev.length > 0 && (
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint">Previous day</p>
          <div className="flex flex-wrap items-center gap-1.5">{prev.map(chip)}</div>
        </div>
      )}
    </div>
  );
}
