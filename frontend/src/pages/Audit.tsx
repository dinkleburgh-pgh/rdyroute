/**
 * Audit — fast per-truck item logging workflow.
 *
 * Phase 1: TruckPicker — tap a truck tile to begin auditing.
 * Phase 2: ItemLogger  — hierarchical category → sub → item selection.
 */
import { useState, useMemo, useRef, useEffect, type FormEvent } from "react";
import { motion } from "framer-motion";
import AnimateCard from "../components/AnimateCard";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import {
  auditPhotoFileUrl,
  useAuditByRoute,
  useAuditDates,
  useAuditEntries,
  useAuditPhotos,
  useBoard,
  useCreateAuditEntry,
  useDeleteAuditEntry,
  useDeleteAuditPhoto,
  useUploadAuditPhoto,
  useTrackedItems,
  type TrackedItem,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import type { AuditEntry, TruckWithState } from "../types";

// ---------------------------------------------------------------------------
// TruckPicker
// ---------------------------------------------------------------------------

function TruckPicker({
  runDate,
  board,
  entriesByTruck,
  topItems,
  onSelect,
}: {
  runDate: string;
  board: TruckWithState[];
  entriesByTruck: Map<number, AuditEntry[]>;
  topItems: Array<{ route: number; item_label: string; total_qty: number }>;
  onSelect: (t: TruckWithState) => void;
}) {
  const trucks = board
    .filter((t) => t.truck_type !== "Spare")
    .sort((a, b) => a.truck_number - b.truck_number);

  const audited    = trucks.filter((t) =>  entriesByTruck.has(t.truck_number));

  const topSummary = [...topItems]
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, 8);

  const totalItems = [...entriesByTruck.values()].reduce((s, e) => s + e.length, 0);

  return (
    <div className="space-y-5 p-3 md:p-6">
      {/* Stats bar */}
      {trucks.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-green-900/50 px-3 py-1 font-semibold text-green-300">
            {audited.length} / {trucks.length} audited
          </span>
          {totalItems > 0 && (
            <span className="rounded-full bg-slate-800 px-3 py-1 font-semibold text-slate-300">
              {totalItems} items logged
            </span>
          )}
        </div>
      )}

      {/* All trucks — audited ones turn green */}
      {trucks.length > 0 && (
        <div className="grid gap-2 grid-cols-3 sm:grid-cols-6 md:grid-cols-9 lg:grid-cols-12">
          {trucks.map((t, i) => {
            const count = entriesByTruck.get(t.truck_number)?.length ?? 0;
            const isAudited = count > 0;
            return (
              <motion.button
                key={t.truck_number}
                type="button"
                onClick={() => onSelect(t)}
                className={clsx(
                  "flex aspect-square flex-col items-center justify-center rounded-xl text-white shadow transition active:scale-95",
                  isAudited
                    ? "bg-emerald-900/70 ring-1 ring-emerald-700/60 hover:bg-emerald-800/70"
                    : "bg-slate-700 hover:bg-slate-600 hover:shadow-lg",
                )}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.02 }}
                whileHover={{ scale: 1.03 }}
              >
                <span className={clsx("font-black leading-none", isAudited ? "text-xl text-emerald-200" : "text-2xl")}>
                  {t.truck_number}
                </span>
                <span className={clsx("mt-0.5 text-[10px] font-medium", isAudited ? "font-semibold text-emerald-400" : "uppercase tracking-wider text-slate-400")}>
                  {isAudited ? `${count} item${count !== 1 ? "s" : ""}` : t.truck_type}
                </span>
              </motion.button>
            );
          })}
        </div>
      )}

      {trucks.length === 0 && (
        <p className="text-sm text-slate-500">No trucks found for this date.</p>
      )}

      {/* Top items */}
      {topSummary.length > 0 && (
        <AnimateCard className="card space-y-2 self-start">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Top Removed · Last 7 days
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            {topSummary.map((row, i) => (
              <div key={`${row.route}-${row.item_label}`} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-600">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-200">{row.item_label}</p>
                  <p className="text-[10px] text-slate-500">Route {row.route} · x{row.total_qty}</p>
                </div>
              </div>
            ))}
          </div>
        </AnimateCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hierarchy helpers + defaults
// ---------------------------------------------------------------------------

const MAT_SIZES = new Set(["3x10", "3x5", "4x6"]);

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
  ...['WET MOP', '24"', '36"', '46"', '60"'].map((l) => ({
    label: l, qty_default: 1, category: "Bulk > Dust Mops",
  })),
  ...["Grid/Terry", "Glass", "Regular", "Premium", "Small Ink", "Large Ink", "Napkins", "Red Shop", "White Shop", "Fender Covers"].map((l) => ({
    label: l, qty_default: 1, category: "Bulk > Towels",
  })),
];

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
  "Black":      "bg-neutral-950 ring-1 ring-white/10 hover:bg-neutral-800",
  "Onyx":       "bg-stone-800 ring-1 ring-stone-400/20 hover:bg-stone-700",
  "Copper":     "bg-[#b87333] ring-1 ring-amber-300/20 hover:bg-[#a06828]",
  "Indigo":     "bg-indigo-700 ring-1 ring-indigo-400/20 hover:bg-indigo-600",
  "White":      "bg-white ring-1 ring-slate-300 hover:bg-slate-100",
  "Red":        "bg-red-700 ring-1 ring-red-400/20 hover:bg-red-600",
  "Green":      "bg-green-700 ring-1 ring-green-400/20 hover:bg-green-600",
  "Blue":       "bg-blue-700 ring-1 ring-blue-400/20 hover:bg-blue-600",
  "Denim":      "bg-[#1a5fa8] ring-1 ring-blue-400/20 hover:bg-[#1e6dbe]",
  "Red Shop":   "bg-red-700 ring-1 ring-red-400/20 hover:bg-red-600",
  "White Shop": "bg-white ring-1 ring-slate-300 hover:bg-slate-100",
};
const LIGHT_BG_ITEMS = new Set(["White", "White Shop"]);

// ---------------------------------------------------------------------------
// HierarchyPicker — 1–3 step selection inside ItemLogger
// ---------------------------------------------------------------------------

function HierarchyPicker({
  items,
  onLog,
  isPending,
  quickSelect,
  quickKey,
}: {
  items: TrackedItem[];
  onLog: (label: string, qty: number) => void;
  isPending: boolean;
  quickSelect?: { label: string } | null;
  quickKey?: number;
}) {
  const [topCat, setTopCat]       = useState<string | null>(null);
  const [bulkSub, setBulkSub]     = useState<string | null>(null);
  const [pendingItem, setPending] = useState<string | null>(null);
  const [qtyInput, setQtyInput]   = useState("");
  const qtyRef = useRef<HTMLInputElement>(null);

  const topCats = useMemo(() => [...new Set(items.map(topCatOf))], [items]);

  function reset()    { setTopCat(null); setBulkSub(null); setPending(null); setQtyInput(""); }
  function resetSub() { setBulkSub(null); setPending(null); setQtyInput(""); }

  function selectItem(label: string) {
    setPending(label);
    setQtyInput("");
    setTimeout(() => qtyRef.current?.focus(), 50);
  }

  function confirmLog() {
    if (!pendingItem) return;
    const qty = Math.max(1, parseInt(qtyInput, 10) || 1);
    onLog(pendingItem, qty);
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
    if (topCat !== null || pendingItem !== null) return;
    if (topCats.length === 1) {
      setTopCat(topCats[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topCats]);

  // Quick-select: when a recently removed chip is tapped, jump to qty input
  useEffect(() => {
    if (quickSelect) selectItem(quickSelect.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickKey]);

  // Auto-skip: if a top category has exactly 1 item (no subs), jump straight to qty entry
  useEffect(() => {
    if (topCat === null || pendingItem !== null) return;
    const subs = subCatsFor(topCat);
    const flat = flatItemsFor(topCat);
    if (subs.length === 0 && flat.length === 1) {
      selectItem(flat[0].label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topCat]);

  // Auto-skip: if a sub-category has exactly 1 item, jump straight to qty entry
  useEffect(() => {
    if (topCat === null || bulkSub === null || pendingItem !== null) return;
    const subItems = subItemsFor(topCat, bulkSub);
    if (subItems.length === 1) {
      selectItem(subItems[0].label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSub]);

  function ItemGrid({ gridItems, cat, btnClass }: { gridItems: TrackedItem[]; cat: string; btnClass: string }) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {gridItems.map((item) => {
          const disp = MAT_SIZES.has(cat) && item.label.startsWith(cat + " ")
            ? item.label.slice(cat.length + 1)
            : item.label;
          return (
            <button
              key={item.label}
              type="button"
              disabled={isPending}
              onClick={() => selectItem(item.label)}
              className={clsx(
                "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black shadow-lg transition-all active:scale-95 disabled:opacity-50",
                LIGHT_BG_ITEMS.has(disp) ? "text-slate-900" : "text-white",
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

  // Build the selection trail — filter out consecutive duplicate labels (e.g. Soap > Soap)
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
  if (pendingItem !== null) {
    const itemPalette =
      MAT_COLOR_PALETTE[pendingItem] ??
      (bulkSub ? (SUB_PALETTE[bulkSub] ?? null) : null) ??
      (topCat  ? (TOP_PALETTE[topCat]  ?? null) : null) ??
      "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20";
    trailRaw.push({
      label: pendingItem,
      palette: itemPalette,
      onClick: () => { setPending(null); setQtyInput(""); },
    });
  }
  // Deduplicate consecutive identical labels (handles auto-skip cases like Soap > Soap)
  const trail = trailRaw.filter((step, i) =>
    i === 0 || step.label.toLowerCase() !== trailRaw[i - 1].label.toLowerCase()
  );

  const subs      = topCat ? subCatsFor(topCat) : [];
  const flatItems = topCat ? flatItemsFor(topCat) : [];

  return (
    <div className="space-y-1">
      {/* Selection trail */}
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
              <div className="flex items-center">
                <div className="h-px w-3 bg-slate-600" />
                <div className="h-0 w-0 border-b-[5px] border-l-[6px] border-t-[5px] border-b-transparent border-l-slate-500 border-t-transparent" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Current level choices */}
      {pendingItem !== null ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Quantity</span>
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
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-base font-black text-white shadow hover:bg-emerald-500 active:scale-95 transition disabled:opacity-50"
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
      ) : topCat === null ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Category</p>
          <div className="grid grid-cols-3 gap-2">
            {topCats.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setTopCat(cat)}
                className={clsx(
                  "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black text-white shadow-lg transition-all active:scale-95",
                  TOP_PALETTE[cat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      ) : subs.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{MAT_SIZES.has(topCat) ? "Color" : "Item"}</p>
          <ItemGrid
            gridItems={flatItems}
            cat={topCat}
            btnClass={TOP_PALETTE[topCat] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700"}
          />
        </div>
      ) : bulkSub === null ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Subcategory</p>
          <div className="grid grid-cols-3 gap-2">
            {subs.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setBulkSub(sub)}
                className={clsx(
                  "w-full rounded-2xl px-4 py-4 sm:px-7 sm:py-5 text-base sm:text-lg font-black text-white shadow-lg transition-all active:scale-95",
                  SUB_PALETTE[sub] ?? "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20 hover:from-slate-500 hover:to-slate-700",
                )}
              >
                {sub}
              </button>
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
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ItemLogger
// ---------------------------------------------------------------------------

function ItemLogger({
  truck,
  entries,
  runDate,
  onBack,
  recentRemoved,
}: {
  truck: TruckWithState;
  entries: AuditEntry[];
  runDate: string;
  onBack: () => void;
  recentRemoved?: { label: string }[];
}) {
  const create      = useCreateAuditEntry();
  const deleteEntry = useDeleteAuditEntry();
  const { data: trackedRaw = [] } = useTrackedItems();
  const items = trackedRaw.length > 0 ? trackedRaw : DEFAULT_TRACKED_ITEMS;
  const [quickSelect, setQuickSelect] = useState<{ label: string } | null>(null);
  const [quickKey, setQuickKey] = useState(0);

  function handleQuickTap(label: string) {
    setQuickSelect({ label });
    setQuickKey((k) => k + 1);
  }

  const [photosOpen, setPhotosOpen] = useState(false);
  const [note, setNote]           = useState("");
  const [warn, setWarn]           = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [routeOverride, setRouteOverride] = useState(
    truck.state?.oos_spare_route?.toString() ?? "",
  );

  async function logItem(label: string, qty: number) {
    if (create.isPending) return;
    await create.mutateAsync({
      truck_number: truck.truck_number,
      run_date: runDate,
      item_label: label,
      quantity: qty,
      note: note.trim() || undefined,
      warn_on_next_load: warn || undefined,
      ...(routeOverride ? { route_override: Number(routeOverride) } : {}),
    });
    setNote("");
    setWarn(false);
  }

  return (
    <div className="flex min-h-0 flex-col">
       {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-3 backdrop-blur-sm md:px-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition"
        >
          ← Back
        </button>
        <div className="flex-1 flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-xl border-2 border-emerald-600/40 bg-emerald-950/30 px-6 py-2">
            <span className="text-5xl font-black tabular-nums text-emerald-300">#{truck.truck_number}</span>
            {entries.length > 0 && (
              <span className="rounded-full bg-emerald-900/70 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                {entries.length} logged
              </span>
            )}
          </div>
        </div>
        <div className="w-20 shrink-0 md:hidden" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-5 p-3 md:p-6">
        {/* Modifier bar */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setWarn((w) => !w)}
            className={clsx(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              warn
                ? "border-amber-600 bg-amber-900/50 text-amber-300"
                : "border-slate-700 bg-slate-800 text-slate-500 hover:bg-slate-700",
            )}
          >
            warn on next load
          </button>

          <button
            type="button"
            onClick={() => setShowExtra((x) => !x)}
            className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-700 transition"
          >
            {showExtra ? "- less" : "+ note / route"}
          </button>

          <button
            type="button"
            onClick={() => setPhotosOpen((o) => !o)}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              photosOpen
                ? "border-blue-600 bg-blue-900/50 text-blue-300"
                : "border-slate-700 bg-slate-800 text-slate-500 hover:bg-slate-700",
            )}
          >
            photos
          </button>
        </div>

        {/* Photos panel */}
        {photosOpen && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <PhotosPanel runDate={runDate} selectedTruck={truck.truck_number} />
          </div>
        )}

        {/* Extra options */}
        {showExtra && (
          <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-slate-400">Note (applies to next tap)</span>
              <input
                className="input w-full"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note..."
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-slate-400">Route override</span>
              <input
                className="input w-full"
                type="number"
                placeholder={`${truck.truck_number}`}
                value={routeOverride}
                onChange={(e) => setRouteOverride(e.target.value)}
              />
            </label>
          </div>
        )}

        {/* Hierarchical item picker */}
        {recentRemoved && recentRemoved.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recently Removed</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentRemoved.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleQuickTap(item.label)}
                  className="shrink-0 rounded-full bg-emerald-900/40 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-800/60 transition"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <HierarchyPicker items={items} onLog={logItem} isPending={create.isPending} quickSelect={quickSelect} quickKey={quickKey} />

        {/* Logged entries */}
        {entries.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Logged this session
            </h4>
      <div className="flex flex-wrap gap-2">
              {[...entries].reverse().map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 w-full sm:w-auto"
                >
                  <span className="flex-1 min-w-0 text-sm font-semibold text-slate-200">{e.item_label}</span>
                  <span className="shrink-0 text-xl font-black text-white">×{e.quantity}</span>
                  {e.warn_on_next_load && (
                    <span className="shrink-0 text-amber-400 text-sm font-bold" title="Warn on next load">!</span>
                  )}
                  {e.note && (
                    <span className="max-w-[8rem] truncate italic text-sm text-slate-500" title={e.note}>
                      "{e.note}"
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteEntry.mutate(e.id)}
                    className="shrink-0 rounded-lg bg-red-900/60 px-3 py-1.5 text-sm font-semibold text-red-300 hover:bg-red-800/60 transition"
                  >
                    Delete
                  </button>
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
// Root page
// ---------------------------------------------------------------------------

export default function Audit() {
  const [runDate, setRunDate]        = useState(todayIso());
  const [selectedTruck, setSelected] = useState<TruckWithState | null>(null);
  const [searchParams]               = useSearchParams();

  const { data: board        = [] } = useBoard(runDate);

  useEffect(() => {
    if (selectedTruck !== null || board.length === 0) return;
    const truckParam = searchParams.get("truck");
    if (!truckParam) return;
    const num = parseInt(truckParam, 10);
    const match = board.find((t) => t.truck_number === num);
    if (match) setSelected(match);
  }, [board, selectedTruck, searchParams]);
  const { data: entries      = [] } = useAuditEntries(runDate);
  const { data: topItems     = [] } = useAuditByRoute(7);
  const { data: auditDates  = [] } = useAuditDates();

  const entriesByTruck = useMemo(() => {
    const map = new Map<number, AuditEntry[]>();
    for (const e of entries) {
      if (!map.has(e.truck_number)) map.set(e.truck_number, []);
      map.get(e.truck_number)!.push(e);
    }
    return map;
  }, [entries]);

  const recentRemoved = useMemo(() => {
    const seen = new Set<string>();
    const list: { label: string }[] = [];
    for (const e of [...entries].reverse()) {
      if (!seen.has(e.item_label)) {
        seen.add(e.item_label);
        list.push({ label: e.item_label });
      }
    }
    return list.slice(0, 8);
  }, [entries]);

  const truckEntries = selectedTruck
    ? (entriesByTruck.get(selectedTruck.truck_number) ?? [])
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex min-h-0 flex-col"
    >
      {/* Page header */}
      <div className="flex items-center justify-center gap-3 border-b border-slate-800 px-3 py-3 md:justify-start md:px-6">
        <h2 className="text-3xl font-black text-slate-100 md:text-xl md:font-semibold">Audit</h2>
      </div>

      {/* Main content */}
      {selectedTruck === null ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {auditDates.length > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 md:px-6">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</span>
              <select
                className="input py-1 text-sm"
                value={runDate}
                onChange={(e) => { setRunDate(e.target.value); setSelected(null); }}
              >
                <option value={todayIso()}>Today</option>
                {auditDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <TruckPicker
          runDate={runDate}
          board={board}
          entriesByTruck={entriesByTruck}
          topItems={topItems}
          onSelect={(t) => { setSelected(t); }}
        />
        </div>
      ) : (
        <ItemLogger
          truck={selectedTruck}
          entries={truckEntries}
          runDate={runDate}
          onBack={() => setSelected(null)}
          recentRemoved={recentRemoved}
        />
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Photos panel
// ---------------------------------------------------------------------------

function PhotosPanel({
  runDate,
  selectedTruck,
}: {
  runDate: string;
  selectedTruck?: number;
}) {
  const { user }                    = useAuth();
  const { data: photos, isLoading } = useAuditPhotos(runDate);
  const upload                      = useUploadAuditPhoto();
  const del                         = useDeleteAuditPhoto();
  const [truck, setTruck]           = useState("");
  const [caption, setCaption]       = useState("");
  const [file, setFile]             = useState<File | null>(null);
  const [error, setError]           = useState<string | null>(null);

  const effectiveTruck = truck || (selectedTruck?.toString() ?? "");

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effectiveTruck || !file) { setError(selectedTruck ? "File is required." : "Truck # and file are required."); return; }
    try {
      await upload.mutateAsync({
        truck_number: Number(effectiveTruck),
        run_date: runDate,
        file,
        caption,
        uploaded_by: user?.username ?? "",
      });
      setFile(null);
      setCaption("");
      const el = document.getElementById("audit-photo-file") as HTMLInputElement | null;
      if (el) el.value = "";
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Upload failed.";
      setError(msg);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3">
        {!selectedTruck && (
          <label className="text-sm">
            <span className="label">Truck #</span>
            <input type="number" className="input w-20" value={truck}
              placeholder="" onChange={(e) => setTruck(e.target.value)} />
          </label>
        )}
        <label className="flex-1 min-w-[8rem] text-sm">
          <span className="label">Caption</span>
          <input className="input w-full" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="optional" />
        </label>
        <label className="text-sm">
          <span className="label">File (10 MB max)</span>
          <input id="audit-photo-file" type="file" accept="image/*" className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn-primary" disabled={upload.isPending}>Upload</button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {isLoading && <p className="text-xs text-slate-500">Loading photos...</p>}
      {!isLoading && (photos ?? []).length === 0 && (
        <p className="text-xs text-slate-500">No photos for this day.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {(photos ?? []).map((p) => (
          <AnimateCard key={p.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <a href={auditPhotoFileUrl(p.id)} target="_blank" rel="noreferrer">
              <img src={auditPhotoFileUrl(p.id)} alt={p.caption || p.file_name}
                loading="lazy" className="h-32 w-full object-cover" />
            </a>
            <figcaption className="space-y-1 p-2 text-[11px] text-slate-400">
              <p className="font-semibold text-slate-200">
                #{p.truck_number}{p.uploaded_by ? ` by ${p.uploaded_by}` : ""}
              </p>
              {p.caption && <p className="line-clamp-2">{p.caption}</p>}
              <button type="button" className="text-red-400 hover:text-red-300 transition"
                onClick={() => { if (confirm("Delete this photo?")) del.mutate(p.id); }}>
                Delete
              </button>
            </figcaption>
          </AnimateCard>
        ))}
      </div>
    </div>
  );
}
