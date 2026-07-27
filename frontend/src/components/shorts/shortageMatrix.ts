/**
 * Pure builder for the shortage item×truck matrix shared by the on-screen
 * ShortageSheetView grid and the server-side PDF export, so both render the
 * exact same numbers. Extracted verbatim from ShortageSheetView's useMemo.
 */
import type { Shortage } from "../../types";
import type { TrackedItem } from "../../api/hooks";
import { findTrackedItem, MAT_SIZES_S, subCatOf, topCatOf } from "./HierarchyPicker";

export interface SheetRow {
  /** Top-level family: Mats / Bulk / Paper / Hygiene … */
  group: string;
  /** The logged category: 3x10 / 3x5 / 4x6 / Towels / Aprons / Paper … */
  category: string;
  detail: string;
  /** Fully-qualified item name, e.g. "3x10 Onyx", "Aprons Black". */
  label: string;
  unit: string | null;
  byTruck: Map<number, number>;
  total: number;
}

// Families read in workflow order; anything unknown sorts after, alphabetically.
export const GROUP_ORDER = ["Mats", "Bulk", "Paper", "Hygiene"];

/**
 * The family a logged category belongs to. Mat sizes (3x10/3x5/4x6) roll up
 * into "Mats"; a catalog SUBcategory (Towels, Aprons, Dust Mops) rolls up into
 * its parent (Bulk); a top-level category is its own family.
 */
export function superGroupOf(category: string, items: TrackedItem[]): string {
  if (MAT_SIZES_S.has(category)) return "Mats";
  for (const i of items) {
    if (subCatOf(i) === category) return topCatOf(i);
  }
  return category;
}

export interface ShortageMatrix {
  trucks: number[];
  rows: SheetRow[];
  truckTotals: Map<number, number>;
  grandTotal: number;
  byTruckItems: Map<number, { row: SheetRow; qty: number }[]>;
}

/**
 * The canonical (item_category, item_detail) a catalog item is logged under —
 * matching HierarchyPicker's onLog: category is the SUBcategory (Towels, or a
 * mat size like 3x10) else the TOP category (Paper); detail is the item label
 * with a mat-size prefix stripped. Every current entry path (By item / By
 * truck) produces this same shape, so cells reconcile exactly.
 */
export function catalogItemKey(item: TrackedItem): { category: string; detail: string } {
  const sub = subCatOf(item);
  const category = sub ?? topCatOf(item);
  const detail =
    sub && MAT_SIZES_S.has(category) && item.label.startsWith(category + " ")
      ? item.label.slice(category.length + 1)
      : item.label;
  return { category, detail };
}

/**
 * Every catalog item as an (empty) SheetRow in sheet order (family → category →
 * label) — the row set for the EDITABLE short sheet, where most cells start
 * blank. Deduped by (category, detail). `byTruck`/`total` are placeholders the
 * editor fills from live shortages.
 */
export function buildCatalogRows(items: TrackedItem[]): SheetRow[] {
  const seen = new Set<string>();
  const rows: SheetRow[] = [];
  for (const item of items) {
    const { category, detail } = catalogItemKey(item);
    const key = `${category}||${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      group: superGroupOf(category, items),
      category,
      detail,
      label: detail ? `${category} ${detail}` : category,
      unit: item.unit_label ?? null,
      byTruck: new Map(),
      total: 0,
    });
  }
  const groupRank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  rows.sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      a.group.localeCompare(b.group) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label),
  );
  return rows;
}

export function buildShortageMatrix(shorts: Shortage[], items: TrackedItem[]): ShortageMatrix {
  const truckSet = new Set<number>();
  const rowMap = new Map<string, SheetRow>();
  for (const s of shorts) {
    truckSet.add(s.truck_number);
    const key = `${s.item_category}||${s.item_detail}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        group: superGroupOf(s.item_category, items),
        category: s.item_category,
        detail: s.item_detail,
        // Always fully qualified — "Onyx" alone is ambiguous across the
        // three mat sizes, "Black" across mats/aprons/towels.
        label: s.item_detail ? `${s.item_category} ${s.item_detail}` : s.item_category,
        unit: findTrackedItem(items, s.item_category, s.item_detail)?.unit_label ?? null,
        byTruck: new Map(),
        total: 0,
      };
      rowMap.set(key, row);
    }
    row.byTruck.set(s.truck_number, (row.byTruck.get(s.truck_number) ?? 0) + s.quantity);
    row.total += s.quantity;
  }
  const trucks = [...truckSet].sort((a, b) => a - b);
  // Ordered by FAMILY (Mats → Bulk → Paper → Hygiene), then by the category
  // inside it (3x10 → 3x5 → 4x6), then by item.
  const groupRank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  const rows = [...rowMap.values()].sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      a.group.localeCompare(b.group) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label),
  );
  const truckTotals = new Map<number, number>();
  for (const row of rows) {
    for (const [n, q] of row.byTruck) truckTotals.set(n, (truckTotals.get(n) ?? 0) + q);
  }
  const grandTotal = [...truckTotals.values()].reduce((a, b) => a + b, 0);
  // Paper view: per-truck item lists (only what that truck was short).
  const byTruckItems = new Map<number, { row: SheetRow; qty: number }[]>();
  for (const n of trucks) {
    byTruckItems.set(
      n,
      rows
        .filter((r) => r.byTruck.has(n))
        .map((r) => ({ row: r, qty: r.byTruck.get(n)! })),
    );
  }
  return { trucks, rows, truckTotals, grandTotal, byTruckItems };
}
