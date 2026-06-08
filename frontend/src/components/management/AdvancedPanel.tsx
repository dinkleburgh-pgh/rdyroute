/**
 * Advanced raw key/value settings editor. Extracted from Settings.tsx.
 */
import { useState } from "react";
import clsx from "clsx";
import { useUpsertSetting } from "../../api/hooks";
import type { AppSetting } from "../../types";

const WELL_KNOWN_KEYS = new Set([
  "timezone_key", "ui_theme", "warn_seconds", "rollover_prompt_hour",
  "rollover_snooze_minutes", "auto_refresh_ms", "pace_avg_override_enabled",
  "pace_avg_override_seconds", "pace_buffer_base_seconds", "pace_buffer_per_truck_seconds",
  "pace_buffer_percent", "pace_loader_baseline_count", "pace_loader_active_count",
  "status_badge_colors", "skip_batching_disabled", "batching_disabled",
  "communications_censor_words",
]);

const HIDDEN_KEYS = new Set(["communications_censor_words"]);

export default function AdvancedPanel({ settings }: { settings: AppSetting[] }) {
  const upsert = useUpsertSetting();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  async function save() {
    if (!key) return;
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep raw string */ }
    await upsert.mutateAsync({ key, value: parsed });
    setKey("");
    setValue("");
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Upsert raw setting</h3>
        <p className="text-xs text-slate-500">
          For keys not surfaced on the other tabs. Value is parsed as JSON if possible,
          otherwise stored as a raw string.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Key</label>
            <input className="input" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Value</label>
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary" disabled={upsert.isPending || !key} onClick={save}>
          Save
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {settings.filter((s) => !HIDDEN_KEYS.has(s.key)).map((s) => (
              <tr key={s.key} className={clsx("border-t border-slate-800", WELL_KNOWN_KEYS.has(s.key) && "opacity-60")}>
                <td className="px-3 py-2 font-mono text-xs">{s.key}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{JSON.stringify(s.value)}</td>
                <td className="px-3 py-2 text-slate-400">{new Date(s.updated_at).toLocaleString()}</td>
              </tr>
            ))}
            {settings.length === 0 && (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={3}>No settings stored.</td></tr>
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">Dimmed rows are managed by the other tabs.</p>
      </div>
    </div>
  );
}
