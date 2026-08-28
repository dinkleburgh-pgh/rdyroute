/**
 * The collapsible coverage banner shared by Load, Unload and the Fleet board.
 *
 * Collapsed is the default: the chip row (CoverageList — the same pills every
 * dense surface uses) says everything a glance needs, and the big paired cards
 * were eating real estate on every page that showed them. Expanding brings the
 * full CoverageCards back; the choice sticks per device under `storageKey`.
 * Renders nothing with no entries.
 */
import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import CoverageCards from "./CoverageCards";
import CoverageList from "./CoverageList";
import type { CoverageEntry } from "../utils/truckStatus";
import type { TruckStatus } from "../types";

const TONES = {
  sky: {
    frame: { borderColor: "rgba(56,189,248,0.30)", background: "rgba(56,189,248,0.07)" },
    divider: { borderColor: "rgba(56,189,248,0.20)" },
    title: "text-sky-400",
    chevron: "text-sky-400/80",
  },
  amber: {
    frame: { borderColor: "rgba(245,158,11,0.28)", background: "rgba(245,158,11,0.06)" },
    divider: { borderColor: "rgba(245,158,11,0.18)" },
    title: "text-amber-400",
    chevron: "text-amber-400/80",
  },
} as const;

export default function CollapsibleCoverage({
  entries,
  title,
  storageKey,
  tone,
  headerExtra,
  isRecurring,
  statusOf,
  showPrevBadge = true,
  cardsClassName,
}: {
  entries: CoverageEntry[];
  title: string;
  /** localStorage key for the open/closed choice; unique per surface. */
  storageKey: string;
  tone: keyof typeof TONES;
  /** Extra header content after the title (an icon, a date). */
  headerExtra?: ReactNode;
  isRecurring?: (route: number, cover: number) => boolean;
  statusOf?: (truckNumber: number) => TruckStatus | null;
  showPrevBadge?: boolean;
  cardsClassName?: string;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) === "true"; } catch { return false; }
  });
  if (entries.length === 0) return null;
  const t = TONES[tone];
  return (
    <div className="rounded-xl border" style={t.frame}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            try { localStorage.setItem(storageKey, String(!v)); } catch { /* private mode */ }
            return !v;
          });
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <span className={clsx("text-[11px] font-semibold uppercase tracking-[0.08em]", t.title)}>{title}</span>
        {headerExtra}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-muted">
          {entries.length} route{entries.length === 1 ? "" : "s"}
        </span>
        <ChevronDown className={clsx("h-4 w-4 shrink-0 transition-transform", t.chevron, open && "rotate-180")} />
      </button>
      {open ? (
        <div className="border-t px-3.5 pb-3.5 pt-3.5" style={t.divider}>
          <CoverageCards
            entries={entries}
            isRecurring={isRecurring}
            statusOf={statusOf}
            showPrevBadge={showPrevBadge}
            className={cardsClassName}
          />
        </div>
      ) : (
        <div className="border-t px-3.5 pb-3 pt-2.5" style={t.divider}>
          <CoverageList
            entries={entries}
            isRecurring={isRecurring ? (e) => isRecurring(e.route, e.cover) : undefined}
          />
        </div>
      )}
    </div>
  );
}
