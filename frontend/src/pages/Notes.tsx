/**
 * Notes Board — manage per-truck notes.
 *
 * Note types:
 *   constant  — always shown, every day.
 *   workday   — shown only when workday_num matches the current load or unload day.
 *   one_off   — shown until expires_on, then auto-archived.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { QRCodeSVG } from "qrcode.react";
import { useBoard } from "../api/hooks";
import { ChevronRightIcon } from "../components/icons";
import {
  useCreateNote,
  useDeleteNote,
  useRegenerateQR,
  useTruckNotes,
  useUpdateNote,
} from "../api/hooks";
import { todayIso, publicBase } from "../api/client";
import type { NoteType, TruckNote, TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import PageHeader from "../components/PageHeader";

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

const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  constant: "Always",
  workday:  "Workday",
  one_off:  "Set Until...",
};

const NOTE_TYPE_COLOR: Record<NoteType, string> = {
  constant: "bg-blue-900/60 text-blue-300 ring-1 ring-blue-700/40",
  workday:  "bg-violet-900/60 text-violet-300 ring-1 ring-violet-700/40",
  one_off:  "bg-amber-900/60 text-amber-300 ring-1 ring-amber-700/40",
};

const NOTE_TYPE_BORDER: Record<NoteType, string> = {
  constant: "border-blue-700/40",
  workday:  "border-violet-700/40",
  one_off:  "border-amber-700/40",
};

function isExpired(note: TruckNote): boolean {
  if (note.note_type !== "one_off" || !note.expires_on) return false;
  return note.expires_on < todayIso();
}

// ---------------------------------------------------------------------------
// Personal Notes pad (per-user, stored in AppSettings)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Note form (create + edit)
// ---------------------------------------------------------------------------

function NoteForm({
  truckNumber,
  initial,
  onClose,
}: {
  truckNumber: number;
  initial?: TruckNote;
  onClose: () => void;
}) {
  const create = useCreateNote();
  const update = useUpdateNote();

  const [type, setType]    = useState<NoteType>(initial?.note_type ?? "constant");
  const [body, setBody]    = useState(initial?.body ?? "");
  const [days, setDays]    = useState<Set<number>>(
    initial?.workday_num != null ? new Set([initial.workday_num]) : new Set(),
  );
  const [exp, setExp]      = useState(initial?.expires_on ?? "");
  const [err, setErr]      = useState("");

  const busy = create.isPending || update.isPending;

  function toggleDay(d: number) {
    if (initial) {
      // Editing an existing note: single-select only
      setDays(new Set([d]));
    } else {
      setDays((prev) => {
        const next = new Set(prev);
        if (next.has(d)) next.delete(d); else next.add(d);
        return next;
      });
    }
  }

  async function submit() {
    setErr("");
    if (!body.trim()) { setErr("Note text is required."); return; }
    if (type === "workday" && days.size === 0) { setErr("Select at least one workday."); return; }
    if (type === "one_off" && !exp) { setErr("Expiry date is required."); return; }

    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          note_type: type,
          body: body.trim(),
          workday_num: type === "workday" ? [...days][0] ?? null : null,
          expires_on:  type === "one_off" ? exp : null,
        });
      } else {
        const dayList = type === "workday" ? [...days].sort() : [null];
        await Promise.all(dayList.map((d) =>
          create.mutateAsync({
            truck_number: truckNumber,
            note_type: type,
            body: body.trim(),
            workday_num: d,
            expires_on:  type === "one_off" ? exp : null,
          }),
        ));
      }
      onClose();
    } catch {
      setErr("Failed to save note.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div className="flex gap-2">
        {(["constant", "workday", "one_off"] as NoteType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={clsx(
              "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              type === t
                ? NOTE_TYPE_COLOR[t]
                : "bg-slate-800 text-slate-400 hover:bg-slate-700",
            )}
          >
            {NOTE_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Body */}
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Note text…"
        className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-blue-500"
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
            className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-amber-500"
          />
        </div>
      )}

      {err && <p className="text-xs text-red-400">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="btn-primary flex-1"
        >
          {initial ? "Save" : "Add Note"}
        </button>
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single note card
// ---------------------------------------------------------------------------

function NoteCard({
  note,
  onEdit,
}: {
  note: TruckNote;
  onEdit: (n: TruckNote) => void;
}) {
  const deleteNote = useDeleteNote();
  const update     = useUpdateNote();
  const expired    = isExpired(note);

  return (
    <div
      className={clsx(
        "rounded-lg border p-3 text-sm transition-opacity",
        NOTE_TYPE_BORDER[note.note_type],
        (!note.is_active || expired) && "opacity-50",
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", NOTE_TYPE_COLOR[note.note_type])}>
            {NOTE_TYPE_LABEL[note.note_type]}
          </span>
          {note.note_type === "workday" && note.workday_num && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
              Day {note.workday_num} · {DAY_NAMES[note.workday_num]}
            </span>
          )}
          {note.note_type === "one_off" && note.expires_on && (
            <span className={clsx(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              expired ? "bg-red-900/60 text-red-400" : "bg-slate-800 text-slate-300",
            )}>
              {expired ? "Expired" : `Until ${note.expires_on}`}
            </span>
          )}
          {!note.is_active && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              Archived
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            title={note.is_active ? "Archive" : "Restore"}
            onClick={() => update.mutate({ id: note.id, is_active: !note.is_active })}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          >
            {note.is_active ? "⊘" : "↩"}
          </button>
          <button
            type="button"
            title="Edit"
            onClick={() => onEdit(note)}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-blue-300"
          >
            ✎
          </button>
          <button
            type="button"
            title="Delete"
            onClick={() => {
              if (confirm("Delete this note permanently?")) deleteNote.mutate(note.id);
            }}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>
      <p className="whitespace-pre-wrap leading-snug text-slate-200">{note.body}</p>
      <p className="mt-1.5 text-[10px] text-slate-600">by {note.created_by}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QR code modal (admin: view, copy, and regenerate)
// ---------------------------------------------------------------------------

function TruckQRModal({
  truckNumber,
  qrToken,
  onClose,
}: {
  truckNumber: number;
  qrToken: string | null | undefined;
  onClose: () => void;
}) {
  const regen = useRegenerateQR();
  const [copied, setCopied] = useState(false);

  const base = publicBase();
  const url = qrToken ? `${base}/driver/${qrToken}` : null;

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Route #{truckNumber} — Driver QR</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>

        {url ? (
          <>
            <div className="flex justify-center rounded-lg bg-white p-3">
              <QRCodeSVG value={url} size={160} />
            </div>

            {/* Copyable URL */}
            <div className="mt-3 flex gap-1.5">
              <input
                readOnly
                value={url}
                className="input min-w-0 flex-1 truncate text-xs"
              />
              <button
                className="shrink-0 rounded-md bg-slate-700 px-3 text-xs font-medium text-slate-200 hover:bg-slate-600"
                onClick={copy}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Preview link */}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-center text-xs text-blue-400 underline hover:text-blue-300"
            >
              Preview driver view ↗
            </a>
          </>
        ) : (
          <p className="text-center text-sm text-slate-400">No QR token assigned yet.</p>
        )}

        {/* Regenerate */}
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="mb-2 text-xs text-slate-500">
            Regenerate to invalidate the current QR code (e.g. if it was shared with unauthorized people).
          </p>
          <button
            className="w-full rounded-md bg-red-900/60 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900 disabled:opacity-50"
            disabled={regen.isPending}
            onClick={() => {
              if (!confirm(`Regenerate QR code for route #${truckNumber}? The old code will stop working immediately.`)) return;
              regen.mutate(truckNumber, { onSuccess: onClose });
            }}
          >
            {regen.isPending ? "Regenerating…" : "Regenerate QR Code"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-truck note panel
// ---------------------------------------------------------------------------

function TruckNotePanel({
  truck,
  notes,
  showArchived,
  isOpen,
  onOpen,
  index,
}: {
  truck: TruckWithState;
  notes: TruckNote[];
  showArchived: boolean;
  isOpen: boolean;
  onOpen: () => void;
  index: number;
}) {
  const [adding, setAdding]     = useState(false);
  const [editing, setEditing]   = useState<TruckNote | null>(null);
  const [showQR, setShowQR]     = useState(false);

  const visible = notes.filter(
    (n) => showArchived || (n.is_active && !isExpired(n)),
  );

  return (
    <AnimateCard className="card space-y-3" delay={index * 0.03}>
      {/* Truck header — tap to open/close */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-xl font-black text-slate-100">#{truck.truck_number}</span>
          <span className="text-xs text-slate-500">{truck.truck_type}</span>
          {visible.length > 0 && (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
              {visible.length}
            </span>
          )}
          <ChevronRightIcon
            className={clsx("ml-auto h-4 w-4 shrink-0 text-ink-muted transition-transform", isOpen && "rotate-90")}
          />
        </button>
        {/* QR code button — only for non-spare trucks that have a token */}
        {truck.truck_type !== "Spare" && (
          <button
            type="button"
            title="View driver QR code"
            onClick={() => setShowQR(true)}
            className="shrink-0 rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {showQR && (
        <TruckQRModal
          truckNumber={truck.truck_number}
          qrToken={truck.qr_token}
          onClose={() => setShowQR(false)}
        />
      )}

      {/* Expanded content */}
      {isOpen && (
        <>
          {/* Add button */}
          {!adding && !editing && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-slate-100"
            >
              + Add note
            </button>
          )}

          {/* Add form */}
          {adding && (
            <NoteForm
              truckNumber={truck.truck_number}
              onClose={() => setAdding(false)}
            />
          )}

          {/* Edit form */}
          {editing && (
            <NoteForm
              truckNumber={truck.truck_number}
              initial={editing}
              onClose={() => setEditing(null)}
            />
          )}

          {/* Note cards */}
          {visible.length > 0 ? (
            <div className="space-y-2">
              {visible.map((n, i) => (
                <AnimateCard key={n.id} delay={i * 0.05}>
                  <NoteCard
                    note={n}
                    onEdit={(n) => { setAdding(false); setEditing(n); }}
                  />
                </AnimateCard>
              ))}
            </div>
          ) : (
            !adding && !editing && (
              <p className="text-xs text-slate-600">No notes yet.</p>
            )
          )}
        </>
      )}
    </AnimateCard>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NotesBoard() {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: allNotes = [] } = useTruckNotes({ activeOnly: false });

  const [search,        setSearch]       = useState("");
  const [typeFilter,    setTypeFilter]   = useState<NoteType | "all">("all");
  const [showArchived,  setShowArchived] = useState(false);
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);
  const [openTruck,     setOpenTruck]    = useState<number | null>(null);

  // Trucks sorted by number, spares excluded.
  const trucks = [...board]
    .filter((t) => t.is_active && t.truck_type !== "Spare")
    .sort((a, b) => a.truck_number - b.truck_number);

  // Notes grouped by truck_number.
  const notesByTruck = allNotes.reduce<Record<number, TruckNote[]>>((acc, n) => {
    (acc[n.truck_number] ??= []).push(n);
    return acc;
  }, {});

  // Apply filters.
  const filtered = trucks.filter((t) => {
    if (search && !String(t.truck_number).includes(search)) return false;
    const tNotes = notesByTruck[t.truck_number] ?? [];
    const activeNotes = tNotes.filter((n) => n.is_active && !isExpired(n));
    if (onlyWithNotes && activeNotes.length === 0) return false;
    if (typeFilter !== "all" && !tNotes.some((n) => n.note_type === typeFilter)) return false;
    return true;
  });

  // Summary counts.
  const totalActive   = allNotes.filter((n) => n.is_active && !isExpired(n)).length;
  const totalConstant = allNotes.filter((n) => n.note_type === "constant" && n.is_active).length;
  const totalWorkday  = allNotes.filter((n) => n.note_type === "workday" && n.is_active).length;
  const totalOneOff   = allNotes.filter((n) => n.note_type === "one_off" && n.is_active && !isExpired(n)).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex min-h-0 flex-col"
    >
      <PageHeader
        eyebrow="Workflow"
        title="Truck Notes"
        subtitle="Manage standing notes, workday instructions, and one-off reminders by truck."
        actions={
          <div className="flex flex-wrap justify-center gap-2 text-xs md:justify-end">
            <span className={clsx("rounded-full px-2.5 py-0.5 font-semibold", NOTE_TYPE_COLOR.constant)}>
              {totalConstant} Always
            </span>
            <span className={clsx("rounded-full px-2.5 py-0.5 font-semibold", NOTE_TYPE_COLOR.workday)}>
              {totalWorkday} Workday
            </span>
            <span className={clsx("rounded-full px-2.5 py-0.5 font-semibold", NOTE_TYPE_COLOR.one_off)}>
              {totalOneOff} Set Until...
            </span>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-semibold text-slate-300">
              {totalActive} Active
            </span>
          </div>
        }
      />

      <div className="space-y-5 p-3 md:p-6">

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search truck #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-32 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-blue-500"
        />

        {/* Type filter */}
        <div className="flex overflow-hidden rounded-lg border border-slate-700 text-xs font-semibold">
          {(["all", "constant", "workday", "one_off"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={clsx(
                "px-3 py-1.5 transition-colors",
                t !== "all" && "border-l border-slate-700",
                typeFilter === t
                  ? "bg-blue-700 text-white"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800",
              )}
            >
              {t === "all" ? "All types" : NOTE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={onlyWithNotes}
            onChange={(e) => setOnlyWithNotes(e.target.checked)}
            className="accent-blue-500"
          />
          Only trucks with notes
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="accent-slate-500"
          />
          Show archived
        </label>
      </div>

      {/* Truck grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No trucks match the current filters.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((t, idx) => (
            <TruckNotePanel
              key={t.truck_number}
              truck={t}
              notes={notesByTruck[t.truck_number] ?? []}
              showArchived={showArchived}
              isOpen={openTruck === t.truck_number}
              onOpen={() => setOpenTruck((prev) => prev === t.truck_number ? null : t.truck_number)}
              index={idx}
            />
          ))}
        </div>
      )}
      </div>
    </motion.div>
  );
}
