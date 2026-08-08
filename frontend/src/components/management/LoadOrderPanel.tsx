/**
 * Correct a finished day's LOAD ORDER.
 *
 * Order is normally derived from `load_finish_time` — whoever was stamped
 * finished first loaded first. When trucks get marked out of sequence (a batch
 * closed out at the end of the shift, a missed tap caught up later), the day's
 * recorded order is wrong, and it feeds the "this truck usually loads 3rd"
 * averages behind the Load page's suggestions.
 *
 * The correction is stored as its own per-date list rather than by rewriting
 * the timestamps. Those stamps are measurements: shifting them to reorder a day
 * would corrupt `load_duration_seconds` and every pace metric derived from it.
 * The backend prefers this list where it exists and falls back to timestamps
 * for any truck it doesn't mention.
 *
 * Writes go through the settings upsert, which requires an admin role
 * (admin / fleet / supervisor) — that's what makes this supervisor-only.
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { useBoard, useSettings, useUpsertSetting } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import { truckTypeLabel } from "../../utils/truckType";
import { FieldRow } from "./shared";

const loadOrderKey = (runDate: string) => `load_order_${runDate}`;

function clock(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function LoadOrderPanel() {
  const toast = useToast();
  const upsert = useUpsertSetting();
  const [runDate, setRunDate] = useState(todayIso());
  const { data: board = [] } = useBoard(runDate);
  const { data: settings = [] } = useSettings();

  /** Trucks that actually finished loading that day — the only ones with an order. */
  const loaded = useMemo(
    () =>
      board
        .filter((t) => t.state?.load_finish_time != null)
        .sort((a, b) => (a.state!.load_finish_time! - b.state!.load_finish_time!)),
    [board],
  );

  const stored = useMemo(() => {
    const raw = settings.find((s) => s.key === loadOrderKey(runDate))?.value;
    return Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : null;
  }, [settings, runDate]);

  const [order, setOrder] = useState<number[]>([]);

  // Seed from the stored correction when there is one, else the timestamp order.
  // Any truck missing from a stored list is appended in timestamp order, so a
  // correction saved before a late truck finished never hides it.
  useEffect(() => {
    const byTime = loaded.map((t) => t.truck_number);
    if (!stored) { setOrder(byTime); return; }
    const known = stored.filter((n) => byTime.includes(n));
    setOrder([...known, ...byTime.filter((n) => !known.includes(n))]);
  }, [stored, loaded]);

  const byNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);
  const timeOrder = loaded.map((t) => t.truck_number);
  const dirty = JSON.stringify(order) !== JSON.stringify(stored ?? timeOrder);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  async function save() {
    try {
      await upsert.mutateAsync({ key: loadOrderKey(runDate), value: order });
      toast.success(`Load order saved for ${runDate}.`);
    } catch {
      toast.error("Could not save the load order.");
    }
  }

  async function reset() {
    try {
      await upsert.mutateAsync({ key: loadOrderKey(runDate), value: null });
      setOrder(timeOrder);
      toast.success("Reverted to the recorded times.");
    } catch {
      toast.error("Could not clear the correction.");
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Load order</h3>
        <p className="mt-1 text-xs text-slate-500">
          The order this day's trucks were loaded in, taken from their finish times. Reorder it when
          trucks were marked out of sequence — the load times themselves are left untouched, so
          durations and pace stay accurate.
        </p>
      </div>

      <FieldRow label="Run date" hint="Which day's order to correct.">
        <input
          type="date"
          className="input w-44"
          value={runDate}
          max={todayIso()}
          onChange={(e) => setRunDate(e.target.value)}
        />
      </FieldRow>

      {order.length === 0 ? (
        <p className="text-xs italic text-slate-600">No trucks finished loading on {runDate}.</p>
      ) : (
        <>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <span>{order.length} trucks</span>
            {stored && <span className="text-amber-400">Corrected order saved</span>}
          </div>

          <ol className="space-y-1">
            {order.map((n, i) => {
              const t = byNum.get(n);
              const movedFrom = timeOrder.indexOf(n);
              const shifted = movedFrom !== -1 && movedFrom !== i;
              return (
                <li
                  key={n}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                    shifted ? "border-amber-600/50 bg-amber-950/20" : "border-slate-700 bg-slate-900/50",
                  )}
                >
                  <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-slate-500">
                    {i + 1}
                  </span>
                  <span className="w-12 shrink-0 font-mono text-base font-black tabular-nums text-slate-100">
                    #{n}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    {t ? truckTypeLabel(t.truck_type) : "—"}
                    <span className="ml-2 text-slate-600">finished {clock(t?.state?.load_finish_time)}</span>
                    {shifted && (
                      <span className="ml-2 text-amber-400">was #{movedFrom + 1}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 p-1 text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    title="Move earlier"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 p-1 text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-30"
                    disabled={i === order.length - 1}
                    onClick={() => move(i, 1)}
                    title="Move later"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={!dirty || upsert.isPending} onClick={() => void save()}>
              {upsert.isPending ? "Saving…" : "Save order"}
            </button>
            {dirty && (
              <button className="btn-ghost" onClick={() => setOrder(stored ?? timeOrder)}>
                Revert changes
              </button>
            )}
            {stored && (
              <button
                className="btn-ghost inline-flex items-center gap-1.5 text-amber-300"
                onClick={() => void reset()}
                title="Delete the correction and go back to the recorded finish times"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Use recorded times
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
