/**
 * Pace / loader calibration settings panel. Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useUpsertSetting } from "../../api/hooks";
import { asBool, asNumber, FieldRow, SaveButton } from "./shared";

export default function PacePanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      pace_avg_override_enabled: asBool(map.get("pace_avg_override_enabled"), false),
      pace_avg_override_seconds: asNumber(map.get("pace_avg_override_seconds"), 600),
      pace_buffer_base_seconds: asNumber(map.get("pace_buffer_base_seconds"), 180),
      pace_buffer_per_truck_seconds: asNumber(
        map.get("pace_buffer_per_truck_seconds"),
        25,
      ),
      pace_buffer_percent: asNumber(map.get("pace_buffer_percent"), 0.08),
      pace_loader_baseline_count: asNumber(map.get("pace_loader_baseline_count"), 2),
      pace_loader_active_count: asNumber(map.get("pace_loader_active_count"), 2),
    }),
    [map],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    const tasks: Promise<unknown>[] = [];
    for (const [k, v] of Object.entries(form)) {
      if ((initial as Record<string, unknown>)[k] !== v) {
        tasks.push(upsert.mutateAsync({ key: k, value: v }));
      }
    }
    await Promise.all(tasks);
  }

  return (
    <div className="card">
      <FieldRow
        label="Override rolling pace average"
        hint="When enabled, the override seconds value is used instead of the 30-day rolling average from load history."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.pace_avg_override_enabled}
            onChange={(e) =>
              setForm({ ...form, pace_avg_override_enabled: e.target.checked })
            }
          />
          Enabled
        </label>
      </FieldRow>
      <FieldRow label="Override seconds">
        <input
          type="number"
          min={30}
          max={7200}
          className="input"
          disabled={!form.pace_avg_override_enabled}
          value={form.pace_avg_override_seconds}
          onChange={(e) =>
            setForm({
              ...form,
              pace_avg_override_seconds: Math.max(
                30,
                parseInt(e.target.value || "0", 10),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Buffer — base seconds"
        hint="Fixed seconds added to every truck's estimated finish time."
      >
        <input
          type="number"
          min={0}
          className="input"
          value={form.pace_buffer_base_seconds}
          onChange={(e) =>
            setForm({
              ...form,
              pace_buffer_base_seconds: Math.max(0, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Buffer — per-truck seconds">
        <input
          type="number"
          min={0}
          className="input"
          value={form.pace_buffer_per_truck_seconds}
          onChange={(e) =>
            setForm({
              ...form,
              pace_buffer_per_truck_seconds: Math.max(
                0,
                parseInt(e.target.value || "0", 10),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Buffer — percent (0.0–1.0)">
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          className="input"
          value={form.pace_buffer_percent}
          onChange={(e) =>
            setForm({
              ...form,
              pace_buffer_percent: Math.max(
                0,
                Math.min(1, parseFloat(e.target.value || "0")),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Baseline loader count"
        hint="The crew size the historic pace average is normalised against."
      >
        <input
          type="number"
          min={1}
          className="input"
          value={form.pace_loader_baseline_count}
          onChange={(e) =>
            setForm({
              ...form,
              pace_loader_baseline_count: Math.max(
                1,
                parseInt(e.target.value || "0", 10),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Active loader count"
        hint="Crew size on the floor right now; used to scale the estimate."
      >
        <input
          type="number"
          min={1}
          className="input"
          value={form.pace_loader_active_count}
          onChange={(e) =>
            setForm({
              ...form,
              pace_loader_active_count: Math.max(1, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}
