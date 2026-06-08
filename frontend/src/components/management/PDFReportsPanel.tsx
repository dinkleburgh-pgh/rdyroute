/**
 * PDF day reports panel — generates a printable HTML report. Extracted from Settings.tsx.
 */
import { useAuditEntries, useBoard } from "../../api/hooks";
import { todayIso } from "../../api/client";

export default function PDFReportsPanel() {
  const { data: board }   = useBoard(todayIso());
  const { data: entries } = useAuditEntries(todayIso());

  function openReportDownloads() {
    const today = todayIso();
    const rows = (board ?? [])
      .slice().sort((a, b) => a.truck_number - b.truck_number)
      .map((t) => {
        const s = t.state?.status ?? "dirty";
        const label = s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const duration = t.state?.load_duration_seconds
          ? `${Math.floor(t.state.load_duration_seconds / 60)}m ${(t.state.load_duration_seconds % 60).toString().padStart(2, "0")}s`
          : "—";
        return `<tr><td>${t.truck_number}</td><td>${t.truck_type ?? ""}</td><td>${label}</td><td>${t.state?.wearers ?? 0}</td><td>${duration}</td></tr>`;
      }).join("");

    const auditRows = (entries ?? [])
      .slice().sort((a, b) => a.truck_number - b.truck_number)
      .map((e) => `<tr><td>#${e.truck_number}</td><td>${e.item_label}</td><td>${e.quantity}</td><td>${e.note ?? ""}</td></tr>`)
      .join("");

    const html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8" />
  <title>ReadyRoute Day Report — ${today}</title>
  <style>
    body { font-family: sans-serif; font-size: 12px; color: #111; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-top: 24px; margin-bottom: 4px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
    p.sub { color: #555; font-size: 11px; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    @media print { body { margin: 0; } }
  </style>
</head><body>
  <h1>ReadyRoute V2 — Day Report</h1>
  <p class="sub">Run date: ${today} &nbsp;·&nbsp; Generated: ${new Date().toLocaleString()}</p>
  <h2>Truck States</h2>
  <table><thead><tr><th>#</th><th>Type</th><th>Status</th><th>Wearers</th><th>Load Time</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='5'>No trucks</td></tr>"}</tbody></table>
  <h2>Audit Entries</h2>
  <table><thead><tr><th>Truck</th><th>Item</th><th>Qty</th><th>Note</th></tr></thead>
    <tbody>${auditRows || "<tr><td colspan='4'>No entries</td></tr>"}</tbody></table>
  <script>window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 200); });<\/script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank");
    if (!win) { URL.revokeObjectURL(url); alert("Pop-up blocked — please allow pop-ups for this site."); return; }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Download PDFs</h3>
      <p className="text-xs text-slate-500">
        Generate a print-ready day report. After clicking, use your browser&apos;s Print dialog (Ctrl+P / Cmd+P) and choose &ldquo;Save as PDF&rdquo; to download.
      </p>
      <button className="btn-primary" onClick={openReportDownloads}>Open report downloads</button>
      <p className="text-[11px] text-slate-600">Includes truck states and audit entries for today&apos;s run date.</p>
    </div>
  );
}
