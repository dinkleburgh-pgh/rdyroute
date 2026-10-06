/**
 * The Day Overview's truck card system — three sizes, one anatomy:
 *
 *   Working card · 64px   status stripe · number · label + sub-line · ≤1 badge (+ notes)
 *   Ready card   · 48px   green stripe · number · sub-line — no label: the stripe
 *                         and the "Ready to load" header already say it
 *   Done / Off chip · 32px  number with a check (done) or a U OFF / L OFF / OOS tag
 *
 * Horizontal on purpose: the same information as the old centred tile at half
 * the height, and nothing sits in a corner over the number any more. Visual
 * mass follows the work left — a finished truck is a chip, not a faded card.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, StickyNote, X } from "lucide-react";
import AnimateCard from "../../components/AnimateCard";
import { STATUS_BG, STATUS_LABELS } from "../../constants/truckStatus";
import type { TruckNote, TruckStatus } from "../../types";

/** Number tints: the 400-weight of each status colour. The 500 stripe hexes
 *  (#ef4444, #22c55e…) fall under 4.5:1 on the card surface; these clear it. */
export const NUMBER_TEXT: Record<TruckStatus, string> = {
  dirty: "text-red-400",
  unfinished: "text-fuchsia-400",
  shop: "text-violet-400",
  in_progress: "text-amber-400",
  unloaded: "text-green-400",
  loaded: "text-blue-300",
  off: "text-slate-400",
  oos: "text-slate-400",
  spare: "text-cyan-300",
};

export type CardBadge = { label: string; tone: "amber" | "violet" | "sky" | "green" };
const BADGE_TONE: Record<CardBadge["tone"], string> = {
  amber: "bg-amber-500/20 text-amber-200",
  violet: "bg-violet-500/20 text-violet-200",
  sky: "bg-sky-500/20 text-sky-200",
  green: "bg-emerald-500/20 text-emerald-200",
};

function Badge({ b }: { b: CardBadge }) {
  return <span className={clsx("badge shrink-0 text-[9px] font-bold", BADGE_TONE[b.tone])}>{b.label}</span>;
}

/** Whole minutes since a unix-seconds stamp, re-read every 30s; null when idle.
 *  Cheap enough per card: only cards with a stamp keep an interval. */
export function useMinutesSince(startSec: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startSec == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [startSec]);
  if (startSec == null) return null;
  return Math.max(0, Math.floor((now / 1000 - startSec) / 60));
}

/**
 * The "N notes" badge with its popover. Portaled and fixed-positioned so it
 * can never be clipped by a lane or run off the screen edge; measured against
 * the badge and flipped above it when it would overflow the bottom.
 */
export function NotesBadge({ truckNumber, notes }: { truckNumber: number; notes: TruckNote[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = btnRef.current;
      const pop = popRef.current;
      if (!btn || !pop) return;
      const r = btn.getBoundingClientRect();
      const m = 8;
      const width = Math.min(256, window.innerWidth - m * 2);
      const left = Math.max(m, Math.min(r.left, window.innerWidth - width - m));
      const popH = pop.offsetHeight;
      let top = r.bottom + m;
      if (top + popH > window.innerHeight - m) {
        const above = r.top - m - popH;
        top = above >= m ? above : Math.max(m, window.innerHeight - popH - m);
      }
      setPos({ top, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={clsx("badge shrink-0 gap-1 text-[9px] font-bold transition-colors hover:bg-violet-500/30", BADGE_TONE.violet)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${notes.length} ${notes.length === 1 ? "note" : "notes"} for truck ${truckNumber}`}
      >
        <StickyNote className="h-3 w-3" aria-hidden />
        {notes.length} {notes.length === 1 ? "note" : "notes"}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={`Notes for truck ${truckNumber}`}
            className="fixed z-50 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: pos?.width ?? 256,
              maxHeight: "70vh",
              overflowY: "auto",
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
                #{truckNumber} · Notes
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                className="-mr-1 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                aria-label="Close notes"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {notes.map((n) => (
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
    </>
  );
}

const CARD_SHADOW = "shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_6px_18px_-12px_rgba(0,0,0,0.7)]";

/** 64px: a truck with work still on it. `emphasis` is the steady amber halo
 *  for the one being worked right now — eight pulsing cards was noise. */
export function WorkingCard({
  number,
  status,
  label,
  sub,
  badge,
  notes,
  sinceSec,
  emphasis,
}: {
  number: number;
  status: TruckStatus;
  /** Overrides the status word (e.g. "Unloading" on a dirty truck the dock is on). */
  label?: string;
  sub: string;
  badge?: CardBadge;
  notes?: TruckNote[];
  /** Unix seconds the current work started — appends "· N min" to the sub-line. */
  sinceSec?: number | null;
  emphasis?: boolean;
}) {
  const mins = useMinutesSince(sinceSec);
  const subLine = mins == null ? sub : `${sub} · ${mins} min`;
  return (
    <AnimateCard
      hoverScale={1}
      className={clsx(
        // flex-wrap + truncating label: on a narrow tablet column the badges
        // drop to their own row instead of running under the status word or
        // getting clipped by overflow-hidden (the "Garments"/note-chip overlap).
        "relative flex min-h-[64px] flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden rounded-[10px] border bg-surface py-2 pl-3 pr-2.5",
        CARD_SHADOW,
        emphasis ? "border-amber-500/60 ring-[3px] ring-amber-500/20" : "border-hairline",
      )}
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1", STATUS_BG[status])} aria-hidden />
      <span className={clsx("font-mono text-[26px] font-semibold leading-none tabular-nums", NUMBER_TEXT[status])}>
        {number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-bold text-ink">{label ?? STATUS_LABELS[status]}</span>
        <span className="truncate text-[10px] text-ink-muted" title={subLine}>
          {subLine}
        </span>
      </span>
      {(badge || (notes && notes.length > 0)) && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {badge && <Badge b={badge} />}
          {notes && notes.length > 0 && <NotesBadge truckNumber={number} notes={notes} />}
        </span>
      )}
    </AnimateCard>
  );
}

/** 48px: unloaded and waiting on the Load lane. */
export function ReadyCard({
  number,
  sub,
  badge,
  notes,
}: {
  number: number;
  sub: string;
  badge?: CardBadge;
  notes?: TruckNote[];
}) {
  return (
    <AnimateCard
      hoverScale={1}
      className={clsx(
        "relative flex min-h-[48px] flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden rounded-[10px] border border-hairline bg-surface py-1.5 pl-3 pr-2.5",
        CARD_SHADOW,
      )}
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1", STATUS_BG.unloaded)} aria-hidden />
      <span className={clsx("font-mono text-[22px] font-semibold leading-none tabular-nums", NUMBER_TEXT.unloaded)}>
        {number}
      </span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-muted" title={sub}>
        {sub}
      </span>
      {(badge || (notes && notes.length > 0)) && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {badge && <Badge b={badge} />}
          {notes && notes.length > 0 && <NotesBadge truckNumber={number} notes={notes} />}
        </span>
      )}
    </AnimateCard>
  );
}

const CHIP_TONE = {
  unloaded: "border-green-500/30 bg-green-500/10 text-green-300",
  loaded: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  off: "border-slate-500/35 bg-slate-500/10 text-ink-muted",
} as const;

/** 32px: finished. Replaces the opacity-40 full card. */
export function DoneChip({ number, tone }: { number: number; tone: "unloaded" | "loaded" }) {
  return (
    <span
      className={clsx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border pl-2 pr-2.5 font-mono text-[13px] font-semibold tabular-nums",
        CHIP_TONE[tone],
      )}
      title={`#${number} · ${STATUS_LABELS[tone]}`}
    >
      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      {number}
    </span>
  );
}

/** 32px: not running this lane today (scheduled off) or out of service. */
export function OffChip({ number, tag }: { number: number; tag: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[13px] font-semibold tabular-nums",
        CHIP_TONE.off,
      )}
      title={`#${number} · ${tag}`}
    >
      {number}
      <span className="font-sans text-[9px] font-bold">{tag}</span>
    </span>
  );
}
