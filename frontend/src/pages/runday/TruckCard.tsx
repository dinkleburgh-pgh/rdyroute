/**
 * Truck tile card used on the Day Overview (RunDay) grids. Extracted from RunDay.tsx.
 *
 * "Unloaded" status cards use a compact fleet-style horizontal layout (number
 * top-left, badge top-right) to visually distinguish done-unloads and load-ready
 * trucks from the active-workflow cards which keep the centered tall layout.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import clsx from "clsx";
import type { TruckNote, TruckStatus, TruckWithState } from "../../types";
import { STATUS_BG, STATUS_TEXT, STATUS_LABELS, DustGarmentIcon } from "./constants";
import AnimateCard from "../../components/AnimateCard";
import CoverageTag from "../../components/CoverageTag";

export default function TruckCard({
  t,
  status,
  done,
  coveringSpare,
  coversRoute,
  dayNum,
  isExtraDay,
  notes,
  context,
}: {
  t: TruckWithState;
  status: TruckStatus;
  done: boolean;
  coveringSpare?: TruckWithState;
  /** When set, this card IS the covering truck — show which route it covers. */
  coversRoute?: number;
  dayNum?: number;
  isExtraDay?: boolean;
  notes?: TruckNote[];
  context?: "unload" | "load";
}) {
  const [notePopoverOpen, setNotePopoverOpen] = useState(false);
  const visibleNotes = useMemo(
    () => (notes ?? []).filter(
      (n) => n.note_type === "constant" || n.note_type === "one_off" || n.workday_num === dayNum
    ),
    [notes, dayNum],
  );
  const showNotes = visibleNotes.length > 0 && (status === "in_progress" || status === "unloaded");
  // Corner badges (note top-left, garment top-right) are absolutely positioned in
  // the top band of the card, where the big centered truck number also sits. When
  // either is present we reserve a top band (pt-8) so the badge never overlaps /
  // hides a digit of the number — worst case a 3-digit number, which both badges
  // can clip.
  const hasGarmentBadge = t.truck_type === "Dust" && !!t.state?.has_dust_garment;
  const hasCornerBadge = showNotes || hasGarmentBadge;

  // The notes popover is rendered in a portal with fixed positioning so it can
  // never be clipped by a card/grid or run off the screen edge (the old
  // `absolute w-64` version overflowed the viewport on right-column cards). We
  // measure the badge and clamp the popover into the viewport, flipping it above
  // the badge if it would overflow the bottom.
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  const notePopRef = useRef<HTMLDivElement>(null);
  const [notePos, setNotePos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!notePopoverOpen) {
      setNotePos(null);
      return;
    }
    const place = () => {
      const btn = noteBtnRef.current;
      const pop = notePopRef.current;
      if (!btn || !pop) return;
      const r = btn.getBoundingClientRect();
      const m = 8; // viewport margin
      const width = Math.min(256, window.innerWidth - m * 2);
      const left = Math.max(m, Math.min(r.left, window.innerWidth - width - m));
      const popH = pop.offsetHeight;
      let top = r.bottom + m;
      if (top + popH > window.innerHeight - m) {
        const above = r.top - m - popH;
        top = above >= m ? above : Math.max(m, window.innerHeight - popH - m);
      }
      setNotePos({ top, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [notePopoverOpen]);

  // Close on click/tap outside the popover (and its trigger) or on Escape.
  useEffect(() => {
    if (!notePopoverOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (notePopRef.current?.contains(target) || noteBtnRef.current?.contains(target)) return;
      setNotePopoverOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotePopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [notePopoverOpen]);

  const rawStatus = (t.state?.status ?? status) as TruckStatus;
  // Status chip: show the underlying dirty/unloaded for off trucks so the real
  // workflow state is always visible first.
  const statusBadge = status === "off" && (rawStatus === "dirty" || rawStatus === "unloaded") ? (
    <span className={clsx("rounded px-1.5 py-0.5 text-xs font-semibold text-white", STATUS_BG[rawStatus])}>
      {STATUS_LABELS[rawStatus]}
    </span>
  ) : (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 text-xs font-semibold text-white",
        STATUS_BG[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
  // Off chip shown below the status chip, not instead of it.
  // Spares are always off unless assigned — the badge is redundant for them.
  const offChip = status === "off" && context && t.truck_type !== "Spare" ? (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 text-xs font-semibold",
        context === "unload"
          ? "bg-slate-700 text-slate-300"
          : "bg-blue-950 text-blue-400 ring-1 ring-blue-800/60",
      )}
    >
      {context === "unload" ? "U Off" : "L Off"}
    </span>
  ) : null;

  const dayChip = dayNum != null ? (
    <span
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        isExtraDay
          ? "bg-amber-900/60 text-amber-300"
          : "bg-blue-900/60 text-blue-300",
      )}
    >
      Day {dayNum}
    </span>
  ) : null;

  const coverageBadge = coversRoute != null ? (
    <CoverageTag route={coversRoute} truck={t.truck_number} />
  ) : coveringSpare ? (
    <CoverageTag route={t.truck_number} truck={coveringSpare.truck_number} />
  ) : t.route_swap_route != null && t.truck_type !== "Spare" ? (
    <CoverageTag route={t.route_swap_route} truck={t.truck_number} />
  ) : null;

  // Centered card for all statuses
  return (
    <AnimateCard
      className={clsx(
        "card relative flex flex-col items-center gap-1.5 px-3 pb-3 text-center transition-opacity min-h-[7.5rem]",
        hasCornerBadge ? "pt-8" : "pt-3",
        done && "opacity-40",
        status === "in_progress" && "animate-pulse ring-2 ring-amber-400",
        showNotes && "ring-1 ring-violet-500/50",
      )}
    >
      {hasGarmentBadge && (
        <span
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-full border border-amber-500/60 bg-amber-950/70 p-0.5"
          title="Garments assigned"
        >
          <DustGarmentIcon className="h-3.5 w-3.5 text-amber-300" />
        </span>
      )}
      <span
        className={clsx(
          "text-4xl font-extrabold tabular-nums leading-none",
          STATUS_TEXT[status],
        )}
      >
        {t.truck_number}
      </span>
      {statusBadge}
      {offChip}
      <span className="text-xs text-slate-500">
        {t.truck_type}
      </span>
      {coverageBadge}
      {dayChip}
      {t.state?.needs_checked && (
        <span className="rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
          Needs Checked
        </span>
      )}
      {showNotes && (
        <div className="absolute left-2 top-2 z-20">
          <button
            ref={noteBtnRef}
            type="button"
            onClick={(e) => { e.stopPropagation(); setNotePopoverOpen((o) => !o); }}
            className="inline-flex items-center gap-1 rounded-md border border-violet-700/40 bg-violet-950/60 px-2 py-0.5 text-[11px] font-medium leading-none text-violet-300 transition-colors hover:bg-violet-900/50"
            aria-haspopup="dialog"
            aria-expanded={notePopoverOpen}
          >
            📝 {visibleNotes.length}
          </button>
        </div>
      )}
      {showNotes && notePopoverOpen && createPortal(
        <div
          ref={notePopRef}
          role="dialog"
          aria-label={`Notes for truck ${t.truck_number}`}
          className="fixed z-50 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
          style={{
            top: notePos?.top ?? 0,
            left: notePos?.left ?? 0,
            width: notePos?.width ?? 256,
            maxHeight: "70vh",
            overflowY: "auto",
            visibility: notePos ? "visible" : "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
              #{t.truck_number} · Notes
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setNotePopoverOpen(false); }}
              className="-mr-1 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              aria-label="Close notes"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {visibleNotes.map((n) => (
              <div key={n.id}>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
                  {n.note_type === "constant" ? "Always" : n.note_type === "one_off" ? "One-off" : `Day ${n.workday_num}`}
                </span>
                <p className="mt-0.5 text-xs leading-snug text-slate-200">{n.body}</p>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </AnimateCard>
  );
}
