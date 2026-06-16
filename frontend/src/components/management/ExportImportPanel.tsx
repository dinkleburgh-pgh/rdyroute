/**
 * Export / Import panel — data backup and restore. Extracted from Settings.tsx.
 */
import { useState } from "react";
import { FieldRow } from "./shared";

export default function ExportImportPanel() {
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  function downloadFile(path: string) {
    const a = document.createElement("a");
    a.href = `/api${path}`;
    a.click();
  }

  async function handleImport(endpoint: string, file: File) {
    setImporting(true);
    setImportStatus(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api${endpoint}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setImportStatus(`Error: ${err.detail ?? res.statusText}`);
      } else {
        const result = await res.json();
        const parts = Object.entries(result as Record<string, number>).map(
          ([k, v]) => `${v} ${k.replace(/_/g, " ")} imported`,
        );
        setImportStatus(parts.length ? parts.join(", ") : "Done");
      }
    } catch (e) {
      setImportStatus(`Network error: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">Quick exports</h3>
        <p className="mb-3 text-xs text-slate-500">Download individual data tables as JSON files.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-sm" onClick={() => downloadFile("/exports/load-durations.json")}>Download load durations JSON</button>
          <button className="btn-ghost text-sm" onClick={() => downloadFile("/exports/truck-states.json")}>Download current-day state JSON</button>
          <button className="btn-ghost text-sm" onClick={() => downloadFile("/exports/audit-entries.json")}>Download audit_entries.json</button>
          <button className="btn-ghost text-sm" onClick={() => downloadFile("/exports/shortages.json")}>Download shortages.json</button>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">Backup package</h3>
        <p className="mb-3 text-xs text-slate-500">
          A single ZIP archive containing the core operational snapshot — fleet, load durations,
          truck states, audit entries, shortages, batches, and packaged activity history.
        </p>
        <button className="btn-primary" onClick={() => downloadFile("/exports/backup.zip")}>
          Download history backup package
        </button>
      </div>

      <div className="card space-y-3">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">Import tools</h3>
        {importStatus && (
          <p className={`rounded px-3 py-2 text-sm ${importStatus.startsWith("Error") ? "bg-red-900/40 text-red-300" : "bg-emerald-900/40 text-emerald-300"}`}>
            {importStatus}
          </p>
        )}
        <FieldRow label="Open backup package import" hint="Upload a readyroute_backup_*.zip file">
          <label className="btn-ghost cursor-pointer text-sm">
            {importing ? "Importing…" : "Choose backup ZIP…"}
            <input type="file" className="sr-only" accept=".zip" disabled={importing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImport("/exports/import/backup", f); e.target.value = ""; }} />
          </label>
        </FieldRow>
        <FieldRow label="Open direct JSON imports" hint="Upload a load_durations.json file exported from this system">
          <label className="btn-ghost cursor-pointer text-sm">
            {importing ? "Importing…" : "Choose load durations JSON…"}
            <input type="file" className="sr-only" accept=".json" disabled={importing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImport("/exports/import/load-durations", f); e.target.value = ""; }} />
          </label>
        </FieldRow>
      </div>
    </div>
  );
}
