import { useState } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { formatUnitBreakdown, type CategoryAgg } from "../../utils/itemUnits";

/**
 * One category in the standup snapshot. Headline shows the category total in
 * its own units + pieces (e.g. "20 bags (200)"); tap to expand per-item rows.
 */
export default function CategoryCard({
  cat,
  accent = "bg-blue-500",
  defaultOpen = false,
}: {
  cat: CategoryAgg;
  accent?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headline = formatUnitBreakdown({ pieces: cat.pieces, unitCount: cat.unitCount, unitLabel: cat.unitLabel });

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-800/40"
      >
        <ChevronRight className={clsx("h-4 w-4 shrink-0 text-slate-500 transition-transform", open && "rotate-90")} />
        <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", accent)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">{cat.name}</p>
          <p className="text-[11px] text-slate-500">
            {cat.entryCount} entr{cat.entryCount !== 1 ? "ies" : "y"} · {cat.items.length} item{cat.items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <p className="shrink-0 text-right text-sm font-bold text-white">{headline}</p>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 py-1.5">
          {cat.items.map((it) => (
            <div key={it.label} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="truncate text-slate-300">{it.label}</span>
              <span className="shrink-0 font-mono text-xs text-slate-400">{formatUnitBreakdown(it.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
