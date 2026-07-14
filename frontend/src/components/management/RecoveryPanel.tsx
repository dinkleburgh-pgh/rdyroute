/**
 * Recovery panel — PostgreSQL backup file management.
 * Lists pg_dump SQL backups created by the background backup_loop(),
 * allows downloading them, and provides the existing ZIP restore functionality.
 */
import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../api/client";
import { useToast } from "../../contexts/ToastContext";
import ConfirmDialog from "../ConfirmDialog";
import { DownloadIcon, TrashIcon, RefreshIcon } from "../icons";

interface PgBackup {
  filename: string;
  size_bytes: number;
  created_at: string;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  // Render in Eastern (the operation's timezone) regardless of the viewer's locale.
  return (
    new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET"
  );
}

export default function RecoveryPanel() {
  const { user } = useAuth();
  const toast = useToast();

  const [backups, setBackups] = useState<PgBackup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // ZIP restore state (existing functionality)
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const isPrivileged =
    user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor" ||
    user?.role === "lead"  || user?.role === "atl";

  async function loadBackups() {
    setLoading(true);
    try {
      const res = await api.get<PgBackup[]>("/exports/pg-backups");
      setBackups(res.data);
      setLoaded(true);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail ?? "Could not load backups");
    } finally {
      setLoading(false);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/exports/pg-backups/${encodeURIComponent(deleteTarget)}`);
      toast.success(`Deleted ${deleteTarget}`);
      setBackups((b) => b.filter((x) => x.filename !== deleteTarget));
    } catch {
      toast.error("Could not delete backup");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function doRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await api.post<{ message?: string }>(
        `/exports/pg-backups/${encodeURIComponent(restoreTarget)}/restore`,
      );
      toast.success(res.data?.message ?? `Restored from ${restoreTarget}`);
      await loadBackups();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail ?? "Restore failed");
    } finally {
      setRestoring(false);
      setRestoreTarget(null);
    }
  }

  function downloadBackup(filename: string) {
    const a = document.createElement("a");
    a.href = `/api/exports/pg-backups/${encodeURIComponent(filename)}`;
    a.download = filename;
    a.click();
  }

  async function handleZipImport(file: File) {
    setImporting(true);
    setImportStatus(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/exports/import/backup", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setImportStatus(`Error: ${err.detail ?? res.statusText}`);
      } else {
        const result = await res.json();
        const parts = Object.entries(result as Record<string, number>).map(
          ([k, v]) => `${v} ${k.replace(/_/g, " ")}`,
        );
        setImportStatus(parts.length ? `Restored: ${parts.join(", ")}` : "Done");
      }
    } catch (e) {
      setImportStatus(`Network error: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {!isPrivileged && (
        <p className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-400">
          Recovery actions are restricted to admin / fleet / supervisor / lead / atl roles.
        </p>
      )}

      {/* PostgreSQL backup files */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">PostgreSQL Backups</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Automatic pg_dump SQL backups created every 30 minutes. Stored at{" "}
              <span className="font-mono text-slate-400">/app/.data/backups/</span>
            </p>
          </div>
          <button
            className="btn-ghost gap-1.5 text-xs"
            onClick={loadBackups}
            disabled={loading}
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            {loading ? "Loading…" : loaded ? "Refresh" : "Load backups"}
          </button>
        </div>

        {loaded && backups.length === 0 && (
          <p className="text-sm text-slate-500">
            No backup files found in <span className="font-mono">/app/.data/backups/</span>.
            Backups are created automatically every 30 minutes when the app is running against PostgreSQL.
          </p>
        )}

        {backups.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">File</th>
                  <th className="px-3 py-2.5 text-right">Size</th>
                  <th className="px-3 py-2.5">Created</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.filename} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{b.filename}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-slate-400">{fmtBytes(b.size_bytes)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDate(b.created_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Restore this backup — replaces the entire database"
                          className="rounded px-2 py-1 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-40"
                          disabled={!isPrivileged}
                          onClick={() => setRestoreTarget(b.filename)}
                        >
                          Restore
                        </button>
                        <button
                          title="Download"
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                          onClick={() => downloadBackup(b.filename)}
                        >
                          <DownloadIcon className="h-4 w-4" />
                        </button>
                        <button
                          title="Delete"
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          disabled={!isPrivileged}
                          onClick={() => setDeleteTarget(b.filename)}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-800 px-3 py-2 text-xs text-slate-600">
              {backups.length} backup{backups.length !== 1 ? "s" : ""} · newest first · keeping last 48
            </p>
          </div>
        )}

        {!loaded && (
          <p className="text-xs text-slate-600">Click "Load backups" to list available backup files.</p>
        )}
      </div>

      {/* ZIP backup restore */}
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Restore from ZIP backup</h3>
        <p className="text-xs text-slate-500">
          Upload a <span className="font-mono">readyroute_backup_*.zip</span> file exported from
          Data &amp; Reports → Export &amp; Import. Restores the core operational snapshot including
          fleet, truck states, shortages, batches, load durations, and any packaged activity history.
        </p>
        {importStatus && (
          <p className={`rounded px-3 py-2 text-sm ${
            importStatus.startsWith("Error")
              ? "bg-red-900/40 text-red-300"
              : "bg-emerald-900/40 text-emerald-300"
          }`}>
            {importStatus}
          </p>
        )}
        <label className={`btn-ghost cursor-pointer text-sm ${!isPrivileged ? "pointer-events-none opacity-50" : ""}`}>
          {importing ? "Restoring…" : "Choose backup ZIP…"}
          <input
            type="file"
            className="sr-only"
            accept=".zip"
            disabled={importing || !isPrivileged}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleZipImport(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Confirm delete */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget ?? "backup"}?`}
        description="This backup file will be permanently removed from the server."
        confirmLabel="Delete"
        variant="danger"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Confirm restore (destructive — full DB replace) */}
      <ConfirmDialog
        open={restoreTarget !== null}
        title={`Restore ${restoreTarget ?? "backup"}?`}
        description="This REPLACES the entire database with this snapshot — all current data is overwritten. A pre-restore snapshot is saved automatically first, and if the restore fails it rolls back with no changes."
        confirmLabel="Replace DB & restore"
        variant="danger"
        busy={restoring}
        onConfirm={doRestore}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}
