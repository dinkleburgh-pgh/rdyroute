/**
 * Workflow toggles panel — timers, tracking, notes, quick actions and day
 * rollover, grouped under sub-headings rather than one flat wall of twelve
 * checkboxes. The batching toggles moved to Operations -> Batching, next to
 * the screen they actually govern.
 */
import { useEffect, useMemo, useState } from "react";
import { useUpsertSetting } from "../../api/hooks";
import { asBool, FieldRow, SaveButton } from "./shared";

export default function WorkflowsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      outside_timer_enabled: asBool(map.get("outside_timer_enabled"), false),
      outside_timer_minutes: Number(map.get("outside_timer_minutes") ?? 20),
      paper_bay_enabled: asBool(map.get("paper_bay_enabled"), false),
      paper_bay_timer_minutes: Number(map.get("paper_bay_timer_minutes") ?? 25),
      arrived_tracking_enabled: asBool(map.get("arrived_tracking_enabled"), false),
      arrived_push_enabled: asBool(map.get("arrived_push_enabled"), false),
      note_cards_enabled: asBool(map.get("note_cards_enabled"), false),
      shift_notes_enabled: asBool(map.get("shift_notes_enabled"), true),
      calculator_fab_enabled: asBool(map.get("calculator_fab_enabled"), false),
      calendar_fab_enabled: asBool(map.get("calendar_fab_enabled"), false),
      force_unloaded_on_new_day: asBool(map.get("force_unloaded_on_new_day"), false),
      unload_page_style: map.get("unload_page_style") === "grid" ? "grid" : "list",
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
      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 first:border-0 first:pt-0">Display</p>
      <FieldRow
        label="Style — Unload page"
        hint="Unload List = one row per truck with inline actions. Fleet Grid = compact fleet-style cards; tapping a truck opens an action menu (Mark Unloaded, Batch, Unfinished)."
      >
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-600 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setForm({ ...form, unload_page_style: "list" })}
            className={form.unload_page_style === "list" ? "bg-blue-600 px-3 py-1.5 text-white" : "bg-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-700"}
          >
            Unload List
          </button>
          <button
            type="button"
            onClick={() => setForm({ ...form, unload_page_style: "grid" })}
            className={form.unload_page_style === "grid" ? "border-l border-slate-600 bg-blue-600 px-3 py-1.5 text-white" : "border-l border-slate-600 bg-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-700"}
          >
            Fleet Grid
          </button>
        </div>
      </FieldRow>
      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 first:border-0 first:pt-0">Timers</p>
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
      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 first:border-0 first:pt-0">Tracking</p>
      <FieldRow
        label="Arrived tracking"
        hint="Records when each truck parks back in the yard — drivers tap 'I'm Back' on their QR page, or a lead taps Arrived on the board. Never auto-stamped."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.arrived_tracking_enabled}
            onChange={(e) => setForm({ ...form, arrived_tracking_enabled: e.target.checked })}
          />
          Enable Arrived quick action
        </label>
      </FieldRow>
      <FieldRow
        label="Arrival push notifications"
        hint="Sends a phone push to every subscribed device when a truck arrives (30-45 a night). The wall display and any open page get the pop-up either way."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.arrived_push_enabled}
            onChange={(e) => setForm({ ...form, arrived_push_enabled: e.target.checked })}
          />
          Push on arrival
        </label>
      </FieldRow>
      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 first:border-0 first:pt-0">Notes</p>
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
      <FieldRow
        label="Shift Notes"
        hint="Show the Shift Notes handoff panel at the top of the Day Overview."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.shift_notes_enabled}
            onChange={(e) => setForm({ ...form, shift_notes_enabled: e.target.checked })}
          />
          Show Shift Notes on Day Overview
        </label>
      </FieldRow>
      {/* Pop-up alerts moved to their own Operations → Pop-ups tab, where each
          kind gets its own dwell time. One switch in one place. */}
      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 first:border-0 first:pt-0">Quick actions</p>
      <FieldRow
        label="Calendar FAB"
        hint="Show a floating calendar button that opens the Fleet Schedule page."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.calendar_fab_enabled}
            onChange={(e) => setForm({ ...form, calendar_fab_enabled: e.target.checked })}
          />
          Enable calendar FAB
        </label>
      </FieldRow>
      <FieldRow
        label="Calculator FAB"
        hint="Show the floating calculator button for quick pack/percent calculations."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.calculator_fab_enabled}
            onChange={(e) => setForm({ ...form, calculator_fab_enabled: e.target.checked })}
          />
          Enable calculator
        </label>
      </FieldRow>
      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 first:border-0 first:pt-0">Day rollover</p>
      <FieldRow
        label="Auto-unload all trucks (end of day)"
        hint="When enabled, every truck is treated as Unloaded at the end of each run day, so the next day starts clean — dirty/unfinished trucks are cleared. OOS and shop trucks are left as-is."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.force_unloaded_on_new_day}
            onChange={(e) => setForm({ ...form, force_unloaded_on_new_day: e.target.checked })}
          />
          Assume all trucks unloaded by end of day
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
