/**
 * ShortSheetEditor — the editable Short Sheet.
 *
 * Mirrors the paper sheet as a live truck × item matrix. You first pick the
 * day's trucks (the sheet's columns), then enter quantities in one of two
 * shapes over the SAME data:
 *   • Grid   — a spreadsheet: items down, picked trucks across, type into cells.
 *   • Guided — item-by-item: walk the catalog in sheet order, fill each item's
 *              trucks, jump around, auto-advance.
 * A Review sub-tab shows the read-only sheet.
 *
 * Every edit saves as-you-go through PUT /shorts/cells (useUpsertShortageCells),
 * which is idempotent: a cell = the canonical total for (truck, item, day), so
 * re-editing never piles up duplicate rows. useShortages is the source of truth.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import {
  useShortageByItem,
  useShortageSheetTemplates,
  useTrackedItems,
  useUpsertShortageCells,
} from "../../api/hooks";
import type { Shortage, TruckWithState } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { isScheduledOff } from "../../utils/truckStatus";
import ConfirmDialog from "../ConfirmDialog";
import ShortageSheetView from "./ShortageSheetView";
import {
  buildCatalogRows,
  buildPaperRank,
  buildPaperRows,
  catalogItemKey,
  superGroupOf,
  GROUP_ORDER,
  type PaperRow,
  type SheetRow,
} from "./shortageMatrix";
import { findTrackedItem, useCategoryPalette } from "./HierarchyPicker";

type Mode = "grid" | "guided" | "paper" | "review";

const keyOf = (category: string, detail: string) => `${category}||${detail}`;
const draftKey = (category: string, detail: string, truck: number) => `${category}|||${detail}|||${truck}`;

export default function ShortSheetEditor({
  shorts,
  board,
  runDate,
  loadDay,
  holiday,
}: {
  shorts: Shortage[];
  board: TruckWithState[];
  runDate: string;
  loadDay: number;
  holiday: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { data: items = [] } = useTrackedItems();
  const upsert = useUpsertShortageCells();
  const palette = useCategoryPalette();

  const [mode, setMode] = useState<Mode>("grid");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [guidedIdx, setGuidedIdx] = useState(0);
  const [paperTruckIdx, setPaperTruckIdx] = useState(0);
  const [confirmClear, setConfirmClear] = useState<SheetRow | null>(null);
  const [truckFilter, setTruckFilter] = useState("");

  const initials = user?.username?.slice(0, 3).toUpperCase() ?? "";

  // The printed sheet's row order, straight off the same template the OCR
  // importer uses — so every surface here lists items in page order.
  const { data: templates = [] } = useShortageSheetTemplates();
  const template = templates[0];
  const paperRank = useMemo(() => buildPaperRank(template, items), [template, items]);

  // --- Rows: full catalog (blank cells) + any extra rows from existing data ---
  //
  // Two orders, deliberately different per mode:
  //   Paper  — strict printed order, because it mirrors the page being read.
  //   Grid /
  //   Guided — grouped by family (Mats → Bulk → Paper → Hygiene) with dividers.
  //            Tried printed order and then most-shorted-first here; both
  //            interleave the families and lose the dividers, which is the
  //            thing that makes a long list scannable.
  const catalogRows = useMemo(() => buildCatalogRows(items), [items]);

  // Existing quantities, normalized onto canonical (category, detail) keys so a
  // short logged under any historical category shape lands on the right row.
  const { qtyByKey, rows, extraRows } = useMemo(() => {
    const qtyByKey = new Map<string, Map<number, number>>();
    const extraMeta = new Map<string, { category: string; detail: string }>();
    for (const s of shorts) {
      const item = findTrackedItem(items, s.item_category, s.item_detail);
      const { category, detail } = item
        ? catalogItemKey(item)
        : { category: s.item_category, detail: s.item_detail };
      const k = keyOf(category, detail);
      if (!qtyByKey.has(k)) qtyByKey.set(k, new Map());
      const perTruck = qtyByKey.get(k)!;
      perTruck.set(s.truck_number, (perTruck.get(s.truck_number) ?? 0) + s.quantity);
      extraMeta.set(k, { category, detail });
    }
    // Rows the catalog doesn't cover (unknown/legacy items) get appended.
    const known = new Set(catalogRows.map((r) => keyOf(r.category, r.detail)));
    const extraRows: SheetRow[] = [];
    for (const [k, meta] of extraMeta) {
      if (known.has(k)) continue;
      extraRows.push({
        group: superGroupOf(meta.category, items),
        category: meta.category,
        detail: meta.detail,
        label: meta.detail ? `${meta.category} ${meta.detail}` : meta.category,
        unit: null,
        byTruck: new Map(),
        total: 0,
      });
    }
    // Family-grouped, with off-template rows sorted in alongside the rest so
    // they land under their own family heading rather than in a tail.
    const groupRank = (g: string) => {
      const i = GROUP_ORDER.indexOf(g);
      return i === -1 ? GROUP_ORDER.length : i;
    };
    const rows = [...catalogRows, ...extraRows].sort(
      (a, b) =>
        groupRank(a.group) - groupRank(b.group) ||
        a.group.localeCompare(b.group) ||
        a.category.localeCompare(b.category) ||
        a.label.localeCompare(b.label),
    );
    return { qtyByKey, rows, extraRows };
  }, [shorts, items, catalogRows]);

  // The printed page, in printed order, for Paper mode.
  const paperRows = useMemo(
    () => buildPaperRows(template, items, extraRows),
    [template, items, extraRows],
  );

  const committedQty = (row: SheetRow, truck: number) =>
    qtyByKey.get(keyOf(row.category, row.detail))?.get(truck) ?? 0;

  const effectiveQty = (row: SheetRow, truck: number): number => {
    const d = drafts[draftKey(row.category, row.detail, truck)];
    if (d != null) return Math.max(0, parseInt(d, 10) || 0);
    return committedQty(row, truck);
  };

  // --- Truck column set (the sheet's trucks), persisted per run-date ---
  const runningRoutes = useMemo(
    () =>
      board
        .filter((t) => t.truck_type !== "Spare" && t.is_active && (holiday || !isScheduledOff(t, loadDay)))
        .map((t) => t.truck_number),
    [board, holiday, loadDay],
  );
  const trucksWithData = useMemo(() => [...new Set(shorts.map((s) => s.truck_number))], [shorts]);

  const storageKey = `short_sheet_trucks_${runDate}`;
  const [picked, setPicked] = useState<number[]>([]);
  const hydrated = useRef<string | null>(null);
  useEffect(() => {
    // (Re)hydrate the picked set whenever the run-date changes.
    if (hydrated.current === runDate) return;
    hydrated.current = runDate;
    let stored: number[] | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) stored = (JSON.parse(raw) as number[]).filter((n) => Number.isFinite(n));
    } catch { /* ignore */ }
    setPicked(stored ?? [...new Set([...runningRoutes, ...trucksWithData])].sort((a, b) => a - b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runDate, storageKey]);

  // Any truck that already has data must always be a column (so nothing hides).
  const columns = useMemo(
    () => [...new Set([...picked, ...trucksWithData])].sort((a, b) => a - b),
    [picked, trucksWithData],
  );

  function persistPicked(next: number[]) {
    const sorted = [...new Set(next)].sort((a, b) => a - b);
    setPicked(sorted);
    try { localStorage.setItem(storageKey, JSON.stringify(sorted)); } catch { /* ignore */ }
  }
  const toggleTruck = (n: number) => persistPicked(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]);

  const candidateTrucks = useMemo(
    () => [...new Set([...runningRoutes, ...trucksWithData, ...picked])].sort((a, b) => a - b),
    [runningRoutes, trucksWithData, picked],
  );

  // --- Save a cell (idempotent upsert) ---
  async function saveCell(row: SheetRow, truck: number) {
    const dk = draftKey(row.category, row.detail, truck);
    const draft = drafts[dk];
    if (draft == null) return;
    const qty = Math.max(0, parseInt(draft, 10) || 0);
    if (qty === committedQty(row, truck)) {
      setDrafts((d) => { const n = { ...d }; delete n[dk]; return n; });
      return;
    }
    try {
      await upsert.mutateAsync({
        run_date: runDate,
        initials,
        initials_ts: Date.now() / 1000,
        entries: [{ truck_number: truck, item_category: row.category, item_detail: row.detail, quantity: qty }],
      });
      qc.invalidateQueries({ queryKey: ["shorts", runDate] });
      setDrafts((d) => { const n = { ...d }; delete n[dk]; return n; }); // committed → drop draft
    } catch {
      toast.error(`Couldn't save #${truck} ${row.label}.`); // keep the draft so it can retry
    }
  }

  async function clearRow(row: SheetRow) {
    const entries = columns
      .filter((t) => committedQty(row, t) > 0)
      .map((t) => ({ truck_number: t, item_category: row.category, item_detail: row.detail, quantity: 0 }));
    if (entries.length === 0) return;
    try {
      await upsert.mutateAsync({ run_date: runDate, initials, initials_ts: Date.now() / 1000, entries });
      qc.invalidateQueries({ queryKey: ["shorts", runDate] });
      setDrafts((d) => {
        const n = { ...d };
        for (const t of columns) delete n[draftKey(row.category, row.detail, t)];
        return n;
      });
    } catch {
      toast.error(`Couldn't clear ${row.label}.`);
    }
  }

  const setDraft = (row: SheetRow, truck: number, v: string) =>
    setDrafts((d) => ({ ...d, [draftKey(row.category, row.detail, truck)]: v.replace(/\D/g, "") }));

  const cellDisplay = (row: SheetRow, truck: number): string => {
    const d = drafts[draftKey(row.category, row.detail, truck)];
    if (d != null) return d;
    const q = committedQty(row, truck);
    return q > 0 ? String(q) : "";
  };

  const rowTotal = (row: SheetRow) => columns.reduce((sum, t) => sum + effectiveQty(row, t), 0);
  const colTotal = (truck: number) => rows.reduce((sum, r) => sum + effectiveQty(r, truck), 0);
  const grandTotal = columns.reduce((sum, t) => sum + colTotal(t), 0);
  const filledRowKeys = useMemo(
    () => new Set(rows.filter((r) => columns.some((t) => effectiveQty(r, t) > 0)).map((r) => keyOf(r.category, r.detail))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, columns, qtyByKey, drafts],
  );

  return (
    <div className="space-y-4 p-3 md:p-6">
      {/* Step 0 — pick the sheet's trucks */}
      <TruckColumnPicker
        candidates={candidateTrucks}
        picked={picked}
        withData={new Set(trucksWithData)}
        filter={truckFilter}
        setFilter={setTruckFilter}
        onToggle={toggleTruck}
        onSelectRunning={() => persistPicked([...new Set([...runningRoutes, ...trucksWithData])])}
        onClear={() => persistPicked([...trucksWithData])}
      />

      {/* Mode switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-lg border border-slate-800 bg-slate-900/70 p-1">
          {(["grid", "guided", "paper", "review"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition",
                mode === m ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {m === "grid" ? "Grid" : m === "guided" ? "Guided" : m === "paper" ? "Paper" : "Review"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {mode === "grid" && (
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              Hide empty
            </label>
          )}
          {mode !== "review" && (
            <span className="text-xs text-slate-500">
              {columns.length} trucks · <span className="font-semibold text-slate-300 tabular-nums">{grandTotal.toLocaleString()}</span> pieces
            </span>
          )}
        </div>
      </div>

      {columns.length === 0 && mode !== "review" ? (
        <p className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          Pick the trucks on the sheet above to start entering shortages.
        </p>
      ) : mode === "grid" ? (
        <GridMode
          rows={hideEmpty ? rows.filter((r) => rowTotal(r) > 0) : rows}
          columns={columns}
          cellDisplay={cellDisplay}
          setDraft={setDraft}
          saveCell={saveCell}
          rowTotal={rowTotal}
          colTotal={colTotal}
          grandTotal={grandTotal}
          dotClass={palette.dotClass}
        />
      ) : mode === "guided" ? (
        <GuidedMode
          rows={rows}
          columns={columns}
          guidedIdx={Math.min(guidedIdx, Math.max(0, rows.length - 1))}
          setGuidedIdx={setGuidedIdx}
          filledRowKeys={filledRowKeys}
          cellDisplay={cellDisplay}
          setDraft={setDraft}
          saveCell={saveCell}
          rowTotal={rowTotal}
          dotClass={palette.dotClass}
          onClearRow={(r) => setConfirmClear(r)}
        />
      ) : mode === "paper" ? (
        <PaperMode
          rows={paperRows}
          columns={columns}
          truckIdx={Math.min(paperTruckIdx, Math.max(0, columns.length - 1))}
          setTruckIdx={setPaperTruckIdx}
          cellDisplay={cellDisplay}
          setDraft={setDraft}
          saveCell={saveCell}
          effectiveQty={effectiveQty}
          colTotal={colTotal}
          dotClass={palette.dotClass}
        />
      ) : (
        <ShortageSheetView shorts={shorts} board={board} />
      )}

      <ConfirmDialog
        open={confirmClear != null}
        variant="danger"
        title={`Clear ${confirmClear?.label}?`}
        description={`Removes this item's quantities from every truck on ${runDate}.`}
        confirmLabel="Clear item"
        onConfirm={() => {
          const r = confirmClear;
          setConfirmClear(null);
          if (r) void clearRow(r);
        }}
        onCancel={() => setConfirmClear(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function TruckColumnPicker({
  candidates,
  picked,
  withData,
  filter,
  setFilter,
  onToggle,
  onSelectRunning,
  onClear,
}: {
  candidates: number[];
  picked: number[];
  withData: Set<number>;
  filter: string;
  setFilter: (v: string) => void;
  onToggle: (n: number) => void;
  onSelectRunning: () => void;
  onClear: () => void;
}) {
  const pickedSet = new Set(picked);
  const filterNum = filter.trim();
  const canAddNew = filterNum !== "" && !candidates.includes(Number(filterNum));
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200">
          Trucks on the sheet <span className="font-normal text-slate-500">({picked.length} picked)</span>
        </h3>
        <div className="flex items-center gap-2">
          <input
            className="input w-24 px-2 py-1 text-xs"
            type="text"
            inputMode="numeric"
            placeholder="add #"
            value={filter}
            onChange={(e) => setFilter(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAddNew) { onToggle(Number(filterNum)); setFilter(""); }
            }}
          />
          <button className="btn-ghost text-xs" onClick={onSelectRunning}>All running</button>
          <button className="btn-ghost text-xs" onClick={onClear}>Clear</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {canAddNew && (
          <button
            onClick={() => { onToggle(Number(filterNum)); setFilter(""); }}
            className="rounded-lg border border-dashed border-blue-500/60 px-2.5 py-1 text-sm font-bold text-blue-300 hover:bg-blue-950/40"
          >
            + #{filterNum}
          </button>
        )}
        {candidates.map((n) => {
          const on = pickedSet.has(n);
          return (
            <button
              key={n}
              onClick={() => onToggle(n)}
              className={clsx(
                "relative rounded-lg border px-2.5 py-1 text-sm font-bold tabular-nums transition-colors",
                on
                  ? "border-blue-500 bg-blue-900/50 text-blue-100"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
              )}
              title={withData.has(n) ? "Has shortages logged" : undefined}
            >
              #{n}
              {withData.has(n) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GridMode({
  rows,
  columns,
  cellDisplay,
  setDraft,
  saveCell,
  rowTotal,
  colTotal,
  grandTotal,
  dotClass,
}: {
  rows: SheetRow[];
  columns: number[];
  cellDisplay: (row: SheetRow, truck: number) => string;
  setDraft: (row: SheetRow, truck: number, v: string) => void;
  saveCell: (row: SheetRow, truck: number) => void;
  rowTotal: (row: SheetRow) => number;
  colTotal: (truck: number) => number;
  grandTotal: number;
  dotClass: (category: string) => string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [scrollW, setScrollW] = useState(0);
  const syncing = useRef(false);

  // Keep the mirrored top scrollbar's width in step with the grid's content.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setScrollW(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns.length, rows.length]);

  // Mirror horizontal scroll between the top bar and the grid (guard the loop).
  const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { syncing.current = false; });
  };

  const focusCell = (r: number, c: number) => {
    const el = document.getElementById(`ssc-${r}-${c}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  };
  let lastGroup = "";
  return (
    <div>
      {/* Mirrored top scrollbar — scroll across trucks without dragging to the
          bottom of a tall grid. Synced both ways with the grid below. */}
      <div
        ref={topRef}
        onScroll={() => syncScroll(topRef.current, gridRef.current)}
        className="overflow-x-auto overflow-y-hidden rounded-t-lg border border-b-0 border-slate-800"
      >
        <div style={{ width: scrollW || 1, height: 1 }} />
      </div>
      <div ref={gridRef} onScroll={() => syncScroll(gridRef.current, topRef.current)} className="overflow-auto rounded-b-lg border border-slate-800">
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 min-w-[10rem] border-b border-r border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-semibold text-slate-400">
              Item
            </th>
            {columns.map((t) => (
              <th key={t} className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 px-2 py-2 text-center text-xs font-bold tabular-nums text-slate-200">
                #{t}
              </th>
            ))}
            <th className="sticky right-0 top-0 z-20 border-b border-l border-slate-800 bg-slate-900 px-2 py-2 text-center text-xs font-semibold text-slate-400">Σ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            const rt = rowTotal(row);
            return (
              <FragmentRow key={`${row.category}||${row.detail}`}>
                {showGroup && (
                  <tr>
                    <td colSpan={columns.length + 2} className="sticky left-0 bg-slate-950/80 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {row.group}
                    </td>
                  </tr>
                )}
                <tr className={clsx(rt > 0 && "bg-slate-900/40")}>
                  <td className="sticky left-0 z-10 min-w-[10rem] border-b border-r border-slate-800 bg-slate-900 px-3 py-1.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", dotClass(row.category))} />
                      {row.label}
                    </span>
                  </td>
                  {columns.map((t, ci) => (
                    <td key={t} className="border-b border-slate-800/60 px-1 py-1 text-center">
                      <input
                        id={`ssc-${ri}-${ci}`}
                        className="w-12 rounded bg-slate-800/60 px-1 py-1 text-center text-sm tabular-nums text-white outline-none focus:bg-slate-700 focus:ring-1 focus:ring-blue-500"
                        type="text"
                        inputMode="numeric"
                        value={cellDisplay(row, t)}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setDraft(row, t, e.target.value)}
                        onBlur={() => saveCell(row, t)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); saveCell(row, t); focusCell(ri + 1, ci); }
                        }}
                      />
                    </td>
                  ))}
                  <td className="border-b border-l border-slate-800 px-2 py-1 text-center text-xs font-bold tabular-nums text-slate-400">
                    {rt || ""}
                  </td>
                </tr>
              </FragmentRow>
            );
          })}
          <tr>
            <td className="sticky left-0 z-10 border-t border-r border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300">Totals</td>
            {columns.map((t) => (
              <td key={t} className="border-t border-slate-700 bg-slate-900/60 px-2 py-2 text-center text-xs font-bold tabular-nums text-slate-200">
                {colTotal(t) || ""}
              </td>
            ))}
            <td className="sticky right-0 z-10 border-t border-l border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs font-black tabular-nums text-white">
              {grandTotal || ""}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Small helper so a group header + its data row share one keyed fragment.
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ---------------------------------------------------------------------------

/**
 * PaperMode — transcribe one truck column exactly as it reads on paper.
 *
 * The sheet is truck-major and sparse: 16 truck columns, 53 item rows in a
 * fixed printed order, and only a handful of cells inked per column. Grid gets
 * the data shape right but sorts rows alphabetically within family, so the eye
 * has to hunt; Guided walks items, which is the wrong axis for transcription.
 *
 * Here the trucks are pills (the sheet's columns) and the body is the printed
 * row list, in printed order, with the PRINTED label including its product code
 * — the string the transcriber is actually looking at. Enter commits and drops
 * to the next row, so a column is `digit, Enter, digit, Enter` straight down the
 * page. Rows the paper doesn't have appear last, under a divider, so anything
 * already logged off-template stays reachable.
 */
function PaperMode({
  rows,
  columns,
  truckIdx,
  setTruckIdx,
  cellDisplay,
  setDraft,
  saveCell,
  effectiveQty,
  colTotal,
  dotClass,
}: {
  rows: PaperRow[];
  columns: number[];
  truckIdx: number;
  setTruckIdx: (n: number) => void;
  cellDisplay: (row: SheetRow, truck: number) => string;
  setDraft: (row: SheetRow, truck: number, v: string) => void;
  saveCell: (row: SheetRow, truck: number) => void;
  effectiveQty: (row: SheetRow, truck: number) => number;
  colTotal: (truck: number) => number;
  dotClass: (category: string) => string;
}) {
  const truck = columns[truckIdx];
  const focusRow = (i: number) => {
    const el = document.getElementById(`psc-${i}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  };

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">The printed sheet template hasn't loaded yet.</p>;
  }
  if (truck == null) return <p className="text-sm text-slate-500">Pick the sheet's trucks above.</p>;

  // How many rows this truck has inked — the pill's badge, so you can see at a
  // glance which columns you've already done.
  const filledFor = (t: number) => rows.reduce((n, r) => n + (effectiveQty(r, t) > 0 ? 1 : 0), 0);

  let lastBand = "";
  return (
    <div className="space-y-3">
      {/* Truck pills — the sheet's columns. */}
      <div className="flex flex-wrap gap-1.5">
        {columns.map((t, i) => {
          const filled = filledFor(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTruckIdx(i)}
              className={clsx(
                "rounded-lg border px-2.5 py-1 text-sm font-bold tabular-nums transition-colors",
                i === truckIdx
                  ? "border-blue-500 bg-blue-900/50 text-blue-100"
                  : filled > 0
                    ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
              )}
            >
              #{t}
              {filled > 0 && <span className="ml-1 text-[10px] font-semibold opacity-80">{filled}</span>}
            </button>
          );
        })}
      </div>

      {/* Sticky column header — which truck, and its running total. */}
      <div className="sticky top-0 z-20 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 shadow-lg">
        <button className="btn-ghost shrink-0 px-3" disabled={truckIdx === 0} onClick={() => setTruckIdx(truckIdx - 1)}>
          ←
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-xl font-black tabular-nums text-blue-300">#{truck}</div>
          <div className="text-[10px] text-slate-500">
            Column {truckIdx + 1} / {columns.length} · <span className="tabular-nums">{colTotal(truck)}</span> pieces
          </div>
        </div>
        <button
          className="btn-primary shrink-0 px-3"
          disabled={truckIdx >= columns.length - 1}
          onClick={() => setTruckIdx(truckIdx + 1)}
        >
          Next →
        </button>
      </div>

      {/* The printed page, top to bottom. */}
      <div className="overflow-hidden rounded-lg border border-slate-800">
        {rows.map((row, i) => {
          const showBand = row.band !== lastBand;
          lastBand = row.band;
          const qty = effectiveQty(row, truck);
          return (
            <FragmentRow key={row.rowKey}>
              {showBand && (
                <div className="bg-slate-950/80 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {row.band}
                </div>
              )}
              <div
                className={clsx(
                  "flex items-center gap-2 border-b border-slate-800/60 px-3 py-1.5",
                  qty > 0 && "bg-slate-900/50",
                )}
              >
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", dotClass(row.category))} />
                <label
                  htmlFor={`psc-${i}`}
                  className={clsx(
                    "min-w-0 flex-1 cursor-pointer truncate text-xs font-medium",
                    qty > 0 ? "text-slate-100" : "text-slate-400",
                  )}
                  title={row.printedLabel}
                >
                  {row.printedLabel}
                </label>
                <input
                  id={`psc-${i}`}
                  className="w-16 shrink-0 rounded bg-slate-800/60 px-2 py-1 text-center text-sm font-semibold tabular-nums text-white outline-none focus:bg-slate-700 focus:ring-1 focus:ring-blue-500"
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="next"
                  value={cellDisplay(row, truck)}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setDraft(row, truck, e.target.value)}
                  onBlur={() => saveCell(row, truck)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    saveCell(row, truck);
                    focusRow(i + 1); // straight down the page
                  }}
                />
              </div>
            </FragmentRow>
          );
        })}
      </div>

      {truckIdx < columns.length - 1 && (
        <button className="btn-primary w-full py-3 font-semibold" onClick={() => setTruckIdx(truckIdx + 1)}>
          Next truck → #{columns[truckIdx + 1]}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GuidedMode({
  rows,
  columns,
  guidedIdx,
  setGuidedIdx,
  filledRowKeys,
  cellDisplay,
  setDraft,
  saveCell,
  rowTotal,
  dotClass,
  onClearRow,
}: {
  rows: SheetRow[];
  columns: number[];
  guidedIdx: number;
  setGuidedIdx: (n: number) => void;
  filledRowKeys: Set<string>;
  cellDisplay: (row: SheetRow, truck: number) => string;
  setDraft: (row: SheetRow, truck: number, v: string) => void;
  saveCell: (row: SheetRow, truck: number) => void;
  rowTotal: (row: SheetRow) => number;
  dotClass: (category: string) => string;
  onClearRow: (row: SheetRow) => void;
}) {
  const row = rows[guidedIdx];
  if (!row) return <p className="text-sm text-slate-500">No items configured.</p>;
  const rt = rowTotal(row);

  return (
    <div className="space-y-3">
      {/* Sticky nav — item name + Prev/Next stay visible while filling trucks below */}
      <div className="sticky top-0 z-20 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 shadow-lg">
        <button className="btn-ghost shrink-0 px-3" disabled={guidedIdx === 0} onClick={() => setGuidedIdx(guidedIdx - 1)}>
          ←
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-bold text-slate-100">
            <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", dotClass(row.category))} />
            <span className="truncate">{row.label}</span>
          </div>
          <div className="text-[10px] text-slate-500">
            Item {guidedIdx + 1} / {rows.length} · <span className="tabular-nums">{rt}</span> total
          </div>
        </div>
        <button className="btn-primary shrink-0 px-3" disabled={guidedIdx >= rows.length - 1} onClick={() => setGuidedIdx(guidedIdx + 1)}>
          Next →
        </button>
      </div>

      {/* Truck inputs for the current item */}
      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {columns.map((t) => (
            <label key={t} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1.5">
              <span className="w-12 shrink-0 text-sm font-extrabold tabular-nums text-white">#{t}</span>
              <input
                className="w-full rounded bg-slate-800/60 px-2 py-1 text-center text-sm tabular-nums text-white outline-none focus:bg-slate-700 focus:ring-1 focus:ring-blue-500"
                type="text"
                inputMode="numeric"
                value={cellDisplay(row, t)}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(row, t, e.target.value)}
                onBlur={() => saveCell(row, t)}
              />
            </label>
          ))}
        </div>

        {rt > 0 && (
          <div className="flex justify-end">
            <button className="text-[11px] text-slate-500 hover:text-red-400" onClick={() => onClearRow(row)}>
              clear item
            </button>
          </div>
        )}
      </div>

      {/* Jump list — tap any item to go straight to it */}
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r, i) => {
          const filled = filledRowKeys.has(`${r.category}||${r.detail}`);
          return (
            <button
              key={`${r.category}||${r.detail}`}
              onClick={() => setGuidedIdx(i)}
              className={clsx(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                i === guidedIdx
                  ? "border-blue-500 bg-blue-900/50 text-blue-100"
                  : filled
                    ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-500",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
