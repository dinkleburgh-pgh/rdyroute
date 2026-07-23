/**
 * LiveReport — a read-only, auto-refreshing run-day report that pulls the day's
 * Unload and Load activity into one place.
 *
 *   UNLOAD · the batch cards (which trucks landed in which batch + wearer load)
 *   LOAD   · routes that were covered, load times, shortages, and audit info
 *
 * It owns a runDate (defaulting to today, seedable via ?run_date=) so it can
 * report any past day too. Every section reads the same per-run-date hooks the
 * workflow pages use, so it stays live off the existing websocket + polling
 * (board 5s, batches 10s, spares/route-swaps 10s, shortages via WS). The audit
 * query has no live channel of its own, so we poke it on an interval here.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { format } from "date-fns";
import clsx from "clsx";
import PageHeader from "../components/PageHeader";
import AnimateCard from "../components/AnimateCard";
import OverbatchedChip from "../components/OverbatchedChip";
import { categoryDotClass, qtyWithUnit } from "../components/shorts/HierarchyPicker";
import { formatDuration } from "../components/LiveInProgress";
import { workdayNumbers } from "../components/Clock";
import { todayIso } from "../api/client";
import { formatRunDate } from "../utils/dates";
import {
  useBatchSummary,
  useBoard,
  useSettings,
  useShortages,
  useAuditEntries,
  useTrackedItems,
  useSpareAssignments,
  useRouteSwaps,
  usePaceAverage,
  useLoadDayOverride,
  useUnloadsDayOverride,
  useHolidayUnload,
  usePrevDayCarriers,
  usePrevDaySplitHelpers,
  useTrackedItemCategories,
  type TrackedItem,
} from "../api/hooks";
import { buildOperationalDayContext, countUnloadedFromContext } from "../utils/truckStatus";
import type { AuditEntry, BatchSummary, RecurringRouteSwap, Shortage } from "../types";

const DEFAULT_WEARER_CAP = 1800;

// Colour bands for a batch's wearer load — mirrors Batches.tsx capacityColor.
// Always graded against the configured cap, even when the cap is not enforced
// (no-cap mode), so the bar still shows how close to a full batch it is.
function capacityColor(total: number, _noCap: boolean, cap: number) {
  if (total >= cap * 0.95) return { bar: "bg-red-500", text: "text-red-400" };
  if (total >= cap * 0.7) return { bar: "bg-amber-500", text: "text-amber-400" };
  return { bar: "bg-emerald-500", text: "text-emerald-400" };
}

// Top-level audit category = text before the first ">" in the "Top > Sub"
// category string (mirrors Audit.tsx topCatOf).
function topCatOf(item: TrackedItem | undefined): string {
  const cat = item?.category ?? "";
  const idx = cat.indexOf(">");
  return (idx >= 0 ? cat.slice(0, idx) : cat).trim() || "General";
}

const TOP_CAT_DOT: Record<string, string> = {
  "3x10": "bg-sky-500",
  "3x5": "bg-violet-500",
  "4x6": "bg-emerald-500",
  Paper: "bg-orange-500",
  Bulk: "bg-rose-500",
  Hygiene: "bg-cyan-500",
  General: "bg-slate-500",
};

function clock(epochSec: number | null | undefined): string {
  return epochSec ? format(new Date(epochSec * 1000), "h:mm a") : "—";
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={clsx("mt-0.5 text-xl font-bold leading-tight tabular-nums", tone ?? "text-ink")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p> : null}
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{eyebrow}</p>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-hairline bg-surface/50 p-4 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

function BatchMiniCard({ batch, cap, noCap }: { batch: BatchSummary; cap: number; noCap: boolean }) {
  const { bar, text } = capacityColor(batch.total_wearers, noCap, cap);
  // Fill is always proportional to the wearer cap so an empty batch reads as
  // an empty outline. With enforcement off (noCap) the configured cap still
  // serves as the visual reference — forcing 100% painted every bar full even
  // for empty batches.
  const pct = Math.min(100, Math.round((batch.total_wearers / Math.max(cap, 1)) * 100));
  return (
    <AnimateCard className="card flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
          Batch {batch.batch_number}
          <OverbatchedChip show={batch.total_wearers > cap} />
        </span>
        <span className={clsx("font-mono text-xs font-semibold tabular-nums", text)}>
          {batch.total_wearers.toLocaleString()}
          {noCap ? "" : ` / ${cap.toLocaleString()}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full border border-hairline bg-surface-3">
        <div className={clsx("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
      {batch.trucks.length === 0 ? (
        <p className="text-[11px] text-ink-faint">Empty</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {batch.trucks.map((t) => (
            <span key={t.truck_number} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
              <span className="font-mono font-bold tabular-nums text-ink">#{t.truck_number}</span>
              <span className="text-ink-faint">({t.wearers})</span>
            </span>
          ))}
        </div>
      )}
    </AnimateCard>
  );
}

export default function LiveReport() {
  const [params] = useSearchParams();
  const [runDate, setRunDate] = useState(params.get("run_date") ?? todayIso());
  const isToday = runDate === todayIso();

  // Day numbers for the header, with the same per-run-date overrides Load/Unload use.
  const dayDate = useMemo(() => new Date(runDate + "T12:00:00"), [runDate]);
  const { loadDay: computedLoadDay, unloadsDay: computedUnloadsDay } = workdayNumbers(dayDate);
  const { data: loadDayOverride } = useLoadDayOverride(runDate);
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const loadDay = loadDayOverride ?? computedLoadDay;
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;

  // Settings-derived caps/flags.
  const { data: settings = [] } = useSettings();
  const noCap = settings.some((s) => s.key === "batch_no_cap" && s.value === true);
  const batchingDisabled = settings.some((s) => s.key === "batching_disabled" && s.value === true);
  const cap = useMemo(() => {
    const v = Number(settings.find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEARER_CAP;
  }, [settings]);
  const recurringRules = useMemo(() => {
    // Guard against a non-array value (the setting is admin-editable) so
    // isRecurring's `.some(...)` can't throw and crash the coverage section.
    const row = settings.find((s) => s.key === "recurring_route_swaps");
    return Array.isArray(row?.value) ? (row!.value as RecurringRouteSwap[]) : [];
  }, [settings]);

  // Per-run-date data (all keyed by runDate; poll/WS keep them live).
  const { data: board = [] } = useBoard(runDate);
  const { data: batches = [] } = useBatchSummary(runDate);
  const { data: shorts = [] } = useShortages(runDate);
  const { data: auditEntries = [] } = useAuditEntries(runDate);
  const { data: trackedItems = [] } = useTrackedItems();
  const { data: trackedCatMeta } = useTrackedItemCategories();
  const { data: spares = [] } = useSpareAssignments(runDate);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const { data: pace } = usePaceAverage(30);

  // The audit query has no websocket/poll of its own — refresh it on an interval
  // so this "live" report doesn't show a stale audit section.
  const qc = useQueryClient();
  useEffect(() => {
    const id = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["audit", runDate] });
    }, 20000);
    return () => window.clearInterval(id);
  }, [qc, runDate]);

  const boardByNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);

  // ---- Unload / batches ----
  const trucksBatched = useMemo(() => batches.reduce((n, b) => n + b.trucks.length, 0), [batches]);
  const totalWearers = useMemo(() => batches.reduce((n, b) => n + b.total_wearers, 0), [batches]);
  const batchesUsed = useMemo(() => batches.filter((b) => b.trucks.length > 0).length, [batches]);
  // Same counting as the Unload page: unload-day roster only, pure day-init
  // seeds pending (not done), "loaded" still counts as unloaded-then-moved-on.
  // The old whole-fleet raw-status filter started the day at the seed count
  // and climbed past the roster size as trucks loaded overnight.
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const unloadCtx = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload", prevSplitHelpers),
    [board, unloadsDay, holidayUnload, prevSplitHelpers],
  );
  const prevDayCarriers = usePrevDayCarriers(runDate, board);
  const unloadedCount = countUnloadedFromContext(unloadCtx, prevDayCarriers);
  const unloadRosterSize = unloadCtx.activeTrucks.length;

  // ---- Coverage ("routes covered") ----
  const coverageRows = useMemo(() => {
    type Row = { routeTruck: number; loadOnTruck: number; type: string; returned: boolean };
    const rows: Row[] = [];
    const seen = new Set<string>();
    const add = (routeTruck: number, loadOnTruck: number, type: string, returned = false) => {
      const key = `${routeTruck}->${loadOnTruck}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ routeTruck, loadOnTruck, type, returned });
    };
    for (const rs of routeSwaps) add(rs.route_truck, rs.load_on_truck, "Route swap");
    // Today's live view shows only still-active spare coverage; a historical
    // report also includes spares that were later returned, since the freight
    // did load on that spare that day (a returned spare keeps its run_date, so
    // filtering it out would silently drop real coverage from past reports).
    for (const s of spares) {
      if (isToday && s.returned) continue;
      add(s.covering_route_truck, s.spare_truck_number, "Spare cover", s.returned);
    }
    return rows.sort((a, b) => a.routeTruck - b.routeTruck);
  }, [routeSwaps, spares, isToday]);

  const isRecurring = (routeTruck: number, loadOnTruck: number) =>
    recurringRules.some((r) => r.route_truck === routeTruck && r.load_on_truck === loadOnTruck && r.days.includes(loadDay));

  // ---- Load times ----
  const finished = useMemo(
    () =>
      board
        .filter((t) => t.state?.status === "loaded" && t.state?.load_duration_seconds != null)
        .sort((a, b) => (a.state?.load_finish_time ?? 0) - (b.state?.load_finish_time ?? 0)),
    [board],
  );
  const durations = useMemo(() => finished.map((t) => t.state!.load_duration_seconds!), [finished]);
  const dayAvg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const fastest = useMemo(
    () => (finished.length ? finished.reduce((m, t) => (t.state!.load_duration_seconds! < m.state!.load_duration_seconds! ? t : m)) : null),
    [finished],
  );
  const slowest = useMemo(
    () => (finished.length ? finished.reduce((m, t) => (t.state!.load_duration_seconds! > m.state!.load_duration_seconds! ? t : m)) : null),
    [finished],
  );
  const paceAvg = pace?.avg_seconds ?? null;
  const durTone = (d: number) =>
    paceAvg == null ? "text-ink" : d <= paceAvg ? "text-emerald-400" : d <= paceAvg * 1.25 ? "text-amber-400" : "text-red-400";

  // ---- Shortages ----
  const shortLabel = (s: Shortage) => (s.item_detail ? `${s.item_category} ${s.item_detail}` : s.item_category);
  const shortsByTruck = useMemo(() => {
    const m = new Map<number, Shortage[]>();
    for (const s of shorts) {
      const arr = m.get(s.truck_number) ?? [];
      arr.push(s);
      m.set(s.truck_number, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [shorts]);
  const totalPieces = useMemo(() => shorts.reduce((n, s) => n + s.quantity, 0), [shorts]);
  const distinctItems = useMemo(() => new Set(shorts.map(shortLabel)).size, [shorts]);

  // ---- Audit ----
  const itemByLabel = useMemo(() => new Map(trackedItems.map((i) => [i.label, i])), [trackedItems]);
  const auditByTruck = useMemo(() => {
    const m = new Map<number, AuditEntry[]>();
    for (const e of auditEntries) {
      const arr = m.get(e.truck_number) ?? [];
      arr.push(e);
      m.set(e.truck_number, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [auditEntries]);
  const itemsLogged = auditEntries.length;
  const piecesRemoved = useMemo(() => auditEntries.reduce((n, e) => n + e.quantity, 0), [auditEntries]);
  const openWarnings = useMemo(
    () => auditEntries.filter((e) => e.warn_on_next_load && !e.warning_applied).length,
    [auditEntries],
  );
  const catRollup = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of auditEntries) {
      const top = topCatOf(itemByLabel.get(e.item_label));
      m.set(top, (m.get(top) ?? 0) + e.quantity);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [auditEntries, itemByLabel]);

  return (
    <>
      <PageHeader
        eyebrow="Live Report"
        title="Run Report"
        subtitle={`${formatRunDate(runDate)} · Load Day ${loadDay} · Unload Day ${unloadsDay}`}
        actions={
          <div className="flex items-center gap-2">
            {isToday && (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-st-inprogress">
                <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
                Live
              </span>
            )}
            <input
              className="input text-xs [color-scheme:dark]"
              type="date"
              max={todayIso()}
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
            />
          </div>
        }
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-8 p-3 md:p-6">
        {/* ===================== UNLOAD ===================== */}
        <Section eyebrow="Unload" title="Batches">
          {batchingDisabled ? (
            <Empty>Batching is turned off for this day.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="Trucks batched" value={trucksBatched} />
                <Kpi label="Total wearers" value={totalWearers.toLocaleString()} sub={`cap ${noCap ? "∞" : cap.toLocaleString()}/batch`} />
                <Kpi label="Batches used" value={`${batchesUsed} / 6`} />
                <Kpi label="Unloaded" value={`${unloadedCount} / ${unloadRosterSize}`} sub="trucks this shift" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {batches.map((b) => (
                  <BatchMiniCard key={b.batch_number} batch={b} cap={cap} noCap={noCap} />
                ))}
              </div>
            </>
          )}
        </Section>

        {/* ===================== LOAD · COVERAGE ===================== */}
        <Section eyebrow="Load" title="Routes covered">
          {coverageRows.length === 0 ? (
            <Empty>No route coverage recorded for this day.</Empty>
          ) : (
            <div className="overflow-hidden rounded-xl border border-hairline">
              {coverageRows.map((r, i) => {
                const st = boardByNum.get(r.loadOnTruck)?.state;
                const done = st?.status === "loaded";
                return (
                  <div
                    key={`${r.routeTruck}-${r.loadOnTruck}`}
                    className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm", i > 0 && "border-t border-hairline")}
                  >
                    <span className="font-mono font-bold tabular-nums text-sky-300">#{r.routeTruck}</span>
                    <span className="text-xs text-ink-muted">loads on</span>
                    <span className="font-mono font-bold tabular-nums text-ink">#{r.loadOnTruck}</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">{r.type}</span>
                    {isRecurring(r.routeTruck, r.loadOnTruck) && (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">recurring</span>
                    )}
                    {r.returned && (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">returned</span>
                    )}
                    <span className="ml-auto text-right text-xs">
                      {done ? (
                        <span className="text-st-loaded">
                          Loaded
                          {st?.load_finish_time ? ` · ${clock(st.load_finish_time)}` : ""}
                          {st?.load_duration_seconds != null ? ` · ${formatDuration(st.load_duration_seconds)}` : ""}
                        </span>
                      ) : (
                        <span className="text-ink-faint">{st?.status === "in_progress" ? "Loading…" : "Not loaded"}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ===================== LOAD · LOAD TIMES ===================== */}
        <Section eyebrow="Load" title="Load times">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Trucks timed" value={durations.length} />
            <Kpi
              label="Day average"
              value={dayAvg != null ? formatDuration(dayAvg) : "—"}
              sub={paceAvg != null ? `30-day avg ${formatDuration(paceAvg)}` : undefined}
              tone={dayAvg != null && paceAvg != null ? (dayAvg <= paceAvg ? "text-emerald-400" : "text-amber-400") : undefined}
            />
            <Kpi label="Fastest" value={fastest ? formatDuration(fastest.state!.load_duration_seconds!) : "—"} sub={fastest ? `#${fastest.truck_number}` : undefined} tone="text-emerald-400" />
            <Kpi label="Slowest" value={slowest ? formatDuration(slowest.state!.load_duration_seconds!) : "—"} sub={slowest ? `#${slowest.truck_number}` : undefined} tone="text-red-400" />
          </div>
          {finished.length === 0 ? (
            <Empty>No trucks have finished loading yet.</Empty>
          ) : (
            <div className="overflow-hidden rounded-xl border border-hairline">
              {finished.map((t, i) => {
                const d = t.state!.load_duration_seconds!;
                return (
                  <div key={t.truck_number} className={clsx("flex items-center gap-3 px-3 py-2 text-sm", i > 0 && "border-t border-hairline")}>
                    <span className="w-12 font-mono font-bold tabular-nums text-ink">#{t.truck_number}</span>
                    <span className="text-xs text-ink-muted">{clock(t.state?.load_finish_time)}</span>
                    <span className={clsx("ml-auto font-mono font-semibold tabular-nums", durTone(d))}>{formatDuration(d)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ===================== LOAD · SHORTAGES ===================== */}
        <Section eyebrow="Load" title="Shortages">
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Qty short" value={totalPieces} sub="total units" tone={totalPieces > 0 ? "text-red-400" : "text-emerald-400"} />
            <Kpi label="Distinct items" value={distinctItems} />
            <Kpi label="Trucks shorted" value={shortsByTruck.length} />
          </div>
          {shortsByTruck.length === 0 ? (
            <Empty>No shortages logged for this day.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shortsByTruck.map(([truck, rows]) => (
                <AnimateCard key={truck} className="card space-y-1.5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold tabular-nums text-ink">#{truck}</span>
                    <span className="text-[11px] text-ink-muted">
                      {rows.length} item{rows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-0.5">
                    {rows.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-ink-soft">{shortLabel(s)}</span>
                        <span className="shrink-0 font-mono font-semibold tabular-nums text-red-400">
                          ×{qtyWithUnit(trackedItems, s.item_category, s.item_detail, s.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AnimateCard>
              ))}
            </div>
          )}
        </Section>

        {/* ===================== LOAD · AUDIT ===================== */}
        <Section eyebrow="Load" title="Audit">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Trucks audited" value={auditByTruck.length} />
            <Kpi label="Items logged" value={itemsLogged} />
            <Kpi label="Pieces removed" value={piecesRemoved} />
            <Kpi label="Open warnings" value={openWarnings} tone={openWarnings > 0 ? "text-amber-400" : undefined} />
          </div>
          {catRollup.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {catRollup.map(([cat, qty]) => (
                <span key={cat} className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface px-2.5 py-1 text-xs">
                  <span className={clsx("h-2 w-2 rounded-full", TOP_CAT_DOT[cat] ?? categoryDotClass(cat, trackedCatMeta))} />
                  <span className="text-ink-soft">{cat}</span>
                  <span className="font-mono font-semibold tabular-nums text-ink">{qty}</span>
                </span>
              ))}
            </div>
          )}
          {auditByTruck.length === 0 ? (
            <Empty>No audit entries logged for this day.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {auditByTruck.map(([truck, entries]) => {
                const routeOverride = entries.find((e) => e.route_override != null)?.route_override ?? null;
                return (
                  <AnimateCard key={truck} className="card space-y-1.5 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold tabular-nums text-ink">
                        #{truck}
                        {routeOverride != null && routeOverride !== truck && (
                          <span className="ml-1 text-[11px] font-normal text-ink-faint">(route {routeOverride})</span>
                        )}
                      </span>
                      <span className="text-[11px] text-ink-muted">
                        {entries.length} item{entries.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {entries.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-ink-soft">{e.item_label}</span>
                            {e.warn_on_next_load && (
                              <span
                                className={clsx(
                                  "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase",
                                  e.warning_applied ? "bg-slate-700 text-slate-300" : "bg-amber-500/20 text-amber-300",
                                )}
                              >
                                warn
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-mono font-semibold tabular-nums text-ink">×{e.quantity}</span>
                        </li>
                      ))}
                    </ul>
                  </AnimateCard>
                );
              })}
            </div>
          )}
        </Section>
      </motion.div>
    </>
  );
}
