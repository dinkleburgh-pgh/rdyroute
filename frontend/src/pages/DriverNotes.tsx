/**
 * DriverNotes — per-route notes page for drivers, accessed via QR code.
 * Route: /driver/:token  (public, no login required)
 *
 * Drivers can:
 *   - See all active notes on their route (staff + their own)
 *   - Add new notes (Always / Workday / Set Until...)
 *   - Delete notes they added (created_by = "driver")
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import clsx from "clsx";
import {
  useDriverNotes,
  useDriverTruckInfo,
  useDriverCreateNote,
  useDriverDeleteNote,
} from "../api/hooks";
import type { NoteType, TruckNote } from "../types";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

const TYPE_LABEL: Record<NoteType, string> = {
  constant: "Always",
  workday:  "Workday",
  one_off:  "Set Until...",
};

const TYPE_COLOR: Record<NoteType, string> = {
  constant: "bg-blue-900/60 text-blue-300 ring-1 ring-blue-700/40",
  workday:  "bg-violet-900/60 text-violet-300 ring-1 ring-violet-700/40",
  one_off:  "bg-amber-900/60 text-amber-300 ring-1 ring-amber-700/40",
};

// ---------------------------------------------------------------------------
// Add-note form
// ---------------------------------------------------------------------------

function AddNoteForm({ token, onClose }: { token: string; onClose: () => void }) {
  const create = useDriverCreateNote(token);
  const [type, setType] = useState<NoteType>("constant");
  const [body, setBody] = useState("");
  const [days, setDays] = useState<Set<number>>(new Set());
  const [exp, setExp] = useState("");
  const [err, setErr] = useState("");

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!body.trim()) { setErr("Please enter a note."); return; }
    if (type === "workday" && days.size === 0) { setErr("Select at least one workday."); return; }
    if (type === "one_off" && !exp) { setErr("Select an expiry date."); return; }
    try {
      const dayList = type === "workday" ? [...days].sort() : [null];
      await Promise.all(
        dayList.map((d) =>
          create.mutateAsync({
            note_type: type,
            body: body.trim(),
            workday_num: d,
            expires_on: type === "one_off" ? exp : null,
          }),
        ),
      );
      onClose();
    } catch {
      setErr("Failed to save. Please try again.");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4"
    >
      {/* Type selector */}
      <div className="flex gap-2">
        {(["constant", "workday", "one_off"] as NoteType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={clsx(
              "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
              type === t
                ? TYPE_COLOR[t]
                : "bg-slate-700 text-slate-400 hover:bg-slate-600",
            )}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Body */}
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Note text…"
        className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-blue-500"
      />

      {/* Workday picker */}
      {type === "workday" && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-400">Applies on</label>
          <div className="flex gap-2">
            {([1, 2, 3, 4, 5] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={clsx(
                  "flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors",
                  days.has(d)
                    ? "bg-violet-700 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                )}
              >
                Day {d}
              </button>
            ))}
          </div>
          {days.size > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {[...days].sort().map((d) => DAY_NAMES[d]).join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Expiry date */}
      {type === "one_off" && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-400">Show until (inclusive)</label>
          <input
            type="date"
            value={exp}
            onChange={(e) => setExp(e.target.value)}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-amber-500"
          />
        </div>
      )}

      {err && <p className="text-xs text-red-400">{err}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="flex-1 rounded-lg bg-blue-700 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {create.isPending ? "Saving…" : "Add Note"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Single note card
// ---------------------------------------------------------------------------

function NoteCard({ note, token }: { note: TruckNote; token: string }) {
  const del = useDriverDeleteNote(token);
  const isDriverNote = note.created_by === "driver";

  return (
    <div
      className={clsx(
        "rounded-xl border p-4",
        isDriverNote
          ? "border-emerald-800/60 bg-emerald-950/30"
          : "border-slate-700 bg-slate-900",
      )}
    >
      {/* Badges row */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={clsx(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            TYPE_COLOR[note.note_type] ?? "bg-slate-800 text-slate-300",
          )}
        >
          {TYPE_LABEL[note.note_type] ?? note.note_type}
          {note.note_type === "workday" && note.workday_num != null
            ? ` · ${DAY_NAMES[note.workday_num] ?? ""}`
            : ""}
          {note.note_type === "one_off" && note.expires_on
            ? ` · until ${note.expires_on}`
            : ""}
        </span>
        {isDriverNote && (
          <span className="rounded-full bg-emerald-900/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
            You added this
          </span>
        )}
      </div>

      {/* Body */}
      <p className="text-base leading-relaxed text-slate-100">{note.body}</p>

      {/* Delete — driver-created notes only */}
      {isDriverNote && (
        <div className="mt-3 flex justify-end">
          <button
            className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-red-400 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
            disabled={del.isPending}
            onClick={() => {
              if (!confirm("Remove this note?")) return;
              del.mutate(note.id);
            }}
          >
            {del.isPending ? "Removing…" : "Remove"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DriverNotes() {
  const { token } = useParams<{ token: string }>();
  const { data: notes, isLoading, isError } = useDriverNotes(token);
  const { data: truckInfo } = useDriverTruckInfo(token);
  const [adding, setAdding] = useState(false);

  const today = format(new Date(), "EEEE, MMMM d");

  const truckNumber = truckInfo?.truck_number ?? notes?.[0]?.truck_number ?? null;

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-950 text-slate-400">
        Loading…
      </div>
    );
  }

  if (isError || !token) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center">
        <p className="text-lg font-semibold text-red-400">Invalid QR Code</p>
        <p className="text-sm text-slate-400">
          This link is not recognised. Ask your supervisor for a new QR code.
        </p>
      </div>
    );
  }

  const staffNotes  = (notes ?? []).filter((n) => n.created_by !== "driver");
  const driverNotes = (notes ?? []).filter((n) => n.created_by === "driver");

  return (
    <div className="min-h-svh bg-slate-950 px-4 py-6 text-slate-100">
      {/* Header */}
      <div className="mb-6 text-center">
        <p className="text-xs uppercase tracking-widest text-slate-500">ReadyRoute</p>
        <h1 className="mt-1 text-3xl font-bold">
          Route #{truckNumber ?? "…"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{today}</p>
      </div>

      <div className="mx-auto max-w-lg space-y-6">
        {/* Add-note button / form */}
        {adding ? (
          <AddNoteForm token={token} onClose={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-xl border border-dashed border-slate-600 py-3 text-sm font-semibold text-slate-400 hover:border-blue-500 hover:text-blue-400"
          >
            + Add a note to your route
          </button>
        )}

        {/* Driver's own notes */}
        {driverNotes.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-500">
              Your notes
            </h2>
            {driverNotes.map((n) => (
              <NoteCard key={n.id} note={n} token={token} />
            ))}
          </section>
        )}

        {/* Staff notes */}
        {staffNotes.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              From your team
            </h2>
            {staffNotes.map((n) => (
              <NoteCard key={n.id} note={n} token={token} />
            ))}
          </section>
        )}

        {/* Empty state */}
        {!adding && driverNotes.length === 0 && staffNotes.length === 0 && (
          <div className="mt-8 text-center text-slate-500">
            <p className="text-lg">No notes yet.</p>
            <p className="mt-1 text-sm">Tap the button above to add one.</p>
          </div>
        )}
      </div>

      <p className="mt-10 text-center text-xs text-slate-700">
        Route-specific · scan QR code to reopen
      </p>
    </div>
  );
}
