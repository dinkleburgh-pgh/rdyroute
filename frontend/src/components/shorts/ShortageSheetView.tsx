/**
 * ShortageSheetView — the day's shortages in two readable layouts:
 *
 *   Grid  · trucks across the top, items down the side, quantities in the
 *          cells. Dense by design so a full day fits on one screen.
 *   Sheet · reads like the paper short sheet: one block per truck listing
 *          only the items that truck was actually short.
 */
import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import type { Shortage, TruckWithState } from "../../types";
import { useTrackedItems } from "../../api/hooks";
import { DEFAULT_TRACKED_ITEMS, useCategoryPalette } from "./HierarchyPicker";
import { buildShortageMatrix } from "./shortageMatrix";

export default function ShortageSheetView({
  shorts,
  board,
  layout: layoutProp,
  onLayoutChange,
}: {
  shorts: Shortage[];
  board: TruckWithState[];
  /** Controlled layout. Omit to let the view own its own Grid/Sheet toggle. */
  layout?: "grid" | "paper";
  onLayoutChange?: (l: "grid" | "paper") => void;
}) {
  const { data: trackedRaw = [] } = useTrackedItems();
  const items = trackedRaw.length > 0 ? trackedRaw : DEFAULT_TRACKED_ITEMS;
  const [ownLayout, setOwnLayout] = useState<"grid" | "paper">("grid");
  const layout = layoutProp ?? ownLayout;
  const setLayout = (l: "grid" | "paper") => {
    setOwnLayout(l);
    onLayoutChange?.(l);
  };

  const { trucks, rows, truckTotals, grandTotal, byTruckItems } = useMemo(
    () => buildShortageMatrix(shorts, items),
    [shorts, items],
  );

  const truckTypeByNum = useMemo(
    () => new Map(board.map((t) => [t.truck_number, t.truck_type])),
    [board],
  );

  // One canonical colour per category — the shared palette (seeded from the
  // whole catalog) so a category's dot/chip matches the PDF, audit, Configure
  // Items, and the entry pickers everywhere.
  const palette = useCategoryPalette();
  const dotOf = palette.dotClass;
  const chipOf = palette.chipClass;

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
                {/* w-px + nowrap makes this column shrink to its content (the
                    longest item name) so more truck columns fit on mobile. */}
                <th className="sticky left-0 top-0 z-20 w-px whitespace-nowrap border-b border-r border-slate-700 bg-slate-900 px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Item
                </th>
                {trucks.map((n) => (
                  <th
                    key={n}
                    className="sticky top-0 z-[15] w-10 border-b border-r border-slate-700 bg-slate-900 px-0.5 py-1 text-center font-mono text-sm font-black tabular-nums text-slate-100"
                    title={truckTypeByNum.get(n) ?? undefined}
                  >
                    {n}
                  </th>
                ))}
                <th className="sticky right-0 top-0 z-20 w-12 border-b border-l border-slate-700 bg-slate-900 px-1 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-amber-400">
                  Tot
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const newGroup = row.group !== (ri > 0 ? rows[ri - 1].group : null);
                const newCat = row.category !== (ri > 0 ? rows[ri - 1].category : null);
                return (
                  <Fragment key={`${row.category}-${row.detail}`}>
                    {newGroup && (
                      <tr>
                        <td
                          colSpan={trucks.length + 2}
                          className="border-y border-slate-700 bg-slate-900/95 px-2 py-[3px]"
                        >
                          <span className="sticky left-2 inline-block text-[9px] font-black uppercase tracking-[0.15em] text-slate-300">
                            {row.group}
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr className={ri % 2 ? "bg-slate-900/30" : undefined}>
                      <td
                        className={clsx(
                          "sticky left-0 z-10 w-px whitespace-nowrap border-r border-slate-800 bg-slate-900 px-2 py-0.5",
                          newCat && !newGroup && "border-t border-t-slate-800",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className={clsx("h-2 w-2 shrink-0 rounded-full", dotOf(row.category))}
                            title={row.category}
                          />
                          <span className="max-w-[11rem] truncate font-medium text-slate-200">{row.label}</span>
                          {row.unit && <span className="shrink-0 text-[9px] text-slate-600">{row.unit}s</span>}
                        </span>
                      </td>
                      {trucks.map((n) => {
                        const q = row.byTruck.get(n);
                        return (
                          <td
                            key={n}
                            className={clsx(
                              "border-b border-r border-slate-800/50 px-0.5 py-0.5 text-center font-mono tabular-nums",
                              q != null ? "text-sm font-black text-amber-300" : "text-slate-600",
                            )}
                          >
                            {q ?? "-"}
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-10 border-b border-l border-slate-800 bg-slate-900 px-1 py-0.5 text-center font-mono text-sm font-black tabular-nums text-slate-100">
                        {row.total}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              <tr>
                <td className="sticky bottom-0 left-0 z-20 w-px whitespace-nowrap border-r border-t border-slate-700 bg-slate-900 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400">
                  Truck total
                </td>
                {trucks.map((n) => (
                  <td
                    key={n}
                    className="sticky bottom-0 z-[15] border-t border-r border-slate-700 bg-slate-900 px-0.5 py-1 text-center font-mono text-sm font-black tabular-nums text-amber-300"
                  >
                    {truckTotals.get(n) ?? 0}
                  </td>
                ))}
                <td className="sticky bottom-0 right-0 z-20 border-l border-t border-slate-700 bg-slate-900 px-1 py-1 text-center font-mono text-sm font-black tabular-nums text-amber-300">
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
                  {(byTruckItems.get(n) ?? []).map(({ row, qty }, i, arr) => (
                    <Fragment key={`${row.category}-${row.detail}`}>
                      {row.group !== (i > 0 ? arr[i - 1].row.group : null) && (
                        <li className="bg-slate-800/40 px-2 py-[1px] text-[8px] font-black uppercase tracking-[0.15em] text-slate-400">
                          {row.group}
                        </li>
                      )}
                      <li className="flex items-baseline gap-1.5 px-2 py-1">
                        <span
                          className={clsx("h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full", dotOf(row.category))}
                          title={row.category}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{row.label}</span>
                        <span className="shrink-0 font-mono text-sm font-black tabular-nums text-amber-300">{qty}</span>
                        {row.unit && <span className="shrink-0 text-[9px] text-slate-500">{row.unit}{qty !== 1 ? "s" : ""}</span>}
                      </li>
                    </Fragment>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend: the dot colors are per CATEGORY (3x10 / Towels / …), grouped
          under the family headers the sheet separates by. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {[...new Map(rows.map((r) => [r.group, r])).keys()].map((group) => (
          <span key={group} className="flex flex-wrap items-center gap-1">
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">{group}</span>
            {[...new Set(rows.filter((r) => r.group === group).map((r) => r.category))].sort().map((cat) => (
              <span key={cat} className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", chipOf(cat))}>
                {cat}
              </span>
            ))}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-600">
          Quantities as logged, in each item's unit. Blank = nothing short.
        </span>
      </div>
    </div>
  );
}
