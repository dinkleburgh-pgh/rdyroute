/**
 * Manual status override editor inside the truck detail modal.
 * Extracted from Board.tsx.
 */
import clsx from "clsx";
import type { TruckStatus, TruckWithState } from "../../types";
import { useUpsertTruckState } from "../../api/hooks";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS, STATUS_OPTIONS } from "./constants";

export default function StatusEditor({
  truck,
  runDate,
  status,
}: {
  truck: TruckWithState;
  runDate: string;
  status: TruckStatus;
}) {
  const upsert = useUpsertTruckState();
  return (
    <section className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
      <label className="label">Status</label>
      <div className="flex items-center gap-2">
        <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
          {STATUS_LABELS[status]}
        </span>
        <select
          className="input flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
          value={status}
          disabled={upsert.isPending || status === "oos"}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__unload_hold__") {
              e.currentTarget.value = status;
              upsert.mutate({
                truck_number: truck.truck_number,
                run_date: runDate,
                priority_hold: true,
                wearers: truck.state?.wearers ?? 0,
              });
              return;
            }
            upsert.mutate({
              truck_number: truck.truck_number,
              run_date: runDate,
              status: val as TruckStatus,
              wearers: truck.state?.wearers ?? 0,
              ...(val === "loaded" ? { load_finish_time: Date.now() / 1000 } : {}),
            });
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          {!truck.state?.priority_hold && (
            <option value="__unload_hold__">🚩 Unload &amp; Hold</option>
          )}
        </select>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
        {status === "oos"
          ? "Disable OOS above to change status."
          : "Manual override — workflow pages drive normal transitions."}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-700/30 bg-amber-950/20 px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Needs checked</p>
          <p className="text-[11px] text-slate-400">Follow-up flag that does not change lifecycle status.</p>
        </div>
        <button
          type="button"
          disabled={upsert.isPending}
          className={clsx(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
            truck.state?.needs_checked
              ? "bg-amber-600 text-slate-950 hover:bg-amber-500"
              : "bg-slate-800 text-slate-200 hover:bg-slate-700",
          )}
          onClick={() =>
            upsert.mutate({
              truck_number: truck.truck_number,
              run_date: runDate,
              needs_checked: !truck.state?.needs_checked,
              wearers: truck.state?.wearers ?? 0,
            })
          }
        >
          {truck.state?.needs_checked ? "Checked flag on" : "Mark needs checked"}
        </button>
      </div>
    </section>
  );
}
