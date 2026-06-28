// ---------------------------------------------------------------------------
// Item unit weighting + category grouping
//
// Audit and shortage quantities are stored as *pieces* (the log forms multiply
// by pack_size up front — see Audit.tsx / Shorts.tsx). The trends used to sum
// those pieces across every item, mashing incompatible units together (24 rolls
// of JRT + 200 apron pieces -> "224"). These helpers reverse pieces back into
// the handler-facing pack unit (Case / Bag / Bundle) using the catalog, and
// group entries by category so each is shown in its own units.
// ---------------------------------------------------------------------------

import type { TrackedItem } from "../api/hooks";

export interface UnitBreakdown {
  pieces: number;
  /** Number of pack units (pieces / pack_size). null = handled as singles. */
  unitCount: number | null;
  /** Pack unit label e.g. "Case", "Bag". null when there is no pack size. */
  unitLabel: string | null;
}

/** Convert a stored piece count back into pack units using the item's pack_size. */
export function unitize(pieces: number, item?: TrackedItem | null): UnitBreakdown {
  const pack = item?.pack_size;
  if (pack && pack > 0) {
    return {
      pieces,
      unitCount: pieces / pack,
      unitLabel: item?.unit_label?.trim() || "pack",
    };
  }
  return { pieces, unitCount: null, unitLabel: null };
}

/** Build a fast `label -> TrackedItem` lookup from the catalog. */
export function catalogIndex(items: TrackedItem[] | undefined): Map<string, TrackedItem> {
  const map = new Map<string, TrackedItem>();
  for (const it of items ?? []) map.set(it.label, it);
  return map;
}

/** Top-level category (before the first ">"), mirroring Shorts.tsx HierarchyPicker. */
export function topCatOf(category: string | undefined): string {
  const cat = category ?? "";
  const idx = cat.indexOf(">");
  return (idx >= 0 ? cat.slice(0, idx) : cat).trim() || "General";
}

/** Sub-category (after the first ">"), or null. */
export function subCatOf(category: string | undefined): string | null {
  const cat = category ?? "";
  const idx = cat.indexOf(">");
  return idx >= 0 ? cat.slice(idx + 1).trim() : null;
}

/** Leaf display name for a full category path: the sub if present, else the top. */
export function categoryLeaf(category: string | undefined): string {
  return subCatOf(category) ?? topCatOf(category);
}

function pluralize(label: string, count: number): string {
  const l = label.toLowerCase();
  if (count === 1) return l;
  if (/(s|x|z|ch|sh)$/.test(l)) return `${l}es`;
  return `${l}s`;
}

function formatNum(n: number): string {
  // Whole numbers print clean; fractional rounds to 1 decimal.
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}

/** "20 bags (200)" / "2 cases (24)" / "45 pieces". */
export function formatUnitBreakdown(b: UnitBreakdown): string {
  const pieces = formatNum(b.pieces);
  if (b.unitCount == null || b.unitLabel == null) {
    return `${pieces} ${pluralize("piece", b.pieces)}`;
  }
  return `${formatNum(b.unitCount)} ${pluralize(b.unitLabel, b.unitCount)} (${pieces})`;
}

// --- Aggregation ----------------------------------------------------------

export interface RawEntry {
  /** The tracked-item label (item_label for audits, item_detail for shorts). */
  label: string;
  /** Pieces (already weighted at log time). */
  quantity: number;
  /** Category to fall back on when the label isn't in the catalog. */
  fallbackCategory?: string;
}

export interface ItemAgg {
  label: string;
  pieces: number;
  unit: UnitBreakdown;
  item?: TrackedItem;
}

export interface CategoryAgg {
  /** Full category path (e.g. "Bulk > Aprons"). */
  key: string;
  /** Leaf display name (e.g. "Aprons"). */
  name: string;
  pieces: number;
  /** Shared pack label when every item in the group uses the same one, else null. */
  unitLabel: string | null;
  /** Summed pack units when `unitLabel` is set, else null. */
  unitCount: number | null;
  entryCount: number;
  items: ItemAgg[];
}

/**
 * Group raw entries by category, weighting each item into pack units. The
 * category headline shows summed units only when every item in it shares one
 * unit label; otherwise it falls back to a piece total (never cross-unit math).
 */
export function aggregateByCategory(
  entries: RawEntry[],
  catalog: Map<string, TrackedItem>,
): CategoryAgg[] {
  const byCategory = new Map<string, Map<string, { pieces: number; count: number; item?: TrackedItem }>>();

  for (const e of entries) {
    const item = catalog.get(e.label);
    const fullCat = item?.category?.trim() || e.fallbackCategory?.trim() || "General";
    if (!byCategory.has(fullCat)) byCategory.set(fullCat, new Map());
    const itemsMap = byCategory.get(fullCat)!;
    const cur = itemsMap.get(e.label) ?? { pieces: 0, count: 0, item };
    cur.pieces += e.quantity;
    cur.count += 1;
    itemsMap.set(e.label, cur);
  }

  const result: CategoryAgg[] = [];
  for (const [key, itemsMap] of byCategory) {
    const items: ItemAgg[] = [...itemsMap.entries()]
      .map(([label, v]) => ({ label, pieces: v.pieces, unit: unitize(v.pieces, v.item), item: v.item }))
      .sort((a, b) => b.pieces - a.pieces);

    const pieces = items.reduce((s, i) => s + i.pieces, 0);
    const entryCount = [...itemsMap.values()].reduce((s, v) => s + v.count, 0);

    const labels = new Set(items.map((i) => i.unit.unitLabel));
    let unitLabel: string | null = null;
    let unitCount: number | null = null;
    if (items.length > 0 && items.every((i) => i.unit.unitCount != null) && labels.size === 1) {
      unitLabel = items[0].unit.unitLabel;
      unitCount = items.reduce((s, i) => s + (i.unit.unitCount ?? 0), 0);
    }

    result.push({ key, name: categoryLeaf(key), pieces, unitLabel, unitCount, entryCount, items });
  }

  return result.sort((a, b) => b.pieces - a.pieces);
}
