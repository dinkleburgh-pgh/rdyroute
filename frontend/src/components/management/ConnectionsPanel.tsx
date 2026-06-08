/**
 * Backend connections health panel. Extracted from Settings.tsx.
 * Includes DbProbe/HealthDetail interfaces and DbCard sub-component.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "../../api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DbProbe {
  ok: boolean;
  type: string;
  url: string;
  latency_ms: number | null;
  error: string | null;
  pool: { size?: number; checked_out?: number; overflow?: number };
  label?: string;
}

interface HealthDetail {
  status: string;
  version: string;
  uptime_seconds: number;
  python: string;
  db: DbProbe;
  db_fallback: string | null;
  extra_dbs: DbProbe[];
  last_backup: { type: string; ok: boolean; path?: string; error?: string; at?: string } | null;
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// DbCard sub-component
// ---------------------------------------------------------------------------

function DbCard({ probe, title }: { probe: DbProbe; title: string }) {
  const color  = probe.ok ? "text-emerald-400" : "text-red-400";
  const border = probe.ok ? "border-emerald-700/40" : "border-red-700/40";
  return (
    <div className={clsx("card space-y-3 border", border)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
        <span className={clsx("text-sm font-bold", color)}>● {probe.ok ? "Connected" : "Error"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-slate-800/60 px-3 py-2">
          <p className="mb-0.5 text-xs text-slate-500">Type</p>
          <p className="font-semibold capitalize text-slate-200">{probe.type}</p>
        </div>
        <div className="rounded-lg bg-slate-800/60 px-3 py-2">
          <p className="mb-0.5 text-xs text-slate-500">Query Latency</p>
          <p className="font-semibold text-slate-200">{probe.latency_ms != null ? `${probe.latency_ms} ms` : "—"}</p>
        </div>
      </div>
      <div className="rounded-lg bg-slate-800/60 px-3 py-2">
        <p className="mb-0.5 text-xs text-slate-500">Connection URL</p>
        <p className="break-all font-mono text-xs text-slate-300">{probe.url}</p>
      </div>
      {probe.error && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {probe.error}
        </div>
      )}
      {Object.keys(probe.pool).length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          {probe.pool.size != null && (
            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-center">
              <p className="text-xs text-slate-500">Pool Size</p>
              <p className="font-bold text-slate-200">{probe.pool.size}</p>
            </div>
          )}
          {probe.pool.checked_out != null && (
            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-center">
              <p className="text-xs text-slate-500">In Use</p>
              <p className="font-bold text-slate-200">{probe.pool.checked_out}</p>
            </div>
          )}
          {probe.pool.overflow != null && (
            <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-center">
              <p className="text-xs text-slate-500">Overflow</p>
              <p className="font-bold text-slate-200">{probe.pool.overflow}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectionsPanel
// ---------------------------------------------------------------------------

export default function ConnectionsPanel() {
  const [health, setHealth] = useState<HealthDetail | null>(null);
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      const t0 = performance.now();
      const res = await api.get<HealthDetail>("/health/detail");
      setApiLatencyMs(Math.round(performance.now() - t0));
      setHealth(res.data);
      setLastChecked(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void check(); }, []);

  const statusColor = health?.status === "ok"
    ? "text-emerald-400"
    : health?.status === "degraded"
    ? "text-amber-400"
    : "text-slate-400";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Backend Connections</h3>
        <button className="btn-ghost text-xs" onClick={check} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      {lastChecked && <p className="text-xs text-slate-600">Last checked: {lastChecked.toLocaleTimeString()}</p>}
      {error && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-200">Main Backend</h4>
          {health && <span className={clsx("text-sm font-bold capitalize", statusColor)}>● {health.status}</span>}
          {loading && <span className="text-xs text-slate-500">Checking…</span>}
        </div>
        {health && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-800/60 px-3 py-2">
              <p className="mb-0.5 text-xs text-slate-500">Version</p>
              <p className="font-mono font-semibold text-slate-200">{health.version}</p>
            </div>
            <div className="rounded-lg bg-slate-800/60 px-3 py-2">
              <p className="mb-0.5 text-xs text-slate-500">Uptime</p>
              <p className="font-semibold text-slate-200">{formatUptime(health.uptime_seconds)}</p>
            </div>
            <div className="rounded-lg bg-slate-800/60 px-3 py-2">
              <p className="mb-0.5 text-xs text-slate-500">Python</p>
              <p className="font-mono font-semibold text-slate-200">{health.python}</p>
            </div>
            <div className="rounded-lg bg-slate-800/60 px-3 py-2">
              <p className="mb-0.5 text-xs text-slate-500">API Round-trip</p>
              <p className="font-semibold text-slate-200">{apiLatencyMs != null ? `${apiLatencyMs} ms` : "—"}</p>
            </div>
          </div>
        )}
      </div>

      {health && <DbCard probe={health.db} title="Primary Database" />}
      {health?.db_fallback && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
          <span className="font-semibold">⚠ SQLite fallback active:</span> {health.db_fallback}
        </div>
      )}
      {health?.extra_dbs.map((probe, i) => (
        <DbCard key={i} probe={probe} title={probe.label ?? `Extra DB ${i + 1}`} />
      ))}
      {health && health.extra_dbs.length === 0 && (
        <p className="text-xs text-slate-600">
          No backup databases configured. Set <span className="font-mono text-slate-400">BACKUP_DATABASE_URL</span> in <span className="font-mono text-slate-400">.env</span> to add one.
        </p>
      )}

      {/* Last backup status */}
      {health?.last_backup && (
        <div className={clsx(
          "rounded-lg border px-4 py-3 text-sm",
          health.last_backup.ok
            ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
            : "border-red-700/40 bg-red-950/30 text-red-300",
        )}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {health.last_backup.ok ? "● Last backup successful" : "● Last backup failed"}
            </span>
            <span className="text-xs opacity-70 uppercase tracking-wide">{health.last_backup.type}</span>
          </div>
          {health.last_backup.at && (
            <p className="mt-0.5 text-xs opacity-70">
              {new Date(health.last_backup.at).toLocaleString()}
            </p>
          )}
          {health.last_backup.error && (
            <p className="mt-1 font-mono text-xs opacity-80">{health.last_backup.error}</p>
          )}
        </div>
      )}
      {health && !health.last_backup && (
        <p className="text-xs text-slate-600">
          No backup run yet this session — first backup runs within 30 minutes.
        </p>
      )}
    </div>
  );
}
