/**
 * Setup Day wizard chrome: header, named stepper, sticky footer, and the
 * centered-header truck chip groups. Pure presentation — RunDayWizard owns every
 * query and save; this file only draws them.
 */
import type { ReactNode } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";

export const STEP_NAMES = ["Run mode", "Garments", "Swaps", "Not here", "Notes"] as const;

export type ChipTone = "garments" | "nogs" | "absent" | "ranAhead";

// Selected-state classes per tone. Written out in full so Tailwind can see them.
const CHIP_ON: Record<ChipTone, string> = {
  garments: "border-emerald-500 bg-emerald-500/20 text-ink",
  nogs: "border-rose-500 bg-rose-500/20 text-ink",
  absent: "border-red-500 bg-red-500/20 text-ink",
  ranAhead: "border-sky-500 bg-sky-500/20 text-ink",
};
// Header colours are the tone lightened toward white so they read on `surface`.
const HEAD: Record<ChipTone, string> = {
  garments: "text-emerald-300",
  nogs: "text-rose-300",
  absent: "text-red-300",
  ranAhead: "text-sky-300",
};

export function StepHeading({ title, help }: { title: string; help?: ReactNode }) {
  return (
    <div className="space-y-1 text-center">
      <h2 className="text-[22px] font-extrabold leading-7 text-ink">{title}</h2>
      {help && <p className="text-sm text-ink-soft">{help}</p>}
    </div>
  );
}

/** One selectable truck number. Check mark + tone, never colour alone. */
export function TruckChip({
  num,
  selected,
  tone,
  onToggle,
}: {
  num: number | string;
  selected: boolean;
  tone: ChipTone;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={clsx(
        "flex min-h-[44px] items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70",
        selected ? CHIP_ON[tone] : "border-hairline bg-surface-2 text-ink-soft hover:bg-track",
      )}
    >
      {selected && <Check className="h-3.5 w-3.5" aria-hidden strokeWidth={3} />}#{num}
    </button>
  );
}

/**
 * A titled group of TruckChips: centered tone-coloured header, one help line,
 * a "N selected · Select all · Clear" row, then the grid. `divider` draws the
 * hairline that separates a group from the one above it.
 */
export function ChipGroup({
  title,
  help,
  tone,
  trucks,
  selected,
  onToggle,
  onSetAll,
  divider,
  cols = 4,
  scroll,
  empty,
}: {
  title: string;
  help: string;
  tone: ChipTone;
  trucks: number[];
  selected: Set<number>;
  onToggle: (n: number) => void;
  onSetAll: (all: boolean) => void;
  divider?: boolean;
  cols?: 3 | 4;
  scroll?: boolean;
  empty?: string;
}) {
  return (
    <section className={clsx("space-y-3", divider && "border-t border-hairline pt-4")}>
      <header className="text-center">
        <h3 className={clsx("text-base font-extrabold leading-snug", HEAD[tone])}>{title}</h3>
        <p className="text-[13px] text-ink-muted">{help}</p>
        {trucks.length > 0 && (
          <div className="mt-1.5 flex items-center justify-center gap-3 text-xs font-semibold text-ink-muted">
            <span>{selected.size} selected</span>
            <span className="text-ink-faint" aria-hidden>·</span>
            <button type="button" className="px-0.5 py-1 text-blue-300 hover:text-blue-200" onClick={() => onSetAll(true)}>Select all</button>
            <button type="button" className="px-0.5 py-1 text-blue-300 hover:text-blue-200" onClick={() => onSetAll(false)}>Clear</button>
          </div>
        )}
      </header>
      {trucks.length === 0 ? (
        <p className="text-center text-sm text-ink-muted">{empty ?? "No trucks."}</p>
      ) : (
        <div className={clsx("grid gap-2", cols === 3 ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4", scroll && "max-h-56 overflow-y-auto pr-1")}>
          {trucks.map((n) => (
            <TruckChip key={n} num={n} tone={tone} selected={selected.has(n)} onToggle={() => onToggle(n)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Header (title, run date, close) and the five-segment named stepper. */
export function WizardHeader({
  step,
  dateLabel,
  onClose,
  onJump,
}: {
  step: number;
  dateLabel: string;
  onClose: () => void;
  onJump: (s: number) => void;
}) {
  return (
    <div className="px-5 pt-4">
      <div className="flex items-center">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">Setup Day</span>
        <span className="ml-3 text-sm font-semibold text-ink">{dateLabel}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-3 ml-auto grid h-11 w-11 place-items-center text-ink-muted hover:text-ink-soft"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="grid grid-cols-5 gap-1.5 pb-5 pt-2">
        {STEP_NAMES.map((name, i) => {
          const n = i + 1;
          const done = n < step;
          const cur = n === step;
          return (
            <li key={name}>
              <button
                type="button"
                disabled={!done}
                aria-current={cur ? "step" : undefined}
                onClick={() => onJump(n)}
                className="flex w-full flex-col gap-1.5 text-left disabled:cursor-default"
              >
                <span className={clsx("h-1 rounded-pill", done || cur ? "bg-accent" : "bg-track")} />
                <span
                  className={clsx(
                    "truncate text-xs",
                    cur ? "font-bold text-blue-300" : done ? "font-medium text-ink-soft" : "font-medium text-ink-muted",
                    // Phones: only the current step keeps its name.
                    !cur && "max-sm:sr-only",
                  )}
                >
                  {done && "✓ "}
                  {name}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Back on the left; Skip and the primary action on the right. */
export function WizardFooter({
  step,
  pending,
  onBack,
  onSkip,
  onNext,
}: {
  step: number;
  pending?: boolean;
  onBack: () => void;
  onSkip?: () => void;
  onNext: () => void;
}) {
  const last = step === STEP_NAMES.length;
  return (
    <div className="flex items-center gap-2 border-t border-hairline bg-surface-2 px-5 py-3 pb-safe">
      <button type="button" className="btn-ghost min-h-[44px] px-4 text-sm font-semibold" onClick={onBack}>
        {step === 1 ? "Close" : "Back"}
      </button>
      {onSkip && !last && (
        <button type="button" className="btn ml-auto min-h-[44px] px-3 text-sm font-semibold text-ink-muted hover:text-ink-soft" onClick={onSkip}>
          Skip
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        className={clsx("btn-primary min-h-[44px] px-6 text-sm font-semibold", (!onSkip || last) && "ml-auto")}
        onClick={onNext}
      >
        {last ? "Finish" : "Continue"}
      </button>
    </div>
  );
}
