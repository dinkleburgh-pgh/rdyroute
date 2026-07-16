/**
 * Shorts — per-truck shortage logging workflow.
 *
 * Phase 1: TruckPicker   — tap a truck tile to begin logging.
 * Phase 2: ShortageLogger — hierarchical category → sub → item → qty → log.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import clsx from "clsx";
import {
  useBoard,
  useTrackedItems,
  useShortages,
  useShortageDates,
  useCreateShortage,
  useUpdateShortage,
  useDeleteShortage,
  useHolidayLoad,
  type TrackedItem,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import type { Shortage, TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import PageHeader from "../components/PageHeader";
import ShortageImportPanel from "../components/shorts/ShortageImportPanel";
import { isScheduledOff } from "../utils/truckStatus";
import { workdayNumbers } from "../components/Clock";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const TOP_PALETTE: Record<string, string> = {
  "3x10":  "bg-gradient-to-b from-sky-600 to-sky-900 ring-1 ring-sky-400/20 hover:from-sky-500 hover:to-sky-800",
  "3x5":   "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800",
  "4x6":   "bg-gradient-to-b from-emerald-600 to-emerald-900 ring-1 ring-emerald-400/20 hover:from-emerald-500 hover:to-emerald-800",
  "Paper":    "bg-gradient-to-b from-orange-700 to-orange-950 ring-1 ring-orange-500/20 hover:from-orange-600 hover:to-orange-900",
  "Bulk":     "bg-gradient-to-b from-rose-600 to-rose-900 ring-1 ring-rose-400/20 hover:from-rose-500 hover:to-rose-800",
  "Hygiene":  "bg-gradient-to-b from-cyan-600 to-cyan-900 ring-1 ring-cyan-400/20 hover:from-cyan-500 hover:to-cyan-800",
};

const CAT_CHIP_COLORS: Record<string, string> = {
  "3x10":  "bg-sky-900/40 text-sky-300 hover:bg-sky-800/60",
  "3x5":   "bg-violet-900/40 text-violet-300 hover:bg-violet-800/60",
  "4x6":   "bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/60",
  "Paper":    "bg-orange-900/40 text-orange-300 hover:bg-orange-800/60",
  "Bulk":     "bg-rose-900/40 text-rose-300 hover:bg-rose-800/60",
  "Hygiene":  "bg-cyan-900/40 text-cyan-300 hover:bg-cyan-800/60",
};

const SUB_PALETTE: Record<string, string> = {
  Aprons:      "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800",
  "Dust Mops": "bg-gradient-to-b from-teal-600 to-teal-900 ring-1 ring-teal-400/20 hover:from-teal-500 hover:to-teal-800",
  Towels:      "bg-gradient-to-b from-amber-700 to-amber-950 ring-1 ring-amber-500/20 hover:from-amber-600 hover:to-amber-900",
};
const MAT_COLOR_PALETTE: Record<string, string> = {
  // Mat colors
  "Black":      "bg-neutral-950 ring-1 ring-white/10 hover:bg-neutral-800",
  "Onyx":       "bg-stone-800 ring-1 ring-stone-400/20 hover:bg-stone-700",
  "Copper":     "bg-[#b87333] ring-1 ring-amber-300/20 hover:bg-[#a06828]",
  "Indigo":     "bg-indigo-700 ring-1 ring-indigo-400/20 hover:bg-indigo-600",
  // Apron / towel colors
  "White":      "bg-white ring-1 ring-slate-300 hover:bg-slate-100",
  "Red":        "bg-red-700 ring-1 ring-red-400/20 hover:bg-red-600",
  "Green":      "bg-green-700 ring-1 ring-green-400/20 hover:bg-green-600",
  "Blue":       "bg-blue-700 ring-1 ring-blue-400/20 hover:bg-blue-600",
  "Denim":      "bg-[#1a5fa8] ring-1 ring-blue-400/20 hover:bg-[#1e6dbe]",
  "Red Shop":   "bg-red-700 ring-1 ring-red-400/20 hover:bg-red-600",
  "White Shop": "bg-white ring-1 ring-slate-300 hover:bg-slate-100",
};

const LIGHT_BG_ITEMS = new Set(["White", "White Shop"]);

// ---------------------------------------------------------------------------
// Hierarchy helpers + defaults
// ---------------------------------------------------------------------------

const MAT_SIZES_S = new Set(["3x10", "3x5", "4x6"]);

function topCatOf(item: TrackedItem): string {
  const cat = item.category ?? "";
  const idx = cat.indexOf(">");
  return (idx >= 0 ? cat.slice(0, idx) : cat).trim() || "General";
}

function subCatOf(item: TrackedItem): string | null {
  const cat = item.category ?? "";
  const idx = cat.indexOf(">");
  return idx >= 0 ? cat.slice(idx + 1).trim() : null;
}

const DEFAULT_TRACKED_ITEMS: TrackedItem[] = [
  ...["3x10", "3x5", "4x6"].flatMap((size) =>
    ["Black", "Onyx", "Indigo", "Copper"].map((color) => ({
      label: color, qty_default: 1, category: size,
    }))
  ),
  ...["C-PULL", "DRC (AIRLAID)", "BROWN HW", "SIG HW", "SIG Z-FOLD", "SIG DUAL TP", "JRT", "B&V TP", "B&V Z-FOLD"].map((l) => ({
    label: l, qty_default: 1, category: "Paper",
  })),
  ...["White", "Black", "Red", "Green", "Blue", "Denim"].map((l) => ({
    label: l, qty_default: 1, category: "Bulk > Aprons",
  })),
  ...['WET MOP', '24"', '36"', '46"', '60"', "Fender Covers"].map((l) => ({
    label: l, qty_default: 1, category: "Bulk > Dust Mops",
  })),
  ...["Grid/Terry", "Glass", "Regular", "Premium", "Small Ink", "Large Ink", "Napkins", "Red Shop", "White Shop"].map((l) => ({
    label: l, qty_default: 1, category: "Bulk > Towels",
  })),
];

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
// HierarchyPicker — driven by tracked items
// ---------------------------------------------------------------------------

// Module-level so it keeps a stable component identity — defined inside
// HierarchyPicker it was recreated every render, remounting these buttons and
// replaying their entrance animation endlessly.
function ItemGrid({
  gridItems,
  cat,
  btnClass,
  isPending,
  onSelect,
}: {
  gridItems: TrackedItem[];
  cat: string;
  btnClass: string;
  isPending: boolean;
  onSelect: (category: string, detail: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {gridItems.map((item, i) => {
        const disp = MAT_SIZES_S.has(cat) && item.label.startsWith(cat + " ")
          ? item.label.slice(cat.length + 1)
          : item.label;
        const detail = disp; // for mats: just color; for others: full label
        return (
          <motion.button
            key={item.label}
            type="button"
            disabled={isPending}
            onClick={() => onSelect(cat, detail)}
            className={clsx(
              "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black shadow-lg disabled:opacity-50",
              LIGHT_BG_ITEMS.has(disp) ? "text-slate-900" : "text-white",
              MAT_COLOR_PALETTE[disp] ?? btnClass,
            )}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 28, delay: i * 0.025 }}
            whileHover={{ scale: 1.04, transition: { type: "spring", stiffness: 400, damping: 20 } }}
            whileTap={{ scale: 0.94 }}
          >
            {disp}
          </motion.button>
        );
      })}
    </div>
  );
}

function HierarchyPicker({
  items,
  onLog,
  isPending,
  quickSelect,
  quickKey,
}: {
  items: TrackedItem[];
  onLog: (category: string, detail: string, qty: number) => void;
  isPending: boolean;
  quickSelect?: { cat: string; det: string } | null;
  quickKey?: number;
}) {
  const [topCat, setTopCat]     = useState<string | null>(null);
  const [bulkSub, setBulkSub]   = useState<string | null>(null);
  const [pending, setPending]   = useState<{ category: string; detail: string } | null>(null);
  const [qtyInput, setQtyInput] = useState("");
  const qtyRef = useRef<HTMLInputElement>(null);

  const topCats = useMemo(() => [...new Set(items.map(topCatOf))], [items]);

  function reset()    { setTopCat(null); setBulkSub(null); setPending(null); setQtyInput(""); }
  function resetSub() { setBulkSub(null); setPending(null); setQtyInput(""); }

  function selectItem(category: string, detail: string) {
    setPending({ category, detail });
    setQtyInput("");
    setTimeout(() => qtyRef.current?.focus(), 50);
  }

  function confirmLog() {
    if (!pending) return;
    const raw = Math.max(1, parseInt(qtyInput, 10) || 1);
    const sel = items.find((i) => i.label === pending.detail && topCatOf(i) === pending.category);
    const qty = sel?.pack_size ? raw * sel.pack_size : raw;
    onLog(pending.category, pending.detail, qty);
    setPending(null);
    setQtyInput("");
  }

  function subCatsFor(tc: string) {
    return [...new Set(
      items.filter(i => topCatOf(i) === tc && subCatOf(i) !== null).map(i => subCatOf(i)!)
    )];
  }

  function flatItemsFor(tc: string) {
    return items.filter(i => topCatOf(i) === tc && subCatOf(i) === null);
  }

  function subItemsFor(tc: string, sc: string) {
    return items.filter(i => topCatOf(i) === tc && subCatOf(i) === sc);
  }

  // Auto-skip: if there's only one top category, go straight to it
  useEffect(() => {
    if (topCat !== null || pending !== null) return;
    if (topCats.length === 1) {
      setTopCat(topCats[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topCats]);

  // Quick-select: when a recently-shorted chip is tapped, jump to qty input
  useEffect(() => {
    if (quickSelect) selectItem(quickSelect.cat, quickSelect.det);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickKey]);

  // Auto-skip: if a top category has exactly 1 item (no subs), jump straight to qty entry
  useEffect(() => {
    if (topCat === null || pending !== null) return;
    const subs = subCatsFor(topCat);
    const flat = flatItemsFor(topCat);
    if (subs.length === 0 && flat.length === 1) {
      selectItem(topCat, flat[0].label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topCat]);

  // Auto-skip: if a sub-category has exactly 1 item, jump straight to qty entry
  useEffect(() => {
    if (topCat === null || bulkSub === null || pending !== null) return;
    const subItems = subItemsFor(topCat, bulkSub);
    if (subItems.length === 1) {
      selectItem(topCat, subItems[0].label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSub]);

  // Build the selection trail from current state — deduplicate consecutive identical labels
  const trailRaw: { label: string; palette: string; onClick: () => void }[] = [];
  if (topCat !== null) {
    trailRaw.push({
      label: topCat,
      palette: TOP_PALETTE[topCat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20",
      onClick: reset,
    });
  }
  if (bulkSub !== null) {
    trailRaw.push({
      label: bulkSub,
      palette: SUB_PALETTE[bulkSub] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20",
      onClick: resetSub,
    });
  }
  if (pending !== null) {
    const itemPalette =
      MAT_COLOR_PALETTE[pending.detail] ??
      (bulkSub ? (SUB_PALETTE[bulkSub] ?? null) : null) ??
      (topCat  ? (TOP_PALETTE[topCat]  ?? null) : null) ??
      "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20";
    trailRaw.push({
      label: pending.detail,
      palette: itemPalette,
      onClick: () => { setPending(null); setQtyInput(""); },
    });
  }
  // Filter consecutive duplicates (handles auto-skip e.g. Soap > Soap)
  const trail = trailRaw.filter((step, i) =>
    i === 0 || step.label.toLowerCase() !== trailRaw[i - 1].label.toLowerCase()
  );

  const subs      = topCat ? subCatsFor(topCat) : [];
  const flatItems = topCat ? flatItemsFor(topCat) : [];

  return (
    <div className="space-y-1">
      {/* Selection trail: chosen buttons in a horizontal row with right-pointing arrows */}
      {trail.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          {trail.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={step.onClick}
                title="Tap to go back"
                className={clsx(
                  "rounded-xl px-5 py-2.5 text-sm font-black text-white shadow-md opacity-70 ring-1 ring-white/10 transition hover:opacity-100 active:scale-95",
                  step.palette,
                )}
              >
                {step.label}
              </button>
              {/* Right-pointing arrow connector */}
              <div className="flex items-center">
                <div className="h-px w-3 bg-slate-600" />
                <div className="h-0 w-0 border-b-[5px] border-l-[6px] border-t-[5px] border-b-transparent border-l-slate-500 border-t-transparent" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Current level choices */}
      {pending !== null ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
          {(() => {
            const sel = items.find((i) => i.label === pending.detail && topCatOf(i) === pending.category);
            const unitLabel = sel?.unit_label;
            const packSize = sel?.pack_size;
            const qtyNum = Math.max(1, parseInt(qtyInput, 10) || 1);
            const pieceCount = packSize ? qtyNum * packSize : null;
            return (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    {unitLabel ? `Qty (${unitLabel}s)` : "Quantity shorted"}
                  </span>
                  <input
                    ref={qtyRef}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    className="input w-full text-2xl font-black"
                    placeholder="1"
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmLog(); }}
                  />
                </label>
                {pieceCount != null && (
                  <p className="mt-1 text-xs text-slate-500">
                    = {pieceCount} {qtyNum === 1 ? "piece" : "pieces"}
                  </p>
                )}
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={confirmLog}
                    disabled={isPending}
                    className="flex-1 rounded-xl bg-amber-600 px-4 py-3 text-base font-black text-white shadow hover:bg-amber-500 active:scale-95 transition disabled:opacity-50"
                  >
                    Log
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPending(null); setQtyInput(""); }}
                    className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-700 transition"
                  >
                    Cancel
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      ) : topCat === null ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Category</p>
          <div className="grid grid-cols-3 gap-2">
            {topCats.map((cat, i) => (
              <motion.button
                key={cat}
                type="button"
                onClick={() => setTopCat(cat)}
                className={clsx(
                  "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black text-white shadow-lg",
                  TOP_PALETTE[cat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700",
                )}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 28, delay: i * 0.025 }}
                whileHover={{ scale: 1.04, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                whileTap={{ scale: 0.94 }}
              >
                {cat}
              </motion.button>
            ))}
          </div>
        </div>
      ) : subs.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Item</p>
          <ItemGrid
            gridItems={flatItems}
            cat={topCat}
            btnClass={TOP_PALETTE[topCat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700"}
            isPending={isPending}
            onSelect={selectItem}
          />
        </div>
      ) : bulkSub === null ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Subcategory</p>
          <div className="grid grid-cols-3 gap-2">
            {subs.map((sub, i) => (
              <motion.button
                key={sub}
                type="button"
                onClick={() => setBulkSub(sub)}
                className={clsx(
                  "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black text-white shadow-lg",
                  SUB_PALETTE[sub] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700",
                )}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 28, delay: i * 0.025 }}
                whileHover={{ scale: 1.04, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                whileTap={{ scale: 0.94 }}
              >
                {sub}
              </motion.button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Item</p>
          <ItemGrid
            gridItems={subItemsFor(topCat, bulkSub)}
            cat={bulkSub}
            btnClass={SUB_PALETTE[bulkSub] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700"}
            isPending={isPending}
            onSelect={selectItem}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShortageLogger
// ---------------------------------------------------------------------------

function LoggedList({ shorts }: { shorts: Shortage[] }) {
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
                <span className="text-xs font-semibold text-slate-200">{label}</span>
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
              <span className="shrink-0 text-xl font-black text-white">×{s.quantity}</span>
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
                    CAT_CHIP_COLORS[item.category] ?? "bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                >
                  {item.category} {item.detail}
                </button>
              ))}
            </div>
          </div>
        )}
        <HierarchyPicker items={items} onLog={logItem} isPending={create.isPending} quickSelect={quickSelect} quickKey={quickKey} />
        <LoggedList shorts={shorts} />
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
                    CAT_CHIP_COLORS[item.category] ?? "bg-slate-800 text-slate-300 hover:bg-slate-700",
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

        <LoggedList shorts={shorts} />
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
  const [viewMode, setViewMode] = useState<"log" | "imports">("log");
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
    if (match) setSelected(match);
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
                onClick={() => setViewMode("log")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  viewMode === "log" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                Log shortages
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
