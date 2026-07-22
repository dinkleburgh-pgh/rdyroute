/**
 * Shorts — per-truck shortage logging workflow.
 *
 * Phase 1: TruckPicker   — tap a truck tile to begin logging.
 * Phase 2: ShortageLogger — hierarchical category → sub → item → qty → log.
 */
import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import clsx from "clsx";
import {
  useBoard,
  useTrackedItems,
  useTrackedItemCategories,
  useShortages,
  useShortageDates,
  useCreateShortage,
  useUpdateShortage,
  useDeleteShortage,
  useHolidayLoad,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import type { Shortage, TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import PageHeader from "../components/PageHeader";
import ShortageImportPanel from "../components/shorts/ShortageImportPanel";
import ItemFirstEntry from "../components/shorts/ItemFirstEntry";
import HierarchyPicker, { categoryChipClass, DEFAULT_TRACKED_ITEMS, findTrackedItem, qtyWithUnit } from "../components/shorts/HierarchyPicker";
import type { TrackedItem } from "../api/hooks";
import { isScheduledOff } from "../utils/truckStatus";
import { workdayNumbers } from "../components/Clock";


// ---------------------------------------------------------------------------
// TruckPicker
// ---------------------------------------------------------------------------

function TruckPicker({
  board,
  shortsByTruck,
  loadDay,
  holiday,
  onSelect,
}: {
  board: TruckWithState[];
  shortsByTruck: Map<number, Shortage[]>;
  loadDay: number;
  holiday: boolean;
  onSelect: (t: TruckWithState) => void;
}) {
  const routeTrucks = board
    .filter((t) => t.truck_type !== "Spare")
    .sort((a, b) => a.truck_number - b.truck_number);

  // Running routes = the route trucks actually scheduled to run this load day
  // (holiday runs every route). Mirrors VerifyShortSheet / the board, so the
  // sheet lists exactly the routes that need writing up and re-derives live
  // whenever the fleet schedule changes.
  const running = routeTrucks.filter(
    (t) => t.is_active && (holiday || !isScheduledOff(t, loadDay)),
  );

  // A route that already has shorts logged is always shown (even if it's off or
  // inactive) so nothing anyone logged can be hidden. "To log" is limited to
  // running routes that don't have shorts yet.
  const withShorts    = routeTrucks.filter((t) => shortsByTruck.has(t.truck_number));
  const withoutShorts = running.filter((t) => !shortsByTruck.has(t.truck_number));
  const runningLogged = running.filter((t) => shortsByTruck.has(t.truck_number)).length;

  if (running.length === 0 && withShorts.length === 0) {
    return <p className="p-6 text-sm text-slate-500">No routes running for this date.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-3 md:p-6">
      {/* Stats */}
      {withShorts.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-amber-900/50 px-3 py-1 font-semibold text-amber-300">
            {runningLogged} / {running.length} routes logged
          </span>
        </div>
      )}

      {/* Routes without shortages */}
      {withoutShorts.length > 0 && (
        <section className="flex flex-col gap-2">
          {withShorts.length > 0 && (
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Routes</h3>
          )}
          <div className="grid gap-2 sm:grid-cols-6 md:grid-cols-9 lg:grid-cols-12 grid-cols-3">
            {withoutShorts.map((t, i) => (
              <motion.button
                key={t.truck_number}
                type="button"
                onClick={() => onSelect(t)}
                className="flex aspect-square flex-col items-center justify-center rounded-xl bg-slate-700 text-white shadow hover:bg-slate-600 hover:shadow-lg"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 30, delay: i * 0.02 }}
                whileHover={{ scale: 1.06, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                whileTap={{ scale: 0.93 }}
              >
                <span className="text-2xl font-black leading-none">{t.truck_number}</span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {t.truck_type}
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* Routes with shortages logged */}
      {withShorts.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Logged</h3>
          <div className="grid gap-2 sm:grid-cols-6 md:grid-cols-9 lg:grid-cols-12 grid-cols-3">
            {withShorts.map((t, i) => {
              const count = shortsByTruck.get(t.truck_number)?.length ?? 0;
              return (
                <motion.button
                  key={t.truck_number}
                  type="button"
                  onClick={() => onSelect(t)}
                  className="flex aspect-square flex-col items-center justify-center rounded-xl bg-amber-900/60 text-white shadow ring-1 ring-amber-700/60 hover:bg-amber-800/60"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30, delay: i * 0.02 }}
                  whileHover={{ scale: 1.06, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                  whileTap={{ scale: 0.93 }}
                >
                  <span className="text-xl font-black leading-none text-amber-200">{t.truck_number}</span>
                  <span className="mt-0.5 text-[10px] font-semibold text-amber-400">
                    {count} item{count !== 1 ? "s" : ""}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// ShortageLogger
// ---------------------------------------------------------------------------

function LoggedList({ shorts, items }: { shorts: Shortage[]; items: TrackedItem[] }) {
  const update = useUpdateShortage();
  const remove = useDeleteShortage();
  const [editId, setEditId]     = useState<number | null>(null);
  const [editQty, setEditQty]   = useState("");

  function startEdit(s: Shortage) {
    setEditId(s.id);
    setEditQty(String(s.quantity));
  }

  async function confirmEdit(s: Shortage) {
    const qty = Math.max(1, parseInt(editQty, 10) || 1);
    await update.mutateAsync({ id: s.id, quantity: qty });
    setEditId(null);
  }

  if (shorts.length === 0) return null;

  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Logged this session</h4>
      <div className="flex flex-wrap gap-2">
        {[...shorts].reverse().map((s) => {
          const label = s.item_detail ? `${s.item_category} ${s.item_detail}` : s.item_category;
          if (editId === s.id) {
            return (
              <AnimateCard key={s.id} className="flex items-center gap-2 rounded-xl border border-amber-700/60 bg-amber-950/40 px-3 py-2">
                <span className="text-xs font-semibold text-slate-200">
                  {label}
                  {(() => {
                    const unit = findTrackedItem(items, s.item_category, s.item_detail)?.unit_label;
                    return unit ? <span className="ml-1 font-normal text-slate-500">({unit}s)</span> : null;
                  })()}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  autoFocus
                  className="input w-16 text-center text-sm font-black"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(s); if (e.key === "Escape") setEditId(null); }}
                />
                <button
                  type="button"
                  onClick={() => confirmEdit(s)}
                  disabled={update.isPending}
                  className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-500 transition disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditId(null)}
                  className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-600 transition"
                >
                  ✕
                </button>
                </AnimateCard>
              );
            }
            return (
              <AnimateCard key={s.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 w-full sm:w-auto">
              <span className="flex-1 min-w-0 text-sm font-semibold text-slate-200">{label}</span>
              <span className="shrink-0 text-xl font-black text-white">
                ×{qtyWithUnit(items, s.item_category, s.item_detail, s.quantity)}
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-slate-600 transition"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(s.id)}
                  disabled={remove.isPending}
                  className="rounded-lg bg-red-900/60 px-3 py-1.5 text-sm font-semibold text-red-300 hover:bg-red-800/60 transition disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </AnimateCard>
          );
        })}
      </div>
    </section>
  );
}

export function ShortageLogger({
  truck,
  shorts,
  runDate,
  onBack,
  inline = false,
  recentItems,
}: {
  truck: TruckWithState;
  shorts: Shortage[];
  runDate: string;
  onBack: () => void;
  inline?: boolean;
  recentItems?: { category: string; detail: string }[];
}) {
  const { user } = useAuth();
  const create   = useCreateShortage();
  const [quickSelect, setQuickSelect] = useState<{ cat: string; det: string } | null>(null);
  const [quickKey, setQuickKey] = useState(0);

  function handleQuickTap(cat: string, det: string) {
    setQuickSelect({ cat, det });
    setQuickKey((k) => k + 1);
  }
  const { data: trackedRaw = [] } = useTrackedItems();
  const { data: catMeta } = useTrackedItemCategories();
  const items = trackedRaw.length > 0 ? trackedRaw : DEFAULT_TRACKED_ITEMS;

  async function logItem(category: string, detail: string, qty: number) {
    if (create.isPending) return;
    await create.mutateAsync({
      truck_number: truck.truck_number,
      run_date: runDate,
      item_category: category,
      item_detail: detail,
      quantity: qty,
      initials: user?.username?.slice(0, 3).toUpperCase() ?? "",
    });
  }

  if (inline) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Shortages</h3>
          {shorts.length > 0 && (
            <span className="rounded-full bg-amber-900/70 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
              {shorts.length} logged
            </span>
          )}
        </div>
        {recentItems && recentItems.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recently Shorted</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentItems.map((item) => (
                <button
                  key={`${item.category}||${item.detail}`}
                  type="button"
                  onClick={() => handleQuickTap(item.category, item.detail)}
                  className={clsx(
                    "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                    categoryChipClass(item.category, catMeta),
                  )}
                >
                  {item.category} {item.detail}
                </button>
              ))}
            </div>
          </div>
        )}
        <HierarchyPicker items={items} onLog={logItem} isPending={create.isPending} quickSelect={quickSelect} quickKey={quickKey} />
        <LoggedList shorts={shorts} items={items} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
       {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-3 backdrop-blur-sm md:px-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition"
        >
          ← Back
        </button>
        <div className="flex-1 flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-xl border-2 border-amber-600/40 bg-amber-950/30 px-6 py-2">
            <span className="text-5xl font-black tabular-nums text-amber-300">#{truck.truck_number}</span>
            {shorts.length > 0 && (
              <span className="rounded-full bg-amber-900/70 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                {shorts.length} logged
              </span>
            )}
          </div>
        </div>
        <div className="w-20 shrink-0 md:hidden" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-5 p-3 md:p-6">
        {/* Recently shorted items quick-list */}
        {recentItems && recentItems.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recently Shorted</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentItems.map((item) => (
                <button
                  key={`${item.category}||${item.detail}`}
                  type="button"
                  onClick={() => handleQuickTap(item.category, item.detail)}
                  className={clsx(
                    "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                    categoryChipClass(item.category, catMeta),
                  )}
                >
                  {item.category} {item.detail}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Category picker */}
        <HierarchyPicker
          items={items}
          onLog={logItem}
          isPending={create.isPending}
          quickSelect={quickSelect}
          quickKey={quickKey}
        />

        <LoggedList shorts={shorts} items={items} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shorts (root)
// ---------------------------------------------------------------------------

export function ShortsWorkspace() {
  const [runDate, setRunDate]        = useState(todayIso());
  const [selectedTruck, setSelected] = useState<TruckWithState | null>(null);
  const [viewMode, setViewMode] = useState<"byItem" | "log" | "imports">("byItem");
  const [searchParams]               = useSearchParams();

  const { data: shortDates = [] } = useShortageDates();

  const { data: board  = [] } = useBoard(runDate);
  const { data: shorts = [] } = useShortages(runDate);

  // Which routes run on this sheet's date, per the fleet schedule. loadDay is
  // derived from the run date the same way the rest of the app does it, and the
  // holiday flag makes every route run. Both feed TruckPicker so the route list
  // stays in lock-step with the fleet schedule (and its Verify companion).
  const loadDay = useMemo(
    () => workdayNumbers(new Date(`${runDate}T12:00:00`)).loadDay,
    [runDate],
  );
  const { data: holiday = false } = useHolidayLoad(runDate);

  // Auto-select only when arriving with a ?truck= param (e.g. from in_progress page)
  useEffect(() => {
    if (selectedTruck !== null || board.length === 0) return;
    const truckParam = searchParams.get("truck");
    if (!truckParam) return;
    const num = parseInt(truckParam, 10);
    const match = board.find((t) => t.truck_number === num);
    if (match) {
      setSelected(match);
      // Deep links (e.g. from the Load page) target the per-truck logger.
      setViewMode("log");
    }
  }, [board, selectedTruck, searchParams]);

  const shortsByTruck = useMemo(() => {
    const map = new Map<number, Shortage[]>();
    for (const s of shorts) {
      if (!map.has(s.truck_number)) map.set(s.truck_number, []);
      map.get(s.truck_number)!.push(s);
    }
    return map;
  }, [shorts]);

  const recentItems = useMemo(() => {
    const map = new Map<string, { category: string; detail: string }>();
    for (const s of shorts) {
      const key = `${s.item_category}||${s.item_detail}`;
      if (!map.has(key)) map.set(key, { category: s.item_category, detail: s.item_detail });
    }
    return [...map.values()].slice(0, 8);
  }, [shorts]);

  const truckShorts = selectedTruck
    ? (shortsByTruck.get(selectedTruck.truck_number) ?? [])
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex h-full flex-col"
    >
      {/* Page header */}
      <PageHeader
        eyebrow="Workflow"
        title="Short Sheet"
        subtitle="Log route shortages or review imported sheet data for verification."
        actions={
          <>
            <select
              className="input min-w-[8.5rem] py-1.5 text-sm"
              value={runDate}
              onChange={(e) => { setRunDate(e.target.value); setSelected(null); }}
            >
              <option value={todayIso()}>Today</option>
              {shortDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <div className="flex rounded-lg border border-slate-800 bg-slate-900/70 p-1">
              <button
                type="button"
                onClick={() => setViewMode("byItem")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  viewMode === "byItem" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                By item
              </button>
              <button
                type="button"
                onClick={() => setViewMode("log")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  viewMode === "log" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                By truck
              </button>
              <button
                type="button"
                onClick={() => setViewMode("imports")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  viewMode === "imports" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                Import sheets
              </button>
            </div>
          </>
        }
      />

      {viewMode === "imports" ? (
        <div className="p-3 md:p-6">
          <ShortageImportPanel defaultRunDate={runDate} lockedRunDate />
        </div>
      ) : viewMode === "byItem" ? (
        <ItemFirstEntry
          runDate={runDate}
          board={board}
          shorts={shorts}
          loadDay={loadDay}
          holiday={holiday}
          recentItems={recentItems}
        />
      ) : (
        <>
          {selectedTruck === null ? (
            <TruckPicker
              board={board}
              shortsByTruck={shortsByTruck}
              loadDay={loadDay}
              holiday={holiday}
              onSelect={(t) => setSelected(t)}
            />
          ) : (
            <ShortageLogger
              truck={selectedTruck}
              shorts={truckShorts}
              runDate={runDate}
              onBack={() => setSelected(null)}
              recentItems={recentItems}
            />
          )}
        </>
      )}
    </motion.div>
  );
}

export default function Shorts() {
  return <ShortsWorkspace />;
}
