/**
 * Truck detail modal (fleet board) — the TRUCK's management surface: fleet
 * attributes, driver QR, and today's record. Deliberately NO day-state
 * controls (status / needs-checked / next-up): those live one tap up on the
 * card's action sheet, and duplicating them here was pure bloat.
 */
import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { QrCode } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { can } from "../../utils/permissions";

// Lazy ON PURPOSE: Board is statically imported, and qrcode.react must stay
// out of the eager entry bundle. This chunk loads only when the modal opens
// for a role that can see the section.
const TruckQRSection = lazy(() => import("../../components/TruckQRSection"));
import type { TruckWithState } from "../../types";
import { useAuditEntries, useShortages } from "../../api/hooks";
import TruckDocuments from "../../components/TruckDocuments";
import Stat from "./Stat";
import { getCoverageRouteNumber } from "../../utils/truckStatus";
import FleetTruckEditor from "./FleetTruckEditor";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS, STATUS_TEXT } from "./constants";
import type { TruckStatus } from "../../types";
import clsx from "clsx";
import { format } from "date-fns";
import { truckTypeLabel } from "../../utils/truckType";
import { useItemDisplayName } from "../../components/shorts/HierarchyPicker";

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
  const itemDisplayName = useItemDisplayName();
  const { data: shorts } = useShortages(runDate, truck.truck_number);
  const { data: audits } = useAuditEntries(runDate);
  const truckAudits = (audits ?? []).filter(
    (a) => a.truck_number === truck.truck_number,
  );
  const status = (truck.is_oos ? "oos" : (truck.state?.status ?? "dirty")) as TruckStatus;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
    >
      {/* Same width, corner radius, status strip and header row as the card's
          action sheet — Manage truck opens FROM that sheet, so it should read
          as the next page of the same surface, not a second, wider design.
          (max-w-2xl with a centred 5xl number was the "ill-fitting" look.) */}
      <div
        className="max-h-[92svh] w-full max-w-md overflow-hidden overflow-y-auto rounded-t-2xl border border-hairline bg-surface shadow-xl sm:max-h-[90svh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={clsx("h-[3px] w-full", STATUS_BG[status])} />
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className={clsx("font-mono text-[44px] font-black leading-none tabular-nums", STATUS_TEXT[status])}>
            {truck.truck_number}
          </span>
          <span className={clsx("badge shrink-0", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
            {STATUS_LABELS[status]}
          </span>
          <span className="min-w-0 truncate text-sm text-ink-muted">
            {truckTypeLabel(truck.truck_type)}
            {truck.truck_type === "Uniform" && truck.uniform_size != null ? ` · ${truck.uniform_size}ft` : ""}
            {truck.is_persistent_spare ? " · Persistent spare" : ""}
            {!truck.is_active ? " · Inactive" : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>
        {(readOnly || truck.state?.priority_hold || truck.state?.needs_checked) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-hairline px-5 py-2">
            {readOnly && <span className="text-xs font-semibold text-amber-400">Archive — read only</span>}
            {truck.state?.priority_hold && <span className="text-xs font-semibold text-red-400">Hold — Do Not Load</span>}
            {truck.state?.needs_checked && <span className="text-xs font-semibold text-amber-400">Needs Checked</span>}
          </div>
        )}

        {/* Safe-area inset: bottom-docked on phones, same reason as the action sheet. */}
        <div className="space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {fleetMode && !readOnly && (
            <FleetTruckEditor truck={truck} runDate={runDate} />
          )}

          <QRBlock truckNumber={truck.truck_number} readOnly={readOnly} />

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
              label="Covers route"
              value={getCoverageRouteNumber(truck) ?? "—"}
            />
            <Stat
              label="Arrived"
              value={truck.state?.arrived_at ? format(new Date(truck.state.arrived_at * 1000), "p") : "—"}
            />
          </section>

          {(truck.state?.off_note || truck.state?.shop_note) && (
            <section className="rounded-md bg-surface-3/60 p-3 text-sm">
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
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Shortages today ({(shorts ?? []).length})
            </h4>
            {(shorts ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">No shortages recorded.</p>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {(shorts ?? []).map((s) => (
                  <li key={s.id} className="py-1.5">
                    <span className="font-medium">{s.item_category}</span>
                    {s.item_detail && (
                      <span className="text-ink-muted"> — {s.item_detail}</span>
                    )}
                    <span className="ml-2 text-xs text-ink-muted">
                      qty {s.quantity} · {s.initials || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Audit entries today ({truckAudits.length})
            </h4>
            {truckAudits.length === 0 ? (
              <p className="text-sm text-ink-muted">No audit entries.</p>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {truckAudits.map((a) => (
                  <li key={a.id} className="py-1.5">
                    <span className="font-medium">{itemDisplayName(a.item_label)}</span>{" "}
                    <span className="text-xs text-ink-muted">qty {a.quantity}</span>
                    {a.warn_on_next_load && (
                      <span className="badge ml-2 bg-amber-700/70">Warn</span>
                    )}
                    {a.note && (
                      <p className="text-xs text-ink-muted">{a.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TruckDocuments truckNumber={truck.truck_number} />
        </div>
      </div>
    </div>,
    document.body,
  );
}


/**
 * Driver QR management, gated the way the API is: the token fetch and
 * regenerate are require_admin (admin/fleet/supervisor), so anyone else gets
 * no section rather than a button that 403s — the exact bug the old Notes
 * placement had. Always expanded: a collapsed "Show" row at the bottom read
 * as the QR not being here at all.
 */
function QRBlock({ truckNumber, readOnly }: { truckNumber: number; readOnly: boolean }) {
  const { user } = useAuth();
  if (readOnly || !can(user?.role, "manage:qr")) return null;
  return (
    <div className="rounded-lg border border-hairline bg-surface/40 p-3">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <QrCode className="h-4 w-4 shrink-0 text-ink-muted" />
        Driver QR
      </p>
      <Suspense fallback={<p className="py-3 text-center text-xs text-ink-muted">Loading QR…</p>}>
        <TruckQRSection truckNumber={truckNumber} />
      </Suspense>
    </div>
  );
}
