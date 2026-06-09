/**
 * NoteCardsDrawer — floating bottom-right drawer showing active truck notes.
 * Enabled via the `note_cards_enabled` app setting.
 * Rendered on /fleet and /load routes by Layout.tsx.
 */
import { useMemo, useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { useLocation } from "react-router-dom";
import { FileText, Check, Bell } from "lucide-react";
import { useSettings, useTruckNotes, useBoard, useUpsertSetting } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "./Clock";
import { useAuth } from "../contexts/AuthContext";
import type { TruckNote, TruckStatus } from "../types";

const NOTE_TYPE_COLOR: Record<string, string> = {
  constant: "bg-blue-900/60 text-blue-300 ring-1 ring-blue-700/40",
  workday:  "bg-violet-900/60 text-violet-300 ring-1 ring-violet-700/40",
  one_off:  "bg-amber-900/60 text-amber-300 ring-1 ring-amber-700/40",
};
const NOTE_TYPE_BORDER: Record<string, string> = {
  constant: "border-blue-700/40",
  workday:  "border-violet-700/40",
  one_off:  "border-amber-700/40",
};
const NOTE_TYPE_LABEL: Record<string, string> = {
  constant: "Constant",
  workday:  "Workday",
  one_off:  "One-off",
};

const STATUS_TEXT: Partial<Record<TruckStatus, string>> = {
  dirty:       "text-status-dirty",
  unfinished:  "text-status-unfinished",
  shop:        "text-status-shop",
  in_progress: "text-status-inprogress",
  unloaded:    "text-status-unloaded",
  loaded:      "text-status-loaded",
  off:         "text-status-off",
  oos:         "text-status-oos",
  spare:       "text-white",
};


export default function NoteCardsDrawer() {
  const location = useLocation();
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const { data: notes = [] } = useTruckNotes({ activeOnly: true });
  const { data: board = [] } = useBoard(todayIso());
  const upsert = useUpsertSetting();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"truck" | "mine">("truck");
  const [filter, setFilter] = useState<"all" | "today">("all");

  // Personal note state
  const personalKey = `personal_note_${user?.username ?? "unknown"}`;
  const savedPersonal = (settings ?? []).find((s) => s.key === personalKey)?.value as string ?? "";
  const [personalDraft, setPersonalDraft] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (personalDraft === null && savedPersonal !== "") setPersonalDraft(savedPersonal);
  }, [savedPersonal, personalDraft]);

  const personalText = personalDraft ?? savedPersonal;

  function handlePersonalChange(val: string) {
    setPersonalDraft(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await upsert.mutateAsync({ key: personalKey, value: val });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    }, 800);
  }

  const { loadDay } = workdayNumbers();

  const statusByTruck = useMemo(() => {
    const map = new Map<number, TruckStatus>();
    for (const t of board) {
      if (t.state?.status) map.set(t.truck_number, t.state.status as TruckStatus);
    }
    return map;
  }, [board]);

  const enabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "note_cards_enabled")?.value === true,
    [settings],
  );

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const activeNotes = useMemo(
    () => notes.filter((n) => n.is_active && (n.note_type !== "one_off" || !n.expires_on || n.expires_on >= today)),
    [notes, today],
  );

  const displayedNotes = useMemo(() => {
    if (filter === "all") return activeNotes;
    return activeNotes.filter((n) => {
      if (n.note_type === "constant") return true;
      if (n.note_type === "workday") return n.workday_num === loadDay;
      if (n.note_type === "one_off") return true; // already date-filtered above
      return true;
    });
  }, [activeNotes, filter, loadDay]);

  const byTruck = useMemo(() => {
    const map = new Map<number, TruckNote[]>();
    for (const n of displayedNotes) {
      const arr = map.get(n.truck_number) ?? [];
      arr.push(n);
      map.set(n.truck_number, arr);
    }
    return map;
  }, [displayedNotes]);

  const truckNums = useMemo(
    () => [...byTruck.keys()].sort((a, b) => a - b),
    [byTruck],
  );

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* Floating panel */}
      {open && (
        <div className="fixed bottom-[7.5rem] left-3 right-3 z-40 flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl md:bottom-20 sm:left-auto sm:right-4 sm:w-[26rem]" style={{ maxHeight: "80svh" }}>
          {/* Panel header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-800 px-4 py-3 rounded-t-xl">
            {/* Tab switcher */}
            <div className="flex items-center gap-1 rounded-lg overflow-hidden ring-1 ring-slate-700">
              <button
                type="button"
                onClick={() => setTab("truck")}
                className={clsx(
                  "px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === "truck" ? "bg-indigo-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                )}
              >
                Truck {activeNotes.length > 0 && <span className="ml-1 rounded-full bg-white/20 px-1">{activeNotes.length}</span>}
              </button>
              <button
                type="button"
                onClick={() => setTab("mine")}
                className={clsx(
                  "px-3 py-1.5 text-xs font-semibold transition-colors border-l border-slate-700",
                  tab === "mine" ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                )}
              >
                My Notes
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Show All / Today Only filter — only on truck tab */}
              {tab === "truck" && (
                <div className="flex rounded-lg overflow-hidden ring-1 ring-slate-700">
                  {(["all", "today"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={clsx(
                        "px-2.5 py-1 text-xs font-semibold transition-colors",
                        filter === f
                          ? "bg-indigo-700 text-white"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                        f === "today" && "border-l border-slate-700",
                      )}
                    >
                      {f === "all" ? "All" : "Today"}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label="Close"
              >
                <FileText className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto p-5 space-y-5">

            {/* My Notes tab */}
            {tab === "mine" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{user?.username}</span>
                  {noteSaved && <span className="text-[10px] text-emerald-500 ml-auto">Saved</span>}
                  {upsert.isPending && !noteSaved && <span className="text-[10px] text-slate-500 ml-auto">Saving…</span>}
                </div>
                <textarea
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none resize-none"
                  rows={12}
                  placeholder="Personal notes visible only to you…"
                  value={personalText}
                  onChange={(e) => handlePersonalChange(e.target.value)}
                />
              </div>
            )}

            {/* Truck Notes tab */}
            {tab === "truck" && truckNums.map((truckNum) => {
              const truckNotes = byTruck.get(truckNum) ?? [];
              return (
                <div
                  key={truckNum}
                  className="rounded-xl border border-slate-700 bg-slate-800/60 p-5 space-y-3"
                >
                  <div className="flex items-center gap-3 border-b border-slate-700 pb-3">
                    <span className={clsx("text-4xl font-black", STATUS_TEXT[statusByTruck.get(truckNum) ?? "dirty"] ?? "text-slate-100")}>#{truckNum}</span>
                    <span className="ml-auto rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
                      {truckNotes.length}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {truckNotes.map((n) => (
                      <div
                        key={n.id}
                        className={clsx("rounded-lg border p-3 text-base", NOTE_TYPE_BORDER[n.note_type])}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          <span className={clsx("rounded-full px-2 py-0.5 text-sm font-semibold", NOTE_TYPE_COLOR[n.note_type])}>
                            {n.note_type === "workday" ? `Day ${n.workday_num}` : NOTE_TYPE_LABEL[n.note_type]}
                          </span>
                          {n.note_type === "one_off" && n.expires_on && (
                            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-sm font-semibold text-slate-300">
                              until {n.expires_on}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-4 whitespace-pre-wrap leading-snug text-slate-200">{n.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FAB toggle button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "fixed bottom-[4.5rem] right-4 z-40 flex items-center gap-2 rounded-full shadow-2xl transition-all duration-150",
          "px-3 py-2 text-sm font-bold md:bottom-5 md:right-5 md:gap-3 md:px-6 md:py-3.5 md:text-base",
          open
            ? "bg-violet-700 text-white ring-4 ring-violet-500/40 shadow-violet-900/50"
            : "bg-gradient-to-br from-violet-600 to-indigo-700 text-white ring-2 ring-violet-400/30 hover:from-violet-500 hover:to-indigo-600 hover:ring-violet-400/50 hover:scale-105",
        )}
      >
        {/* Clipboard / note icon */}
        <Bell className="h-4 w-4 shrink-0 md:h-5 md:w-5" />
        <span className="hidden md:inline">Notes</span>
        <span className="inline-flex items-center justify-center rounded-full bg-white min-w-[1.25rem] h-5 px-1.5 text-xs font-extrabold text-indigo-700 md:min-w-[1.5rem] md:h-6 md:px-2 md:text-sm" style={{ lineHeight: 1 }}>
          {displayedNotes.length}
        </span>
      </button>
    </>
  );
}
