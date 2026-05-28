/**
 * Shorts — per-truck shortage logging workflow.
 *
 * Phase 1: TruckPicker   — tap a truck tile to begin logging.
 * Phase 2: ShortageLogger — hierarchical category → sub → item → qty → log.
 */
import { useState, useMemo, useRef } from "react";
import clsx from "clsx";
import {
  useBoard,
  useTrackedItems,
  useShortages,
  useCreateShortage,
  type TrackedItem,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import type { Shortage, TruckWithState } from "../types";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const TOP_PALETTE: Record<string, string> = {
  "3x10":  "bg-gradient-to-b from-sky-600 to-sky-900 ring-1 ring-sky-400/20 hover:from-sky-500 hover:to-sky-800",
  "3x5":   "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800",
  "4x6":   "bg-gradient-to-b from-emerald-600 to-emerald-900 ring-1 ring-emerald-400/20 hover:from-emerald-500 hover:to-emerald-800",
  "Paper": "bg-gradient-to-b from-orange-700 to-orange-950 ring-1 ring-orange-500/20 hover:from-orange-600 hover:to-orange-900",
  "Bulk":  "bg-gradient-to-b from-rose-600 to-rose-900 ring-1 ring-rose-400/20 hover:from-rose-500 hover:to-rose-800",
};

const SUB_PALETTE: Record<string, string> = {
  Aprons:      "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800",
  "Dust Mops": "bg-gradient-to-b from-teal-600 to-teal-900 ring-1 ring-teal-400/20 hover:from-teal-500 hover:to-teal-800",
  Towels:      "bg-gradient-to-b from-amber-700 to-amber-950 ring-1 ring-amber-500/20 hover:from-amber-600 hover:to-amber-900",
};
const MAT_COLOR_PALETTE: Record<string, string> = {
  "Black":  "bg-neutral-950 ring-1 ring-white/10 hover:bg-neutral-800",
  "Onyx":   "bg-stone-800 ring-1 ring-stone-400/20 hover:bg-stone-700",
  "Copper": "bg-[#b87333] ring-1 ring-amber-300/20 hover:bg-[#a06828]",
  "Indigo": "bg-indigo-700 ring-1 ring-indigo-400/20 hover:bg-indigo-600",
};

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
  onSelect,
}: {
  board: TruckWithState[];
  shortsByTruck: Map<number, Shortage[]>;
  onSelect: (t: TruckWithState) => void;
}) {
  const trucks = board
    .filter((t) => t.truck_type !== "Spare")
    .sort((a, b) => a.truck_number - b.truck_number);

  const withShorts    = trucks.filter((t) =>  shortsByTruck.has(t.truck_number));
  const withoutShorts = trucks.filter((t) => !shortsByTruck.has(t.truck_number));

  if (trucks.length === 0) {
    return <p className="p-6 text-sm text-slate-500">No trucks found for this date.</p>;
  }

  return (
    <div className="space-y-5 p-3 md:p-6">
      {/* Stats */}
      {withShorts.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-amber-900/50 px-3 py-1 font-semibold text-amber-300">
            {withShorts.length} / {trucks.length} routes logged
          </span>
        </div>
      )}

      {/* Routes without shortages */}
      {withoutShorts.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Routes</h3>
          <div className="flex flex-wrap gap-3">
            {withoutShorts.map((t) => (
              <button
                key={t.truck_number}
                type="button"
                onClick={() => onSelect(t)}
                className="flex h-20 w-20 flex-col items-center justify-center rounded-xl bg-slate-700 text-white shadow transition active:scale-95 hover:bg-slate-600 hover:shadow-lg"
              >
                <span className="text-2xl font-black leading-none">{t.truck_number}</span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {t.truck_type}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Routes with shortages logged */}
      {withShorts.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Logged</h3>
          <div className="flex flex-wrap gap-2">
            {withShorts.map((t) => {
              const count = shortsByTruck.get(t.truck_number)?.length ?? 0;
              return (
                <button
                  key={t.truck_number}
                  type="button"
                  onClick={() => onSelect(t)}
                  className="flex h-16 w-16 flex-col items-center justify-center rounded-xl bg-amber-900/60 text-white shadow ring-1 ring-amber-700/60 transition active:scale-95 hover:bg-amber-800/60"
                >
                  <span className="text-xl font-black leading-none text-amber-200">{t.truck_number}</span>
                  <span className="mt-0.5 text-[10px] font-semibold text-amber-400">
                    {count} item{count !== 1 ? "s" : ""}
                  </span>
                </button>
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

function HierarchyPicker({
  items,
  onLog,
  isPending,
}: {
  items: TrackedItem[];
  onLog: (category: string, detail: string, qty: number) => void;
  isPending: boolean;
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
    const qty = Math.max(1, parseInt(qtyInput, 10) || 1);
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

  // --- Qty prompt ---
  if (pending !== null) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Selected item</p>
          <p className="mb-1 text-base font-semibold text-slate-400">{pending.category}</p>
          <p className="mb-4 text-xl font-black text-white">{pending.detail}</p>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Quantity shorted</span>
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
        </div>
      </div>
    );
  }

  function ItemGrid({ gridItems, cat, btnClass }: { gridItems: TrackedItem[]; cat: string; btnClass: string }) {
    return (
      <div className="flex flex-wrap gap-2">
        {gridItems.map((item) => {
          const disp = MAT_SIZES_S.has(cat) && item.label.startsWith(cat + " ")
            ? item.label.slice(cat.length + 1)
            : item.label;
          const detail = disp; // for mats: just color; for others: full label
          return (
            <button
              key={item.label}
              type="button"
              disabled={isPending}
              onClick={() => selectItem(cat, detail)}
              className={clsx(
                "rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow transition-all active:scale-95 disabled:opacity-50",
                MAT_COLOR_PALETTE[disp] ?? btnClass,
              )}
            >
              {disp}
            </button>
          );
        })}
      </div>
    );
  }

  // --- Step 1: top-level categories ---
  if (topCat === null) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Category</p>
        <div className="flex flex-wrap gap-3">
          {topCats.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setTopCat(cat)}
              className={clsx(
                "rounded-2xl px-7 py-5 text-lg font-black text-white shadow-lg transition-all active:scale-95",
                TOP_PALETTE[cat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const subs      = subCatsFor(topCat);
  const flatItems = flatItemsFor(topCat);

  // --- Step 2a: flat items ---
  if (subs.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={reset}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition">
            ← {topCat}
          </button>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Item</p>
        </div>
        <ItemGrid
          gridItems={flatItems}
          cat={topCat}
          btnClass={TOP_PALETTE[topCat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700"}
        />
      </div>
    );
  }

  // --- Step 2b: sub-categories ---
  if (bulkSub === null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={reset}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition">
            ← {topCat}
          </button>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Subcategory</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {subs.map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => setBulkSub(sub)}
              className={clsx(
                "rounded-2xl px-6 py-4 text-base font-black text-white shadow-lg transition-all active:scale-95",
                SUB_PALETTE[sub] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700",
              )}
            >
              {sub}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- Step 3: sub items ---
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={resetSub}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition">
          ← {bulkSub}
        </button>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Item</p>
      </div>
      <ItemGrid
        gridItems={subItemsFor(topCat, bulkSub)}
        cat={bulkSub}
        btnClass={SUB_PALETTE[bulkSub] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShortageLogger
// ---------------------------------------------------------------------------

function ShortageLogger({
  truck,
  shorts,
  runDate,
  onBack,
}: {
  truck: TruckWithState;
  shorts: Shortage[];
  runDate: string;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const create   = useCreateShortage();
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

  return (
    <div className="flex min-h-0 flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-2.5 backdrop-blur-sm md:px-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-slate-700 transition"
        >
          back
        </button>
        <span className="text-3xl font-black text-white">#{truck.truck_number}</span>
        <div className="flex items-center gap-2">
          {shorts.length > 0 && (
            <span className="rounded-full bg-amber-900/70 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
              {shorts.length} logged
            </span>
          )}
        </div>
      </div>

      <div className="space-y-5 p-3 md:p-6">
        {/* Category picker */}
        <HierarchyPicker
          items={items}
          onLog={logItem}
          isPending={create.isPending}
        />

        {/* Logged shortages for this truck */}
        {shorts.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Logged this session
            </h4>
            <div className="flex flex-wrap gap-2">
              {[...shorts].reverse().map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-slate-200">
                    {s.item_detail ? `${s.item_category} ${s.item_detail}` : s.item_category}
                  </span>
                  {s.quantity > 1 && (
                    <span className="font-bold text-slate-400">x{s.quantity}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shorts (root)
// ---------------------------------------------------------------------------

export default function Shorts() {
  const [runDate, setRunDate]        = useState(todayIso());
  const [selectedTruck, setSelected] = useState<TruckWithState | null>(null);

  const { data: board  = [] } = useBoard(runDate);
  const { data: shorts = [] } = useShortages(runDate);

  const shortsByTruck = useMemo(() => {
    const map = new Map<number, Shortage[]>();
    for (const s of shorts) {
      if (!map.has(s.truck_number)) map.set(s.truck_number, []);
      map.get(s.truck_number)!.push(s);
    }
    return map;
  }, [shorts]);

  const truckShorts = selectedTruck
    ? (shortsByTruck.get(selectedTruck.truck_number) ?? [])
    : [];

  return (
    <div className="flex min-h-0 flex-col">
      {/* Page header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-3 py-3 md:px-6">
        <h2 className="text-xl font-semibold text-slate-100">Shortages</h2>
        <input
          className="input"
          type="date"
          max={todayIso()}
          value={runDate}
          onChange={(e) => { setRunDate(e.target.value); setSelected(null); }}
        />
      </div>

      {selectedTruck === null ? (
        <TruckPicker
          board={board}
          shortsByTruck={shortsByTruck}
          onSelect={(t) => setSelected(t)}
        />
      ) : (
        <ShortageLogger
          truck={selectedTruck}
          shorts={truckShorts}
          runDate={runDate}
          onBack={() => setSelected(null)}
        />
      )}
    </div>
  );
}
