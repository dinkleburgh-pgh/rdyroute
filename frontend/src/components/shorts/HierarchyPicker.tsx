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
import { useTrackedItemCategories, type TrackedItem, type CategoryMetaMap } from "../../api/hooks";

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

/**
 * Find the tracked item behind a logged (category, detail) pair. Stored
 * shortage rows carry the category in THREE historical shapes — the top
 * name ("Bulk", old auto-skip rows), the sub name ("Towels", grid taps),
 * or the full string ("Bulk > Towels") — so match all of them.
 */
export function findTrackedItem(
  items: TrackedItem[],
  category: string,
  detail: string,
): TrackedItem | undefined {
  return items.find(
    (i) =>
      i.label === detail &&
      (topCatOf(i) === category ||
        subCatOf(i) === category ||
        (i.category ?? "General") === category),
  );
}

/** "2 Bags" / "1 Bag" when the item has a unit, else just the number. */
export function qtyWithUnit(
  items: TrackedItem[],
  category: string,
  detail: string,
  qty: number,
): string {
  const unit = findTrackedItem(items, category, detail)?.unit_label;
  return unit ? `${qty} ${unit}${qty !== 1 ? "s" : ""}` : String(qty);
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
// Color presets + best-guess resolution
//
// Priority everywhere: hardcoded palettes (existing look) → user-chosen preset
// (from Configure Items) → best guess (semantic name match, color words in
// item labels, then a stable name-hash). Nothing falls back to slate gray.
// ---------------------------------------------------------------------------

export const COLOR_PRESETS: Record<string, { tile: string; chip: string; dot: string; swatch: string }> = {
  sky:     { tile: "bg-gradient-to-b from-sky-600 to-sky-900 ring-1 ring-sky-400/20 hover:from-sky-500 hover:to-sky-800",             chip: "bg-sky-900/40 text-sky-300 hover:bg-sky-800/60",         dot: "bg-sky-500",     swatch: "bg-sky-500" },
  violet:  { tile: "bg-gradient-to-b from-violet-600 to-violet-900 ring-1 ring-violet-400/20 hover:from-violet-500 hover:to-violet-800", chip: "bg-violet-900/40 text-violet-300 hover:bg-violet-800/60", dot: "bg-violet-500",  swatch: "bg-violet-500" },
  emerald: { tile: "bg-gradient-to-b from-emerald-600 to-emerald-900 ring-1 ring-emerald-400/20 hover:from-emerald-500 hover:to-emerald-800", chip: "bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/60", dot: "bg-emerald-500", swatch: "bg-emerald-500" },
  orange:  { tile: "bg-gradient-to-b from-orange-700 to-orange-950 ring-1 ring-orange-500/20 hover:from-orange-600 hover:to-orange-900", chip: "bg-orange-900/40 text-orange-300 hover:bg-orange-800/60", dot: "bg-orange-500",  swatch: "bg-orange-500" },
  rose:    { tile: "bg-gradient-to-b from-rose-600 to-rose-900 ring-1 ring-rose-400/20 hover:from-rose-500 hover:to-rose-800",           chip: "bg-rose-900/40 text-rose-300 hover:bg-rose-800/60",       dot: "bg-rose-500",    swatch: "bg-rose-500" },
  cyan:    { tile: "bg-gradient-to-b from-cyan-600 to-cyan-900 ring-1 ring-cyan-400/20 hover:from-cyan-500 hover:to-cyan-800",           chip: "bg-cyan-900/40 text-cyan-300 hover:bg-cyan-800/60",       dot: "bg-cyan-500",    swatch: "bg-cyan-500" },
  teal:    { tile: "bg-gradient-to-b from-teal-600 to-teal-900 ring-1 ring-teal-400/20 hover:from-teal-500 hover:to-teal-800",           chip: "bg-teal-900/40 text-teal-300 hover:bg-teal-800/60",       dot: "bg-teal-500",    swatch: "bg-teal-500" },
  amber:   { tile: "bg-gradient-to-b from-amber-700 to-amber-950 ring-1 ring-amber-500/20 hover:from-amber-600 hover:to-amber-900",     chip: "bg-amber-900/40 text-amber-300 hover:bg-amber-800/60",   dot: "bg-amber-500",   swatch: "bg-amber-500" },
  red:     { tile: "bg-gradient-to-b from-red-600 to-red-900 ring-1 ring-red-400/20 hover:from-red-500 hover:to-red-800",               chip: "bg-red-900/40 text-red-300 hover:bg-red-800/60",         dot: "bg-red-500",     swatch: "bg-red-500" },
  green:   { tile: "bg-gradient-to-b from-green-600 to-green-900 ring-1 ring-green-400/20 hover:from-green-500 hover:to-green-800",     chip: "bg-green-900/40 text-green-300 hover:bg-green-800/60",   dot: "bg-green-500",   swatch: "bg-green-500" },
  blue:    { tile: "bg-gradient-to-b from-blue-600 to-blue-900 ring-1 ring-blue-400/20 hover:from-blue-500 hover:to-blue-800",           chip: "bg-blue-900/40 text-blue-300 hover:bg-blue-800/60",       dot: "bg-blue-500",    swatch: "bg-blue-500" },
  indigo:  { tile: "bg-gradient-to-b from-indigo-600 to-indigo-900 ring-1 ring-indigo-400/20 hover:from-indigo-500 hover:to-indigo-800", chip: "bg-indigo-900/40 text-indigo-300 hover:bg-indigo-800/60", dot: "bg-indigo-500",  swatch: "bg-indigo-500" },
  lime:    { tile: "bg-gradient-to-b from-lime-600 to-lime-900 ring-1 ring-lime-400/20 hover:from-lime-500 hover:to-lime-800",           chip: "bg-lime-900/40 text-lime-300 hover:bg-lime-800/60",       dot: "bg-lime-500",    swatch: "bg-lime-500" },
  stone:   { tile: "bg-gradient-to-b from-stone-500 to-stone-800 ring-1 ring-stone-300/20 hover:from-stone-400 hover:to-stone-700",     chip: "bg-stone-800/60 text-stone-300 hover:bg-stone-700/60",   dot: "bg-stone-400",   swatch: "bg-stone-400" },
};

// Categories whose NAME implies a hue — used before the hash fallback.
const SEMANTIC_CATEGORY_PRESET: Record<string, string> = {
  towels: "amber", aprons: "violet", "dust mops": "teal", mops: "teal", rags: "stone",
  chemicals: "lime", wipes: "cyan", soap: "cyan", soaps: "cyan", linens: "indigo",
  uniforms: "blue", mats: "emerald", paper: "orange", hygiene: "cyan", gloves: "green",
};

const PRESET_POOL = Object.keys(COLOR_PRESETS).filter((k) => k !== "stone");

/** Best-guess preset for a category with no palette entry and no user color. */
export function guessCategoryPreset(cat: string): { tile: string; chip: string; dot: string; swatch: string } {
  const idx = cat.indexOf(">");
  const part = (idx >= 0 ? cat.slice(idx + 1) : cat).trim().toLowerCase();
  const semantic = SEMANTIC_CATEGORY_PRESET[part];
  if (semantic) return COLOR_PRESETS[semantic];
  let h = 0;
  for (let i = 0; i < part.length; i++) h = (h * 31 + part.charCodeAt(i)) >>> 0;
  return COLOR_PRESETS[PRESET_POOL[h % PRESET_POOL.length]];
}

// Color words in item labels → solid tile classes (extends the MAT_COLOR_PALETTE idea).
// Exact-label MAT palette entries always win first, so mat tiles are unchanged.
const COLOR_WORD_CLASSES: [RegExp, string, boolean][] = [
  [/\bblack\b/i,              "bg-neutral-950 ring-1 ring-white/10 hover:bg-neutral-800",     false],
  [/\bwhite\b/i,              "bg-white ring-1 ring-slate-300 hover:bg-slate-100",            true],
  [/\bred\b/i,                "bg-red-700 ring-1 ring-red-400/20 hover:bg-red-600",           false],
  [/\bgreen\b/i,              "bg-green-700 ring-1 ring-green-400/20 hover:bg-green-600",     false],
  [/\bblue\b/i,               "bg-blue-700 ring-1 ring-blue-400/20 hover:bg-blue-600",        false],
  [/\bdenim\b/i,              "bg-[#1a5fa8] ring-1 ring-blue-400/20 hover:bg-[#1e6dbe]",      false],
  [/\bindigo\b/i,             "bg-indigo-700 ring-1 ring-indigo-400/20 hover:bg-indigo-600",  false],
  [/\bcopper\b/i,             "bg-[#b87333] ring-1 ring-amber-300/20 hover:bg-[#a06828]",     false],
  [/\bonyx\b/i,               "bg-stone-800 ring-1 ring-stone-400/20 hover:bg-stone-700",     false],
  [/\bnavy\b/i,               "bg-blue-900 ring-1 ring-blue-400/20 hover:bg-blue-800",        false],
  [/\bgr[ae]y\b/i,            "bg-gray-500 ring-1 ring-gray-300/20 hover:bg-gray-400",        false],
  [/\bcharcoal\b/i,           "bg-neutral-700 ring-1 ring-white/10 hover:bg-neutral-600",     false],
  [/\byellow\b/i,             "bg-yellow-500 ring-1 ring-yellow-300/40 hover:bg-yellow-400",  true],
  [/\borange\b/i,             "bg-orange-600 ring-1 ring-orange-400/20 hover:bg-orange-500",  false],
  [/\bpurple\b/i,             "bg-purple-700 ring-1 ring-purple-400/20 hover:bg-purple-600",  false],
  [/\bbrown\b/i,              "bg-amber-900 ring-1 ring-amber-500/20 hover:bg-amber-800",     false],
  [/\b(tan|khaki)\b/i,        "bg-[#c3a06b] ring-1 ring-amber-200/30 hover:bg-[#b3915d]",     true],
  [/\bpink\b/i,               "bg-pink-600 ring-1 ring-pink-400/20 hover:bg-pink-500",        false],
  [/\b(maroon|burgundy)\b/i,  "bg-red-900 ring-1 ring-red-400/20 hover:bg-red-800",           false],
  [/\bteal\b/i,               "bg-teal-600 ring-1 ring-teal-400/20 hover:bg-teal-500",        false],
  [/\blime\b/i,               "bg-lime-500 ring-1 ring-lime-300/40 hover:bg-lime-400",        true],
  [/\bgold\b/i,               "bg-amber-500 ring-1 ring-amber-300/40 hover:bg-amber-400",     true],
  [/\bsilver\b/i,             "bg-slate-300 ring-1 ring-slate-100/40 hover:bg-slate-200",     true],
  [/\b(cream|ivory)\b/i,      "bg-[#f5f0dc] ring-1 ring-slate-300 hover:bg-[#ece5cc]",        true],
];

export function colorWordClass(label: string): { cls: string; lightBg: boolean } | null {
  for (const [re, cls, lightBg] of COLOR_WORD_CLASSES) {
    if (re.test(label)) return { cls, lightBg };
  }
  return null;
}

/**
 * Tile class for a category key ("Top" or "Top > Sub" — the meta map is keyed
 * by the full normalized string, SUB_PALETTE by the bare sub name).
 */
export function categoryTileClass(catKey: string, meta?: CategoryMetaMap): string {
  const idx = catKey.indexOf(">");
  const subPart = idx >= 0 ? catKey.slice(idx + 1).trim() : null;
  const userColor = meta?.[catKey]?.color;
  return (
    TOP_PALETTE[catKey] ??
    SUB_PALETTE[subPart ?? catKey] ??
    (userColor ? COLOR_PRESETS[userColor]?.tile : undefined) ??
    guessCategoryPreset(catKey).tile
  );
}

export function categoryChipClass(catKey: string, meta?: CategoryMetaMap): string {
  const userColor = meta?.[catKey]?.color;
  return (
    CAT_CHIP_COLORS[catKey] ??
    (userColor ? COLOR_PRESETS[userColor]?.chip : undefined) ??
    guessCategoryPreset(catKey).chip
  );
}

export function categoryDotClass(catKey: string, meta?: CategoryMetaMap): string {
  const userColor = meta?.[catKey]?.color;
  return (userColor ? COLOR_PRESETS[userColor]?.dot : undefined) ?? guessCategoryPreset(catKey).dot;
}

/** Item tile: MAT palette → user item color → color word in label → category class. */
export function itemTileClass(
  item: TrackedItem | undefined,
  disp: string,
  fallbackCls: string,
): { cls: string; lightBg: boolean } {
  if (MAT_COLOR_PALETTE[disp]) return { cls: MAT_COLOR_PALETTE[disp], lightBg: LIGHT_BG_ITEMS.has(disp) };
  const preset = item?.color ? COLOR_PRESETS[item.color] : undefined;
  if (preset) return { cls: preset.tile, lightBg: false };
  const word = colorWordClass(disp);
  if (word) return word;
  return { cls: fallbackCls, lightBg: false };
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
        const tile = itemTileClass(item, disp, btnClass);
        return (
          <motion.button
            key={item.label}
            type="button"
            disabled={isPending}
            onClick={() => onSelect(cat, detail)}
            className={clsx(
              "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black shadow-lg disabled:opacity-50",
              tile.lightBg ? "text-slate-900" : "text-white",
              tile.cls,
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
  const { data: catMeta } = useTrackedItemCategories();

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
    // Quantities are stored as RAW UNITS exactly as typed (2 bags → 2);
    // displays add the unit label, and the "= N pieces" hint is info-only.
    const raw = Math.max(1, parseInt(qtyInput, 10) || 1);
    onLog(pending.category, pending.detail, raw);
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

  // Auto-skip: if a sub-category has exactly 1 item, jump straight to qty
  // entry. Logs the SUB name as the category, matching what ItemGrid taps
  // store for multi-item subs (historical rows that stored the top name are
  // still resolved by findTrackedItem).
  useEffect(() => {
    if (topCat === null || bulkSub === null || pending !== null) return;
    const subItems = subItemsFor(topCat, bulkSub);
    if (subItems.length === 1) {
      selectItem(bulkSub, subItems[0].label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSub]);

  // Build the selection trail from current state — deduplicate consecutive identical labels
  const trailRaw: { label: string; palette: string; onClick: () => void }[] = [];
  if (topCat !== null) {
    trailRaw.push({
      label: topCat,
      palette: categoryTileClass(topCat, catMeta),
      onClick: reset,
    });
  }
  if (bulkSub !== null) {
    trailRaw.push({
      label: bulkSub,
      palette: categoryTileClass(topCat ? `${topCat} > ${bulkSub}` : bulkSub, catMeta),
      onClick: resetSub,
    });
  }
  if (pending !== null) {
    const pendingItem = findTrackedItem(items, pending.category, pending.detail);
    const catFallback = bulkSub && topCat
      ? categoryTileClass(`${topCat} > ${bulkSub}`, catMeta)
      : topCat
        ? categoryTileClass(topCat, catMeta)
        : guessCategoryPreset(pending.category).tile;
    trailRaw.push({
      label: pending.detail,
      palette: itemTileClass(pendingItem, pending.detail, catFallback).cls,
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
            const sel = findTrackedItem(items, pending.category, pending.detail);
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
                  categoryTileClass(cat, catMeta),
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
            btnClass={categoryTileClass(topCat, catMeta)}
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
                  categoryTileClass(`${topCat} > ${sub}`, catMeta),
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
            btnClass={categoryTileClass(`${topCat} > ${bulkSub}`, catMeta)}
            isPending={isPending}
            onSelect={selectItem}
          />
        </div>
      )}
    </div>
  );
}
