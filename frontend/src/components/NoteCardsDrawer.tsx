/**
 * NoteCardsDrawer — floating bottom-right drawer showing active truck notes.
 * Enabled via the `note_cards_enabled` app setting.
 * Rendered on /fleet and /load routes by Layout.tsx.
 */
import { useMemo, useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { Bell, Check, AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { useSettings, useSpareAssignments, useRouteSwapLog, useTruckNotes, useBoard, useUpsertSetting } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "./Clock";
import { isScheduledOff } from "../utils/truckStatus";
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


export default function NoteCardsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const { data: notes = [] } = useTruckNotes({ activeOnly: true });
  const { data: board = [] } = useBoard(todayIso());
  const upsert = useUpsertSetting();
  const [tab, setTab] = useState<"truck" | "mine" | "reminders">("truck");
  const [filter, setFilter] = useState<"all" | "today">("all");

  // Personal note state — stored as JSON array of { title, body }
  interface NoteSection { title: string; body: string; id: string; }
  const personalKey = `personal_note_${user?.username ?? "unknown"}`;
  const rawSaved = (settings ?? []).find((s) => s.key === personalKey)?.value;
  const savedSections = useMemo((): NoteSection[] => {
    if (!rawSaved) return [];
    if (typeof rawSaved === "string") {
      try { return JSON.parse(rawSaved); } catch { return [{ title: "", body: rawSaved, id: "legacy" }]; }
    }
    return [];
  }, [rawSaved]);
  const [sections, setSections] = useState<NoteSection[] | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSections = sections ?? savedSections;

  useEffect(() => {
    if (sections === null && savedSections.length > 0) setSections(savedSections);
  }, [savedSections, sections]);

  function saveSections(s: NoteSection[]) {
    setSections(s);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await upsert.mutateAsync({ key: personalKey, value: JSON.stringify(s) });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    }, 800);
  }

  function addSection() {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    saveSections([...currentSections, { id, title: "", body: "" }]);
  }

  function removeSection(id: string) {
    saveSections(currentSections.filter((s) => s.id !== id));
  }

  function updateSection(id: string, field: "title" | "body", val: string) {
    saveSections(currentSections.map((s) => s.id === id ? { ...s, [field]: val } : s));
  }

  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const { data: yesterdaySpares } = useSpareAssignments(yesterday);
  const unreturnedSpares = useMemo(
    () => (yesterdaySpares ?? []).filter((s) => !s.returned),
    [yesterdaySpares],
  );

  const { data: todaySpares } = useSpareAssignments(todayIso());
  const { data: swapLog = [] } = useRouteSwapLog(1);
  const todaySwaps = useMemo(
    () => swapLog.filter((s) => s.run_date === todayIso()),
    [swapLog],
  );
  const offTrucksToday = useMemo(
    () => board.filter((t) => t.state?.status === "off"),
    [board],
  );

  const { loadDay } = workdayNumbers();

  const statusByTruck = useMemo(() => {
    const map = new Map<number, TruckStatus>();
    for (const t of board) {
      if (t.state?.status) map.set(t.truck_number, t.state.status as TruckStatus);
    }
    return map;
  }, [board]);

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

  if (!open) return null;

  return (
    <div className="fixed bottom-[7.5rem] left-3 right-3 z-40 flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl md:bottom-20 sm:left-auto sm:right-4 sm:w-[26rem]" style={{ height: "calc(80svh - 3rem)" }}>
      {/* Panel header */}
      <div className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-2 border-b border-slate-700 bg-slate-800 px-4 py-3 rounded-t-xl">
            {/* Tab switcher */}
            <div className="flex items-center gap-1 rounded-lg overflow-hidden ring-1 ring-slate-700 min-w-0">
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
              <button
                type="button"
                onClick={() => setTab("reminders")}
                className={clsx(
                  "px-3 py-1.5 text-xs font-semibold transition-colors border-l border-slate-700",
                  tab === "reminders" ? "bg-amber-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                )}
              >
                Reminders {unreturnedSpares.length > 0 && <span className="ml-1 rounded-full bg-white/20 px-1">{unreturnedSpares.length}</span>}
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
                onClick={onClose}
                className="rounded p-1 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto p-5 space-y-5">

            {/* My Notes tab */}
            {tab === "mine" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{user?.username}</span>
                  {noteSaved && <span className="text-[10px] text-emerald-500 ml-auto">Saved</span>}
                  {upsert.isPending && !noteSaved && <span className="text-[10px] text-slate-500 ml-auto">Saving…</span>}
                </div>
                {currentSections.map((sec) => (
                  <div key={sec.id} className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm font-semibold text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                        placeholder="Section title (optional)"
                        value={sec.title}
                        onChange={(e) => updateSection(sec.id, "title", e.target.value)}
                      />
                      <button onClick={() => removeSection(sec.id)} className="rounded p-1 text-slate-500 hover:text-red-400 transition-colors" title="Remove section">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none resize-none overflow-hidden"
                      rows={1}
                      placeholder="Notes…"
                      value={sec.body}
                      onChange={(e) => {
                        updateSection(sec.id, "body", e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = e.target.scrollHeight + "px";
                      }}
                    />
                  </div>
                ))}
                <button
                  onClick={addSection}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-emerald-600 hover:text-emerald-400"
                >
                  <Plus className="h-4 w-4" /> Add section
                </button>
              </div>
            )}

            {/* Reminders tab */}
            {tab === "reminders" && (
              <div className="space-y-4">
                {/* Yesterday's Coverage */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Yesterday's Coverage</span>
                  </div>
                  {unreturnedSpares.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-3">No active coverage reminders.</p>
                  ) : (
                    unreturnedSpares.map((s) => (
                      <div key={s.id} className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-amber-300">#{s.covering_route_truck}</span>
                          <span className="text-xs text-slate-500">ran on</span>
                          <span className="text-base font-black text-amber-300">Spare #{s.spare_truck_number}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Today's Coverage */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blue-400" />
                    <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Today's Coverage</span>
                  </div>

                  {/* Active spares */}
                  {todaySpares && todaySpares.filter((s) => !s.returned).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Active Spares</p>
                      {todaySpares.filter((s) => !s.returned).map((s) => (
                        <div key={s.id} className="rounded-xl border border-blue-700/30 bg-blue-900/10 p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-blue-300">Spare #{s.spare_truck_number}</span>
                            <span className="text-xs text-slate-500">covering</span>
                            <span className="text-base font-black text-blue-300">#{s.covering_route_truck}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Route swaps */}
                  {todaySwaps.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Route Swaps</p>
                      {todaySwaps.map((s, i) => (
                        <div key={i} className="rounded-xl border border-blue-700/30 bg-blue-900/10 p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-blue-300">#{s.route_truck}</span>
                            <span className="text-xs text-slate-500">loaded by</span>
                            <span className="text-base font-black text-blue-300">#{s.load_on_truck}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Routes Off — non-spare route trucks not running today */}
                  {(() => {
                    const routeOff = board.filter((t) => t.truck_type !== "Spare" && isScheduledOff(t, loadDay));
                    return routeOff.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Routes Off</p>
                        <div className="flex flex-wrap gap-2">
                          {routeOff.map((t) => (
                            <span key={t.truck_number} className="inline-flex items-center rounded-full bg-red-900/30 px-3 py-1 text-xs font-semibold text-red-400">
                              #{t.truck_number}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {(!todaySpares || todaySpares.filter((s) => !s.returned).length === 0) && todaySwaps.length === 0 && offTrucksToday.length === 0 && (
                    <p className="text-center text-sm text-slate-500 py-3">No coverage or off trucks today.</p>
                  )}
                </div>
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
  );
}
