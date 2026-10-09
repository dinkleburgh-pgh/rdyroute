/**
 * TEMPORARY — the Load crew's unload shortcut (Load is the only crew in the
 * app right now, so the unload side gets reflected from the Load screen).
 *
 * Tonight's dirty trucks as equal 48px (real pixels — the root font is 14px) number tiles. One tap marks a truck
 * Unloaded — the same write Unload's own button does — and the tile LINGERS
 * in its slot for a few seconds as a green UNDO tile instead of vanishing, so
 * a glove mis-tap has a way back without a confirm on the common path. A tap
 * on the green tile inside the first 400ms is ignored (a double-registered
 * tap must not mark-then-undo and race the first write), and a lingering
 * tile drops out the moment the truck moves past Unloaded (someone started
 * loading it) so undo can never pull a loading truck back to Dirty.
 *
 * The card owns the undo state so it stays mounted while the LAST truck's
 * undo tile lingers, and "Mark all" runs through the same path so a bulk
 * clear turns the grid green with per-truck undo.
 *
 * The grid is an inline auto-fill, not Tailwind breakpoints: the Load Display
 * is CSS-zoomed and media queries do not move with zoom, so columns derive
 * from the container's real width on every surface.
 *
 * Remove: delete this file and its two call sites (Load.tsx, LoadDisplay.tsx).
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useUpsertTruckState } from "../../api/hooks";
import { getCoverageRouteNumber } from "../../utils/truckStatus";
import ConfirmDialog from "../ConfirmDialog";
import { SectionHeader } from "../workflow/QuietTile";
import type { TruckWithState } from "../../types";

const UNDO_WINDOW_MS = 6000;
const BOUNCE_GUARD_MS = 400;

type Done = { truck: TruckWithState; at: number };

export default function StillToUnloadCard({
  trucks,
  board,
  runDate,
  variant = "page",
  markAll = false,
  className,
  label = "Still to unload",
  hint = "tap once it's empty · tap again to undo",
  numberClass = "text-st-dirty",
}: {
  /** Tonight's dirty trucks, already sorted. */
  trucks: TruckWithState[];
  /** Whole board — a lingering tile needs the truck's LIVE status. */
  board: TruckWithState[];
  runDate: string;
  /** "page" = SectionHeader card (Load page); "display" = the Display's h3 card. */
  variant?: "page" | "display";
  /** Offer the confirmed "Mark all unloaded" (Load page only). */
  markAll?: boolean;
  /** Outer wrapper classes (the Load page places the card per breakpoint). */
  className?: string;
  /** Card title (page variant). The Not Here / Needs Checked card reuses this grid. */
  label?: string;
  hint?: string;
  /** Colour of a not-yet-done truck number. */
  numberClass?: string;
}) {
  const upsert = useUpsertTruckState();
  const [justDone, setJustDone] = useState<Map<number, Done>>(() => new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulk, setBulk] = useState(false);
  const timers = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending.values()) window.clearTimeout(id);
    };
  }, []);

  function forget(n: number) {
    const id = timers.current.get(n);
    if (id != null) window.clearTimeout(id);
    timers.current.delete(n);
    setJustDone((m) => {
      if (!m.has(n)) return m;
      const next = new Map(m);
      next.delete(n);
      return next;
    });
  }

  function linger(t: TruckWithState) {
    setJustDone((m) => new Map(m).set(t.truck_number, { truck: t, at: Date.now() }));
    const prev = timers.current.get(t.truck_number);
    if (prev != null) window.clearTimeout(prev);
    timers.current.set(t.truck_number, window.setTimeout(() => forget(t.truck_number), UNDO_WINDOW_MS));
  }

  function mark(t: TruckWithState) {
    upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "unloaded", wearers: t.state?.wearers ?? 0 });
    linger(t);
  }

  function undo(d: Done) {
    if (Date.now() - d.at < BOUNCE_GUARD_MS) return;
    // Marking unloaded clears Needs Checked server-side (a status change IS
    // the check), so an undo puts the flag back with the status.
    upsert.mutate({
      truck_number: d.truck.truck_number,
      run_date: runDate,
      status: "dirty",
      wearers: d.truck.state?.wearers ?? 0,
      ...(d.truck.state?.needs_checked ? { needs_checked: true } : {}),
    });
    forget(d.truck.truck_number);
  }

  async function markAllNow() {
    setBulk(true);
    try {
      for (const t of trucks) {
        await upsert.mutateAsync({ truck_number: t.truck_number, run_date: runDate, status: "unloaded", wearers: t.state?.wearers ?? 0 });
        linger(t);
      }
    } finally {
      setBulk(false);
      setConfirmOpen(false);
    }
  }

  // Live dirty trucks plus the lingering done ones, one grid, by number. A
  // lingering truck only shows while it is still exactly "unloaded": back in
  // `trucks` (reverted elsewhere) it renders red again; moved on to loading
  // it drops out, so undo cannot reach it.
  const live = new Set(trucks.map((t) => t.truck_number));
  const statusOf = new Map(board.map((t) => [t.truck_number, t.state?.status ?? "dirty"]));
  const ghosts = [...justDone.values()].filter(
    (d) => !live.has(d.truck.truck_number) && statusOf.get(d.truck.truck_number) === "unloaded",
  );
  const rows = [
    ...trucks.map((t) => ({ truck: t, done: null as Done | null })),
    ...ghosts.map((d) => ({ truck: d.truck, done: d })),
  ].sort((a, b) => a.truck.truck_number - b.truck.truck_number);

  if (rows.length === 0) return null;

  const grid = (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(68px, 1fr))" }}>
      {rows.map(({ truck, done }) => {
        const cr = getCoverageRouteNumber(truck);
        const pair =
          cr != null ? { route: cr, split: false }
          : truck.route_split_route != null ? { route: truck.route_split_route, split: true }
          : null;
        const isDone = done != null;
        return (
          <button
            key={truck.truck_number}
            type="button"
            disabled={bulk && !isDone}
            onClick={() => (done ? undo(done) : mark(truck))}
            aria-label={isDone ? `#${truck.truck_number} marked unloaded — tap to undo` : `Mark #${truck.truck_number} unloaded`}
            className={clsx(
              "flex min-h-[48px] w-full select-none touch-manipulation flex-col items-center justify-center rounded-lg border px-1 font-mono font-black leading-none tabular-nums transition-colors active:scale-[0.97] disabled:opacity-50",
              isDone
                ? "border-st-unloaded bg-st-unloaded/15 text-st-unloaded"
                : clsx("border-hairline bg-surface-3 hover:border-st-unloaded hover:bg-surface-2", numberClass),
            )}
          >
            <span className={pair ? "text-[15px]" : "text-[20px]"}>
              {pair ? (
                <>
                  <span className={pair.split ? "text-amber-300" : "text-sky-300"}>{pair.route}</span>
                  <span className="px-px text-[12px] text-ink-faint">{pair.split ? "+" : "→"}</span>
                  {truck.truck_number}
                </>
              ) : (
                <>#{truck.truck_number}</>
              )}
            </span>
            {isDone && <span className="mt-1 font-sans text-[9px] font-bold uppercase tracking-[0.14em]">Undo</span>}
          </button>
        );
      })}
    </div>
  );

  const markAllButton = markAll ? (
    <button
      type="button"
      disabled={bulk || trucks.length === 0}
      onClick={() => setConfirmOpen(true)}
      className="min-h-[36px] shrink-0 rounded-md border border-hairline bg-surface-2/60 px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-track disabled:opacity-50"
    >
      Mark all unloaded
    </button>
  ) : null;

  return (
    <div className={className}>
      <div className="card">
        {variant === "page" ? (
          <div className="flex items-start justify-between gap-3">
            <SectionHeader label={label} count={trucks.length} hint={hint} />
            {markAllButton}
          </div>
        ) : (
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-st-dirty">
            Still to unload ({trucks.length}){" "}
            <span className="font-normal normal-case tracking-normal text-ink-faint">· tap once it's empty · tap again to undo</span>
          </h3>
        )}
        {grid}
      </div>
      {markAll && (
        <ConfirmDialog
          open={confirmOpen}
          title={`Mark all ${trucks.length} trucks unloaded?`}
          description="Every truck still showing Dirty for tonight's load becomes Unloaded and joins Ready. Each tile turns green for a few seconds — tap one to undo it."
          confirmLabel="Mark all unloaded"
          busy={bulk}
          onConfirm={() => void markAllNow()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
