/**
 * HierarchyPicker — the catalog-driven category → subcategory → item → qty
 * picker used by the shortage workflows, plus its palettes and hierarchy
 * helpers. Extracted from pages/Shorts.tsx so the item-first bulk entry mode
 * (ItemFirstEntry) can reuse it standalone; behavior for the original
 * per-truck ShortageLogger call sites is unchanged.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import type { TrackedItem } from "../../api/hooks";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

export const TOP_PALETTE: Record<string, string> = {
  "3x10":  "bg-gradient-to-b from-sky-600 to-sky-900 ring-1 ring-sky-400/20 hover:from-sky-500 hover:to-sky-800",
  "3x5":   "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800",
  "4x6":   "bg-gradient-to-b from-emerald-600 to-emerald-900 ring-1 ring-emerald-400/20 hover:from-emerald-500 hover:to-emerald-800",
  "Paper":    "bg-gradient-to-b from-orange-700 to-orange-950 ring-1 ring-orange-500/20 hover:from-orange-600 hover:to-orange-900",
  "Bulk":     "bg-gradient-to-b from-rose-600 to-rose-900 ring-1 ring-rose-400/20 hover:from-rose-500 hover:to-rose-800",
  "Hygiene":  "bg-gradient-to-b from-cyan-600 to-cyan-900 ring-1 ring-cyan-400/20 hover:from-cyan-500 hover:to-cyan-800",
};

export const CAT_CHIP_COLORS: Record<string, string> = {
  "3x10":  "bg-sky-900/40 text-sky-300 hover:bg-sky-800/60",
  "3x5":   "bg-violet-900/40 text-violet-300 hover:bg-violet-800/60",
  "4x6":   "bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/60",
  "Paper":    "bg-orange-900/40 text-orange-300 hover:bg-orange-800/60",
  "Bulk":     "bg-rose-900/40 text-rose-300 hover:bg-rose-800/60",
  "Hygiene":  "bg-cyan-900/40 text-cyan-300 hover:bg-cyan-800/60",
};

export const SUB_PALETTE: Record<string, string> = {
  Aprons:      "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800",
  "Dust Mops": "bg-gradient-to-b from-teal-600 to-teal-900 ring-1 ring-teal-400/20 hover:from-teal-500 hover:to-teal-800",
  Towels:      "bg-gradient-to-b from-amber-700 to-amber-950 ring-1 ring-amber-500/20 hover:from-amber-600 hover:to-amber-900",
};
export const MAT_COLOR_PALETTE: Record<string, string> = {
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

export const LIGHT_BG_ITEMS = new Set(["White", "White Shop"]);

// ---------------------------------------------------------------------------
// Hierarchy helpers + defaults
// ---------------------------------------------------------------------------

export const MAT_SIZES_S = new Set(["3x10", "3x5", "4x6"]);

export function topCatOf(item: TrackedItem): string {
  const cat = item.category ?? "";
  const idx = cat.indexOf(">");
  return (idx >= 0 ? cat.slice(0, idx) : cat).trim() || "General";
}

export function subCatOf(item: TrackedItem): string | null {
  const cat = item.category ?? "";
  const idx = cat.indexOf(">");
  return idx >= 0 ? cat.slice(idx + 1).trim() : null;
}

export const DEFAULT_TRACKED_ITEMS: TrackedItem[] = [
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

export default function HierarchyPicker({
  items,
  onLog,
  isPending,
  quickSelect,
  quickKey,
  onSelectItem,
  resetKey,
}: {
  items: TrackedItem[];
  onLog: (category: string, detail: string, qty: number) => void;
  isPending: boolean;
  quickSelect?: { cat: string; det: string } | null;
  quickKey?: number;
  /** When set, the picker is a pure item selector — the qty panel never opens. */
  onSelectItem?: (category: string, detail: string) => void;
  /** Bump to return the picker to the top category level (parent-driven reset). */
  resetKey?: number;
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
    if (onSelectItem) {
      onSelectItem(category, detail);
      return;
    }
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

  // Parent-driven reset (e.g. after ItemFirstEntry logs a batch)
  useEffect(() => {
    if (resetKey !== undefined) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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
