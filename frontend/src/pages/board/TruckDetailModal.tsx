/**
 * Truck detail modal (fleet board). Wraps StatusEditor + FleetTruckEditor and
 * shows stats, notes, shortages, and audit entries. Extracted from Board.tsx.
 */
import type { TruckStatus, TruckWithState } from "../../types";
import { useAuditEntries, useShortages } from "../../api/hooks";
import Stat from "./Stat";
import StatusEditor from "./StatusEditor";
import FleetTruckEditor from "./FleetTruckEditor";

export default function TruckDetailModal({
  truck,
  runDate,
  fleetMode,
  readOnly = false,
  onClose,
}: {
  truck: TruckWithState;
  runDate: string;
  fleetMode: boolean;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { data: shorts } = useShortages(runDate, truck.truck_number);
  const { data: audits } = useAuditEntries(runDate);
  const truckAudits = (audits ?? []).filter(
    (a) => a.truck_number === truck.truck_number,
  );
  // is_oos flag takes priority — ensures OOS is reflected even on dates with no state row
  const status = (truck.is_oos ? "oos" : (truck.state?.status ?? "dirty")) as TruckStatus;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div>
            <h3 className="text-xl font-semibold">Truck #{truck.truck_number}</h3>
            <p className="text-xs text-slate-400">
              {truck.truck_type} · {truck.is_active ? "Active" : "Inactive"}
              {truck.is_persistent_spare ? " · Persistent spare" : ""}
            </p>
            {readOnly && (
              <p className="mt-0.5 text-xs font-semibold text-amber-400">Archive — read only</p>
            )}
          </div>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          {!readOnly && <StatusEditor truck={truck} runDate={runDate} status={status} />}

          {fleetMode && !readOnly && (
            <FleetTruckEditor truck={truck} runDate={runDate} />
          )}

          <section className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Wearers" value={truck.state?.wearers ?? 0} />
            <Stat label="Batch" value={truck.state?.batch_id ?? "—"} />
            <Stat label="Load day" value={truck.state?.load_day_num ?? "—"} />
            <Stat
              label="Load duration"
              value={
                truck.state?.load_duration_seconds
                  ? `${Math.round(truck.state.load_duration_seconds / 60)} min`
                  : "—"
              }
            />
            <Stat
              label="OOS covers route"
              value={truck.state?.oos_spare_route ?? "—"}
            />
          </section>

          {(truck.state?.off_note || truck.state?.shop_note) && (
            <section className="rounded-md bg-slate-950/60 p-3 text-sm">
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
            </section>
          )}

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Shortages today ({(shorts ?? []).length})
            </h4>
            {(shorts ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No shortages recorded.</p>
            ) : (
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
            )}
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Audit entries today ({truckAudits.length})
            </h4>
            {truckAudits.length === 0 ? (
              <p className="text-sm text-slate-500">No audit entries.</p>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm">
                {truckAudits.map((a) => (
                  <li key={a.id} className="py-1.5">
                    <span className="font-medium">{a.item_label}</span>{" "}
                    <span className="text-xs text-slate-500">qty {a.quantity}</span>
                    {a.warn_on_next_load && (
                      <span className="badge ml-2 bg-amber-700/70">Warn</span>
                    )}
                    {a.note && (
                      <p className="text-xs text-slate-400">{a.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
