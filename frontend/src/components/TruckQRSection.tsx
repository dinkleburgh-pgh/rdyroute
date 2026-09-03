/**
 * Per-truck driver-QR management, mounted inside the Fleet truck modal.
 *
 * The QR outgrew Notes: it is the driver's whole entry point now ("I'm Back"
 * arrival + notes), so its per-truck home is the truck's management surface.
 * The bulk print sheet stays in Management → Driver QR; the "Print sticker"
 * link below lands there pre-filtered, because printing from inside a portal
 * modal would print the whole dark page behind it — the print CSS lives on
 * that sheet and only there.
 *
 * IMPORTANT: this file owns the only qrcode.react import reachable from the
 * statically-imported Board page — it must ONLY ever be loaded via React.lazy
 * (see TruckDetailModal), or the QR library lands in the eager entry bundle.
 */
import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { publicBase } from "../api/client";
import { useQrTokens, useRegenerateQR } from "../api/hooks";

export default function TruckQRSection({ truckNumber }: { truckNumber: number }) {
  // Mounts whenever the truck modal opens for a role passing manage:qr —
  // that gate (in TruckDetailModal's QRBlock) is what keeps this admin-only
  // token fetch from firing as a 403 for everyone else.
  const { data: qrTokens = {}, isLoading } = useQrTokens(true);
  const regen = useRegenerateQR();
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const token = qrTokens[String(truckNumber)] ?? null;
  const url = token ? `${publicBase()}/driver/${token}` : null;

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  if (isLoading) {
    return <p className="py-3 text-center text-xs text-slate-500">Loading QR…</p>;
  }

  return (
    <div className="space-y-3">
      {url ? (
        <>
          <div className="mx-auto flex w-fit justify-center rounded-lg bg-white p-3">
            <QRCodeSVG value={url} size={160} />
          </div>
          <div className="flex gap-1.5">
            <input readOnly value={url} className="input min-w-0 flex-1 truncate text-xs" />
            <button
              className="shrink-0 rounded-md bg-slate-700 px-3 text-xs font-medium text-slate-200 hover:bg-slate-600"
              onClick={copy}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-center gap-4 text-xs">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline hover:text-blue-300"
            >
              Preview driver view ↗
            </a>
            {/* The bulk sheet's search filter seeds from ?truck=, so this lands
                showing exactly one sticker and its Print button prints it. */}
            <Link
              to={`/management?tab=driver_qr&truck=${truckNumber}`}
              className="text-blue-400 underline hover:text-blue-300"
            >
              Print sticker →
            </Link>
          </div>
        </>
      ) : (
        <p className="text-center text-sm text-slate-400">No QR token assigned yet.</p>
      )}

      <div className="border-t border-slate-800 pt-3">
        <p className="mb-2 text-xs text-slate-500">
          Regenerate if this code was shared with someone it shouldn't have been. The sticker
          printed in the cab stops working immediately.
        </p>
        <button
          className="w-full rounded-md bg-red-900/60 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900 disabled:opacity-50"
          disabled={regen.isPending}
          onClick={() => setConfirmRegen(true)}
        >
          {regen.isPending ? "Regenerating…" : "Regenerate QR Code"}
        </button>
      </div>
      <ConfirmDialog
        open={confirmRegen}
        title={`Regenerate QR for #${truckNumber}?`}
        description="The old code — including the printed sticker — stops working immediately."
        confirmLabel="Regenerate"
        variant="danger"
        onConfirm={() => { regen.mutate(truckNumber); setConfirmRegen(false); }}
        onCancel={() => setConfirmRegen(false)}
      />
    </div>
  );
}
