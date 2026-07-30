/**
 * Pure builder for the shortage item×truck matrix shared by the on-screen
 * ShortageSheetView grid and the server-side PDF export, so both render the
 * exact same numbers. Extracted verbatim from ShortageSheetView's useMemo.
 */
import type { Shortage, ShortageSheetTemplate } from "../../types";
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

// ---------------------------------------------------------------------------
// Printed-sheet order
//
// The paper sheet's 53 rows have a fixed printed order that has nothing to do
// with alphabetical-within-family. Whoever is transcribing reads straight down
// a truck column, so every surface that shows items — the editable grid, the
// read-only sheet, the report/PDF — should list them in that same order.
//
// The order lives server-side in shortage_sheet_template.py and arrives via
// useShortageSheetTemplates(). These helpers turn it into a rank map keyed by
// the app's CANONICAL (category, detail), which is the join between the printed
// template and what actually gets written to the shortages table.
// ---------------------------------------------------------------------------

/**
 * The canonical (category, detail) a printed template row maps onto.
 *
 * The template speaks its own dialect: `Bulk > Towels` / `Micro Blue`, where
 * live rows use the SUBcategory alone (`Towels`). Prefer a real catalog match
 * so the key is exactly what the pickers write; otherwise fall back to the same
 * sub-else-top reduction catalogItemKey() applies, so both paths agree.
 */
export function templateItemKey(
  templateCategory: string,
  templateDetail: string,
  items: TrackedItem[],
): { category: string; detail: string } {
  const match = findTrackedItem(items, templateCategory, templateDetail);
  if (match) return catalogItemKey(match);
  const idx = templateCategory.indexOf(">");
  const category = (idx >= 0 ? templateCategory.slice(idx + 1) : templateCategory).trim();
  return { category, detail: templateDetail };
}

/** canonical "category||detail" → its position on the printed page. */
export function buildPaperRank(
  template: ShortageSheetTemplate | undefined,
  items: TrackedItem[],
): Map<string, number> {
  const rank = new Map<string, number>();
  if (!template) return rank;
  template.rows.forEach((r, i) => {
    const { category, detail } = templateItemKey(r.item_category, r.item_detail, items);
    const k = `${category}||${detail}`;
    // First occurrence wins — a duplicate mapping must not shuffle the page.
    if (!rank.has(k)) rank.set(k, i);
  });
  return rank;
}

/**
 * Sort comparator: printed order first, with anything not on the paper falling
 * back to the family grouping and sorting after every printed row.
 */
function makeRowComparator(paperRank?: Map<string, number>) {
  const groupRank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  const paperOf = (r: SheetRow) =>
    paperRank?.get(`${r.category}||${r.detail}`) ?? Number.MAX_SAFE_INTEGER;
  return (a: SheetRow, b: SheetRow) => {
    const pa = paperOf(a);
    const pb = paperOf(b);
    if (pa !== pb) return pa - pb;
    return (
      groupRank(a.group) - groupRank(b.group) ||
      a.group.localeCompare(b.group) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label)
    );
  };
}

/**
 * Every catalog item as an (empty) SheetRow in sheet order — printed order when
 * the paper template is supplied, else family → category → label. This is the
 * row set for the EDITABLE short sheet, where most cells start blank. Deduped
 * by (category, detail). `byTruck`/`total` are placeholders the editor fills
 * from live shortages.
 */
export function buildCatalogRows(items: TrackedItem[], paperRank?: Map<string, number>): SheetRow[] {
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
  rows.sort(makeRowComparator(paperRank));
  return rows;
}

/** A row of the printed sheet, carrying the label as it appears on paper. */
export interface PaperRow extends SheetRow {
  /** Template row_key, or a synthetic key for off-template rows. */
  rowKey: string;
  /** Exactly as printed, e.g. "MICRO BLUE - x7432" — including the product
   *  code, which is how the transcriber finds the line on the page. */
  printedLabel: string;
  /** Visual block on the paper (aprons, towels, dust mops …) for dividers. */
  band: string;
}

/**
 * The printed sheet as an ordered row list: every template row in printed
 * order, then any item that has data today but isn't on the paper, so nothing
 * already logged becomes unreachable from this screen.
 */
export function buildPaperRows(
  template: ShortageSheetTemplate | undefined,
  items: TrackedItem[],
  extraRows: SheetRow[] = [],
): PaperRow[] {
  const out: PaperRow[] = [];
  const seen = new Set<string>();
  for (const r of template?.rows ?? []) {
    const { category, detail } = templateItemKey(r.item_category, r.item_detail, items);
    const k = `${category}||${detail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const idx = r.item_category.indexOf(">");
    out.push({
      rowKey: r.row_key,
      printedLabel: r.printed_label,
      band: (idx >= 0 ? r.item_category.slice(idx + 1) : r.item_category).trim(),
      group: superGroupOf(category, items),
      category,
      detail,
      label: detail ? `${category} ${detail}` : category,
      unit: findTrackedItem(items, category, detail)?.unit_label ?? null,
      byTruck: new Map(),
      total: 0,
    });
  }
  for (const r of extraRows) {
    const k = `${r.category}||${r.detail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...r, rowKey: `x:${k}`, printedLabel: r.label.toUpperCase(), band: "Not on sheet" });
  }
  return out;
}

export function buildShortageMatrix(
  shorts: Shortage[],
  items: TrackedItem[],
  paperRank?: Map<string, number>,
): ShortageMatrix {
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
  // Printed-page order when the template is available, else FAMILY (Mats →
  // Bulk → Paper → Hygiene) then category then item.
  const rows = [...rowMap.values()].sort(makeRowComparator(paperRank));
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
