/**
 * Driver QR Codes panel — per-route QR codes for driver note access.
 * Extracted from Settings.tsx.
 */
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useFleet, useRegenerateQR } from "../../api/hooks";
import { publicBase } from "../../api/client";

export default function DriverQRPanel() {
  const { data: trucks, isLoading } = useFleet(true);
  const regen = useRegenerateQR();
  const [search, setSearch] = useState("");
  const [copiedTruck, setCopiedTruck] = useState<number | null>(null);

  const base = publicBase();

  const active = useMemo(
    () =>
      (trucks ?? [])
        .filter((t) => t.is_active && t.truck_type !== "Spare")
        .filter((t) => search === "" || String(t.truck_number).includes(search))
        .sort((a, b) => a.truck_number - b.truck_number),
    [trucks, search],
  );

  function copyUrl(truckNumber: number, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedTruck(truckNumber);
      setTimeout(() => setCopiedTruck(null), 1800);
    });
  }

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Driver QR Codes</h3>
        <p className="text-xs text-slate-500">
          Each driver scans their route&apos;s QR code to view their notes without logging in.
          Print or post the code in the truck cab. Use &ldquo;Regenerate&rdquo; if a code is
          compromised — the old code stops working immediately.
        </p>
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Filter by route #…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-ghost text-sm" onClick={() => window.print()}>Print all visible</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 print:grid-cols-3">
        {active.map((truck) => {
          if (!truck.qr_token) return null;
          const url = `${base}/driver/${truck.qr_token}`;
          const isCopied   = copiedTruck === truck.truck_number;
          const isRegening = regen.isPending && regen.variables === truck.truck_number;
          return (
            <div key={truck.truck_number}
              className="flex flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 print:border-slate-300 print:bg-white">
              <p className="text-sm font-semibold text-slate-200 print:text-slate-900">Route #{truck.truck_number}</p>
              <div className="rounded bg-white p-1.5">
                <QRCodeSVG value={url} size={120} />
              </div>
              <div className="flex w-full gap-1 print:hidden">
                <input readOnly value={url} className="input min-w-0 flex-1 truncate text-[11px]" />
                <button
                  className="shrink-0 rounded-md bg-slate-700 px-2 text-[11px] font-medium text-slate-200 hover:bg-slate-600"
                  onClick={() => copyUrl(truck.truck_number, url)}>
                  {isCopied ? "✓" : "Copy"}
                </button>
              </div>
              <div className="flex w-full gap-1.5 print:hidden">
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 rounded-md bg-slate-800 py-1 text-center text-[11px] font-medium text-slate-300 hover:bg-slate-700">
                  Preview ↗
                </a>
                <button
                  className="flex-1 rounded-md bg-red-900/50 py-1 text-[11px] font-medium text-red-300 hover:bg-red-900 disabled:opacity-50"
                  disabled={isRegening}
                  onClick={() => {
                    if (!confirm(`Regenerate QR for route #${truck.truck_number}? The old code stops working immediately.`)) return;
                    regen.mutate(truck.truck_number);
                  }}>
                  {isRegening ? "…" : "Regenerate"}
                </button>
              </div>
              <p className="hidden text-center text-[10px] text-slate-600 print:block">
                /driver/{truck.qr_token.slice(0, 8)}…
              </p>
            </div>
          );
        })}
        {active.length === 0 && (
          <p className="col-span-full text-sm text-slate-500">No active route trucks found.</p>
        )}
      </div>
    </div>
  );
}
