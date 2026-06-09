/**
 * Workflow toggles panel (batching, outside timer, note cards). Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useUpsertSetting } from "../../api/hooks";
import { asBool, FieldRow, SaveButton } from "./shared";

export default function WorkflowsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      batching_disabled: asBool(map.get("batching_disabled"), false),
      batch_no_cap: asBool(map.get("batch_no_cap"), false),
      outside_timer_enabled: asBool(map.get("outside_timer_enabled"), false),
      outside_timer_minutes: Number(map.get("outside_timer_minutes") ?? 20),
      paper_bay_enabled: asBool(map.get("paper_bay_enabled"), false),
      paper_bay_timer_minutes: Number(map.get("paper_bay_timer_minutes") ?? 25),
      note_cards_enabled: asBool(map.get("note_cards_enabled"), false),
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
        label="Batching disabled"
        hint="Hide the Batches workflow entirely (mirrors V1 batching_disabled)."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.batching_disabled}
            onChange={(e) => setForm({ ...form, batching_disabled: e.target.checked })}
          />
          Hide Batches
        </label>
      </FieldRow>
      <FieldRow
        label="No wearer cap"
        hint="Remove the 400-wearer batch capacity limit. Useful for holiday or overflow loads."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.batch_no_cap}
            onChange={(e) => setForm({ ...form, batch_no_cap: e.target.checked })}
          />
          No limit
        </label>
      </FieldRow>
      <FieldRow
        label="Outside timer"
        hint="Lets fleet mark a truck as 'Outside' — a countdown that auto-transitions to Unloaded."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.outside_timer_enabled}
            onChange={(e) => setForm({ ...form, outside_timer_enabled: e.target.checked })}
          />
          Enable
          <input
            type="number"
            min={1}
            max={120}
            value={form.outside_timer_minutes}
            onChange={(e) => setForm({ ...form, outside_timer_minutes: Number(e.target.value) || 20 })}
            className="input ml-2 w-16"
          />
          <span className="text-xs text-slate-500">min</span>
        </label>
      </FieldRow>
      <FieldRow
        label="Paper Bay timer"
        hint="Lets fleet mark a truck as 'Paper Bay' — a countdown that auto-transitions to Loaded."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.paper_bay_enabled}
            onChange={(e) => setForm({ ...form, paper_bay_enabled: e.target.checked })}
          />
          Enable
          <input
            type="number"
            min={1}
            max={120}
            value={form.paper_bay_timer_minutes}
            onChange={(e) => setForm({ ...form, paper_bay_timer_minutes: Number(e.target.value) || 25 })}
            className="input ml-2 w-16"
          />
          <span className="text-xs text-slate-500">min</span>
        </label>
      </FieldRow>
      <FieldRow
        label="Note Cards"
        hint="Shows a persistent Note Cards drawer on the fleet board, displaying all active truck notes in compact card rectangles."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.note_cards_enabled}
            onChange={(e) => setForm({ ...form, note_cards_enabled: e.target.checked })}
          />
          Enable Note Cards
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
