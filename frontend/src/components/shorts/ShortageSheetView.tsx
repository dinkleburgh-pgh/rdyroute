/**
 * ShortageSheetView — the day's shortages in two readable layouts:
 *
 *   Grid  · trucks across the top, items down the side, quantities in the
 *          cells. Dense by design so a full day fits on one screen.
 *   Sheet · reads like the paper short sheet: one block per truck listing
 *          only the items that truck was actually short.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Shortage, TruckWithState } from "../../types";
import { useTrackedItemCategories, useTrackedItems } from "../../api/hooks";
import { categoryChipClass, categoryDotClass, DEFAULT_TRACKED_ITEMS, findTrackedItem } from "./HierarchyPicker";

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
  const [layout, setLayout] = useState<"grid" | "paper">("grid");

  const { trucks, rows, truckTotals, grandTotal, byTruckItems } = useMemo(() => {
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
    const trucks = [...truckSet].sort((a, b) => a - b);
    // Rows grouped by category (categories alphabetical, items within too) but
    // rendered as ONE flat list — the category rides along in the item cell so
    // it costs no vertical space.
    const rows = [...rowMap.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label),
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
  }, [shorts, items]);

  const truckTypeByNum = useMemo(
    () => new Map(board.map((t) => [t.truck_number, t.truck_type])),
    [board],
  );

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
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:p-4">
      {/* Summary + layout switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span><span className="font-bold text-slate-200">{trucks.length}</span> trucks</span>
          <span className="text-slate-700">·</span>
          <span><span className="font-bold text-slate-200">{rows.length}</span> items</span>
          <span className="text-slate-700">·</span>
          <span><span className="font-bold text-amber-300">{grandTotal}</span> total qty</span>
        </div>
        <div className="ml-auto flex rounded-lg border border-slate-800 bg-slate-900/70 p-0.5">
          {(["grid", "paper"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                layout === l ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {l === "grid" ? "Grid" : "Sheet"}
            </button>
          ))}
        </div>
      </div>

      {layout === "grid" ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {/* Sticky on the TH itself — a sticky <thead> doesn't hold in
                    every browser, which made the header drift while scrolling. */}
                <th className="sticky left-0 top-0 z-30 w-[10.5rem] min-w-[10.5rem] border-b border-r border-slate-700 bg-slate-900 px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Item
                </th>
                {trucks.map((n) => (
                  <th
                    key={n}
                    className="sticky top-0 z-20 w-10 border-b border-slate-700 bg-slate-900 px-0.5 py-1 text-center font-mono text-sm font-black tabular-nums text-slate-100"
                    title={truckTypeByNum.get(n) ?? undefined}
                  >
                    {n}
                  </th>
                ))}
                <th className="sticky right-0 top-0 z-30 w-12 border-b border-l border-slate-700 bg-slate-900 px-1 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-amber-400">
                  Tot
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const prevCat = ri > 0 ? rows[ri - 1].category : null;
                const newCat = row.category !== prevCat;
                return (
                  <tr key={`${row.category}-${row.detail}`} className={ri % 2 ? "bg-slate-900/30" : undefined}>
                    <td
                      className={clsx(
                        "sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-2 py-0.5",
                        newCat && ri > 0 && "border-t border-t-slate-700",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={clsx("h-2 w-2 shrink-0 rounded-full", categoryDotClass(row.category, catMeta))}
                          title={row.category}
                        />
                        <span className="truncate font-medium text-slate-200">{row.label}</span>
                        {row.unit && <span className="shrink-0 text-[9px] text-slate-600">{row.unit}s</span>}
                      </span>
                    </td>
                    {trucks.map((n) => {
                      const q = row.byTruck.get(n);
                      return (
                        <td
                          key={n}
                          className={clsx(
                            "border-b border-slate-800/50 px-0.5 py-0.5 text-center font-mono tabular-nums",
                            newCat && ri > 0 && "border-t border-t-slate-700",
                            q != null ? "text-sm font-black text-amber-300" : "text-slate-800",
                          )}
                        >
                          {q ?? ""}
                        </td>
                      );
                    })}
                    <td
                      className={clsx(
                        "sticky right-0 z-10 border-b border-l border-slate-800 bg-slate-900 px-1 py-0.5 text-center font-mono text-sm font-black tabular-nums text-slate-100",
                        newCat && ri > 0 && "border-t border-t-slate-700",
                      )}
                    >
                      {row.total}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="sticky bottom-0 left-0 z-30 border-r border-t border-slate-700 bg-slate-900 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400">
                  Truck total
                </td>
                {trucks.map((n) => (
                  <td
                    key={n}
                    className="sticky bottom-0 z-20 border-t border-slate-700 bg-slate-900 px-0.5 py-1 text-center font-mono text-sm font-black tabular-nums text-amber-300"
                  >
                    {truckTotals.get(n) ?? 0}
                  </td>
                ))}
                <td className="sticky bottom-0 right-0 z-30 border-l border-t border-slate-700 bg-slate-900 px-1 py-1 text-center font-mono text-sm font-black tabular-nums text-amber-300">
                  {grandTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        /* Paper layout — one block per truck, exactly what the written sheet
           shows: the route number and the items it came up short. */
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {trucks.map((n) => (
              <div key={n} className="break-inside-avoid rounded-lg border border-slate-800 bg-slate-900/60">
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-800 px-2 py-1">
                  <span className="font-mono text-lg font-black tabular-nums text-slate-100">{n}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                    {truckTotals.get(n) ?? 0} qty
                  </span>
                </div>
                <ul className="divide-y divide-slate-800/60">
                  {(byTruckItems.get(n) ?? []).map(({ row, qty }) => (
                    <li key={`${row.category}-${row.detail}`} className="flex items-baseline gap-1.5 px-2 py-1">
                      <span
                        className={clsx("h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full", categoryDotClass(row.category, catMeta))}
                        title={row.category}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{row.label}</span>
                      <span className="shrink-0 font-mono text-sm font-black tabular-nums text-amber-300">{qty}</span>
                      {row.unit && <span className="shrink-0 text-[9px] text-slate-500">{row.unit}{qty !== 1 ? "s" : ""}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category legend — replaces the per-category header rows the grid used
          to spend a full row on. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[...new Set(rows.map((r) => r.category))].sort().map((cat) => (
          <span key={cat} className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", categoryChipClass(cat, catMeta))}>
            {cat}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-600">
          Quantities as logged, in each item's unit. Blank = nothing short.
        </span>
      </div>
    </div>
  );
}
