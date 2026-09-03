/**
 * Batching — the settings and the end-of-day assignment screen in one place.
 *
 * These used to be split: the four toggles lived in Operations → Workflows
 * while the panel you actually batch on was buried under Data & Reports →
 * Previous Data Entry, two groups away. The "batching" category id had been
 * reserved in Settings.tsx all along with nothing wired to it; this is it.
 */
import { useEffect, useMemo, useState } from "react";
import { useUpsertSetting } from "../../api/hooks";
import { asBool, FieldRow, SaveButton } from "./shared";
import BatchingPanel from "./BatchingPanel";
import BatchingQuickEntry from "./BatchingQuickEntry";
import { DEFAULT_WEARER_CAP } from "../../utils/batchCapacity";

export default function BatchingSettingsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      batching_disabled: asBool(map.get("batching_disabled"), false),
      prebatch_mode: asBool(map.get("prebatch_mode"), false),
      batch_no_cap: asBool(map.get("batch_no_cap"), false),
      wearer_cap: Number(map.get("wearer_cap") ?? DEFAULT_WEARER_CAP),
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
    <div className="space-y-4">
      <div className="card space-y-1">
        <h3 className="text-sm font-semibold text-slate-300">Batching settings</h3>
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
          label="Pre-batch mode"
          hint="Assigning a batch records the batch only — it no longer marks the truck unloaded. For transcribing the paper batch sheet ahead of the unload. Trucks stay Dirty until someone taps Mark Unloaded, so unload progress stays honest. Turn OFF while the crew is working: a Dirty truck does not appear in Ready to load."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.prebatch_mode}
              onChange={(e) => setForm({ ...form, prebatch_mode: e.target.checked })}
            />
            Batch without unloading
          </label>
        </FieldRow>
        <FieldRow
          label="No wearer cap"
          hint="Remove the per-batch wearer capacity limit. Useful for holiday or overflow loads."
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
          label="Wearers cap"
          hint="Maximum total wearers allowed per batch during unload. Ignored when 'No wearer cap' is on."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="input w-28"
              value={form.wearer_cap}
              onChange={(e) => setForm({ ...form, wearer_cap: Number(e.target.value) })}
            />
            <span className="text-xs text-slate-500">wearers</span>
          </div>
        </FieldRow>
        <SaveButton dirty={dirty} saving={upsert.isPending} onSave={save} onRevert={() => setForm(initial)} />
      </div>

      {/* Type-through entry first: it is the fastest way in when you are working
          from the paper sheet. The full grid below stays for reviewing and
          fixing what is already assigned. */}
      <BatchingQuickEntry />
      <BatchingPanel />
    </div>
  );
}
