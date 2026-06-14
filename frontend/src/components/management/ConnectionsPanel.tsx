/**
 * Backend connections health panel. Extracted from Settings.tsx.
 * Includes database health plus runtime Ollama OCR settings.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "../../api/client";
import { useUpsertSetting } from "../../api/hooks";

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

interface OllamaHealthDetail {
  configured: boolean;
  reachable: boolean;
  model_available: boolean;
  base_url: string;
  model: string;
  timeout_seconds: number;
  low_confidence_threshold: number;
  preprocess_max_image_side: number;
  available_models: string[];
  error: string | null;
}

interface OllamaFormState {
  baseUrl: string;
  model: string;
  timeoutSeconds: string;
  lowConfidenceThreshold: string;
  preprocessMaxImageSide: string;
}

interface OllamaProbePayload {
  base_url: string;
  model: string;
  timeout_seconds: number;
  low_confidence_threshold: number;
  preprocess_max_image_side: number;
}

const DEFAULT_OLLAMA_BASE_URL = "http://192.168.1.132:30068";
const DEFAULT_OLLAMA_MODEL = "minicpm-v:latest";
const DEFAULT_OLLAMA_TIMEOUT_SECONDS = "60";
const DEFAULT_OLLAMA_LOW_CONFIDENCE_THRESHOLD = "0.82";
const DEFAULT_OLLAMA_PREPROCESS_MAX_IMAGE_SIDE = "1800";

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

function DbCard({ probe, title }: { probe: DbProbe; title: string }) {
  const color = probe.ok ? "text-emerald-400" : "text-red-400";
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

function SettingField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export default function ConnectionsPanel() {
  const [health, setHealth] = useState<HealthDetail | null>(null);
  const [ollama, setOllama] = useState<OllamaHealthDetail | null>(null);
  const [form, setForm] = useState<OllamaFormState>({
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    model: DEFAULT_OLLAMA_MODEL,
    timeoutSeconds: DEFAULT_OLLAMA_TIMEOUT_SECONDS,
    lowConfidenceThreshold: DEFAULT_OLLAMA_LOW_CONFIDENCE_THRESHOLD,
    preprocessMaxImageSide: DEFAULT_OLLAMA_PREPROCESS_MAX_IMAGE_SIDE,
  });
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const upsertSetting = useUpsertSetting();

  function normalizeForm(values: OllamaFormState): OllamaFormState {
    const baseUrl = String(values?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).trim() || DEFAULT_OLLAMA_BASE_URL;
    const model = String(values?.model ?? DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
    const timeoutSeconds = String(values?.timeoutSeconds ?? DEFAULT_OLLAMA_TIMEOUT_SECONDS);
    const lowConfidenceThreshold = String(values?.lowConfidenceThreshold ?? DEFAULT_OLLAMA_LOW_CONFIDENCE_THRESHOLD);
    const preprocessMaxImageSide = String(values?.preprocessMaxImageSide ?? DEFAULT_OLLAMA_PREPROCESS_MAX_IMAGE_SIDE);
    return {
      baseUrl,
      model,
      timeoutSeconds: String(Math.max(1, Number.parseInt(timeoutSeconds, 10) || 60)),
      lowConfidenceThreshold: String(Number.parseFloat(lowConfidenceThreshold) || 0.82),
      preprocessMaxImageSide: String(Math.max(600, Number.parseInt(preprocessMaxImageSide, 10) || 1800)),
    };
  }

  function probePayload(values: OllamaFormState): OllamaProbePayload {
    const normalized = normalizeForm(values);
    return {
      base_url: normalized.baseUrl,
      model: normalized.model,
      timeout_seconds: Number.parseInt(normalized.timeoutSeconds, 10),
      low_confidence_threshold: Number.parseFloat(normalized.lowConfidenceThreshold),
      preprocess_max_image_side: Number.parseInt(normalized.preprocessMaxImageSide, 10),
    };
  }

  async function testCurrentForm(): Promise<OllamaHealthDetail> {
    const normalized = normalizeForm(form);
    setForm(normalized);
    const res = await api.post<OllamaHealthDetail>("/shorts/imports/ollama/test", probePayload(normalized));
    setOllama(res.data);
    return res.data;
  }

  async function check() {
    setLoading(true);
    setError(null);
    setOllamaError(null);

    try {
      const t0 = performance.now();
      const res = await api.get<HealthDetail>("/health/detail");
      setApiLatencyMs(Math.round(performance.now() - t0));
      setHealth(res.data);
      setLastChecked(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed");
      setHealth(null);
    }

    try {
      const res = await api.get<OllamaHealthDetail>("/shorts/imports/ollama/health");
      setOllama(res.data);
      setForm({
        baseUrl: res.data.base_url || DEFAULT_OLLAMA_BASE_URL,
        model: res.data.model || DEFAULT_OLLAMA_MODEL,
        timeoutSeconds: String(res.data.timeout_seconds ?? DEFAULT_OLLAMA_TIMEOUT_SECONDS),
        lowConfidenceThreshold: String(res.data.low_confidence_threshold ?? DEFAULT_OLLAMA_LOW_CONFIDENCE_THRESHOLD),
        preprocessMaxImageSide: String(res.data.preprocess_max_image_side ?? DEFAULT_OLLAMA_PREPROCESS_MAX_IMAGE_SIDE),
      });
    } catch (e: unknown) {
      setOllamaError(e instanceof Error ? e.message : "Ollama check failed");
      setOllama(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void check();
  }, []);

  async function saveOllamaSettings() {
    setSaveError(null);
    setSaveNotice(null);
    setOllamaError(null);
    setIsSavingSettings(true);
    try {
      const normalized = normalizeForm(form);
      setForm(normalized);
      const result = await api.post<OllamaHealthDetail>("/shorts/imports/ollama/test", probePayload(normalized)).then((res) => {
        setOllama(res.data);
        return res.data;
      });
      if (!(result.configured && result.reachable && result.model_available)) {
        setSaveError(result.error ?? "Connection test failed. Fix the values above before saving.");
        return;
      }

      await upsertSetting.mutateAsync({ key: "ollama_base_url", value: normalized.baseUrl });
      await upsertSetting.mutateAsync({ key: "shortage_sheet_ollama_model", value: normalized.model });
      await upsertSetting.mutateAsync({
        key: "shortage_sheet_ollama_timeout_seconds",
        value: Number.parseInt(normalized.timeoutSeconds, 10),
      });
      await upsertSetting.mutateAsync({
        key: "shortage_sheet_llm_low_confidence_threshold",
        value: Number.parseFloat(normalized.lowConfidenceThreshold),
      });
      await upsertSetting.mutateAsync({
        key: "shortage_sheet_preprocess_max_image_side",
        value: Number.parseInt(normalized.preprocessMaxImageSide, 10),
      });
      setSaveNotice("Ollama settings saved and connected.");
      await check();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Failed to save Ollama settings");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleTestConnection() {
    setSaveError(null);
    setSaveNotice(null);
    setOllamaError(null);
    setIsTestingConnection(true);
    try {
      const result = await testCurrentForm();
      if (result.configured && result.reachable && result.model_available) {
        setSaveNotice("Ollama connection verified.");
      } else {
        setOllamaError(result.error ?? "Connection test failed.");
      }
    } catch (e: unknown) {
      setOllamaError(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setIsTestingConnection(false);
    }
  }

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
      {ollamaError && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">{ollamaError}</div>
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

      <div className="card space-y-4 border border-slate-700/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-200">Ollama OCR Connection</h4>
            <p className="mt-1 text-xs text-slate-500">
              These settings drive shortage-sheet OCR imports. They override `.env` values at runtime.
            </p>
          </div>
          {ollama && (
            <span
              className={clsx(
                "text-sm font-bold",
                ollama.reachable && ollama.model_available
                  ? "text-emerald-400"
                  : ollama.configured
                  ? "text-amber-400"
                  : "text-slate-400",
              )}
            >
              ● {ollama.reachable && ollama.model_available ? "Connected" : ollama.configured ? "Needs attention" : "Not configured"}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SettingField label="Base URL" hint="Verified host: http://192.168.1.132:30068">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              value={form.baseUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
              placeholder="http://192.168.1.132:30068"
            />
          </SettingField>
          <SettingField label="Model" hint="Verified model: minicpm-v:latest">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              value={form.model}
              onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
              placeholder="minicpm-v:latest"
            />
          </SettingField>
          <SettingField label="Timeout Seconds">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              type="number"
              min={1}
              value={form.timeoutSeconds}
              onChange={(event) => setForm((prev) => ({ ...prev, timeoutSeconds: event.target.value }))}
            />
          </SettingField>
          <SettingField label="Low Confidence Threshold" hint="Values below this go through the repair/review path.">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={form.lowConfidenceThreshold}
              onChange={(event) => setForm((prev) => ({ ...prev, lowConfidenceThreshold: event.target.value }))}
            />
          </SettingField>
          <SettingField label="Preprocess Max Image Side" hint="Upper bound used during sheet normalization before OCR.">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              type="number"
              min={600}
              value={form.preprocessMaxImageSide}
              onChange={(event) => setForm((prev) => ({ ...prev, preprocessMaxImageSide: event.target.value }))}
            />
          </SettingField>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="mb-0.5 text-xs text-slate-500">Configured</p>
            <p className={clsx("font-semibold", ollama?.configured ? "text-emerald-300" : "text-slate-300")}>
              {ollama?.configured ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="mb-0.5 text-xs text-slate-500">Reachable</p>
            <p className={clsx("font-semibold", ollama?.reachable ? "text-emerald-300" : "text-slate-300")}>
              {ollama?.reachable ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="mb-0.5 text-xs text-slate-500">Model Installed</p>
            <p className={clsx("font-semibold", ollama?.model_available ? "text-emerald-300" : "text-slate-300")}>
              {ollama?.model_available ? "Yes" : "No"}
            </p>
          </div>
        </div>

        {ollama?.available_models && ollama.available_models.length > 0 && (
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="mb-1 text-xs text-slate-500">Available Models</p>
            <p className="break-words text-sm text-slate-300">{ollama.available_models.join(", ")}</p>
          </div>
        )}
        {ollama?.error && (
          <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            {ollama.error}
          </div>
        )}
        {saveError && (
          <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            {saveError}
          </div>
        )}
        {saveNotice && (
          <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
            {saveNotice}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-xs" onClick={saveOllamaSettings} disabled={isSavingSettings || isTestingConnection || upsertSetting.isPending}>
            {isSavingSettings || upsertSetting.isPending ? "Saving…" : "Save Ollama Settings"}
          </button>
          <button className="btn-ghost text-xs" onClick={handleTestConnection} disabled={isSavingSettings || isTestingConnection || loading}>
            {isTestingConnection ? "Testing…" : "Test Connection"}
          </button>
        </div>
      </div>

      {health && <DbCard probe={health.db} title="Primary Database" />}
      {health?.db_fallback && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
          <span className="font-semibold">⚠ SQLite fallback active:</span> {health.db_fallback}
        </div>
      )}
      {health?.extra_dbs.map((probe, index) => (
        <DbCard key={index} probe={probe} title={probe.label ?? `Extra DB ${index + 1}`} />
      ))}
      {health && health.extra_dbs.length === 0 && (
        <p className="text-xs text-slate-600">
          No backup databases configured. Set <span className="font-mono text-slate-400">BACKUP_DATABASE_URL</span> in <span className="font-mono text-slate-400">.env</span> to add one.
        </p>
      )}

      {health?.last_backup && (
        <div
          className={clsx(
            "rounded-lg border px-4 py-3 text-sm",
            health.last_backup.ok
              ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
              : "border-red-700/40 bg-red-950/30 text-red-300",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {health.last_backup.ok ? "● Last backup successful" : "● Last backup failed"}
            </span>
            <span className="text-xs uppercase tracking-wide opacity-70">{health.last_backup.type}</span>
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
