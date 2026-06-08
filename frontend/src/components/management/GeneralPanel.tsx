/**
 * General app settings panel. Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useUpsertSetting } from "../../api/hooks";
import { asBool, asNumber, asString, FieldRow, SaveButton } from "./shared";

export default function GeneralPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      timezone_key: asString(map.get("timezone_key"), "America/Chicago"),
      ui_theme: asString(map.get("ui_theme"), "dark"),
      warn_seconds: asNumber(map.get("warn_seconds"), 900),
      rollover_prompt_hour: asNumber(map.get("rollover_prompt_hour"), 6),
      rollover_snooze_minutes: asNumber(map.get("rollover_snooze_minutes"), 60),
      auto_refresh_ms: asNumber(map.get("auto_refresh_ms"), 120000),
      live_truck_styling: asBool(map.get("live_truck_styling"), true),
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
      <FieldRow label="Timezone" hint="IANA name, e.g. America/Chicago">
        <input
          className="input"
          value={form.timezone_key}
          onChange={(e) => setForm({ ...form, timezone_key: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="UI theme">
        <select
          className="input"
          value={form.ui_theme}
          onChange={(e) => setForm({ ...form, ui_theme: e.target.value })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </FieldRow>
      <FieldRow
        label="Load warning threshold (minutes)"
        hint="When elapsed exceeds this, the in-progress card turns red."
      >
        <input
          type="number"
          min={1}
          className="input"
          value={Math.round(form.warn_seconds / 60)}
          onChange={(e) =>
            setForm({
              ...form,
              warn_seconds: Math.max(1, parseInt(e.target.value || "0", 10)) * 60,
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Rollover prompt hour"
        hint="0–23. When the shift opens past this hour the rollover prompt appears."
      >
        <input
          type="number"
          min={0}
          max={23}
          className="input"
          value={form.rollover_prompt_hour}
          onChange={(e) =>
            setForm({
              ...form,
              rollover_prompt_hour: Math.min(
                23,
                Math.max(0, parseInt(e.target.value || "0", 10)),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Rollover snooze (minutes)">
        <input
          type="number"
          min={1}
          className="input"
          value={form.rollover_snooze_minutes}
          onChange={(e) =>
            setForm({
              ...form,
              rollover_snooze_minutes: Math.max(1, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Auto refresh (ms)"
        hint="Default polling interval for board/status views."
      >
        <input
          type="number"
          min={500}
          step={500}
          className="input"
          value={form.auto_refresh_ms}
          onChange={(e) =>
            setForm({
              ...form,
              auto_refresh_ms: Math.max(500, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Enable live truck button styling"
        hint="Apply status-based colors to truck tiles and buttons on the board."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.live_truck_styling}
            onChange={(e) => setForm({ ...form, live_truck_styling: e.target.checked })}
          />
          Enabled
        </label>
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
