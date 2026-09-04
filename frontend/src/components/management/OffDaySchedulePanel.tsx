import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Pencil } from "lucide-react";
import { useFleet, useHolidayLoad, useHolidayUnload, useRouteDrivers, useUpdateTruck, useUpsertRouteDriver } from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { can } from "../../utils/permissions";
import { isScheduledOff, previousWorkday } from "../../utils/truckStatus";
import { TRUCK_TYPE_SHORT_LABEL } from "../../utils/truckType";
import { workdayNumbers } from "../Clock";
import { todayIso } from "../../api/client";
import clsx from "clsx";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TYPE_SHORT: Record<string, string> = TRUCK_TYPE_SHORT_LABEL;

export default function OffDaySchedulePanel({ compact }: { compact?: boolean }) {
  const { data: fleet } = useFleet(false);
  const updateTruck = useUpdateTruck();
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [pinnedRow, setPinnedRow] = useState<number | null>(null);
  const [pinnedDay, setPinnedDay] = useState<number | null>(null);
  // Track saving state per (truck, day) key so cells show feedback individually
  const [saving, setSaving] = useState<Set<string>>(new Set());
  // Cells are LIVE mutations — locked by default so a stray tap can't silently
  // change a truck's schedule. The Edit Schedule toggle arms them, and edit
  // mode auto-relocks after 2 minutes without an edit (shared floor tablets
  // shouldn't sit armed).
  const RELOCK_MS = 2 * 60 * 1000;
  const [editing, setEditing] = useState(false);
  // The page is visible to everyone including guests, but everything edit mode
  // writes is admin-only server-side. Offering the toggle to anyone else armed
  // a mode where every tap 403s.
  const { user } = useAuth();
  const canEdit = can(user?.role, "edit:fleet-schedule");
  const relockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function armRelock() {
    if (relockTimer.current) clearTimeout(relockTimer.current);
    relockTimer.current = setTimeout(() => setEditing(false), RELOCK_MS);
  }
  function setEditingSafe(next: boolean) {
    if (next && !canEdit) return;
    if (relockTimer.current) clearTimeout(relockTimer.current);
    if (next) armRelock();
    setEditing(next);
  }
  useEffect(() => () => {
    if (relockTimer.current) clearTimeout(relockTimer.current);
  }, []);

  const rows = useMemo(() => {
    if (!fleet) return [];
    return fleet
      .filter((t) => t.truck_type !== "Spare")
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [fleet]);

  // SSR names from the captured dock board, keyed by route number. 403s for
  // guests, so an empty map just means "render without the name column".
  const { data: routeDrivers } = useRouteDrivers();
  const driverByRoute = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of routeDrivers ?? []) {
      if (d.route_number != null) m.set(d.route_number, d.driver_name);
    }
    return m;
  }, [routeDrivers]);
  const hasDrivers = driverByRoute.size > 0;
  // The column is hidden when no SSR has ever been captured — but then there is
  // nowhere to type the first one, so edit mode always shows it.
  const showDriverCol = hasDrivers || editing;
  const upsertDriver = useUpsertRouteDriver();
  // Per-route text drafts, so typing doesn't fight the 5-minute query cache.
  // Cleared for a route once its save lands and the refetch agrees.
  const [driverDrafts, setDriverDrafts] = useState<Record<number, string>>({});

  async function commitDriver(routeNumber: number) {
    const draft = driverDrafts[routeNumber];
    if (draft === undefined) return;
    const stored = driverByRoute.get(routeNumber) ?? "";
    if (draft.trim() === stored) {
      setDriverDrafts((d) => { const n = { ...d }; delete n[routeNumber]; return n; });
      return;
    }
    armRelock();
    try {
      await upsertDriver.mutateAsync({ route_number: routeNumber, driver_name: draft.trim() });
      setDriverDrafts((d) => { const n = { ...d }; delete n[routeNumber]; return n; });
    } catch {
      // Keep the draft on screen so the typed name isn't lost on a failed save.
    }
  }

  const { loadDay, unloadsDay } = workdayNumbers();
  const runDate = todayIso();
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);

  // On a holiday two ship days run in one shift: load also gets ahead on the
  // next ship day (loadDay+1), unload also catches up on the previous ship day
  // (unloadsDay-1). Track every active load/unload day so the compact view and
  // highlighting include the holiday's extra day.
  const loadNextDay = loadDay === 5 ? 1 : loadDay + 1;
  const unloadPrevDay = previousWorkday(unloadsDay);
  const loadDays = holidayLoad ? [loadDay, loadNextDay] : [loadDay];
  const unloadDays = holidayUnload ? [unloadsDay, unloadPrevDay] : [unloadsDay];
  const isLoadDay = (d: number) => loadDays.includes(d);
  const isUnloadDay = (d: number) => unloadDays.includes(d);
  const showInCompact = (d: number) => isLoadDay(d) || isUnloadDay(d);

  const runningToday = useMemo(
    () => rows.filter((t) => !isScheduledOff(t, loadDay)).length,
    [rows, loadDay],
  );

  const perDayCount = useMemo(
    () => [1, 2, 3, 4, 5].map((day) => rows.filter((t) => !isScheduledOff(t, day)).length),
    [rows],
  );

  const activeRow = pinnedRow ?? hoveredRow;
  const activeDay = pinnedDay ?? hoveredDay;

  function isActive(truck: number, day: number): boolean {
    return activeRow === truck || activeDay === day;
  }

  function togglePinRow(truck: number) {
    setPinnedRow((prev) => (prev === truck ? null : truck));
  }

  function togglePinDay(day: number) {
    setPinnedDay((prev) => (prev === day ? null : day));
  }

  async function toggleOffDay(truckNumber: number, day: number, currentOffDays: number[]) {
    if (!editing) return;
    armRelock();
    const key = `${truckNumber}-${day}`;
    if (saving.has(key)) return;
    setSaving((s) => new Set(s).add(key));
    const next = currentOffDays.includes(day)
      ? currentOffDays.filter((d) => d !== day)
      : [...currentOffDays, day].sort((a, b) => a - b);
    try {
      await updateTruck.mutateAsync({ truck_number: truckNumber, scheduled_off_days: next });
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {!canEdit
            ? "Schedule is read-only for your role."
            : editing
              ? "Editing — click any cell to toggle that truck's off day, or type an SSR name. Changes save immediately. Auto-locks after 2 min of inactivity."
              : "Schedule is locked so a stray tap can't change it. Tap Edit Schedule to make changes."}
        </p>
        <button
          type="button"
          hidden={!canEdit}
          onClick={() => setEditingSafe(!editing)}
          className={clsx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors",
            editing
              ? "border-amber-500/60 bg-amber-900/40 text-amber-300 hover:bg-amber-900/60"
              : "border-hairline bg-surface-2 text-ink-soft hover:bg-track",
          )}
        >
          {editing ? <Lock className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          {editing ? "Done — Lock" : "Edit Schedule"}
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-hairline bg-surface/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-xs uppercase tracking-widest text-ink-muted">
              {showDriverCol && (
                <th className="sticky left-0 z-10 hidden w-36 border border-hairline bg-surface-2 px-2 py-1.5 text-left sm:table-cell">
                  SSR
                </th>
              )}
              <th
                className={clsx(
                  "sticky left-0 z-10 border border-hairline bg-surface-2 px-1 py-1.5 text-center",
                  showDriverCol && "sm:left-36",
                )}
              >
                Route
              </th>
              {[1, 2, 3, 4, 5].map((day) => (
                <th
                  key={day}
                  className={clsx(
                    "border border-hairline px-1 py-1 text-center transition-colors cursor-pointer select-none",
                    pinnedDay === day && "bg-blue-900/30",
                    isLoadDay(day) && "ring-2 ring-blue-500/40 animate-pulse",
                    isUnloadDay(day) && "ring-2 ring-emerald-500/40 animate-pulse",
                    compact && !showInCompact(day) && "hidden md:table-cell",
                  )}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  onClick={() => togglePinDay(day)}
                >
                  <div className="font-semibold text-ink-soft">Day {day}</div>
                  <div className="text-[10px] font-normal text-ink-muted">
                    {DAY_LABELS[day - 1]}
                    {isLoadDay(day) && <span className="ml-1 text-blue-400">L</span>}
                    {isUnloadDay(day) && <span className="ml-1 text-emerald-400">U</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showDriverCol ? 7 : 6} className="border border-hairline px-1 py-10 text-center text-xs text-ink-muted">
                  No active route trucks found.
                </td>
              </tr>
            ) : (
              rows.map((t, i) => (
                <tr
                  key={t.truck_number}
                  className={clsx("transition-colors", i % 2 === 1 && "bg-surface-2/20")}
                >
                  {showDriverCol && (
                    <td
                      className={clsx(
                        "sticky left-0 z-10 hidden w-36 truncate border border-hairline bg-surface px-2 py-1.5 text-left text-xs text-ink-soft transition-colors sm:table-cell",
                        activeRow === t.truck_number && "!bg-blue-900/40 text-ink",
                      )}
                      onMouseEnter={() => setHoveredRow(t.truck_number)}
                      onMouseLeave={() => setHoveredRow(null)}
                      // Pinning a row is a read affordance; in edit mode the cell
                      // belongs to the input, or every click into the field would
                      // also toggle the pin.
                      onClick={editing ? undefined : () => togglePinRow(t.truck_number)}
                      title={driverByRoute.get(t.truck_number) ?? undefined}
                    >
                      {editing ? (
                        <input
                          className="w-full rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-xs text-ink outline-none focus:border-blue-500"
                          value={driverDrafts[t.truck_number] ?? driverByRoute.get(t.truck_number) ?? ""}
                          placeholder="—"
                          maxLength={120}
                          onChange={(e) =>
                            setDriverDrafts((d) => ({ ...d, [t.truck_number]: e.target.value }))
                          }
                          // Saves on the way out, like the day cells save on tap.
                          onBlur={() => void commitDriver(t.truck_number)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              setDriverDrafts((d) => {
                                const n = { ...d };
                                delete n[t.truck_number];
                                return n;
                              });
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      ) : (
                        driverByRoute.get(t.truck_number) ?? <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  )}
                  <td
                    className={clsx(
                      "sticky left-0 z-10 border border-hairline bg-blue-900/30 px-1 py-1.5 text-center font-bold leading-5 text-ink-soft transition-colors cursor-pointer select-none",
                      showDriverCol && "sm:left-36",
                      activeRow === t.truck_number && "!bg-blue-800/40",
                    )}
                    onMouseEnter={() => setHoveredRow(t.truck_number)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => togglePinRow(t.truck_number)}
                  >
                    {/* Bigger number, same row height. A flex box locked to the
                        cell's existing 20px line-height contains the text, so the
                        20px glyphs can't grow the row (inline layout would add
                        ~4px from baseline alignment). Type suffix stays small. */}
                    <span className="flex h-5 items-center justify-center gap-0.5 leading-5">
                      <span className="text-xl leading-5 tabular-nums">#{t.truck_number}</span>
                      {TYPE_SHORT[t.truck_type] && (
                        <span className="text-[10px] font-semibold text-ink-muted">
                          {TYPE_SHORT[t.truck_type]}
                        </span>
                      )}
                    </span>
                  </td>
                  {[1, 2, 3, 4, 5].map((day) => {
                    const off = isScheduledOff(t, day);
                    const highlight = isActive(t.truck_number, day);
                    const key = `${t.truck_number}-${day}`;
                    const isSaving = saving.has(key);
                    return (
                      <td
                        key={day}
                        onClick={() => toggleOffDay(t.truck_number, day, t.scheduled_off_days ?? [])}
                        className={clsx(
                          "border border-hairline px-1 py-1 text-center font-mono text-xs font-semibold transition-all select-none",
                          editing ? "cursor-pointer" : "cursor-default",
                          compact && !showInCompact(day) && "hidden md:table-cell",
                          isSaving
                            ? "opacity-40"
                            : off
                              ? clsx(
                                  highlight ? "bg-red-800/60 text-red-200" : "bg-red-900/50 text-red-300",
                                  editing && "hover:bg-track/60 hover:text-ink-soft",
                                )
                              : clsx(
                                  highlight ? "bg-track/70 text-ink-soft" : "bg-surface-2/50 text-ink-muted",
                                  editing && "hover:bg-red-900/40 hover:text-red-300/80",
                                ),
                        )}
                      >
                        {isSaving ? "…" : off ? "OFF" : "RUN"}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-surface-2/60 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {showDriverCol && (
                  <td className="sticky left-0 z-10 hidden w-36 border border-hairline bg-surface-2/80 px-2 py-1.5 sm:table-cell" />
                )}
                <td
                  className={clsx(
                    "sticky left-0 z-10 border border-hairline bg-surface-2/80 px-1 py-1.5 text-center text-[10px] text-ink-muted",
                    showDriverCol && "sm:left-36",
                  )}
                >
                  Total
                </td>
                {perDayCount.map((count, i) => {
                  const day = i + 1;
                  return (
                    <td
                      key={day}
                      className={clsx(
                        "border border-hairline px-1 py-1.5 text-center font-mono tabular-nums transition-colors",
                        compact && !showInCompact(day) && "hidden md:table-cell",
                        isLoadDay(day)
                          ? "bg-blue-900/30 text-blue-300"
                          : isUnloadDay(day)
                          ? "bg-emerald-900/30 text-emerald-300"
                          : "text-ink-soft",
                      )}
                    >
                      {count}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length > 0 && (
          <div className="border-t border-hairline px-3 py-1.5 text-[10px] text-ink-muted">
            <span className="text-blue-400">{runningToday}</span> running <span className="text-blue-400">Day {loadDay}{holidayLoad ? `+${loadNextDay}` : ""}</span> · <span className="text-emerald-400">{rows.filter((t) => !isScheduledOff(t, unloadsDay)).length}</span> unloading <span className="text-emerald-400">Day {unloadsDay}{holidayUnload ? `+${unloadPrevDay}` : ""}</span> · {rows.length} total route trucks
          </div>
        )}
      </div>
    </div>
  );
}
