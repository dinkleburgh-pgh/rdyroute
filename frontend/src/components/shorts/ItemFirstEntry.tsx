/**
 * ItemFirstEntry — bulk shortage entry for end-of-shift sheet transcription.
 *
 * The paper sheet reality: ONE item is short for SEVERAL trucks (only the
 * ones that requested it), usually with different quantities. So instead of
 * re-drilling the item for every truck, this mode inverts the flow:
 *
 *   Phase A: pick the item once (same HierarchyPicker as the per-truck mode)
 *   Phase B: tap the trucks that were short it → each gets its own qty field
 *            (tap-truck → type-qty → tap-next-truck rhythm) → one bulk log
 *
 * All rows post atomically via POST /shorts/bulk, then the picker resets for
 * the next item. A session list with per-row undo accumulates below.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import {
  useBulkCreateShortages,
  useDeleteShortage,
  useTrackedItems,
} from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { isScheduledOff } from "../../utils/truckStatus";
import type { Shortage, TruckWithState } from "../../types";
import AnimateCard from "../AnimateCard";
import HierarchyPicker, {
  DEFAULT_TRACKED_ITEMS,
  MAT_SIZES_S,
  colorWordClass,
  findTrackedItem,
  itemTileClass,
  qtyWithUnit,
  useCategoryPalette,
} from "./HierarchyPicker";
import { truckTypeLabel } from "../../utils/truckType";

/**
 * Idle time before a batch posts itself.
 *
 * Deliberately longer than the per-truck picker's 1.2s: the rhythm here is
 * tap-truck → type-qty → tap-next-truck, and a short timer would fire in the
 * gap where someone is reading the next line off the paper sheet, splitting one
 * item's batch across several posts.
 */
const AUTO_LOG_MS = 2500;

interface SessionBatch {
  /** `${category}||${detail}` — one box per ITEM, merged across submits. */
  key: string;
  ids: number[];
  queuedCount: number;
  label: string;
}

export default function ItemFirstEntry({
  runDate,
  board,
  shorts,
  loadDay,
  holiday,
  recentItems,
}: {
  runDate: string;
  board: TruckWithState[];
  shorts: Shortage[];
  loadDay: number;
  holiday: boolean;
  recentItems: { category: string; detail: string }[];
}) {
  const { user } = useAuth();
  const toast = useToast();
  const bulk = useBulkCreateShortages();
  const remove = useDeleteShortage();
  const { data: trackedRaw = [] } = useTrackedItems();
  const palette = useCategoryPalette();
  const items = trackedRaw.length > 0 ? trackedRaw : DEFAULT_TRACKED_ITEMS;

  const [selectedItem, setSelectedItem] = useState<{ category: string; detail: string } | null>(null);
  // Insertion order = tap order, so the qty strip mirrors the sheet.
  const [qtyByTruck, setQtyByTruck] = useState<Map<number, string>>(new Map());
  const [sessionLog, setSessionLog] = useState<SessionBatch[]>([]);
  const [pickerResetKey, setPickerResetKey] = useState(0);
  const lastAddedRef = useRef<number | null>(null);
  const [autoArmed, setAutoArmed] = useState(false);
  /** Set when a post fails, so the idle timer stops retrying the same payload. */
  const autoBlockedRef = useRef(false);
  /**
   * Render-visible mirror of the ref above. There is no manual Log button any
   * more, so a blocked batch would otherwise sit on screen with nothing to send
   * it — this is what surfaces the Retry.
   */
  const [autoFailed, setAutoFailed] = useState(false);

  // Changing the run date invalidates everything in-flight on screen.
  useEffect(() => {
    setSelectedItem(null);
    setQtyByTruck(new Map());
    setSessionLog([]);
    setPickerResetKey((k) => k + 1);
  }, [runDate]);

  // Running routes for this sheet's date — same roster logic as TruckPicker.
  const running = useMemo(() => {
    return board
      .filter((t) => t.truck_type !== "Spare")
      .sort((a, b) => a.truck_number - b.truck_number)
      .filter((t) => t.is_active && (holiday || !isScheduledOff(t, loadDay)));
  }, [board, holiday, loadDay]);

  // Trucks that already have THIS item logged today (dupe warning, not a block).
  const alreadyLoggedQty = useMemo(() => {
    const map = new Map<number, number>();
    if (!selectedItem) return map;
    for (const s of shorts) {
      if (s.item_category === selectedItem.category && s.item_detail === selectedItem.detail) {
        map.set(s.truck_number, (map.get(s.truck_number) ?? 0) + s.quantity);
      }
    }
    return map;
  }, [shorts, selectedItem]);

  // Robust lookup shared with the per-truck picker — resolves the item no
  // matter which historical category shape ("Bulk"/"Towels"/"Bulk > Towels").
  const selTracked = selectedItem
    ? findTrackedItem(items, selectedItem.category, selectedItem.detail)
    : undefined;

  // Mirror the picker button the user just tapped. It renders "Black Aprons"
  // (ItemGrid's colour-word suffix rule), while this read "Aprons Black" — the
  // same colour-first/item-last mismatch as the audit log. Mats keep size first
  // ("4x6 Black"); anything that isn't a colour word keeps category first.
  const itemLabel = selectedItem
    ? !selectedItem.detail
      ? selectedItem.category
      : MAT_SIZES_S.has(selectedItem.category)
        ? `${selectedItem.category} ${selectedItem.detail}`
        : colorWordClass(selectedItem.detail)
          ? `${selectedItem.detail} ${selectedItem.category}`
          : `${selectedItem.category} ${selectedItem.detail}`
    : "";

  function pickItem(category: string, detail: string) {
    autoBlockedRef.current = false;
    setSelectedItem({ category, detail });
    setQtyByTruck(new Map());
  }

  function toggleTruck(n: number) {
    // Any deliberate interaction re-enables auto-log after a failed post.
    autoBlockedRef.current = false;
    setAutoFailed(false);
    setQtyByTruck((prev) => {
      const next = new Map(prev);
      if (next.has(n)) {
        next.delete(n);
      } else {
        next.set(n, String(selTracked?.qty_default ?? 1));
        lastAddedRef.current = n;
      }
      return next;
    });
  }

  async function submit() {
    if (!selectedItem || qtyByTruck.size === 0 || bulk.isPending) return;
    // Quantities are stored as RAW UNITS exactly as typed (2 bags → 2);
    // the "= N pcs" hint is informational only.
    const entries = [...qtyByTruck.entries()].map(([truck_number, rawStr]) => ({
      truck_number,
      quantity: Math.max(1, parseInt(rawStr, 10) || 1),
    }));
    const label = itemLabel;
    try {
      const result = await bulk.mutateAsync({
        run_date: runDate,
        item_category: selectedItem.category,
        item_detail: selectedItem.detail,
        initials: user?.username?.slice(0, 3).toUpperCase() ?? "",
        entries,
      });
      const key = `${selectedItem.category}||${selectedItem.detail}`;
      // Merge into the item's existing box (and float it to the top) instead
      // of stacking a second identical box for the same item.
      const merge = (log: SessionBatch[], addIds: number[], addQueued: number): SessionBatch[] => {
        const prev = log.find((b) => b.key === key);
        const rest = log.filter((b) => b.key !== key);
        return [
          {
            key,
            label,
            ids: [...new Set([...(prev?.ids ?? []), ...addIds])],
            queuedCount: (prev?.queuedCount ?? 0) + addQueued,
          },
          ...rest,
        ];
      };
      if (Array.isArray(result)) {
        setSessionLog((log) => merge(log, result.map((r) => r.id), 0));
        toast.success(`Logged ${label} for ${entries.length} truck${entries.length !== 1 ? "s" : ""}`);
      } else {
        setSessionLog((log) => merge(log, [], entries.length));
        toast.info(`Offline — ${entries.length} row${entries.length !== 1 ? "s" : ""} queued, will sync`);
      }
      setQtyByTruck(new Map());
      setSelectedItem(null);
      setPickerResetKey((k) => k + 1);
      setAutoFailed(false);
    } catch (error: unknown) {
      // The rows are still on screen, so without this the idle timer would
      // re-fire against the same failing payload forever. Any further tap or
      // keystroke clears the block and lets it try again — as does the Retry
      // button this puts on screen.
      autoBlockedRef.current = true;
      setAutoFailed(true);
      setAutoArmed(false);
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : `Could not log ${label}.`);
    }
  }

  // Post the batch once entry goes quiet, so transcribing a sheet is
  // tap-trucks → next item, with no Log press between them. Re-running on every
  // qtyByTruck change means the cleanup cancels the previous timer, so the clock
  // restarts on each tap or keystroke and only a real pause commits.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (qtyByTruck.size === 0 || bulk.isPending || autoBlockedRef.current) {
      setAutoArmed(false);
      return;
    }
    setAutoArmed(true);
    const t = window.setTimeout(() => {
      setAutoArmed(false);
      void submitRef.current();
    }, AUTO_LOG_MS);
    return () => window.clearTimeout(t);
  }, [qtyByTruck, bulk.isPending]);

  // Resolve each box's live rows and drop boxes whose rows were all undone
  // (an emptied box used to linger with no chips).
  const visibleSessionLog = useMemo(() => {
    const byId = new Map(shorts.map((s) => [s.id, s]));
    return sessionLog
      .map((batch) => ({ batch, rows: batch.ids.map((id) => byId.get(id)).filter((s): s is Shortage => s != null) }))
      .filter(({ batch, rows }) => rows.length > 0 || batch.queuedCount > 0);
  }, [sessionLog, shorts]);

  const packSize = selTracked?.pack_size;
  const unitLabel = selTracked?.unit_label;
  const dupeSelected = [...qtyByTruck.keys()].filter((n) => alreadyLoggedQty.has(n));

  const itemChipTile = selectedItem
    ? itemTileClass(selTracked, selectedItem.detail, palette.tileClass(selectedItem.category))
    : { cls: "bg-gradient-to-b from-slate-600 to-slate-800 ring-1 ring-slate-400/20", lightBg: false };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3 md:p-6">
      {selectedItem === null ? (
        <>
          {/* Phase A — pick the item once */}
          {recentItems.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recently Shorted</p>
              {/* Wraps rather than scrolls — see Shorts.tsx recentItems. */}
              <div className="flex flex-wrap gap-2">
                {recentItems.map((item) => (
                  <button
                    key={`${item.category}||${item.detail}`}
                    type="button"
                    onClick={() => pickItem(item.category, item.detail)}
                    className={clsx(
                      "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                      palette.chipClass(item.category),
                    )}
                  >
                    {item.category} {item.detail}
                  </button>
                ))}
              </div>
            </div>
          )}
          <HierarchyPicker
            items={items}
            onLog={() => {}}
            isPending={false}
            onSelectItem={pickItem}
            resetKey={pickerResetKey}
          />
        </>
      ) : (
        <>
          {/* Phase B — tap the trucks that were short it */}
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={clsx(
                "rounded-xl px-5 py-2.5 text-base font-black shadow-md ring-1 ring-white/10",
                itemChipTile.lightBg ? "text-slate-900" : "text-white",
                itemChipTile.cls,
              )}
            >
              {itemLabel}
            </span>
            <button
              type="button"
              onClick={() => { setSelectedItem(null); setQtyByTruck(new Map()); }}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              ← Change item
            </button>
            <p className="w-full text-xs text-slate-500 sm:w-auto">
              Tap every truck that was short this item{packSize ? ` · qty in ${unitLabel ?? "pack"}s, ×${packSize} pieces` : ""}
            </p>
          </div>

          {running.length === 0 ? (
            <p className="text-sm text-slate-500">No routes running for this date.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 md:grid-cols-9 lg:grid-cols-12">
              {running.map((t, i) => {
                const sel = qtyByTruck.has(t.truck_number);
                const had = alreadyLoggedQty.get(t.truck_number);
                return (
                  <motion.button
                    key={t.truck_number}
                    type="button"
                    onClick={() => toggleTruck(t.truck_number)}
                    className={clsx(
                      "flex aspect-square flex-col items-center justify-center rounded-xl text-white shadow transition-colors",
                      sel
                        ? "bg-blue-700 ring-2 ring-blue-400 hover:bg-blue-600"
                        : had != null
                          ? "bg-amber-900/60 ring-1 ring-amber-700/60 hover:bg-amber-800/60"
                          : "bg-slate-700 hover:bg-slate-600",
                    )}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30, delay: i * 0.015 }}
                    whileTap={{ scale: 0.93 }}
                  >
                    <span className="text-2xl font-black leading-none">{t.truck_number}</span>
                    {sel ? (
                      <span className="mt-0.5 text-[10px] font-bold text-blue-200">
                        ×{Math.max(1, parseInt(qtyByTruck.get(t.truck_number) ?? "1", 10) || 1)}
                        {unitLabel ? ` ${unitLabel}${Math.max(1, parseInt(qtyByTruck.get(t.truck_number) ?? "1", 10) || 1) !== 1 ? "s" : ""}` : ""}
                      </span>
                    ) : had != null ? (
                      <span className="mt-0.5 text-[10px] font-semibold text-amber-400">
                        has ×{had}{unitLabel ? ` ${unitLabel}${had !== 1 ? "s" : ""}` : ""}
                      </span>
                    ) : (
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        {truckTypeLabel(t.truck_type)}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}

          {dupeSelected.length > 0 && (
            <p className="text-xs text-amber-400">
              #{dupeSelected.join(", #")} already {dupeSelected.length === 1 ? "has" : "have"} this item logged today —
              logging again adds another row.
            </p>
          )}

          {/* Per-truck quantities, in tap order */}
          {qtyByTruck.size > 0 && (
            <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Quantities{unitLabel ? ` (${unitLabel}s)` : ""}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...qtyByTruck.entries()].map(([n, qty]) => {
                  const raw = Math.max(1, parseInt(qty, 10) || 1);
                  return (
                    <div key={n} className="flex items-center gap-2 rounded-xl bg-slate-800/70 px-3 py-2">
                      <span className="w-12 shrink-0 text-lg font-black tabular-nums text-white">#{n}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        className="input w-full text-center text-lg font-black"
                        value={qty}
                        ref={(el) => {
                          if (el && lastAddedRef.current === n) {
                            el.focus();
                            el.select();
                            lastAddedRef.current = null;
                          }
                        }}
                        onChange={(e) => {
                          autoBlockedRef.current = false;
                          setAutoFailed(false);
                          setQtyByTruck((prev) => new Map(prev).set(n, e.target.value));
                        }}
                        // Enter commits the whole batch now rather than waiting
                        // out the idle timer.
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                            void submit();
                          }
                        }}
                      />
                      {packSize ? (
                        <span className="shrink-0 text-[10px] text-slate-500">= {raw * packSize} pcs</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggleTruck(n)}
                        className="shrink-0 rounded-lg bg-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:bg-red-900/60 hover:text-red-300"
                        title="Remove truck"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* No manual Log button: the batch posts itself once entry goes
                  quiet (and Enter commits immediately), so a confirm tap between
                  every item was pure friction while transcribing a sheet. The
                  only case that still needs a tap is a post that failed — the
                  idle timer deliberately stops retrying a payload the server
                  rejected, so Retry is the way back. */}
              {autoFailed ? (
                <button
                  type="button"
                  onClick={() => {
                    autoBlockedRef.current = false;
                    setAutoFailed(false);
                    void submit();
                  }}
                  disabled={bulk.isPending}
                  className="w-full rounded-xl bg-red-700 px-4 py-3 text-base font-black text-white shadow transition hover:bg-red-600 active:scale-[0.99] disabled:opacity-50"
                >
                  {bulk.isPending
                    ? "Logging…"
                    : `Retry — ${qtyByTruck.size} truck${qtyByTruck.size !== 1 ? "s" : ""} not logged`}
                </button>
              ) : (
                <p className="flex items-center justify-center gap-1.5 py-2 text-center text-xs font-semibold text-amber-300">
                  {bulk.isPending ? (
                    "Logging…"
                  ) : autoArmed ? (
                    <>
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                      Saving…
                    </>
                  ) : (
                    <span className="text-slate-500">Keep tapping trucks — this logs itself once you pause.</span>
                  )}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Session log — everything logged through this mode since page open.
          One box per ITEM; a box disappears once its last row is undone. */}
      {visibleSessionLog.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Logged this session</h4>
          <div className="space-y-2">
            {visibleSessionLog.map(({ batch, rows }) => {
              return (
                <AnimateCard
                  key={batch.key}
                  className="rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-200">{batch.label}</span>
                    {batch.queuedCount > 0 && (
                      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        queued ×{batch.queuedCount}
                      </span>
                    )}
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => rows.forEach((s) => remove.mutate(s.id))}
                        disabled={remove.isPending}
                        className="ml-auto rounded-lg bg-red-900/60 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-800/60 disabled:opacity-50"
                      >
                        Undo all
                      </button>
                    )}
                  </div>
                  {rows.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rows.map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200"
                        >
                          #{s.truck_number} ×{qtyWithUnit(items, s.item_category, s.item_detail, s.quantity)}
                          <button
                            type="button"
                            onClick={() => remove.mutate(s.id)}
                            disabled={remove.isPending}
                            className="text-slate-400 transition hover:text-red-300 disabled:opacity-50"
                            title="Undo this row"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </AnimateCard>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
