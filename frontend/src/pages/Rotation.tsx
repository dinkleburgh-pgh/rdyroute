import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Printer, RefreshCw, X } from "lucide-react";
import {
  useAddRotationPerson,
  useAdvanceRotation,
  useAssignRotation,
  useRenameRotationSection,
  useRotationHistory,
  useRotationPeople,
  useRotationStale,
  useRotationWeek,
  useUpdateRotationPerson,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";
import PageHeader, { Sep, Stat } from "../components/PageHeader";
import { api } from "../api/client";
import type { RotationSlot, RotationWeek } from "../types";

/** Monday of the week containing d, as YYYY-MM-DD in LOCAL time.
 *  Never use toISOString() here - it shifts to UTC and lands on the wrong
 *  Monday for anyone working an evening shift. */
function mondayOf(d: Date): string {
  const copy = new Date(d);
  const dow = (copy.getDay() + 6) % 7; // Mon=0
  copy.setDate(copy.getDate() - dow);
  const y = copy.getFullYear();
  const m = String(copy.getMonth() + 1).padStart(2, "0");
  const day = String(copy.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addWeeks(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n * 7);
  return mondayOf(dt);
}

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function prettyWeek(iso: string): string {
  return localDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Mon Sep 29 – Fri Oct 3" — the work week the Monday key stands for. */
function weekSpan(iso: string): string {
  const mon = localDate(iso);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const f = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${f(mon)} – ${f(fri)}`;
}

/** One colour per section so a week reads as a pattern, not five grey boxes.
 *  Indexed by position; the floater is always the muted one. */
const SECTION_TONES = [
  { stripe: "bg-sky-500", label: "text-sky-300", border: "border-sky-500/25" },
  { stripe: "bg-emerald-500", label: "text-emerald-300", border: "border-emerald-500/25" },
  { stripe: "bg-amber-500", label: "text-amber-300", border: "border-amber-500/25" },
  { stripe: "bg-violet-500", label: "text-violet-300", border: "border-violet-500/25" },
  { stripe: "bg-rose-500", label: "text-rose-300", border: "border-rose-500/25" },
  { stripe: "bg-cyan-500", label: "text-cyan-300", border: "border-cyan-500/25" },
] as const;
const FLOATER_TONE = { stripe: "bg-slate-500", label: "text-slate-300", border: "border-slate-500/25" } as const;

function toneFor(slot: RotationSlot, index: number) {
  return slot.is_floater ? FLOATER_TONE : SECTION_TONES[index % SECTION_TONES.length];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Weeks printed around the selected one — the sheet exists for transparency
 *  (nobody can camp the easy section if the wall shows the recent weeks and
 *  the next one), so it prints a WINDOW, not a single week. */
// The hero band at the top of the sheet IS the printed week; the grid below
// is pure history — the three weeks before it, labelled relative to the hero
// (never "this week", never a future projection).
const PRINT_OFFSETS = [0, -1, -2, -3] as const;
const SEL_IDX = 0; // the printed week: hero only, never a grid column
const GRID_LABELS = ["Last week", "2 weeks ago", "3 weeks ago"];

/** "Mon Sep 28 – Fri Oct 2" — unambiguous even torn off and pinned up. */
function clearSpan(iso: string): string {
  const mon = localDate(iso);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const f = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${f(mon)} – ${f(fri)}`;
}

/**
 * The printable rotation: a self-contained page in its own window, black on
 * white — sections down the side, a window of weeks across the top (past
 * weeks, the selected week, and the next one), each column headed by its
 * explicit Mon–Fri dates. Built here rather than with a print stylesheet so
 * the app shell never has to know about printing — and the sheet looks the
 * same from every browser.
 */
async function printRotation(week: string, thisWeek: string): Promise<boolean> {
  const keys = PRINT_OFFSETS.map((o) => addWeeks(week, o));
  const boards = await Promise.all(
    keys.map(async (k): Promise<RotationWeek> => {
      try {
        return (await api.get<RotationWeek>("/rotation", { params: { week: k } })).data;
      } catch {
        return { week_start: k, sections: [] };
      }
    }),
  );
  // The selected week anchors the row order; other weeks map by section id.
  const anchor = boards[SEL_IDX];
  const byWeek = boards.map((b) => new Map(b.sections.map((s) => [s.section_id, s])));
  // A week nobody built prints as a quiet "—" column, not five "unassigned"s.
  const weekFilled = boards.map((b) => b.sections.some((s) => s.person_name != null));

  const gridIdx = boards.map((_, i) => i).filter((i) => i !== SEL_IDX);
  const head = gridIdx
    .map((i, col) => {
      const b = boards[i];
      return `<th class="wk"><span class="rel">${esc(GRID_LABELS[col] ?? "")}</span><span class="dates">${esc(clearSpan(b.week_start))}</span></th>`;
    })
    .join("");
  const body = anchor.sections
    .map((s) => {
      const cells = gridIdx
        .map((i) => {
          const slot = byWeek[i].get(s.section_id);
          const filled = slot?.person_name != null;
          const name = filled
            ? slot!.person_name!
            : slot == null || !weekFilled[i]
              ? "—"
              : s.is_floater
                ? "— skipped —"
                : "— unassigned —";
          return `<td class="${filled ? "" : "empty"}">${esc(name)}</td>`;
        })
        .join("");
      return `<tr class="${s.is_floater ? "floater" : ""}">
        <th>${esc(s.section_name)}</th>${cells}
      </tr>`;
    })
    .join("");

  // The hero band: the printed week read HORIZONTALLY — section names across
  // the top, this week's person big under each. This is what the crew reads;
  // the grid below is the receipts.
  const hero = anchor.sections
    .map((s) => {
      const filled = s.person_name != null;
      const name = filled ? s.person_name! : s.is_floater ? "— skipped —" : "— unassigned —";
      return `<div class="hcell${s.is_floater ? " hfloat" : ""}">
        <div class="hsec">${esc(s.section_name)}</div>
        <div class="hname${filled ? "" : " hempty"}">${esc(name)}</div>
      </div>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Section rotation — week of ${esc(prettyWeek(week))}</title>
<style>
  @page { margin: 14mm; size: landscape; }
  body { font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; padding: 24px; }
  h1 { font-size: 26px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { font-size: 14px; color: #555; margin: 0 0 14px; }
  .hero { display: flex; border: 2px solid #111; border-radius: 10px; overflow: hidden; margin-bottom: 26px; }
  .hcell { flex: 1 1 0; padding: 14px 12px 16px; border-left: 1px solid #ccc; text-align: center; }
  .hcell:first-child { border-left: 0; }
  .hsec { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: #444; font-weight: 700; margin-bottom: 6px; }
  .hfloat .hsec { color: #888; }
  .hname { font-size: 30px; font-weight: 800; letter-spacing: -0.01em; }
  .hname.hempty { font-size: 16px; font-weight: 500; color: #999; padding-top: 8px; }
  h2 { font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: #666; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #ccc; vertical-align: middle; }
  thead th { border-bottom: 2px solid #111; vertical-align: bottom; }
  tbody th { width: 13%; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #444; font-weight: 700; }
  th.wk .rel { display: block; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #888; font-weight: 700; }
  th.wk .dates { display: block; font-size: 11.5px; color: #333; font-weight: 700; margin-top: 2px; }
  td { font-size: 15px; font-weight: 700; }
  td.empty { color: #999; font-weight: 500; font-size: 12px; }
  tr.floater th { color: #777; }
  .foot { margin-top: 16px; font-size: 11px; color: #888; }
</style></head><body>
<h1>Section rotation</h1>
<p class="sub">Week of <b>${esc(clearSpan(week))}, ${localDate(week).getFullYear()}</b>${week === thisWeek ? " — this week" : ""}</p>
<div class="hero">${hero}</div>
<h2>Recent weeks</h2>
<table>
  <thead><tr><th></th>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
<p class="foot">Printed ${esc(new Date().toLocaleString())} · ReadyRoute</p>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`;
  const w = window.open("", "_blank", "width=1040,height=760");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

export default function Rotation() {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const thisWeek = mondayOf(new Date());
  const { data: board, isLoading } = useRotationWeek(week);
  const { data: people = [] } = useRotationPeople();
  const { data: history = [] } = useRotationHistory(8);
  const { data: staleData } = useRotationStale();
  // Same lesson as the Audit strip: a 401/HTML response must never poison the
  // page — only ever map over a real array.
  const staleWeeks = Array.isArray(staleData) ? staleData : [];
  const assign = useAssignRotation();
  const advance = useAdvanceRotation();
  const addPerson = useAddRotationPerson();
  const updatePerson = useUpdateRotationPerson();
  const rename = useRenameRotationSection();
  const { user } = useAuth();
  // Mirrors the server's require_admin (admin / fleet / supervisor). Section
  // names are floor vocabulary — the migration seeded "Section 1–4", and the
  // people who run the floor put the real names on them here.
  const canRename = user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor";
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // The draft is mirrored into a ref so the blur that commits it can never
  // read a stale closure — Escape resets the ref THEN blurs, which makes the
  // commit a no-op instead of a race.
  const renameDraftRef = useRef("");
  function setDraft(v: string) {
    renameDraftRef.current = v;
    setRenameDraft(v);
  }
  function commitRename(id: number, current: string) {
    const name = renameDraftRef.current.trim();
    setRenamingId(null);
    if (!name || name === current) return;
    setErr(null);
    rename.mutate(
      { id, name },
      {
        onError: (e: unknown) => {
          const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setErr(detail ?? "Could not rename that section.");
        },
      },
    );
  }

  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState<"this" | "next">("this");
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null);
  function submitPerson() {
    if (!newName.trim()) return;
    addPerson.mutate({
      name: newName.trim(),
      // "Added Friday, starts Monday": an explicit next-week start keeps a
      // rebuild of the current week from pulling the newcomer in early.
      ...(newStart === "next" ? { active_since: addWeeks(thisWeek, 1) } : {}),
    });
    setNewName("");
    setNewStart("this");
  }
  const [err, setErr] = useState<string | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);

  const slots = board?.sections ?? [];
  const filled = useMemo(() => slots.filter((s) => s.person_id != null).length, [slots]);
  const isEmptyWeek = filled === 0;

  /** Build (empty week) or REBUILD (force) the fair rotation: everyone works
   *  every section once before repeating one. The server reads the recent
   *  weeks as they are now, so fixing a past week and rebuilding the next one
   *  flows the fix forward. */
  function doAdvance(force: boolean) {
    setErr(null);
    setRebuildOpen(false);
    advance.mutate(
      { week, force },
      {
        onError: (e: unknown) => {
          const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setErr(detail ?? "Could not build that week.");
        },
      },
    );
  }

  async function doPrint() {
    setErr(null);
    try {
      if (!(await printRotation(week, thisWeek))) {
        setErr("The browser blocked the print window — allow pop-ups for this site and try again.");
      }
    } catch {
      setErr("Could not load the surrounding weeks for the print sheet.");
    }
  }

  return (
    <>
      <PageHeader
        title="Rotation"
        meta={
          <>
            <span>Week of {prettyWeek(week)}</span>
            <Sep />
            <Stat value={`${filled}/${slots.length}`} label="filled" />
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={doPrint}
              disabled={isLoading || slots.length === 0}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print week
            </button>
            {isEmptyWeek ? (
              <button
                type="button"
                disabled={advance.isPending || people.length === 0}
                onClick={() => doAdvance(false)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
              >
                <RefreshCw className={clsx("h-3.5 w-3.5", advance.isPending && "animate-spin")} aria-hidden />
                {advance.isPending ? "Building…" : "Build week"}
              </button>
            ) : (
              <button
                type="button"
                disabled={advance.isPending || people.length === 0}
                onClick={() => setRebuildOpen(true)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              >
                <RefreshCw className={clsx("h-3.5 w-3.5", advance.isPending && "animate-spin")} aria-hidden />
                {advance.isPending ? "Rebuilding…" : "Rebuild week"}
              </button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* ---------------- week picker ---------------- */}
        <div className="card flex flex-wrap items-center gap-2 py-3">
          <button
            type="button"
            aria-label="Previous week"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            onClick={() => setWeek(addWeeks(week, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
              {week === thisWeek ? "This week" : week < thisWeek ? "Past week" : "Upcoming week"}
            </p>
            <p className="truncate text-base font-black tracking-tight text-ink">{weekSpan(week)}</p>
          </div>
          <button
            type="button"
            aria-label="Next week"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            onClick={() => setWeek(addWeeks(week, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {week !== thisWeek && (
            <button type="button" className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => setWeek(thisWeek)}>
              Back to this week
            </button>
          )}
        </div>

        {err && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">{err}</div>
        )}

        {/* Roster drift: built weeks that no longer match who's on the
            rotation. Rebuilding stays the lead's call (it discards hand
            edits), so this prompts instead of acting. */}
        {staleWeeks.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400">
              Roster changed after these weeks were built
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {staleWeeks.map((sw) => (
                <button
                  key={sw.week_start}
                  type="button"
                  className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-left text-[13px] text-amber-100 hover:underline"
                  title="Open this week and rebuild it"
                  onClick={() => {
                    setWeek(sw.week_start);
                    setRebuildOpen(true);
                  }}
                >
                  <span className="font-mono font-bold tabular-nums">{prettyWeek(sw.week_start)}</span>
                  <span className="text-[12px] text-amber-200/80">{sw.reasons.join(" · ")} — tap to rebuild</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------------- the board ---------------- */}
        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink">Sections</span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">{filled}/{slots.length}</span>
            <span className="hidden h-px flex-1 bg-hairline sm:block" />
            {!isEmptyWeek && (
              <span className="text-[11px] text-ink-faint">Change anyone below — a rebuild replaces the whole week.</span>
            )}
          </div>
          {isLoading ? (
            <p className="text-[12px] text-ink-faint">Loading…</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {slots.map((slot, i) => {
                const tone = toneFor(slot, i);
                const empty = slot.person_id == null;
                return (
                  <div
                    key={slot.section_id}
                    className={clsx(
                      "relative flex min-h-[132px] flex-col overflow-hidden rounded-xl border pb-3 pl-4 pr-3 pt-3",
                      empty ? "border-dashed border-hairline bg-surface-3/60" : clsx("bg-surface", tone.border),
                    )}
                  >
                    <span className={clsx("absolute inset-y-0 left-0 w-1", tone.stripe, empty && "opacity-40")} aria-hidden />
                    <div className="flex items-center justify-between gap-2">
                      {renamingId === slot.section_id ? (
                        <input
                          autoFocus
                          maxLength={80}
                          value={renameDraft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitRename(slot.section_id, slot.section_name)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              setDraft(slot.section_name);
                              e.currentTarget.blur();
                            }
                          }}
                          className="min-w-0 flex-1 rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em]"
                        />
                      ) : (
                        <span className={clsx("min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.1em]", tone.label)}>
                          {slot.section_name}
                        </span>
                      )}
                      <span className="flex shrink-0 items-center gap-2">
                        {slot.is_floater && (
                          <span className="rounded-pill border border-hairline px-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                            floater
                          </span>
                        )}
                        {canRename && renamingId !== slot.section_id && (
                          <button
                            type="button"
                            className="text-[10px] text-ink-faint transition-colors hover:text-ink"
                            onClick={() => {
                              setDraft(slot.section_name);
                              setRenamingId(slot.section_id);
                            }}
                          >
                            rename
                          </button>
                        )}
                      </span>
                    </div>
                    <p className={clsx("mt-2 flex-1 truncate text-[22px] font-black leading-tight tracking-tight", empty ? "text-ink-faint" : slot.person_active === false ? "text-amber-300 line-through decoration-2" : "text-ink")}>
                      {slot.person_name ?? (slot.is_floater ? "Skipped" : "Unassigned")}
                    </p>
                    {slot.person_active === false && (
                      <p className="text-[10px] font-semibold text-amber-400">Left the rotation — pick someone or rebuild the week</p>
                    )}
                    {slot.pinned && slot.person_active !== false && (
                      <p className="text-[10px] font-semibold text-sky-300">Pinned — holds this section every week</p>
                    )}
                    <label className="sr-only" htmlFor={`slot-${slot.section_id}`}>
                      Who works {slot.section_name} this week
                    </label>
                    <select
                      id={`slot-${slot.section_id}`}
                      className="input mt-2 py-1 text-xs"
                      value={slot.person_id ?? ""}
                      disabled={assign.isPending}
                      onChange={(e) =>
                        assign.mutate({
                          section_id: slot.section_id,
                          person_id: e.target.value === "" ? null : Number(e.target.value),
                          week_start: week,
                        })
                      }
                    >
                      <option value="">{slot.is_floater ? "— skipped —" : "— unassigned —"}</option>
                      {slot.person_active === false && slot.person_id != null && (
                        <option value={slot.person_id} disabled>
                          {slot.person_name} (left)
                        </option>
                      )}
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------------- people ---------------- */}
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink">People in the rotation</span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">{people.length}</span>
            <span className="hidden h-px flex-1 bg-hairline sm:block" />
            <span className="text-[11px] text-ink-faint">Everyone works each section once before repeating one</span>
          </div>
          <div className="mb-3 flex gap-2">
            <input
              className="input flex-1 py-1.5 text-sm"
              placeholder="Add a name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPerson();
              }}
            />
            <select
              className="input w-32 py-1.5 text-xs"
              title="Which week they start counting for the rotation"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value as "this" | "next")}
            >
              <option value="this">This week</option>
              <option value="next">Next Monday</option>
            </select>
            <button
              type="button"
              className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
              disabled={!newName.trim() || addPerson.isPending}
              onClick={submitPerson}
            >
              Add
            </button>
          </div>
          {people.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Nobody yet — add names above, then use Build week.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-2/60 py-1.5 pl-3 pr-1.5">
                  <span
                    className="text-[13px] font-semibold text-ink"
                    title={p.active_since ? `On the rotation since ${prettyWeek(p.active_since)}` : undefined}
                  >
                    {p.name}
                  </span>
                  <select
                    className="max-w-[7rem] rounded-md border border-hairline bg-surface py-0.5 pl-1.5 pr-5 text-[10px] text-ink-soft"
                    title="Pin to one section — they hold it every week while everyone else rotates around them"
                    aria-label={`Where ${p.name} works`}
                    value={p.pinned_section_id ?? ""}
                    disabled={updatePerson.isPending}
                    onChange={(e) => {
                      setErr(null);
                      updatePerson.mutate(
                        { id: p.id, pinned_section_id: e.target.value === "" ? null : Number(e.target.value) },
                        {
                          onError: (er: unknown) => {
                            const detail = (er as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                            setErr(detail ?? "Could not pin that section.");
                          },
                        },
                      );
                    }}
                  >
                    <option value="">Rotates</option>
                    {slots.map((sec) => (
                      <option key={sec.section_id} value={sec.section_id}>
                        Pin: {sec.section_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title="Remove from the rotation (history keeps the name)"
                    aria-label={`Remove ${p.name} from the rotation`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-track hover:text-ink"
                    onClick={() => setRemoving({ id: p.id, name: p.name })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------------- history ---------------- */}
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink">Last 8 weeks</span>
            <span className="hidden h-px flex-1 bg-hairline sm:block" />
            <span className="text-[11px] text-ink-faint">Edit a past week, then Rebuild the one after it.</span>
          </div>
          {history.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No weeks recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                    <th className="py-1.5 pr-3 font-bold">Week</th>
                    {slots.map((s, i) => (
                      <th key={s.section_id} className={clsx("py-1.5 pr-3 font-bold", toneFor(s, i).label)}>
                        {s.section_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((wk) => {
                    const current = wk.week_start === week;
                    return (
                      <tr
                        key={wk.week_start}
                        className={clsx("cursor-pointer border-t border-hairline transition-colors hover:bg-surface-2/60", current && "bg-surface-2/80")}
                        onClick={() => setWeek(wk.week_start)}
                        title="Open this week"
                      >
                        <td className={clsx("py-2 pr-3 font-mono tabular-nums", current ? "text-ink" : "text-ink-muted")}>
                          {prettyWeek(wk.week_start)}
                        </td>
                        {wk.sections.map((s) => (
                          <td key={s.section_id} className={clsx("py-2 pr-3 font-semibold", s.person_name ? "text-ink-soft" : "text-ink-faint")}>
                            {s.person_name ?? "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={removing != null}
        title={`Remove ${removing?.name ?? ""} from the rotation?`}
        description="History keeps their name on past weeks. Any current or upcoming week still naming them will show a rebuild prompt until it's rebuilt or edited."
        confirmLabel="Remove"
        variant="danger"
        busy={updatePerson.isPending}
        onConfirm={() => {
          if (removing) updatePerson.mutate({ id: removing.id, is_active: false }, { onSettled: () => setRemoving(null) });
        }}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={rebuildOpen}
        title={`Rebuild the week of ${prettyWeek(week)}?`}
        description="Every section this week is re-picked so everyone works each section once before repeating one, going by the recent weeks exactly as they stand now. Anything set by hand this week is lost — edit an earlier week first if that is what needs fixing."
        confirmLabel="Rebuild"
        variant="danger"
        busy={advance.isPending}
        onConfirm={() => doAdvance(true)}
        onCancel={() => setRebuildOpen(false)}
      />
    </>
  );
}
