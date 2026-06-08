/**
 * Fleet-mode truck settings editor (persistent spare, OOS, scheduled off days).
 * Extracted from Board.tsx.
 */
import { useState } from "react";
import clsx from "clsx";
import type { TruckWithState } from "../../types";
import { useUpdateTruck, useUpsertTruckState } from "../../api/hooks";
import { DAY_LABELS } from "./constants";

export default function FleetTruckEditor({ truck, runDate }: { truck: TruckWithState; runDate: string }) {
  const update = useUpdateTruck();
  const upsertState = useUpsertTruckState();
  const offDays: number[] = truck.scheduled_off_days ?? [];
  const [editingOffDays, setEditingOffDays] = useState(false);
  const [pendingOffDays, setPendingOffDays] = useState<number[]>([]);
  const isOos = truck.is_oos || (truck.state?.status ?? "dirty") === "oos";

  function toggleOos(checked: boolean) {
    update.mutate({
      truck_number: truck.truck_number,
      is_oos: checked,
    });
    upsertState.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      status: checked ? "oos" : "dirty",
      wearers: truck.state?.wearers ?? 0,
    });
  }

  function openOffDayEditor() {
    setPendingOffDays([...offDays]);
    setEditingOffDays(true);
  }

  function cancelOffDayEdit() {
    setEditingOffDays(false);
    setPendingOffDays([]);
  }

  function togglePendingOffDay(day: number) {
    setPendingOffDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...new Set([...prev, day])].sort((a, b) => a - b),
    );
  }

  function saveOffDays() {
    update.mutate(
      { truck_number: truck.truck_number, scheduled_off_days: pendingOffDays },
      { onSuccess: () => { setEditingOffDays(false); setPendingOffDays([]); } },
    );
  }

  function togglePersistentSpare(checked: boolean) {
    update.mutate({
      truck_number: truck.truck_number,
      is_persistent_spare: checked,
    });
    upsertState.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      status: checked ? "spare" : "dirty",
    });
  }

  return (
    <section className="rounded-md border border-slate-700 bg-slate-950/40 p-3 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Fleet settings
      </p>

      {/* Persistent spare */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Persistent spare</p>
          <p className="text-xs text-slate-500">
            This truck permanently covers a route as a spare — not part of the normal load cycle.
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={truck.is_persistent_spare}
            disabled={update.isPending}
            onChange={(e) => togglePersistentSpare(e.target.checked)}
          />
          <div className="h-6 w-11 rounded-full bg-slate-700 peer-checked:bg-indigo-600 peer-disabled:opacity-50 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Out of Service */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Out of Service (OOS)</p>
          <p className="text-xs text-slate-500">
            Truck is unavailable for today's run and needs coverage.
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={isOos}
            disabled={upsertState.isPending}
            onChange={(e) => toggleOos(e.target.checked)}
          />
          <div className="h-6 w-11 rounded-full bg-slate-700 peer-checked:bg-red-600 peer-disabled:opacity-50 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Scheduled off days — hidden for spare trucks */}
      {!truck.is_persistent_spare && truck.truck_type !== "Spare" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-200">Scheduled off days</p>
            {!editingOffDays && (
              <button
                type="button"
                onClick={openOffDayEditor}
                className="rounded px-2 py-1 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
              >
                Edit schedule
              </button>
            )}
          </div>

          {editingOffDays ? (
            <>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(DAY_LABELS) as [string, string][]).map(([dayStr, label]) => {
                  const day = Number(dayStr);
                  const active = pendingOffDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={update.isPending}
                      onClick={() => togglePendingOffDay(day)}
                      className={clsx(
                        "flex flex-col items-center rounded-md px-3 py-1.5 text-sm font-medium transition leading-tight",
                        active
                          ? "bg-red-800 text-red-100"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                      )}
                    >
                      <span>{label}</span>
                      <span className="text-xs opacity-70">Day {day}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {pendingOffDays.length === 0
                  ? "Runs every day."
                  : `Off on ${pendingOffDays.map((d) => `Day ${d} (${DAY_LABELS[d] ?? d})`).join(", ")}.`}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={saveOffDays}
                  disabled={update.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition"
                >
                  {update.isPending ? "Saving…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={cancelOffDayEdit}
                  disabled={update.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              {offDays.length === 0
                ? "Runs every day."
                : `Off on ${offDays.map((d) => `Day ${d} (${DAY_LABELS[d] ?? d})`).join(", ")}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
