import { useMemo, useRef, useState } from "react";
import {
  useAddRotationPerson,
  useAdvanceRotation,
  useAssignRotation,
  useRenameRotationSection,
  useRotationHistory,
  useRotationPeople,
  useRotationWeek,
  useUpdateRotationPerson,
} from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";

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

function prettyWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Rotation() {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const { data: board, isLoading } = useRotationWeek(week);
  const { data: people = [] } = useRotationPeople();
  const { data: history = [] } = useRotationHistory(8);
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
  const [err, setErr] = useState<string | null>(null);

  const filled = useMemo(
    () => (board?.sections ?? []).filter((s) => s.person_id != null).length,
    [board],
  );
  const isEmptyWeek = filled === 0;

  function doAdvance() {
    setErr(null);
    advance.mutate(week, {
      onError: (e: unknown) => {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setErr(detail ?? "Could not build that week.");
      },
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ---------------- week picker ---------------- */}
      <div className="card flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => setWeek(addWeeks(week, -1))}>
          ‹ Prev
        </button>
        <div className="font-mono text-sm font-bold">Week of {prettyWeek(week)}</div>
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => setWeek(addWeeks(week, 1))}>
          Next ›
        </button>
        <button
          type="button"
          className="btn-ghost px-3 py-1 text-[11px]"
          onClick={() => setWeek(mondayOf(new Date()))}
        >
          This week
        </button>
        <div className="ml-auto flex items-center gap-2">
          {isEmptyWeek && (
            <button
              type="button"
              className="btn-ghost px-3 py-1"
              disabled={advance.isPending || people.length === 0}
              onClick={doAdvance}
            >
              {advance.isPending ? "Building…" : "Build from last week"}
            </button>
          )}
          <span className="text-[11px] text-ink-faint">
            {filled} of {board?.sections.length ?? 0} filled
          </span>
        </div>
      </div>

      {err && <div className="card text-[12px] text-st-oos">{err}</div>}

      {/* ---------------- the board ---------------- */}
      <div className="card">
        <h2 className="mb-3 text-sm font-bold">Sections</h2>
        {isLoading ? (
          <p className="text-[12px] text-ink-faint">Loading…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(board?.sections ?? []).map((slot) => (
              <div
                key={slot.section_id}
                className={
                  "rounded-lg border p-3 " +
                  (slot.person_id == null
                    ? "border-dashed border-white/15"
                    : "border-white/10 bg-white/[0.03]")
                }
              >
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
                      className="min-w-0 flex-1 rounded border border-white/20 bg-transparent px-1.5 py-0.5 text-[12px] font-bold"
                    />
                  ) : (
                    <span className="min-w-0 truncate text-[12px] font-bold">{slot.section_name}</span>
                  )}
                  <span className="flex shrink-0 items-center gap-2">
                    {slot.is_floater && <span className="text-[10px] text-ink-faint">floater</span>}
                    {canRename && renamingId !== slot.section_id && (
                      <button
                        type="button"
                        className="text-[10px] text-ink-faint hover:text-ink"
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
                <select
                  className="mt-2 w-full bg-transparent text-sm"
                  value={slot.person_id ?? ""}
                  onChange={(e) =>
                    assign.mutate({
                      section_id: slot.section_id,
                      person_id: e.target.value === "" ? null : Number(e.target.value),
                      week_start: week,
                    })
                  }
                >
                  <option value="">
                    {slot.is_floater ? "— skipped —" : "— unassigned —"}
                  </option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- people ---------------- */}
      <div className="card">
        <h2 className="mb-3 text-sm font-bold">People in the rotation</h2>
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 bg-transparent text-sm"
            placeholder="Add a name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                addPerson.mutate(newName.trim());
                setNewName("");
              }
            }}
          />
          <button
            type="button"
            className="btn-ghost px-3 py-1"
            disabled={!newName.trim() || addPerson.isPending}
            onClick={() => {
              addPerson.mutate(newName.trim());
              setNewName("");
            }}
          >
            Add
          </button>
        </div>
        {people.length === 0 ? (
          <p className="text-[12px] text-ink-faint">
            Nobody yet — add names above, then use Build from last week.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-white/10 px-2 py-1">
                <span className="text-[12px]">{p.name}</span>
                <button
                  type="button"
                  title="Remove from the rotation (history keeps the name)"
                  className="text-[11px] text-ink-faint hover:text-ink-soft"
                  onClick={() => updatePerson.mutate({ id: p.id, is_active: false })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- history ---------------- */}
      <div className="card">
        <h2 className="mb-3 text-sm font-bold">Last 8 weeks</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-ink-faint">
              <tr>
                <th className="py-1 pr-3 font-normal">Week</th>
                {(board?.sections ?? []).map((s) => (
                  <th key={s.section_id} className="py-1 pr-3 font-normal">
                    {s.section_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((wk) => (
                <tr key={wk.week_start} className="border-t border-white/5">
                  <td className="py-1 pr-3 font-mono">{prettyWeek(wk.week_start)}</td>
                  {wk.sections.map((s) => (
                    <td key={s.section_id} className="py-1 pr-3">
                      {s.person_name ?? <span className="text-ink-faint">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
