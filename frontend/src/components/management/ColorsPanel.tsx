/**
 * Status badge colors panel. Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import type { TruckStatus } from "../../types";
import { useUpsertSetting } from "../../api/hooks";
import { DEFAULT_BADGE_COLORS, STATUS_LABELS, SaveButton, FieldRow } from "./shared";

export default function ColorsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const raw = map.get("status_badge_colors");
  const initial = useMemo<Record<TruckStatus, string>>(() => {
    const out: Record<TruckStatus, string> = { ...DEFAULT_BADGE_COLORS };
    if (raw && typeof raw === "object") {
      for (const k of Object.keys(out) as TruckStatus[]) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim())) {
          out[k] = v.trim();
        }
      }
    }
    return out;
  }, [raw]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    await upsert.mutateAsync({ key: "status_badge_colors", value: form });
  }

  return (
    <div className="card">
      {(Object.keys(STATUS_LABELS) as TruckStatus[]).map((k) => (
        <FieldRow key={k} label={STATUS_LABELS[k]}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              className="h-9 w-14 cursor-pointer rounded border border-slate-700 bg-slate-900"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
            <input
              className="input w-36 font-mono text-xs"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
            <span
              className="ml-2 rounded px-2 py-0.5 text-xs font-semibold text-white"
              style={{ background: form[k] }}
            >
              sample
            </span>
          </div>
        </FieldRow>
      ))}
      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}
