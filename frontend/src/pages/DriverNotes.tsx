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
  useDriverMarkArrived,
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
    } catch (e) {
      // Reachable again now that driver writes are excluded from the offline
      // queue. Before, this call resolved as a fake 202 and onClose() ran, so
      // the form closed as if the note had saved and it was replayed by
      // nothing. The typed body is left in the box on purpose.
      const status = (e as { response?: { status?: number } })?.response?.status;
      setErr(
        status == null
          ? "Not sent — no signal. Your note is still here; try again when you have a bar."
          : "Couldn't save that. Try again.",
      );
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


/**
 * What a driver sees when they scan. One thing to do, one thing to read.
 *
 * "I'm Back" is the reason to scan at all: it tells the dock the truck has
 * landed. It is deliberately the whole screen — a driver uses this for five
 * seconds, in a yard, once a day, with no training and possibly gloves on.
 */
/**
 * The "I'm Back" action, sitting inline above the notes.
 *
 * Deliberately NOT a gate in front of the notes. A driver scans once, in a
 * yard, with one hand: making them tap through to read a note that says "use
 * the north gate" is a step that can only cost them.
 */
function ArrivalBlock({ token }: { token: string }) {
  const arrive = useDriverMarkArrived(token);
  const [done, setDone] = useState<{ at: number | null; already: boolean } | null>(null);
  const [err, setErr] = useState("");

  async function markBack() {
    setErr("");
    try {
      const r = await arrive.mutateAsync();
      setDone({ at: r.arrived_at, already: r.already });
    } catch (e) {
      const s = (e as { response?: { status?: number } })?.response?.status;
      setErr(
        s == null
          ? "Not sent — no signal. Move somewhere with a bar and tap again."
          : "Couldn't send that. Try again.",
      );
    }
  }

  const at = done?.at != null ? format(new Date(done.at * 1000), "h:mm a") : null;

  return (
    <div className="space-y-3">
        {done ? (
          <div className="rounded-2xl border border-emerald-700/50 bg-emerald-950/40 px-5 py-6 text-center">
            <p className="text-2xl font-bold text-emerald-300">
              {done.already ? "Already marked back" : "Thanks — you're marked back"}
            </p>
            {at && <p className="mt-1 text-sm text-emerald-200/80">at {at}</p>}
            <p className="mt-2 text-xs text-emerald-200/60">The dock has been told.</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void markBack()}
            disabled={arrive.isPending}
            className="w-full rounded-2xl bg-emerald-600 px-6 py-8 text-3xl font-black text-white shadow-lg active:scale-95 disabled:opacity-60"
          >
            {arrive.isPending ? "Sending…" : "I'm Back"}
          </button>
        )}

        {err && (
          <p className="rounded-xl border border-amber-600/50 bg-amber-950/30 px-4 py-3 text-center text-sm font-semibold text-amber-200">
            {err}
          </p>
        )}

    </div>
  );
}

export default function DriverNotes() {
  const { token } = useParams<{ token: string }>();
  const { data: notes, isLoading, isError, error, fetchStatus, refetch } = useDriverNotes(token);
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

  // Only a real 404 means the code is bad. Everything else — a redeploy, a
  // timeout, a captive portal, one bar at the back of the yard — is a
  // connection problem, and telling a driver their sticker is invalid sends
  // them to regenerate a token that was fine, which voids the code printed in
  // their cab and manufactures the exact failure the message described.
  const httpStatus = (error as { response?: { status?: number } } | null)?.response?.status;
  const badToken = !token || httpStatus === 404;
  // A paused query (browser reports offline) resolves with no data, no error
  // and not loading — without this the page renders "No notes yet" as fact.
  const unreachable = !badToken && (isError || (fetchStatus === "paused" && notes === undefined));

  if (badToken) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center">
        <p className="text-lg font-semibold text-red-400">QR code not recognised</p>
        <p className="text-sm text-slate-400">
          This code isn&apos;t active any more. Ask the office for a new one for this truck.
        </p>
      </div>
    );
  }

  if (unreachable) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center">
        <p className="text-lg font-semibold text-amber-300">Can&apos;t reach ReadyRoute</p>
        <p className="max-w-xs text-sm text-slate-400">
          Your code is fine — the phone can&apos;t get a connection right now. Move somewhere
          with signal and try again.
        </p>
        <button
          type="button"
          className="mt-2 rounded-xl bg-blue-600 px-8 py-4 text-lg font-bold text-white active:scale-95"
          onClick={() => void refetch()}
        >
          Try again
        </button>
        {truckInfo?.truck_number != null && (
          <p className="text-xs text-slate-600">Truck #{truckInfo.truck_number}</p>
        )}
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
        {/* Big: scanning the wrong truck is the easiest mistake a driver can
            make here, and this number is the only thing that would catch it. */}
        <h1 className="mt-1 text-5xl font-black tabular-nums">#{truckNumber ?? "…"}</h1>
        <p className="mt-1 text-sm text-slate-400">{today}</p>
      </div>

      <div className="mx-auto max-w-lg space-y-6">
        <ArrivalBlock token={token} />

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
