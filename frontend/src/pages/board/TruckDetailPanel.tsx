/**
 * Inline truck detail panel (non-fleet board). Shows stats, notes, shortages,
 * and audit entries for a truck. Extracted from Board.tsx.
 */
import type { ReactNode } from "react";
import type { TruckStatus, TruckWithState } from "../../types";
import { useAuditEntries, useShortages } from "../../api/hooks";
import { STATUS_LABELS } from "./constants";

import { format } from "date-fns";

export default function TruckDetailPanel({
  truck,
  runDate,
  onClose,
}: {
  truck: TruckWithState;
  runDate: string;
  onClose: () => void;
}) {
  const { data: shorts } = useShortages(runDate, truck.truck_number);
  const { data: audits } = useAuditEntries(runDate);
  const truckAudits = (audits ?? []).filter(
    (a) => a.truck_number === truck.truck_number,
  );
  const status = (truck.state?.status ?? "dirty") as TruckStatus;

  function fmtDuration(sec: number | null | undefined) {
    if (!sec) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function fmtTime(ts: number | null | undefined) {
    if (!ts) return "—";
    return format(new Date(ts * 1000), "PPpp");
  }

  const stats: { label: string; value: ReactNode }[] = [
    { label: "Route", value: `Route #${truck.truck_number}` },
    { label: "Batch", value: truck.state?.batch_id ?? "—" },
    { label: "Wearers", value: truck.state?.wearers ?? 0 },
    { label: "Type", value: truck.truck_type },
    { label: "Duration", value: fmtDuration(truck.state?.load_duration_seconds) },
    { label: "Started", value: fmtTime(truck.state?.load_start_time) },
    { label: "Finished", value: fmtTime(truck.state?.load_finish_time) },
    { label: "Status", value: STATUS_LABELS[status] ?? status },
  ];

  return (
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      {/* Header */}
      <div className="relative flex items-center justify-center px-6 py-6 border-b border-slate-800">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {truck.truck_type}
            {truck.truck_type === "Uniform" && truck.uniform_size != null ? ` · ${truck.uniform_size}ft` : ""}
            {" · "}{truck.is_active ? "Active" : "Inactive"}
            {truck.is_persistent_spare ? " · Persistent spare" : ""}
          </p>
          <h2 className="mt-0.5 text-5xl font-black tracking-tight text-white">
            #{truck.truck_number}
          </h2>
        </div>
        <button
          className="absolute right-6 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-4">
        {stats.map(({ label, value }) => (
          <div
            key={label}
            className="border-b border-r border-slate-800 px-5 py-4 last:border-r-0 [&:nth-child(2n)]:md:border-r [&:nth-child(4n)]:md:border-r-0"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-base font-semibold text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="space-y-4 px-6 py-5">
        {(truck.state?.off_note || truck.state?.shop_note) && (
          <div className="rounded-md bg-slate-950/60 border border-slate-800 px-4 py-3 text-sm space-y-1">
            {truck.state?.off_note && (
              <p>
                <span className="font-semibold text-amber-300">OFF note:</span>{" "}
                {truck.state.off_note}
              </p>
            )}
            {truck.state?.shop_note && (
              <p>
                <span className="font-semibold text-purple-300">SHOP note:</span>{" "}
                {truck.state.shop_note}
              </p>
            )}
          </div>
        )}

        {(shorts ?? []).length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Shortages ({(shorts ?? []).length})
            </h4>
            <ul className="divide-y divide-slate-800 text-sm">
              {(shorts ?? []).map((s) => (
                <li key={s.id} className="py-1.5">
                  <span className="font-medium">{s.item_category}</span>
                  {s.item_detail && (
                    <span className="text-slate-400"> — {s.item_detail}</span>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    qty {s.quantity} · {s.initials || "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {truckAudits.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Audit entries ({truckAudits.length})
            </h4>
            <ul className="divide-y divide-slate-800 text-sm">
              {truckAudits.map((a) => (
                <li key={a.id} className="py-1.5">
                  <span className="font-medium">{a.item_label}</span>{" "}
                  <span className="text-xs text-slate-500">qty {a.quantity}</span>
                  {a.warn_on_next_load && (
                    <span className="badge ml-2 bg-amber-700/70">Warn</span>
                  )}
                  {a.note && <p className="text-xs text-slate-400">{a.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
