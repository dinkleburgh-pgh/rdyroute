/**
 * ShortageSheetView — the day's shortages as a readable spreadsheet:
 * one column per truck, one row per item (grouped by category), quantities
 * in the cells, with per-truck and per-item totals. Mirrors the paper
 * short sheet the crew writes, but live.
 */
import { useMemo } from "react";
import clsx from "clsx";
import type { Shortage, TruckWithState } from "../../types";
import { useTrackedItemCategories, useTrackedItems } from "../../api/hooks";
import { categoryChipClass, DEFAULT_TRACKED_ITEMS, findTrackedItem } from "./HierarchyPicker";

interface SheetRow {
  category: string;
  detail: string;
  label: string;
  unit: string | null;
  byTruck: Map<number, number>;
  total: number;
}

export default function ShortageSheetView({
  shorts,
  board,
}: {
  shorts: Shortage[];
  board: TruckWithState[];
}) {
  const { data: catMeta } = useTrackedItemCategories();
  const { data: trackedRaw = [] } = useTrackedItems();
  const items = trackedRaw.length > 0 ? trackedRaw : DEFAULT_TRACKED_ITEMS;

  const { trucks, groups, truckTotals, grandTotal } = useMemo(() => {
    const truckSet = new Set<number>();
    const rowMap = new Map<string, SheetRow>();
    for (const s of shorts) {
      truckSet.add(s.truck_number);
      const key = `${s.item_category}||${s.item_detail}`;
      let row = rowMap.get(key);
      if (!row) {
        row = {
          category: s.item_category,
          detail: s.item_detail,
          label: s.item_detail || s.item_category,
          unit: findTrackedItem(items, s.item_category, s.item_detail)?.unit_label ?? null,
          byTruck: new Map(),
          total: 0,
        };
        rowMap.set(key, row);
      }
      row.byTruck.set(s.truck_number, (row.byTruck.get(s.truck_number) ?? 0) + s.quantity);
      row.total += s.quantity;
    }
    // Column order: board order (numeric) for trucks that have shortages.
    const boardOrder = board
      .map((t) => t.truck_number)
      .filter((n) => truckSet.has(n));
    for (const n of [...truckSet]) if (!boardOrder.includes(n)) boardOrder.push(n);
    boardOrder.sort((a, b) => a - b);
    // Group rows by category, categories sorted, rows alphabetical within.
    const byCategory = new Map<string, SheetRow[]>();
    for (const row of rowMap.values()) {
      if (!byCategory.has(row.category)) byCategory.set(row.category, []);
      byCategory.get(row.category)!.push(row);
    }
    const groups = [...byCategory.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, rows]) => ({
        category,
        rows: rows.sort((a, b) => a.label.localeCompare(b.label)),
      }));
    const truckTotals = new Map<number, number>();
    for (const row of rowMap.values()) {
      for (const [n, q] of row.byTruck) truckTotals.set(n, (truckTotals.get(n) ?? 0) + q);
    }
    const grandTotal = [...truckTotals.values()].reduce((a, b) => a + b, 0);
    return { trucks: boardOrder, groups, truckTotals, grandTotal };
  }, [shorts, items, board]);

  if (shorts.length === 0) {
    return (
      <div className="p-6">
        <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
          No shortages logged for this date yet — the sheet fills in as shorts are logged.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>
          <span className="font-bold text-slate-200">{trucks.length}</span> truck{trucks.length !== 1 ? "s" : ""}
        </span>
        <span>·</span>
        <span>
          <span className="font-bold text-slate-200">{groups.reduce((n, g) => n + g.rows.length, 0)}</span> item{groups.reduce((n, g) => n + g.rows.length, 0) !== 1 ? "s" : ""}
        </span>
        <span>·</span>
        <span>
          <span className="font-bold text-amber-300">{grandTotal}</span> total qty
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-800">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 min-w-[11rem] border-b border-r border-slate-700 bg-slate-900 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Item
              </th>
              {trucks.map((n) => (
                <th key={n} className="min-w-[3.5rem] border-b border-slate-700 bg-slate-900 px-2 py-2 text-center font-mono text-base font-black tabular-nums text-slate-100">
                  {n}
                </th>
              ))}
              <th className="min-w-[4rem] border-b border-l border-slate-700 bg-slate-900 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-amber-400">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <>
                <tr key={`cat-${g.category}`}>
                  <td
                    colSpan={trucks.length + 2}
                    className="border-b border-slate-800 bg-slate-900/80 px-3 py-1.5"
                  >
                    <span className={clsx("inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold", categoryChipClass(g.category, catMeta))}>
                      {g.category}
                    </span>
                  </td>
                </tr>
                {g.rows.map((row, ri) => (
                  <tr key={`${g.category}-${row.detail}`} className={ri % 2 === 0 ? "bg-slate-950/40" : "bg-slate-900/30"}>
                    <td className="sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-900 px-3 py-1.5 font-medium text-slate-200">
                      {row.label}
                      {row.unit && <span className="ml-1.5 text-[10px] font-normal text-slate-500">({row.unit}s)</span>}
                    </td>
                    {trucks.map((n) => {
                      const q = row.byTruck.get(n);
                      return (
                        <td
                          key={n}
                          className={clsx(
                            "border-b border-slate-800/70 px-2 py-1.5 text-center font-mono text-base tabular-nums",
                            q != null ? "font-black text-amber-300" : "text-slate-800",
                          )}
                        >
                          {q ?? "·"}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-800 px-2 py-1.5 text-center font-mono font-black tabular-nums text-slate-100">
                      {row.total}
                    </td>
                  </tr>
                ))}
              </>
            ))}
            {/* Per-truck totals */}
            <tr>
              <td className="sticky left-0 z-10 border-r border-t border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                Truck total
              </td>
              {trucks.map((n) => (
                <td key={n} className="border-t border-slate-700 bg-slate-900/70 px-2 py-2 text-center font-mono text-base font-black tabular-nums text-amber-300">
                  {truckTotals.get(n) ?? 0}
                </td>
              ))}
              <td className="border-l border-t border-slate-700 bg-slate-900/70 px-2 py-2 text-center font-mono text-base font-black tabular-nums text-amber-300">
                {grandTotal}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-600">
        Quantities are as logged (in each item's unit — bags, bundles, rolls shown next to the item name).
        Rows group by category; · means no shortage for that truck.
      </p>
    </div>
  );
}
