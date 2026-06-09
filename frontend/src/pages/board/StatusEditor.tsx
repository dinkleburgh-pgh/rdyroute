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
    </section>
  );
}
