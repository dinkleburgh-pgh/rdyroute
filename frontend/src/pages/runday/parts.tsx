/**
 * Day Overview layout pieces that are not truck cards: the pulse-row meters,
 * lane and group headers, the compact coverage card, the batch tile and the
 * phone lane switch. Pure presentation — every number is handed in.
 */
import type { ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { BatchSummary } from "../../types";
import { capacityColor, capacityPct } from "../../utils/batchCapacity";

export function DayPill({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-pill bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-300">
      {children}
    </span>
  );
}

/** Centred rule · LABEL · count · rule — the group divider inside a lane. */
export function GroupHeader({ label, count, extra }: { label: string; count: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-muted">
      <span className="h-px min-w-3 flex-1 bg-hairline" aria-hidden />
      <span>{label}</span>
      <span className="font-mono normal-case tracking-normal text-ink">{count}</span>
      {extra && <span className="text-[11px] font-medium normal-case tracking-normal">{extra}</span>}
      <span className="h-px min-w-3 flex-1 bg-hairline" aria-hidden />
    </div>
  );
}

export type MeterSegment = { value: number; className: string };
export type MeterLegendItem = { value: number; label: string; className: string };

/**
 * One lane's pulse: done/total, a STACKED bar (so dirty vs in-progress vs done
 * read at a glance, not just one fill), and a legend that only fits from lg up.
 */
export function Meter({
  label,
  day,
  done,
  total,
  segments,
  legend,
  trailing,
}: {
  label: string;
  day: string;
  done: number;
  total: number;
  segments: MeterSegment[];
  legend: MeterLegendItem[];
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5 lg:gap-2.5 lg:px-4 lg:py-3.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted lg:text-[11px]">{label}</span>
        <DayPill>{day}</DayPill>
        <span className="ml-auto font-mono text-lg font-semibold tabular-nums text-ink lg:text-[22px]">
          {done}
          <span className="text-ink-faint">/{total}</span>
        </span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-pill bg-track lg:h-2" role="img" aria-label={`${done} of ${total}`}>
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => (
              <div key={i} className={clsx("transition-all", s.className)} style={{ width: `${(s.value / total) * 100}%` }} />
            ))}
      </div>
      <div className="hidden gap-3 text-[11px] text-ink-muted lg:flex">
        {legend.map((l) => (
          <span key={l.label}>
            <b className={l.className}>{l.value}</b> {l.label}
          </span>
        ))}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
    </div>
  );
}

/** A pulse-row box. Amber only when it has something to say. */
export function PulseCard({ amber, className, children }: { amber?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-2 rounded-xl border px-3 py-2.5 lg:px-4 lg:py-3.5",
        amber ? "border-amber-500/35 bg-amber-500/[0.06]" : "border-hairline bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type CoverageKindLabel = "spare" | "swap" | "split";
const KIND_CHIP: Record<CoverageKindLabel, { text: string; className: string }> = {
  spare: { text: "Spare cover", className: "bg-track text-ink-muted" },
  swap: { text: "Route swap", className: "bg-sky-500/15 text-sky-300" },
  split: { text: "Split", className: "bg-amber-500/20 text-amber-200" },
};

/**
 * The Report's ROUTE → LOADS ON read, compact enough for a lane. Route on the
 * left, the truck its load rides on to the right; the verb says whether that
 * already happened ("Loaded on") or is still ahead ("Loads on").
 */
export function CoverageMini({
  route,
  cover,
  kind,
  verb,
  state,
  stateClassName,
  prev,
}: {
  route: number;
  cover: number;
  kind: CoverageKindLabel;
  verb: string;
  state: string;
  stateClassName: string;
  /** Previous-day pairing: the route number wears amber instead of sky. */
  prev?: boolean;
}) {
  const chip = KIND_CHIP[kind];
  return (
    <div
      className={clsx(
        "flex flex-col items-center gap-1.5 rounded-[10px] border bg-surface px-2.5 py-2",
        prev ? "border-amber-500/25" : "border-hairline",
      )}
    >
      <div className="flex items-center justify-center gap-3">
        <div className="text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-muted">Route</p>
          <p className={clsx("font-mono text-[22px] font-semibold leading-none tabular-nums", prev ? "text-amber-300" : "text-sky-300")}>
            #{route}
          </p>
        </div>
        <span className="text-lg font-extrabold leading-none text-ink-faint" aria-hidden>
          {kind === "split" ? "+" : "→"}
        </span>
        <div className="text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-muted">{verb}</p>
          <p className="font-mono text-[22px] font-semibold leading-none tabular-nums text-ink">#{cover}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={clsx("rounded px-1.5 py-px text-[10px] font-semibold", chip.className)}>{chip.text}</span>
        <span className={clsx("text-[11px]", stateClassName)}>{state}</span>
      </div>
    </div>
  );
}

/** One batch, the Report's BatchMiniCard read at lane density. */
export function BatchTile({ batch, cap, noCap }: { batch: BatchSummary; cap: number; noCap: boolean }) {
  const { bar, text } = capacityColor(batch.total_wearers, noCap, cap);
  const pct = capacityPct(batch.total_wearers, cap);
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-hairline bg-surface px-2.5 py-2">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-xs font-bold text-ink">Batch {batch.batch_number}</span>
        <span className={clsx("font-mono text-[11px] font-semibold tabular-nums", text)}>
          {batch.total_wearers.toLocaleString()}
          {!noCap && <span className="text-ink-faint"> / {cap.toLocaleString()}</span>}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-pill border border-hairline bg-surface-3">
        <div className={clsx("h-full rounded-pill transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex min-h-[22px] flex-wrap items-center gap-1">
        {batch.trucks.length === 0 ? (
          <span className="text-[11px] text-ink-faint">Empty</span>
        ) : (
          batch.trucks.map((t) => (
            <span key={t.truck_number} className="inline-flex items-baseline gap-0.5 rounded-[5px] bg-track px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-ink">
              #{t.truck_number}
              <span className="font-sans text-[10px] font-normal text-ink-muted">({t.wearers})</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** Lane title, centred, with the day pill and the done · left · spares line. */
export function LaneHeader({
  title,
  day,
  summary,
  collapsed,
  onToggle,
}: {
  title: string;
  day: string;
  summary: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center gap-1 border-b border-hairline pb-1.5 pt-1">
      <h2 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h2>
      <div className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-ink-muted">
        <DayPill>{day}</DayPill>
        <span>{summary}</span>
      </div>
      <button
        type="button"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${title.toLowerCase()} lane`}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="absolute right-0 top-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", collapsed && "-rotate-90")} />
      </button>
    </div>
  );
}

/** Phone only: one lane at a time. */
export function MobileLaneSwitch({
  lane,
  onChange,
  unloadLeft,
  loadLeft,
}: {
  lane: "unload" | "load";
  onChange: (lane: "unload" | "load") => void;
  unloadLeft: number;
  loadLeft: number;
}) {
  const tab = (key: "unload" | "load", label: string, left: number) => {
    const on = lane === key;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => onChange(key)}
        className={clsx(
          "min-h-[40px] rounded-lg text-[13px] transition-colors",
          on ? "bg-track font-bold text-ink" : "font-semibold text-ink-muted hover:text-ink-soft",
        )}
      >
        {label} · {left} left
      </button>
    );
  };
  return (
    <div role="tablist" aria-label="Lane" className="grid grid-cols-2 gap-1 rounded-[10px] border border-hairline bg-surface p-1 lg:hidden">
      {tab("unload", "Unload", unloadLeft)}
      {tab("load", "Load", loadLeft)}
    </div>
  );
}
