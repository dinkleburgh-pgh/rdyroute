/**
 * Batching — bulk end-of-day batch assignment. One screen to put every
 * returning truck into a batch (1–6) for the run date, with live per-batch
 * wearer totals against the Operations wearer cap. The one-truck-at-a-time
 * flow (Unload page → batch cards → /batches) still exists for crews; this
 * panel is the supervisor's sweep at the end of the day.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  useAssignBatch,
  useBatchSummary,
  useBoard,
  useHolidayUnload,
  useRemoveTruckFromBatch,
  useSettings,
  useUnloadsDayOverride,
} from "../../api/hooks";
import { todayIso } from "../../api/client";
import { workdayNumbers } from "../../components/Clock";
import { buildOperationalDayContext } from "../../utils/truckStatus";
import { useToast } from "../../contexts/ToastContext";
import ConfirmDialog from "../ConfirmDialog";
import { FieldRow } from "./shared";
import type { TruckWithState } from "../../types";

const BATCH_NUMBERS = [1, 2, 3, 4, 5, 6];
const DEFAULT_WEARER_CAP = 1800;

// Always graded against the configured cap, even when the cap is not enforced.
function capacityText(total: number, _noCap: boolean, cap: number) {
  if (total >= cap * 0.95) return "text-red-400";
  if (total >= cap * 0.7) return "text-amber-400";
  return "text-emerald-400";
}

export default function BatchingPanel() {
  const toast = useToast();
  const [runDate, setRunDate] = useState(todayIso());
  const [showAll, setShowAll] = useState(false);
  const [wearerDrafts, setWearerDrafts] = useState<Record<number, string>>({});
  const [confirmClear, setConfirmClear] = useState<number | null>(null);
  const [busyTruck, setBusyTruck] = useState<number | null>(null);

  const { data: board = [] } = useBoard(runDate);
  const { data: batches = [] } = useBatchSummary(runDate);
  const { data: settings = [] } = useSettings();
  const { data: unloadsOverride } = useUnloadsDayOverride(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const assign = useAssignBatch();
  const removeFromBatch = useRemoveTruckFromBatch();

  const noCap = settings.some((s) => s.key === "batch_no_cap" && s.value === true);
  const wearerCap = (() => {
    const v = Number(settings.find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEARER_CAP;
  })();

  const [yr, mo, dy] = runDate.split("-").map(Number);
  const unloadsDay = unloadsOverride ?? workdayNumbers(new Date(yr, mo - 1, dy, 12)).unloadsDay;

  // batch each truck currently sits in, from the live summary
  const batchByTruck = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of batches) for (const t of b.trucks) map.set(t.truck_number, b.batch_number);
    return map;
  }, [batches]);

  // End-of-day roster = today's unload-day trucks, plus anything already
  // batched (so a stray assignment is always visible and fixable).
  const rosterTrucks = useMemo(() => {
    if (showAll) return [...board].sort((a, b) => a.truck_number - b.truck_number);
    const ctx = buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload");
    const nums = new Set(ctx.activeTrucks.map((t) => t.truck_number));
    return board
      .filter((t) => nums.has(t.truck_number) || batchByTruck.has(t.truck_number))
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [board, showAll, unloadsDay, holidayUnload, batchByTruck]);

  const unassigned = rosterTrucks.filter((t) => !batchByTruck.has(t.truck_number)).length;

  function draftWearers(t: TruckWithState): string {
    return wearerDrafts[t.truck_number] ?? String(t.state?.wearers ?? 0);
  }

  async function assignTruck(t: TruckWithState, batchNumber: number) {
    setBusyTruck(t.truck_number);
    try {
      await assign.mutateAsync({
        run_date: runDate,
        batch_number: batchNumber,
        truck_number: t.truck_number,
        wearers: Number(draftWearers(t)) || 0,
      });
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? `Could not assign truck ${t.truck_number}.`);
    } finally {
      setBusyTruck(null);
    }
  }

  async function unassignTruck(truckNumber: number) {
    const batchNumber = batchByTruck.get(truckNumber);
    if (batchNumber == null) return;
    setBusyTruck(truckNumber);
    try {
      await removeFromBatch.mutateAsync({ run_date: runDate, batch_number: batchNumber, truck_number: truckNumber });
    } catch {
      toast.error(`Could not remove truck ${truckNumber} from batch ${batchNumber}.`);
    } finally {
      setBusyTruck(null);
    }
  }

  async function clearBatch(batchNumber: number) {
    const trucks = batches.find((b) => b.batch_number === batchNumber)?.trucks ?? [];
    for (const t of trucks) {
      try {
        await removeFromBatch.mutateAsync({ run_date: runDate, batch_number: batchNumber, truck_number: t.truck_number });
      } catch {
        toast.error(`Could not remove truck ${t.truck_number} from batch ${batchNumber}.`);
        return;
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-300">End-of-Day Batching</h3>
          <p className="mt-1 text-xs text-slate-500">
            Assign each returning truck to a batch for the run date. Tap a batch number on a truck's row;
            tap it again (or ✕) to unassign. Wearer totals update live against the Operations wearer cap.
            Every change saves instantly — there is no separate save or apply step.
          </p>
        </div>

        <FieldRow label="Run date">
          <input
            type="date"
            className="input"
            max={todayIso()}
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
          />
        </FieldRow>

        {/* Batch totals */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {BATCH_NUMBERS.map((n) => {
            const b = batches.find((x) => x.batch_number === n);
            const total = b?.total_wearers ?? 0;
            const count = b?.trucks.length ?? 0;
            return (
              <div key={n} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">Batch {n}</span>
                  {count > 0 && (
                    <button
                      className="text-[10px] text-slate-500 hover:text-red-400"
                      onClick={() => setConfirmClear(n)}
                    >
                      clear
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {count} truck{count !== 1 ? "s" : ""} ·{" "}
                  <span className={clsx("font-semibold tabular-nums", capacityText(total, noCap, wearerCap))}>
                    {total}
                  </span>
                  <span className="text-slate-600"> / {noCap ? "∞" : wearerCap}</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-300">
            Trucks ({rosterTrucks.length})
            {unassigned > 0 && <span className="ml-2 text-xs font-normal text-amber-300">{unassigned} unassigned</span>}
            {unassigned === 0 && rosterTrucks.length > 0 && (
              <span className="ml-2 text-xs font-normal text-emerald-400">all batched ✓</span>
            )}
          </h3>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show entire fleet
          </label>
        </div>

        {rosterTrucks.length === 0 ? (
          <p className="text-sm text-slate-500">No trucks on the unload roster for this date.</p>
        ) : (
          <div className="space-y-1.5">
            {rosterTrucks.map((t) => {
              const current = batchByTruck.get(t.truck_number);
              const busy = busyTruck === t.truck_number;
              return (
                <div
                  key={t.truck_number}
                  className={clsx(
                    "flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5",
                    current != null ? "border-slate-800 bg-slate-900/40" : "border-amber-800/50 bg-amber-950/20",
                  )}
                >
                  <span className="w-12 shrink-0 text-base font-extrabold tabular-nums text-white">
                    #{t.truck_number}
                  </span>
                  <span className="w-20 shrink-0 text-xs capitalize text-slate-500">
                    {t.state?.status?.replace("_", " ") ?? "—"}
                  </span>
                  <input
                    className="input w-20 px-2 py-1 text-xs"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    title="Wearers on this truck"
                    value={draftWearers(t)}
                    onChange={(e) =>
                      setWearerDrafts((d) => ({ ...d, [t.truck_number]: e.target.value.replace(/\D/g, "") }))
                    }
                    onBlur={() => {
                      // Auto-save wearers edits for trucks already in a batch —
                      // re-assigning to the same batch updates the stored count.
                      if (current == null) return;
                      const saved = batches
                        .find((b) => b.batch_number === current)
                        ?.trucks.find((x) => x.truck_number === t.truck_number)?.wearers;
                      const next = Number(draftWearers(t)) || 0;
                      if (saved !== undefined && next !== saved) void assignTruck(t, current);
                    }}
                  />
                  <div className="flex items-center gap-1">
                    {BATCH_NUMBERS.map((n) => (
                      <button
                        key={n}
                        disabled={busy}
                        className={clsx(
                          "h-7 w-7 rounded-md text-xs font-bold transition-colors",
                          current === n
                            ? "bg-blue-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white",
                          busy && "opacity-50",
                        )}
                        onClick={() => (current === n ? unassignTruck(t.truck_number) : assignTruck(t, n))}
                      >
                        {n}
                      </button>
                    ))}
                    {current != null && (
                      <button
                        disabled={busy}
                        className="ml-1 h-7 w-7 rounded-md bg-slate-800 text-xs text-slate-500 hover:bg-red-900/60 hover:text-red-300"
                        title="Remove from batch"
                        onClick={() => unassignTruck(t.truck_number)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear != null}
        title={`Clear batch ${confirmClear}?`}
        description={`Removes every truck assignment from batch ${confirmClear} for ${runDate}. Truck statuses are not changed.`}
        confirmLabel="Clear batch"
        onConfirm={() => {
          const n = confirmClear;
          setConfirmClear(null);
          if (n != null) void clearBatch(n);
        }}
        onCancel={() => setConfirmClear(null)}
      />
    </div>
  );
}
