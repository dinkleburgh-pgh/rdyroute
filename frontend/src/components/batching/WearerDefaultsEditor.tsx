import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  unloadDayWearersKey,
  useAssignBatch,
  useBatchSummary,
  useBoard,
  useFleet,
  usePrevDayCarriers,
  usePrevDaySplitHelpers,
  useSettings,
  useUnloadsDayOverride,
  useUpsertSetting,
} from "../../api/hooks";
import { todayIso } from "../../api/client";
import { workdayNumbers } from "../Clock";
import ConfirmDialog from "../ConfirmDialog";
import { truckTypeLabel } from "../../utils/truckType";
import { isScheduledOff } from "../../utils/truckStatus";

/**
 * Editor for the standing per-unload-day wearer counts.
 *
 * These counts are what makes batching a single tap: the wizard prefills each
 * truck's wearers from the day's sheet, so batching is confirming a number
 * rather than typing one. Until now the values only existed because a seed
 * script wrote them, which made the monthly refresh a developer task.
 *
 * All five days are editable from one place because the paper sheets arrive as
 * a set once a month — you do the whole month in one sitting.
 *
 * A BLANK cell means "not on this day's sheet" and is dropped from the saved
 * map. An explicit 0 is kept: the paper sheet really does print 0 for dust
 * trucks that run with nothing on them, and those still get batched. Blank and
 * 0 are therefore different answers — "no number for this truck" versus "the
 * number is none" — and only the first should make the wizard ask.
 */

const DAYS = [1, 2, 3, 4, 5] as const;
const DAY_NAMES: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday",
};

type Drafts = Record<number, Record<number, string>>;

function readStored(settings: { key: string; value: unknown }[], day: number): Record<number, number> {
  const raw = settings.find((s) => s.key === unloadDayWearersKey(day))?.value;
  const out: Record<number, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(k);
      const w = Number(v);
      if (Number.isFinite(n) && Number.isFinite(w)) out[n] = w;
    }
  }
  return out;
}

export default function WearerDefaultsEditor({
  open,
  initialDay,
  onClose,
  runDate = todayIso(),
}: {
  open: boolean;
  /** Opens on the day being batched, since that's usually the one in question. */
  initialDay: number;
  onClose: () => void;
  /** The run date whose live batch numbers the "apply now" prompt targets. */
  runDate?: string;
}) {
  const { data: settings = [] } = useSettings();
  const { data: trucks = [] } = useFleet();
  const upsert = useUpsertSetting();

  // Saving a sheet only rewrites the STANDING numbers. Anything already batched
  // today keeps whatever it was assigned with, which is right when the sheet is
  // being corrected after the fact and wrong when it is being corrected because
  // today's numbers came out of a stale sheet. The app cannot tell those apart,
  // so it asks — but only when a live assignment would actually change.
  const { data: board = [] } = useBoard(runDate);
  const { data: batches = [] } = useBatchSummary(runDate);
  const { data: unloadsOverride } = useUnloadsDayOverride(runDate);
  const prevCarriers = usePrevDayCarriers(runDate, board);
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const assign = useAssignBatch();
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const [day, setDay] = useState(initialDay);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saved, setSaved] = useState(false);

  const stored = useMemo(() => {
    const out: Record<number, Record<number, number>> = {};
    for (const d of DAYS) out[d] = readStored(settings, d);
    return out;
  }, [settings]);

  function draftsFromStored(): Drafts {
    const next: Drafts = {};
    for (const d of DAYS) {
      next[d] = Object.fromEntries(
        Object.entries(stored[d]).map(([n, w]) => [Number(n), String(w)]),
      );
    }
    return next;
  }

  // Seed drafts from the server on OPEN only, so a half-finished edit from last
  // time never resurfaces as if it were saved. Deliberately keyed on the open
  // transition rather than on `stored`: the settings query refetches on its own,
  // and anyone editing an unrelated setting would otherwise wipe the numbers
  // being typed here mid-entry.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDrafts(draftsFromStored());
      setDay(initialDay);
      setSaved(false);
    }
    wasOpen.current = open;
  });

  /**
   * Rows for a day: everything already on that day's sheet, plus every active
   * route truck the schedule says runs that day. The second half is what lets a
   * new month ADD a truck; without it you could only edit numbers that a seed
   * script had already put there.
   *
   * Derived from the fleet schedule rather than the live board on purpose — the
   * board carries tonight's coverage and OOS substitutions, which say nothing
   * about a standing monthly sheet.
   */
  const rows = useMemo(() => {
    const nums = new Set<number>(Object.keys(stored[day] ?? {}).map(Number));
    for (const t of trucks) {
      if (!t.is_active || t.truck_type === "Spare") continue;
      if (isScheduledOff(t, day)) continue;
      nums.add(t.truck_number);
    }
    const byNum = new Map(trucks.map((t) => [t.truck_number, t]));
    return [...nums].sort((a, b) => a - b).map((n) => ({ num: n, truck: byNum.get(n) }));
  }, [stored, trucks, day]);

  const dayDrafts = drafts[day] ?? {};

  const total = useMemo(
    () => Object.values(dayDrafts).reduce((n, v) => n + (Number(v) || 0), 0),
    [dayDrafts],
  );
  const onSheet = useMemo(
    () => Object.values(dayDrafts).filter((v) => String(v).trim() !== "").length,
    [dayDrafts],
  );

  /** Normalised payload for a day: every filled cell, keyed by truck. Blanks
   *  drop out; an explicit 0 is a real value and stays. */
  function payloadFor(d: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [num, v] of Object.entries(drafts[d] ?? {})) {
      if (String(v).trim() === "") continue;
      const w = Number(v);
      if (Number.isFinite(w) && w >= 0) out[num] = w;
    }
    return out;
  }

  const changedDays = useMemo(() => {
    if (!open) return [];
    return DAYS.filter((d) => {
      const before: Record<string, number> = {};
      for (const [n, w] of Object.entries(stored[d] ?? {})) before[n] = w;
      return JSON.stringify(before) !== JSON.stringify(payloadFor(d));
    });
    // payloadFor reads `drafts`, which is the real dependency here.
  }, [drafts, stored, open]);

  /** The unload day `runDate` actually works — the only sheet whose numbers
   *  govern what is batched right now. */
  const liveDay = useMemo(() => {
    const [y, m, dd] = runDate.split("-").map(Number);
    return unloadsOverride ?? workdayNumbers(new Date(y, m - 1, dd, 12)).unloadsDay;
  }, [runDate, unloadsOverride]);

  const routeByCarrier = useMemo(() => {
    const map = new Map<number, number>();
    for (const [route, carrier] of prevCarriers) map.set(carrier.truck_number, route);
    return map;
  }, [prevCarriers]);

  /**
   * Trucks batched on `runDate` whose assigned wearers disagree with what the
   * just-saved sheet says they should be. Resolved exactly the way every
   * batching surface resolves a prefill — a carrier takes the route it carried,
   * and a split helper is 0 — so "what it would become" is genuinely what the
   * app would have filled in.
   */
  function pendingChanges(): { truck: number; batch: number; from: number; to: number }[] {
    const sheet = payloadFor(liveDay);
    const out: { truck: number; batch: number; from: number; to: number }[] = [];
    for (const b of batches) {
      for (const t of b.trucks) {
        const to = prevSplitHelpers.has(t.truck_number)
          ? 0
          : sheet[String(routeByCarrier.get(t.truck_number) ?? t.truck_number)];
        // Not on the sheet -> the sheet has no opinion, so leave it alone.
        if (to == null) continue;
        if (to !== t.wearers) out.push({ truck: t.truck_number, batch: b.batch_number, from: t.wearers, to });
      }
    }
    return out.sort((a, b) => a.truck - b.truck);
  }

  const [pending, setPending] = useState<{ truck: number; batch: number; from: number; to: number }[]>([]);

  async function save() {
    for (const d of changedDays) {
      await upsert.mutateAsync({ key: unloadDayWearersKey(d), value: payloadFor(d) });
    }
    setSaved(true);
    // Only worth asking when TODAY's sheet moved and something live disagrees.
    if (changedDays.some((d) => d === liveDay)) {
      const diffs = pendingChanges();
      if (diffs.length > 0) {
        setPending(diffs);
        setApplyOpen(true);
      }
    }
  }

  /** Re-assign each affected truck to the batch it is already in, with the new
   *  number. Reuses the normal assign path so the cap check, the split-helper
   *  rule and the activity log all behave as if a person had typed it. */
  async function applyToCurrent() {
    setApplying(true);
    try {
      for (const c of pending) {
        await assign.mutateAsync({
          run_date: runDate,
          batch_number: c.batch,
          truck_number: c.truck,
          wearers: c.to,
        });
      }
      setApplyOpen(false);
      setPending([]);
    } finally {
      setApplying(false);
    }
  }

  function setCell(num: number, value: string) {
    setSaved(false);
    setDrafts((p) => ({ ...p, [day]: { ...(p[day] ?? {}), [num]: value } }));
  }

  if (!open) return null;

  // Portalled: the Batching page body sits inside a transformed wrapper, where
  // position:fixed would resolve against that ancestor instead of the viewport.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">Wearer defaults</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              The standing count for each truck, from the monthly sheets. Batching prefills
              from these, so a truck can be batched in one tap.
            </p>
          </div>
          <button className="btn-ghost shrink-0" onClick={onClose}>Close</button>
        </div>

        {/* Day tabs — the month arrives as five sheets, so all five live here. */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-700 px-4 py-2">
          {DAYS.map((d) => {
            const count = Object.values(drafts[d] ?? {}).filter((v) => String(v).trim() !== "").length;
            const dirty = changedDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={clsx(
                  "relative flex min-w-[68px] flex-col items-center rounded-lg border px-2.5 py-1.5 transition-colors",
                  day === d
                    ? "border-blue-500 bg-blue-950/40"
                    : "border-slate-700 bg-slate-900/60 hover:border-slate-600",
                )}
              >
                {dirty && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />}
                <span className="text-xs font-bold text-slate-200">Day {d}</span>
                <span className="text-[10px] text-slate-500">{count} trucks</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-950/40 px-4 py-2 text-xs">
          <span className="text-slate-400">
            Day {day}{DAY_NAMES[day] ? ` · ${DAY_NAMES[day]}` : ""}
          </span>
          {/* Reconcile against the paper before saving. */}
          <span className="text-slate-400">
            <span className="font-semibold tabular-nums text-slate-200">{onSheet}</span> on sheet ·{" "}
            <span className="font-semibold tabular-nums text-slate-200">{total.toLocaleString()}</span> wearers
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rows.map(({ num, truck }) => {
              const v = dayDrafts[num] ?? "";
              const active = String(v).trim() !== "";
              return (
                <label
                  key={num}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                    active ? "border-slate-600 bg-slate-800/70" : "border-slate-800 bg-slate-900/40",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-bold tabular-nums text-slate-200">
                      #{num}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      {truck ? truckTypeLabel(truck.truck_type) : "not in fleet"}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="input w-20 py-1 text-right text-sm tabular-nums"
                    placeholder="—"
                    value={v}
                    onChange={(e) => setCell(num, e.target.value)}
                  />
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Leave a truck blank when it isn't on that day's sheet; blanks aren't saved, so the
            wizard asks for a number rather than prefilling a false one. Enter <code>0</code>
            when the sheet really says 0 — that truck still gets batched.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-700 px-4 py-3">
          <span className="text-xs text-slate-500">
            {changedDays.length === 0
              ? saved ? "Saved." : "No changes."
              : `Unsaved: ${changedDays.map((d) => `Day ${d}`).join(", ")}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={changedDays.length === 0 || upsert.isPending}
              onClick={() => setDrafts(draftsFromStored())}
            >
              Revert
            </button>
            <button
              type="button"
              className="btn-primary font-semibold"
              disabled={changedDays.length === 0 || upsert.isPending}
              onClick={save}
            >
              {upsert.isPending ? "Saving…" : "Save defaults"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={applyOpen}
        title="Update current batching numbers?"
        description={
          `Day ${liveDay}'s sheet changed. ${pending.length} truck${pending.length === 1 ? "" : "s"} already ` +
          `batched on ${runDate} ${pending.length === 1 ? "has" : "have"} a different number:\n\n` +
          pending.slice(0, 8).map((c) => `  #${c.truck} (batch ${c.batch})  ${c.from} → ${c.to}`).join("\n") +
          (pending.length > 8 ? `\n  …and ${pending.length - 8} more` : "") +
          `\n\nSaving the sheet on its own leaves today's batches as they are.`
        }
        confirmLabel={applying ? "Updating…" : "Update them"}
        cancelLabel="Leave as they are"
        onConfirm={() => void applyToCurrent()}
        onCancel={() => { setApplyOpen(false); setPending([]); }}
      />
    </div>,
    document.body,
  );
}
