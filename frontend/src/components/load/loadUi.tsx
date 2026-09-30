import clsx from "clsx";
import type { ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import CoverageTag from "../CoverageTag";
import { getCoverageRouteNumber } from "../../utils/truckStatus";
import type { TruckWithState } from "../../types";

export type LoadPair = { route: number; split?: boolean } | null;

/** The tile-face coverage pair: tonight's covered route, or the route whose
 *  SPLIT overflow this truck carries (amber; the route also runs). One rule
 *  for every tile on the Load page and the display. */
export function loadPairOf(t: TruckWithState): LoadPair {
  const cr = getCoverageRouteNumber(t);
  if (cr != null) return { route: cr };
  if (t.route_split_route != null) return { route: t.route_split_route, split: true };
  return null;
}

/**
 * What the crew is actually loading. A spare (or swap truck) covering a route
 * is loading THAT ROUTE's freight — so the route is the headline and the truck
 * number is the "which one to pull up" detail, not the other way round. A
 * split keeps the truck first: its own route runs, it just carries overflow.
 */
export function loadFace(t: TruckWithState): { number: number; onTruck: number | null } {
  const route = getCoverageRouteNumber(t);
  return route != null
    ? { number: route, onTruck: t.truck_number }
    : { number: t.truck_number, onTruck: null };
}

/** Text form for buttons and hints: "#62", or "55 → 62" when covering. */
export function loadFaceText(t: TruckWithState): string {
  const f = loadFace(t);
  return f.onTruck != null ? `${f.number} → ${f.onTruck}` : `#${f.number}`;
}

const FACE_SIZES = {
  sm: { big: "text-[24px]", small: "text-[13px]" },
  md: { big: "text-[34px]", small: "text-[16px]" },
  sheet: { big: "text-[40px]", small: "text-[18px]" },
  lg: { big: "text-[52px]", small: "text-[22px]" },
  xl: { big: "text-[92px]", small: "text-[36px]" },
} as const;

/**
 * The number as the crew reads it: the route big, then "→ on #truck" a size
 * down when the truck covers one (the app-wide ROUTE → ON TRUCK idiom, see
 * CoverageTag). `numberClass` colours the headline; the truck stays ink so it
 * is always legible — that is the one they have to find on the lot.
 */
export function LoadFace({
  truck,
  numberClass,
  size = "md",
  className,
}: {
  truck: TruckWithState;
  numberClass: string;
  size?: keyof typeof FACE_SIZES;
  className?: string;
}) {
  const f = loadFace(truck);
  const s = FACE_SIZES[size];
  return (
    <span
      className={clsx("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}
      title={f.onTruck != null ? `Route ${f.number}'s load rides on truck ${f.onTruck}` : undefined}
    >
      <span className={clsx("font-mono font-black leading-none tracking-[-0.02em] tabular-nums", s.big, numberClass)}>
        #{f.number}
      </span>
      {f.onTruck != null && (
        <span className={clsx("whitespace-nowrap font-mono font-bold leading-none tabular-nums text-ink-soft", s.small)}>
          <span className="font-normal text-ink-faint">→ on</span> #{f.onTruck}
        </span>
      )}
    </span>
  );
}

/**
 * The Load page's small shared vocabulary: the three zone colours and the
 * buttons that sit inside them.
 *
 * Every zone owns ONE hue and wears it on its label and its truck numbers, so
 * a glance sorts the dock without reading: amber is loading, sky is up next,
 * white is staged, green is ready, blue is loaded. Staged used to borrow
 * loading's amber, and the two read as one thing from across the dock.
 */
export const ZONE = {
  loading: { label: "text-amber-300", dot: "bg-st-inprogress", number: "text-amber-300" },
  next: { label: "text-sky-300", dot: "bg-sky-400", number: "text-sky-300" },
  staged: { label: "text-ink", dot: "bg-ink-soft", number: "text-ink" },
  // The unload dock's truck is still dirty — its dot says so. The label stays
  // quiet: this is the other crew's work, shown for the answer it needs.
  unloading: { label: "text-ink-soft", dot: "bg-st-dirty", number: "text-ink" },
} as const;

export type ZoneKey = keyof typeof ZONE;

/** Eyebrow label for a zone: dot, words, optional count. */
export function ZoneLabel({
  zone,
  pulse = false,
  muted = false,
  count,
  children,
  className,
}: {
  zone: ZoneKey;
  pulse?: boolean;
  /** The zone is empty right now — grey it rather than hide it. */
  muted?: boolean;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em]",
        muted ? "text-ink-muted" : ZONE[zone].label,
        className,
      )}
    >
      <span className={clsx("h-2 w-2 shrink-0 rounded-full", muted ? "bg-ink-faint/60" : ZONE[zone].dot, pulse && "animate-pulse")} />
      <span>{children}</span>
      {count != null && <span className="font-mono tabular-nums text-ink-faint">{count}</span>}
    </div>
  );
}

/** The one go-button green, shared by Start and Finish so the two read alike. */
export const BTN_GO =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#15803d] px-5 font-bold text-white transition-colors hover:bg-[#16a34a] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

/** Secondary actions — surface-toned, never the slate btn-ghost, so they sit
 *  inside the page's cards instead of floating on top of them. */
export const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-4 text-xs font-semibold text-ink-soft transition-colors hover:bg-track hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** A text-weight action inside a zone header (Change, Clear). */
export const BTN_LINK =
  "rounded-md px-2 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40";

/**
 * Header for every Load sheet — the chooser, the Start confirmation and the
 * garment check. The truck number is the headline in all three, so tapping a
 * tile and landing in a confirmation never feels like leaving the page. (The
 * start confirm used to be a bare title line with small buttons, a different
 * dialog from the chooser that opened it.)
 */
export function SheetHead({
  eyebrow,
  eyebrowClass = "text-ink-muted",
  truck,
  detail,
  onClose,
}: {
  eyebrow: ReactNode;
  eyebrowClass?: string;
  truck: TruckWithState;
  detail?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className={clsx("text-[10.5px] font-bold uppercase tracking-[0.16em]", eyebrowClass)}>{eyebrow}</div>
        <LoadFace truck={truck} size="sheet" numberClass="text-ink" className="mt-1" />
        {detail && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-muted">{detail}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** A boxed note inside a sheet — `warn` when it blocks the action. */
export function SheetNote({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <p
      className={clsx(
        "mt-4 rounded-lg border px-3 py-2.5 text-[13px] leading-snug",
        tone === "warn"
          ? "border-st-dirty/40 bg-st-dirty/10 text-red-200"
          : "border-hairline bg-surface-3 text-ink-soft",
      )}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// The line — pieces shared by the yard (page + display) and the dock card
// ---------------------------------------------------------------------------

/** A truck's place in the line: ① is the queued truck, ②… the lane. */
export function PositionBadge({ n, tone = "line" }: { n: number; tone?: "line" | "next" }) {
  return (
    <span
      className={clsx(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold tabular-nums",
        tone === "next" ? "bg-sky-400/20 text-sky-200" : "bg-track text-ink-soft",
      )}
    >
      {n}
    </span>
  );
}

/** What a staged truck is waiting on. The lane can hold a truck that is
 *  still being unloaded, and the slot has to say so rather than look ready. */
export function stagedStatus(t: TruckWithState): { label: string; dot: string } {
  const st = t.state?.status;
  const since =
    t.state?.staged_at != null
      ? new Date(t.state.staged_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : null;
  const what =
    t.state?.priority_hold ? "On hold"
    : st === "unloaded" ? "Ready"
    : st === "unfinished" ? "Unload unfinished"
    : st === "dirty" ? "Not unloaded"
    : "Staged";
  const dot =
    t.state?.priority_hold ? "bg-st-dirty"
    : st === "unloaded" ? (t.truck_type === "Spare" ? "bg-st-spare" : "bg-st-unloaded")
    : st === "unfinished" ? "bg-st-unfinished"
    : "bg-st-dirty";
  return { label: since ? `Staged ${since} · ${what}` : what, dot };
}

/** One-tap "queue this one up next" chip for the empty ① slot. */
export function SuggestChip({ n, note, onPick }: { n: number; note: string; onPick: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(n)}
      title={`Queue #${n} up next`}
      className="inline-flex items-baseline gap-1.5 rounded-md border border-sky-600/40 bg-sky-950/40 px-2 py-1 transition-colors hover:bg-sky-900/50"
    >
      <span className="font-mono text-[13px] font-bold tabular-nums text-sky-200">#{n}</span>
      <span className="text-[10px] text-sky-300/70">{note}</span>
    </button>
  );
}

/**
 * One truck in the line. The body is a real button (tap = the chooser, or
 * Start on the display); `action` sits beside it outside the button, so a
 * Start button on the ① row is never a button inside a button.
 */
export function LineSlot({
  truck,
  zone,
  position,
  pair,
  sub,
  dotClass,
  onClick,
  action,
  disabled = false,
  size = "md",
}: {
  truck: TruckWithState;
  zone: "next" | "staged";
  /** Place in the line; omitted in the classic dock card's Up-next zone. */
  position?: number;
  pair: LoadPair;
  sub: ReactNode;
  dotClass: string;
  onClick: () => void;
  action?: ReactNode;
  disabled?: boolean;
  /** "lg" = the Floor view, one size up across the dock. */
  size?: "md" | "lg";
}) {
  const lg = size === "lg";
  const faceSize = zone === "next" ? (lg ? "lg" : "md") : lg ? "md" : "sm";
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-[10px] border pl-3.5 pr-3 transition-colors",
        lg ? "min-h-[88px]" : "min-h-[72px]",
        zone === "next"
          ? "border-sky-500/30 bg-sky-500/[0.07] hover:bg-sky-500/[0.11]"
          : "border-hairline bg-surface hover:bg-surface-2",
      )}
    >
      {position != null && <PositionBadge n={position} tone={zone === "next" ? "next" : "line"} />}
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={clsx(
          "group flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50",
          lg ? "min-h-[88px]" : "min-h-[72px]",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <LoadFace truck={truck} size={faceSize} numberClass={zone === "next" ? ZONE.next.number : ZONE.staged.number} />
            {pair?.split && <CoverageTag route={pair.route} truck={truck.truck_number} split />}
          </span>
          <span className="mt-1.5 flex items-baseline gap-1.5 text-[11.5px] leading-snug text-ink-muted">
            <span className={clsx("h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full", dotClass)} />
            <span className="min-w-0">{sub}</span>
          </span>
        </span>
        {!action && <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink-muted" aria-hidden />}
      </button>
      {action}
    </div>
  );
}

/** One held / unfinished truck: number in its status colour, then why. */
export function NotReadyChip({
  truck,
  pair,
  tone,
  dot,
  label,
}: {
  truck: TruckWithState;
  pair: LoadPair;
  tone: string;
  dot: string;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-lg border border-hairline bg-surface-3 px-3 py-2">
      <span className={clsx("font-mono text-[17px] font-black leading-none tabular-nums", tone)}>
        {pair != null ? (
          <>
            <span className={pair.split ? "text-amber-300" : "text-sky-300"}>{pair.route}</span>
            <span className="px-0.5 text-[13px] text-ink-faint">{pair.split ? "+" : "→"}</span>
            {truck.truck_number}
          </>
        ) : (
          <>#{truck.truck_number}</>
        )}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
      </span>
    </div>
  );
}
