import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { StickyNote } from "lucide-react";
import {
  useUpsertSetting,
  useWorkflowNotes,
  workflowDayNotesKey,
  workflowPersistentNotesKey,
  type NoteScope,
} from "../../api/hooks";
import NotesSection from "./NotesSection";

/**
 * Editor for one workflow's standing notes: a persistent set that applies every
 * run day, plus a set per workday 1-5.
 *
 * These are the instructions that live on the paper sheet and repeat every
 * week — "69 must be in its own batch", "keep 56 execs separate" — as opposed
 * to the truck notes on the rest of this page, which hang off a single truck.
 *
 * Day 3's box here is the SAME `unload_day_notes_3` the Unload page and the
 * batching wizard have always rendered, so this is an editor for what was
 * previously seed-script-only, not a second parallel set of notes.
 *
 * One line per note. Leading bullets are stripped on display, so pasting
 * straight off the sheet works.
 */

const DAYS = [1, 2, 3, 4, 5] as const;
const DAY_NAMES: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri",
};

type Tab = "persistent" | number;

export default function WorkflowNotesSection({
  scope,
  title,
  subtitle,
  currentDay,
  canEdit,
}: {
  scope: NoteScope;
  title: string;
  subtitle: string;
  /** Today's workday for this workflow — its tab gets a "today" marker. */
  currentDay?: number | null;
  /** Writing an AppSetting is admin-gated server-side; read-only otherwise. */
  canEdit: boolean;
}) {
  const stored = useWorkflowNotes(scope);
  const upsert = useUpsertSetting();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("persistent");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const asDrafts = useMemo(() => {
    const d: Record<string, string> = { persistent: stored.persistent };
    for (const n of DAYS) d[String(n)] = stored.days[n] ?? "";
    return d;
  }, [stored]);

  // Seed from the server on OPEN only. Keyed on the open transition rather than
  // on `stored` so an unrelated settings refetch can't wipe what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDrafts(asDrafts);
      setTab(currentDay ? currentDay : "persistent");
      setSaved(false);
    }
    wasOpen.current = open;
  });

  const dirtyKeys = useMemo(
    () => Object.keys(asDrafts).filter((k) => (drafts[k] ?? "") !== asDrafts[k]),
    [drafts, asDrafts],
  );

  async function save() {
    for (const k of dirtyKeys) {
      const key = k === "persistent"
        ? workflowPersistentNotesKey(scope)
        : workflowDayNotesKey(scope, Number(k));
      await upsert.mutateAsync({ key, value: drafts[k] ?? "" });
    }
    setSaved(true);
  }

  const tabKey = tab === "persistent" ? "persistent" : String(tab);
  const value = drafts[tabKey] ?? "";
  const lineCount = (s: string) => s.split("\n").filter((l) => l.trim()).length;

  // Total across the whole workflow, so the collapsed header says whether
  // there is anything in here without opening it.
  const totalLines =
    lineCount(stored.persistent) +
    DAYS.reduce((n, d) => n + lineCount(stored.days[d] ?? ""), 0);

  return (
    <NotesSection
      title={title}
      subtitle={subtitle}
      icon={<StickyNote className="h-6 w-6" />}
      count={totalLines}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTab("persistent")}
              className={clsx(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                tab === "persistent"
                  ? "border-blue-500 bg-blue-950/40 text-blue-100"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600",
              )}
            >
              Daily
              {lineCount(drafts.persistent ?? "") > 0 && (
                <span className="ml-1.5 text-[10px] text-slate-500">
                  {lineCount(drafts.persistent ?? "")}
                </span>
              )}
              {dirtyKeys.includes("persistent") && <span className="ml-1 text-amber-400">•</span>}
            </button>
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTab(d)}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === d
                    ? "border-blue-500 bg-blue-950/40 text-blue-100"
                    : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600",
                )}
              >
                Day {d}
                <span className="ml-1 text-[10px] text-slate-500">{DAY_NAMES[d]}</span>
                {currentDay === d && (
                  <span className="ml-1.5 rounded bg-sky-500/20 px-1 text-[9px] font-bold text-sky-300">
                    today
                  </span>
                )}
                {lineCount(drafts[String(d)] ?? "") > 0 && (
                  <span className="ml-1.5 text-[10px] text-slate-500">
                    {lineCount(drafts[String(d)] ?? "")}
                  </span>
                )}
                {dirtyKeys.includes(String(d)) && <span className="ml-1 text-amber-400">•</span>}
              </button>
            ))}
          </div>

          <p className="mb-1.5 text-[11px] text-slate-500">
            {tab === "persistent"
              ? "Shown every run day, on top of that day's notes."
              : `Shown only on ${scope} day ${tab}.`}{" "}
            One note per line.
          </p>

          <textarea
            rows={5}
            className="input w-full font-mono text-xs leading-relaxed"
            placeholder={
              tab === "persistent"
                ? "e.g. Check the dock door is latched before leaving"
                : "e.g. 69 must be in its own batch"
            }
            disabled={!canEdit}
            value={value}
            onChange={(e) => {
              setSaved(false);
              setDrafts((p) => ({ ...p, [tabKey]: e.target.value }));
            }}
          />

          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">
              {!canEdit
                ? "Read only — ask an admin to change these."
                : dirtyKeys.length === 0
                  ? saved ? "Saved." : "No changes."
                  : `Unsaved: ${dirtyKeys.map((k) => (k === "persistent" ? "Daily" : `Day ${k}`)).join(", ")}`}
            </span>
            {canEdit && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={dirtyKeys.length === 0 || upsert.isPending}
                  onClick={() => setDrafts(asDrafts)}
                >
                  Revert
                </button>
                <button
                  type="button"
                  className="btn-primary font-semibold"
                  disabled={dirtyKeys.length === 0 || upsert.isPending}
                  onClick={save}
                >
                  {upsert.isPending ? "Saving…" : "Save notes"}
                </button>
              </div>
            )}
          </div>
    </NotesSection>
  );
}
