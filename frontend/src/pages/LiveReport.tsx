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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import PageHeader from "../components/PageHeader";
import DownloadImageButton from "../components/DownloadImageButton";
import AnimateCard from "../components/AnimateCard";
import OverbatchedChip from "../components/OverbatchedChip";
import { DEFAULT_TRACKED_ITEMS, useCategoryPalette } from "../components/shorts/HierarchyPicker";
import { buildShortageMatrix } from "../components/shorts/shortageMatrix";
import { downloadReportPdf, type ReportViewModel } from "../lib/reportPdf";
import { capacityColor } from "../utils/batchCapacity";
import { ChevronLeft, ChevronRight, FileDown, Maximize2, Pause, Play, X } from "lucide-react";
import ShortageSheetView from "../components/shorts/ShortageSheetView";
import { formatDuration } from "../components/LiveInProgress";
import { workdayNumbers } from "../components/Clock";
import { todayIso } from "../api/client";
import { formatEasternTime, formatRunDate } from "../utils/dates";
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
  type TrackedItem,
} from "../api/hooks";
import { buildOperationalDayContext, countUnloadedFromContext, nextRunDate, previousRunDate } from "../utils/truckStatus";
import type { AuditEntry, BatchSummary, RecurringRouteSwap, Shortage } from "../types";

const DEFAULT_WEARER_CAP = 1800;

// Tailwind class → hex, so the PDF view-model can ship concrete colours that
// match what capacityColor / durTone / the KPI tones paint on screen.
const BAR_HEX: Record<string, string> = {
  "bg-red-500": "#ef4444",
  "bg-amber-500": "#f59e0b",
  "bg-emerald-500": "#10b981",
};
const TONE_HEX: Record<string, string> = {
  "text-ink": "#f2f6fb",
  "text-emerald-400": "#34d399",
  "text-amber-400": "#fbbf24",
  "text-amber-300": "#fcd34d",
  "text-red-400": "#f87171",
  "text-sky-300": "#7dd3fc",
};

// The report sections the PDF picker offers, in on-screen order.
type SectionKey = "batches" | "coverage" | "loadTimes" | "shortages" | "shortSheet" | "audit";

// Top-level audit category = text before the first ">" in the "Top > Sub"
// category string (mirrors Audit.tsx topCatOf).
function topCatOf(item: TrackedItem | undefined): string {
  const cat = item?.category ?? "";
  const idx = cat.indexOf(">");
  return (idx >= 0 ? cat.slice(0, idx) : cat).trim() || "General";
}

function clock(epochSec: number | null | undefined): string {
  return epochSec ? formatEasternTime(epochSec) : "—";
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

/** True inside a kiosk slide. The kiosk toolbar already names the section (and
 *  its Load/Unload phase), so Section drops its own header there — repeating it
 *  cost vertical space and pushed slides into needless scrolling. */
const KioskSlideContext = createContext(false);

function Section({
  eyebrow,
  title,
  children,
  downloadName,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  /** When set, renders a "Download image" button that snapshots this whole
   *  section (title + content) to a PNG with the given base filename. */
  downloadName?: string;
}) {
  const captureRef = useRef<HTMLElement>(null);
  const inKioskSlide = useContext(KioskSlideContext);
  return (
    <section ref={captureRef} className="space-y-3">
      {!inKioskSlide && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{eyebrow}</p>
          <h2 className="text-lg font-bold text-ink">{title}</h2>
        </div>
      )}
      {children}
      {downloadName && (
        <DownloadImageButton targetRef={captureRef} filename={downloadName} className="pt-1" />
      )}
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
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink">
          Batch {batch.batch_number}
          <OverbatchedChip show={batch.total_wearers > cap} />
        </span>
        <span className={clsx("shrink-0 whitespace-nowrap font-mono text-xs font-semibold tabular-nums", text)}>
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
  const palette = useCategoryPalette();
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
    type Row = { routeTruck: number; loadOnTruck: number; type: string; returned: boolean; split: boolean };
    const rows: Row[] = [];
    const seen = new Set<string>();
    const add = (routeTruck: number, loadOnTruck: number, type: string, returned = false, split = false) => {
      const key = `${routeTruck}->${loadOnTruck}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ routeTruck, loadOnTruck, type, returned, split });
    };
    // A SPLIT swap means the route ALSO ran (the truck carried only its overflow)
    // — label it "Split", not full "Route swap", so the report doesn't imply the
    // route was covered.
    for (const rs of routeSwaps) add(rs.route_truck, rs.load_on_truck, rs.is_split ? "Split" : "Route swap", false, rs.is_split);
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
  // Worst offenders — ranked by total quantity short (ties → more line items).
  const topItem = useMemo(() => {
    const m = new Map<string, { label: string; qty: number; trucks: Set<number> }>();
    for (const s of shorts) {
      const label = shortLabel(s);
      const e = m.get(label) ?? { label, qty: 0, trucks: new Set<number>() };
      e.qty += s.quantity;
      e.trucks.add(s.truck_number);
      m.set(label, e);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty || b.trucks.size - a.trucks.size)[0] ?? null;
  }, [shorts]);
  const topTruck = useMemo(() => {
    const m = new Map<number, { truck: number; qty: number; items: number }>();
    for (const s of shorts) {
      const e = m.get(s.truck_number) ?? { truck: s.truck_number, qty: 0, items: 0 };
      e.qty += s.quantity;
      e.items += 1;
      m.set(s.truck_number, e);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty || b.items - a.items)[0] ?? null;
  }, [shorts]);
  // Top 3 shorted trucks, each with its biggest items — a quick "worst trucks"
  // breakdown for the report (and PDF), beyond the single "most shorted truck" KPI.
  const topTrucks = useMemo(() => {
    const m = new Map<number, { truck: number; total: number; items: Map<string, number> }>();
    for (const s of shorts) {
      const e = m.get(s.truck_number) ?? { truck: s.truck_number, total: 0, items: new Map<string, number>() };
      e.total += s.quantity;
      const label = shortLabel(s);
      e.items.set(label, (e.items.get(label) ?? 0) + s.quantity);
      m.set(s.truck_number, e);
    }
    return [...m.values()]
      .sort((a, b) => b.total - a.total || b.items.size - a.items.size)
      .slice(0, 5)
      .map((t) => ({
        truck: t.truck,
        total: t.total,
        items: [...t.items.entries()]
          .map(([label, qty]) => ({ label, qty }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 5),
      }));
  }, [shorts]);

  // Top 5 shorted ITEMS (qty across every truck) — the item-side companion to
  // topTrucks. Same derivation the PDF uses, so the two always agree.
  const topItems = useMemo(() => {
    const m = new Map<string, { label: string; category: string; qty: number; trucks: Map<number, number> }>();
    for (const s of shorts) {
      const label = shortLabel(s);
      const e = m.get(label) ?? { label, category: s.item_category, qty: 0, trucks: new Map<number, number>() };
      e.qty += s.quantity;
      e.trucks.set(s.truck_number, (e.trucks.get(s.truck_number) ?? 0) + s.quantity);
      m.set(label, e);
    }
    return [...m.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
      .map((it) => ({
        label: it.label,
        category: it.category,
        qty: it.qty,
        // Which trucks made up this item's total, biggest contributor first.
        trucks: [...it.trucks.entries()]
          .map(([truck, qty]) => ({ truck, qty }))
          .sort((a, b) => b.qty - a.qty),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shorts]);

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

  // ---- PDF export ----
  // Assemble the exact numbers/rows the page shows — plus the hex colours it
  // paints them with — into the server's view-model, which renders a dark,
  // app-matching PDF whose text stays SELECTABLE. A picker lets the user choose
  // which sections to include before generating.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
    batches: true, coverage: true, loadTimes: true, shortages: true, shortSheet: true, audit: true,
  });

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  function buildViewModel(sel: Record<SectionKey, boolean>): ReportViewModel {
    const vm: ReportViewModel = {
      run_date: runDate,
      generated_at: new Date().toISOString(),
      load_day: loadDay,
      unload_day: unloadsDay,
      title: "Run Report",
    };

    if (sel.batches) {
      vm.batches = {
        disabled: batchingDisabled,
        cap,
        no_cap: noCap,
        kpis: batchingDisabled
          ? []
          : [
              { label: "Trucks batched", value: String(trucksBatched) },
              { label: "Total wearers", value: totalWearers.toLocaleString(), sub: `cap ${noCap ? "∞" : cap.toLocaleString()}/batch` },
              { label: "Batches used", value: `${batchesUsed} / 6` },
              { label: "Unloaded", value: `${unloadedCount} / ${unloadRosterSize}`, sub: "trucks this shift" },
            ],
        cards: batchingDisabled
          ? []
          : batches.map((b) => {
              const { bar, text } = capacityColor(b.total_wearers, noCap, cap);
              return {
                batch_number: b.batch_number,
                total_wearers: b.total_wearers,
                cap_label: noCap ? b.total_wearers.toLocaleString() : `${b.total_wearers.toLocaleString()} / ${cap.toLocaleString()}`,
                pct: Math.min(100, Math.round((b.total_wearers / Math.max(cap, 1)) * 100)),
                bar_hex: BAR_HEX[bar] ?? "#10b981",
                text_hex: TONE_HEX[text] ?? "#f2f6fb",
                overbatched: b.total_wearers > cap,
                trucks: b.trucks.map((t) => ({ truck_number: t.truck_number, wearers: t.wearers })),
              };
            }),
      };
    }

    if (sel.coverage) {
      vm.coverage = {
        rows: coverageRows.map((r) => {
          const st = boardByNum.get(r.loadOnTruck)?.state;
          const done = st?.status === "loaded";
          const status_label = done
            ? "Loaded" +
              (st?.load_finish_time ? ` · ${clock(st.load_finish_time)}` : "") +
              (st?.load_duration_seconds != null ? ` · ${formatDuration(st.load_duration_seconds)}` : "")
            : st?.status === "in_progress"
              ? "Loading…"
              : "Not loaded";
          return {
            route_truck: r.routeTruck,
            load_on_truck: r.loadOnTruck,
            type: r.type,
            recurring: isRecurring(r.routeTruck, r.loadOnTruck),
            returned: r.returned,
            loaded: done,
            status_label,
            status_hex: done ? "#3b82f6" : "#7a8698",
          };
        }),
      };
    }

    if (sel.loadTimes) {
      vm.load_times = {
        kpis: [
          { label: "Trucks timed", value: String(durations.length) },
          {
            label: "Day average",
            value: dayAvg != null ? formatDuration(dayAvg) : "—",
            sub: paceAvg != null ? `30-day avg ${formatDuration(paceAvg)}` : null,
            tone: dayAvg != null && paceAvg != null ? (dayAvg <= paceAvg ? "#34d399" : "#fbbf24") : null,
          },
          { label: "Fastest", value: fastest ? formatDuration(fastest.state!.load_duration_seconds!) : "—", sub: fastest ? `#${fastest.truck_number}` : null, tone: "#34d399" },
          { label: "Slowest", value: slowest ? formatDuration(slowest.state!.load_duration_seconds!) : "—", sub: slowest ? `#${slowest.truck_number}` : null, tone: "#f87171" },
        ],
        rows: finished.map((t) => {
          const d = t.state!.load_duration_seconds!;
          return {
            truck_number: t.truck_number,
            finish_label: clock(t.state?.load_finish_time),
            duration_label: formatDuration(d),
            tone: TONE_HEX[durTone(d)] ?? "#f2f6fb",
          };
        }),
      };
    }

    if (sel.shortages || sel.shortSheet) {
      const items = trackedItems.length > 0 ? trackedItems : DEFAULT_TRACKED_ITEMS;
      const m = buildShortageMatrix(shorts, items);
      // The summary (KPIs + top strips) and the sheet grid are separate picks,
      // so a report can carry either, both, or just the grid.
      vm.shortages = {
        kpis: !sel.shortages ? [] : [
          { label: "Qty short", value: String(totalPieces), sub: "total units", tone: totalPieces > 0 ? "#f87171" : "#34d399" },
          { label: "Most shorted item", value: topItem ? topItem.label : "—", sub: topItem ? `${topItem.qty} qty · ${topItem.trucks.size} truck${topItem.trucks.size === 1 ? "" : "s"}` : null, tone: "#fcd34d" },
          { label: "Most shorted truck", value: topTruck ? `#${topTruck.truck}` : "—", sub: topTruck ? `${topTruck.qty} qty · ${topTruck.items} item${topTruck.items === 1 ? "" : "s"}` : null, tone: "#fcd34d" },
          { label: "Distinct items", value: String(distinctItems) },
          { label: "Trucks shorted", value: String(shortsByTruck.length) },
        ],
        top_trucks: !sel.shortages
          ? []
          : topTrucks.map((t) => ({
              truck_number: t.truck,
              total: t.total,
              items: t.items.map((it) => ({ label: it.label, qty: it.qty })),
            })),
        matrix:
          sel.shortSheet
            ? {
                trucks: m.trucks,
                rows: m.rows.map((r) => ({
                  group: r.group,
                  category: r.category,
                  detail: r.detail,
                  label: r.label,
                  unit: r.unit,
                  dot_hex: palette.hexOf(r.category),
                  cells: m.trucks.map((n) => r.byTruck.get(n) ?? null),
                  total: r.total,
                })),
                truck_totals: m.trucks.map((n) => m.truckTotals.get(n) ?? 0),
                grand_total: m.grandTotal,
              }
            : null,
      };
    }

    if (sel.audit) {
      vm.audit = {
        kpis: [
          { label: "Trucks audited", value: String(auditByTruck.length) },
          { label: "Items logged", value: String(itemsLogged) },
          { label: "Pieces removed", value: String(piecesRemoved) },
          { label: "Open warnings", value: String(openWarnings), tone: openWarnings > 0 ? "#fbbf24" : null },
        ],
        chips: catRollup.map(([cat, qty]) => ({
          category: cat,
          qty,
          dot_hex: palette.hexOf(cat),
        })),
        cards: auditByTruck.map(([truck, entries]) => ({
          truck_number: truck,
          route_override: entries.find((e) => e.route_override != null)?.route_override ?? null,
          entries: entries.map((e) => ({
            item_label: e.item_label,
            quantity: e.quantity,
            warn: e.warn_on_next_load,
            warn_applied: e.warning_applied,
          })),
        })),
      };
    }

    return vm;
  }

  async function handleDownloadPdf(sel: Record<SectionKey, boolean>) {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfErr(false);
    try {
      await downloadReportPdf(buildViewModel(sel));
      setPickerOpen(false);
    } catch (e) {
      console.error("report pdf failed", e);
      setPdfErr(true);
    } finally {
      setPdfBusy(false);
    }
  }

  // Which sections have content today (drives the picker's muted hints).
  // `phase` mirrors each Section's eyebrow so kiosk mode can show it in the
  // toolbar instead of inside the slide.
  const sectionDefs: { key: SectionKey; label: string; phase: "Load" | "Unload"; hint?: string }[] = [
    { key: "shortages", label: "Shortages", phase: "Load", hint: shorts.length ? undefined : "empty" },
    { key: "shortSheet", label: "Short sheet", phase: "Load", hint: shorts.length ? undefined : "empty" },
    { key: "batches", label: "Batches", phase: "Unload", hint: batchingDisabled ? "off" : batches.length ? undefined : "empty" },
    { key: "coverage", label: "Routes covered", phase: "Load", hint: coverageRows.length ? undefined : "empty" },
    { key: "loadTimes", label: "Load times", phase: "Load", hint: finished.length ? undefined : "empty" },
    { key: "audit", label: "Audit", phase: "Load", hint: auditByTruck.length ? undefined : "empty" },
  ];
  const anySelected = Object.values(selected).some(Boolean);

  // ---------------------------------------------------------------------
  // Kiosk mode — full-screen rotation through the report's sections for a
  // wall display. Renders one section at a time over the app chrome, auto
  // advancing with an animated transition. Data keeps polling underneath, so
  // the board on the wall stays live.
  // ---------------------------------------------------------------------
  const [kiosk, setKiosk] = useState(false);
  const [kioskIdx, setKioskIdx] = useState(0);
  const [kioskPaused, setKioskPaused] = useState(false);
  const [kioskSecs, setKioskSecs] = useState(20);
  // Kiosk is read from across the room, so the dense sections (short sheet,
  // load times, batch/wearer numbers) get scaled up. `zoom` is used rather
  // than transform:scale because it reflows — the grid keeps its own
  // horizontal scroll instead of being squashed.
  const [kioskZoom, setKioskZoom] = useState(1.3);
  const [kioskTick, setKioskTick] = useState(0); // drives the progress bar

  // Only rotate through sections the user picked that actually have something
  // to show — nobody wants a wall display parked on "No shortages logged".
  const kioskSlides = useMemo(() => {
    const has: Record<SectionKey, boolean> = {
      shortages: shorts.length > 0,
      shortSheet: shorts.length > 0,
      batches: (batches?.length ?? 0) > 0,
      coverage: coverageRows.length > 0,
      loadTimes: finished.length > 0,
      audit: auditEntries.length > 0,
    };
    const live = sectionDefs.filter((d) => selected[d.key] && has[d.key]);
    // Fall back to whatever is selected so kiosk mode is never empty.
    return (live.length > 0 ? live : sectionDefs.filter((d) => selected[d.key])).map((d) => d.key);
  }, [selected, shorts.length, batches, coverageRows.length, finished.length, auditEntries.length, sectionDefs]);

  const kioskKey = kioskSlides[Math.min(kioskIdx, Math.max(0, kioskSlides.length - 1))] ?? "shortages";
  const kioskNext = useCallback(() => setKioskIdx((i) => (kioskSlides.length ? (i + 1) % kioskSlides.length : 0)), [kioskSlides.length]);
  const kioskPrev = useCallback(
    () => setKioskIdx((i) => (kioskSlides.length ? (i - 1 + kioskSlides.length) % kioskSlides.length : 0)),
    [kioskSlides.length],
  );

  // Advance timer + 100ms tick for the progress bar.
  useEffect(() => {
    if (!kiosk || kioskPaused) return;
    setKioskTick(0);
    const started = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= kioskSecs * 1000) kioskNext();
      else setKioskTick(elapsed / (kioskSecs * 1000));
    }, 100);
    return () => window.clearInterval(id);
  }, [kiosk, kioskPaused, kioskSecs, kioskIdx, kioskNext]);

  // Auto-scroll a slide that doesn't fit, as one slow constant crawl:
  //   hold at top -> glide to the bottom -> sit at the bottom -> back to the
  //   top and repeat, for as long as the slide is on screen.
  // The pace is a fixed comfortable reading speed, so a longer timer means MORE
  // dwell (and another pass) rather than an ever-slower crawl. If the slide is
  // too short for a full pass at that pace, the travel compresses to fit.
  //
  // NOTE: this deliberately runs even under prefers-reduced-motion. Paging in
  // discrete jumps to honour that setting read as erratic on a wall display,
  // and skipping the scroll entirely left the bottom of a long slide
  // unreachable — a slow, constant crawl is the calmest option of the three.
  const kioskScrollRef = useRef<HTMLDivElement>(null);
  const KIOSK_PACE = 38;        // px per second — measured comfortable crawl
  const KIOSK_TOP_HOLD = 1500;  // ms parked at the top before setting off
  const KIOSK_BOTTOM_HOLD = 3500; // ms parked at the bottom before looping

  // Someone touched it: stop auto-scrolling this slide so they can read at
  // their own pace. Clears automatically when the slide changes.
  const [kioskManual, setKioskManual] = useState(false);
  useEffect(() => {
    setKioskManual(false);
    if (kioskScrollRef.current) kioskScrollRef.current.scrollTop = 0;
  }, [kioskKey, kioskIdx]);

  useEffect(() => {
    const el = kioskScrollRef.current;
    if (!kiosk || !el) return;
    // Only real user intent — NOT the "scroll" event, which our own animation
    // fires every frame.
    const stop = () => setKioskManual(true);
    const opts = { passive: true } as AddEventListenerOptions;
    el.addEventListener("wheel", stop, opts);
    el.addEventListener("touchstart", stop, opts);
    el.addEventListener("pointerdown", stop, opts);
    el.addEventListener("keydown", stop, opts);
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("keydown", stop);
    };
  }, [kiosk, kioskKey]);

  useEffect(() => {
    const el = kioskScrollRef.current;
    if (!kiosk || !el || kioskPaused || kioskManual) return;

    const total = kioskSecs * 1000;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      // Re-measure every frame: the section animates in and data can refetch
      // underneath, both of which change the height.
      const max = el.scrollHeight - el.clientHeight;
      if (max > 8) {
        const usable = Math.max(600, total - KIOSK_TOP_HOLD - KIOSK_BOTTOM_HOLD);
        const travel = Math.min((max / KIOSK_PACE) * 1000, usable);
        const cycle = KIOSK_TOP_HOLD + travel + KIOSK_BOTTOM_HOLD;
        const t = (now - start) % cycle;   // wraps -> back to the top for another pass
        el.scrollTop =
          t < KIOSK_TOP_HOLD
            ? 0
            : t < KIOSK_TOP_HOLD + travel
              ? max * ((t - KIOSK_TOP_HOLD) / travel)
              : max;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [kiosk, kioskPaused, kioskManual, kioskKey, kioskIdx, kioskSecs]);

  // Keyboard: Esc exits, Space pauses, arrows step.
  useEffect(() => {
    if (!kiosk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setKiosk(false); return; }
      if (e.key === " ") { e.preventDefault(); setKioskPaused((v) => !v); return; }
      if (e.key === "ArrowRight") kioskNext();
      if (e.key === "ArrowLeft") kioskPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kiosk, kioskNext, kioskPrev]);

  // Keep the wall display awake and hide the browser chrome where allowed.
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* denied / unsupported — the overlay still covers the app */ }
  }

  function startKiosk() {
    setKioskIdx(0);
    setKioskPaused(false);
    setKiosk(true);
    void toggleFullscreen();
  }

  // In kiosk mode only the active section renders; otherwise everything does.
  const showSection = (key: SectionKey) => (kiosk ? kioskKey === key : true);

  const kioskButton = (
    <button
      type="button"
      onClick={startKiosk}
      title="Full-screen rotating display"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-soft active:scale-95"
    >
      <Play className="h-4 w-4" />
      Kiosk
    </button>
  );

  const pdfButton = (
    <button
      type="button"
      onClick={() => {
        setPdfErr(false);
        setPickerOpen(true);
      }}
      disabled={pdfBusy}
      title="Download the report as a PDF"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-soft active:scale-95 disabled:opacity-50"
    >
      <FileDown className="h-4 w-4" />
      {pdfBusy ? "…" : "PDF"}
    </button>
  );

  const sectionPicker = pickerOpen
    ? createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !pdfBusy && setPickerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose report sections"
            className="max-h-[90svh] w-full max-w-sm overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-100">Download report PDF</h3>
            <p className="mt-1 text-sm text-slate-400">Choose which sections to include.</p>
            <div className="mt-4 space-y-0.5">
              {sectionDefs.map((s) => (
                <label
                  key={s.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={selected[s.key]}
                    onChange={(e) => setSelected((p) => ({ ...p, [s.key]: e.target.checked }))}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <span className="flex-1 text-sm text-slate-200">{s.label}</span>
                  {s.hint && <span className="text-[11px] text-slate-500">{s.hint}</span>}
                </label>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {pdfErr && <span className="mr-auto text-xs text-st-dirty">Couldn't generate — try again.</span>}
              <button className="btn-ghost" onClick={() => setPickerOpen(false)} disabled={pdfBusy}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => handleDownloadPdf(selected)}
                disabled={pdfBusy || !anySelected}
              >
                {pdfBusy ? "Generating…" : "Generate PDF"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  // Kiosk slides drop the per-section "Download image" buttons — nobody taps
  // them from across the room, and their height pushed slides into scrolling
  // that wasn't otherwise needed.
  const dlName = (label: string) => (kiosk ? undefined : `${label} ${runDate}`);

  // The report body itself. Rendered inline on the page, or one section at a
  // time inside the kiosk overlay — showSection() decides which.
  const reportBody = (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={clsx(kiosk ? "px-6 pb-6 pt-2" : "space-y-8 py-3 md:py-6")}
        style={
          kiosk
            ? undefined
            : {
                paddingLeft: "calc(0.75rem + env(safe-area-inset-left))",
                paddingRight: "calc(0.75rem + env(safe-area-inset-right))",
              }
        }
      >
        {/* ===================== LOAD · SHORTAGES (shown first) ===================== */}
        {showSection("shortages") && (
        <Section eyebrow="Load" title="Shortages" downloadName={dlName("Shortages")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Qty short" value={totalPieces} sub="total units" tone={totalPieces > 0 ? "text-red-400" : "text-emerald-400"} />
            <Kpi
              label="Most shorted item"
              value={topItem ? topItem.label : "—"}
              sub={topItem ? `${topItem.qty} qty · ${topItem.trucks.size} truck${topItem.trucks.size === 1 ? "" : "s"}` : undefined}
              tone="text-amber-300"
            />
            <Kpi
              label="Most shorted truck"
              value={topTruck ? `#${topTruck.truck}` : "—"}
              sub={topTruck ? `${topTruck.qty} qty · ${topTruck.items} item${topTruck.items === 1 ? "" : "s"}` : undefined}
              tone="text-amber-300"
            />
            <Kpi label="Distinct items" value={distinctItems} />
            <Kpi label="Trucks shorted" value={shortsByTruck.length} />
          </div>
          {topTrucks.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Top shorted trucks
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {topTrucks.map((t, i) => (
                  <div key={t.truck} className="rounded-xl border border-hairline bg-surface p-3">
                    {/* Place + qty flank the truck number so the number itself
                        stays centred as the card's focal point. */}
                    <div className="border-b border-hairline pb-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-bold text-ink-faint">#{i + 1}</span>
                        <span className="font-mono text-sm font-bold tabular-nums text-amber-300">
                          {t.total.toLocaleString()} <span className="text-[10px] font-normal text-ink-faint">qty</span>
                        </span>
                      </div>
                      <p className="text-center font-mono text-2xl font-black leading-tight tabular-nums text-ink">
                        #{t.truck}
                      </p>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {t.items.map((it) => (
                        <li key={it.label} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-ink-soft">{it.label}</span>
                          <span className="shrink-0 font-mono font-semibold tabular-nums text-amber-300">
                            {it.qty.toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
          {topItems.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Top shorted items
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {topItems.map((it, i) => (
                  <div key={it.label} className="rounded-xl border border-hairline bg-surface p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-ink-faint">#{i + 1}</span>
                      <span className="font-mono text-sm font-bold tabular-nums text-amber-300">
                        {it.qty.toLocaleString()} <span className="text-[10px] font-normal text-ink-faint">qty</span>
                      </span>
                    </div>
                    <p className="mt-1 flex items-center justify-center gap-1.5 border-t border-hairline pt-1.5 text-center text-sm font-bold leading-tight text-ink">
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", palette.dotClass(it.category))} />
                      {it.label}
                    </p>
                    {/* Which trucks this item was short on — the mirror of the
                        per-truck cards above, which list items. */}
                    <ul className="mt-1.5 space-y-0.5 border-t border-hairline pt-1.5">
                      {it.trucks.slice(0, 6).map((t) => (
                        <li key={t.truck} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold tabular-nums text-ink-soft">#{t.truck}</span>
                          <span className="shrink-0 font-mono font-semibold tabular-nums text-amber-300">
                            {t.qty.toLocaleString()}
                          </span>
                        </li>
                      ))}
                      {it.trucks.length > 6 && (
                        <li className="text-center text-[10px] text-ink-faint">
                          +{it.trucks.length - 6} more truck{it.trucks.length - 6 === 1 ? "" : "s"}
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
          {shorts.length === 0 && <Empty>No shortages logged for this day.</Empty>}
        </Section>
        )}

        {/* ===================== LOAD · SHORT SHEET ===================== */}
        {/* The grid is its own section so it can be picked, exported and shown
            in kiosk mode independently of the shortage summary above. */}
        {showSection("shortSheet") && (
        <Section eyebrow="Load" title="Short sheet" downloadName={dlName("Short sheet")}>
          {shorts.length === 0 ? (
            <Empty>No shortages logged for this day.</Empty>
          ) : (
            /* Same Grid / Sheet views as the Short Sheet page, so the report
               shows the crew's actual sheet. */
            <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
              <ShortageSheetView shorts={shorts} board={board} />
            </div>
          )}
        </Section>
        )}

        {/* ===================== UNLOAD ===================== */}
        {showSection("batches") && (
        <Section eyebrow="Unload" title="Batches" downloadName={dlName("Batches")}>
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
        )}

        {/* ===================== LOAD · COVERAGE ===================== */}
        {showSection("coverage") && (
        <Section eyebrow="Load" title="Routes covered">
          {coverageRows.length === 0 ? (
            <Empty>No route coverage recorded for this day.</Empty>
          ) : (
            /* Full coverage cards — the canonical big ROUTE → TRUCK paired
               numbers (same read as a fleet coverage card), not a dense list. */
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {coverageRows.map((r) => {
                const st = boardByNum.get(r.loadOnTruck)?.state;
                const done = st?.status === "loaded";
                return (
                  <div
                    key={`${r.routeTruck}-${r.loadOnTruck}`}
                    className="rounded-xl border border-hairline bg-surface p-4"
                  >
                    <div className="flex items-center justify-center gap-4">
                      <div className="text-center">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">Route</p>
                        <p className="font-mono text-3xl font-black leading-none tabular-nums text-sky-300">
                          #{r.routeTruck}
                        </p>
                      </div>
                      <span className="text-2xl font-black leading-none text-ink-faint">→</span>
                      <div className="text-center">
                        {/* Past tense only once the carrier has actually loaded. */}
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                          {done ? "Loaded on" : "Loads on"}
                        </p>
                        <p className="font-mono text-3xl font-black leading-none tabular-nums text-ink">
                          #{r.loadOnTruck}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">{r.type}</span>
                      {isRecurring(r.routeTruck, r.loadOnTruck) && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">recurring</span>
                      )}
                      {r.returned && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">returned</span>
                      )}
                    </div>
                    <p className="mt-2.5 border-t border-hairline pt-2 text-center text-xs">
                      {done ? (
                        <span className="text-st-loaded">
                          Loaded
                          {st?.load_finish_time ? ` · ${clock(st.load_finish_time)}` : ""}
                          {st?.load_duration_seconds != null ? ` · ${formatDuration(st.load_duration_seconds)}` : ""}
                        </span>
                      ) : (
                        <span className="text-ink-faint">{st?.status === "in_progress" ? "Loading…" : "Not loaded"}</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        )}

        {/* ===================== LOAD · LOAD TIMES ===================== */}
        {showSection("loadTimes") && (
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
            /* Tiles rather than full-width rows: a row pinned the duration to
               the far right edge, stranding it a screen-width away from the
               truck number and finish time it belongs to. */
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {finished.map((t) => {
                const d = t.state!.load_duration_seconds!;
                return (
                  <div
                    key={t.truck_number}
                    className="flex items-center justify-center gap-3 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="w-12 text-right font-mono font-bold tabular-nums text-ink">#{t.truck_number}</span>
                    <span className="w-16 text-center text-xs text-ink-muted">{clock(t.state?.load_finish_time)}</span>
                    <span className={clsx("w-16 font-mono font-semibold tabular-nums", durTone(d))}>{formatDuration(d)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        )}

        {/* ===================== LOAD · AUDIT ===================== */}
        {showSection("audit") && (
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
                  <span className={clsx("h-2 w-2 rounded-full", palette.dotClass(cat))} />
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
        )}
      </motion.div>
  );

  const kioskDef = sectionDefs.find((d) => d.key === kioskKey);

  const kioskBar = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-hairline bg-surface/80 px-3 py-2.5 backdrop-blur sm:gap-x-3 sm:px-6 sm:py-3">
      <div className="min-w-0 flex-1">
        {/* Carries the section's Load/Unload phase, which used to live in the
            slide's own header. */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          {formatRunDate(runDate)} · {kioskDef?.phase ?? "Run Report"}
        </p>
        <h2 className="truncate text-lg font-black leading-tight text-ink sm:text-2xl">
          {kioskDef?.label ?? ""}
        </h2>
      </div>
      {isToday && (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-st-inprogress">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-st-inprogress" />
          Live
        </span>
      )}
      {/* Exit stays on the title row so a narrow screen can never push it off */}
      <button
        onClick={() => { setKiosk(false); if (document.fullscreenElement) void document.exitFullscreen(); }}
        title="Exit kiosk (Esc)"
        className="shrink-0 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink sm:order-last"
      >
        <X className="h-5 w-5" />
      </button>
      {/* dots + transport: second (wrapping) row on phones, inline on desktop */}
      <div className="flex w-full flex-wrap items-center gap-x-1 gap-y-1.5 sm:ml-auto sm:w-auto sm:flex-nowrap">
        <div className="flex shrink-0 items-center gap-1.5">
          {kioskSlides.map((k, i) => (
            <button
              key={k}
              onClick={() => setKioskIdx(i)}
              title={sectionDefs.find((d) => d.key === k)?.label}
              className={clsx(
                "h-1.5 rounded-full transition-all",
                i === kioskIdx ? "w-8 bg-sky-400" : "w-3 bg-slate-600 hover:bg-slate-500",
              )}
            />
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-2 sm:gap-1">
          <button onClick={kioskPrev} title="Previous (←)" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink sm:p-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setKioskPaused((v) => !v)}
            title={kioskPaused ? "Resume (space)" : "Pause (space)"}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink sm:p-2"
          >
            {kioskPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          </button>
          <button onClick={kioskNext} title="Next (→)" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink sm:p-2">
            <ChevronRight className="h-5 w-5" />
          </button>
          <select
            value={kioskSecs}
            onChange={(e) => setKioskSecs(Number(e.target.value))}
            title="Seconds per section"
            className="input ml-1 w-[3.75rem] px-1.5 py-1 text-xs sm:w-20 sm:px-2"
          >
            {[10, 15, 20, 30, 45, 60].map((n) => (
              <option key={n} value={n}>{n}s</option>
            ))}
          </select>
          <select
            value={kioskZoom}
            onChange={(e) => setKioskZoom(Number(e.target.value))}
            title="Text size"
            className="input w-[4.25rem] px-1.5 py-1 text-xs sm:w-20 sm:px-2"
          >
            {[1, 1.15, 1.3, 1.5, 1.75, 2].map((z) => (
              <option key={z} value={z}>{Math.round(z * 100)}%</option>
            ))}
          </select>
          <button onClick={toggleFullscreen} title="Toggle full screen" className="hidden rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink sm:block">
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {sectionPicker}
      {kiosk && (
        <div className="fixed inset-0 z-[95] flex flex-col overflow-hidden bg-app pt-[env(safe-area-inset-top)]">
          {kioskBar}
          {/* progress through the current slide */}
          <div className="h-0.5 w-full bg-slate-800">
            <div
              className="h-full bg-sky-500"
              style={{ width: `${Math.round(kioskTick * 100)}%`, transition: "width 0.1s linear" }}
            />
          </div>
          <div ref={kioskScrollRef} className="min-h-0 flex-1 overflow-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={kioskKey}
                initial={{ opacity: 0, y: 24, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -24, scale: 0.99 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="px-6 py-5"
                style={{ zoom: kioskZoom }}
              >
                <KioskSlideContext.Provider value>{reportBody}</KioskSlideContext.Provider>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
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
            {kioskButton}
            {pdfButton}
            {pdfErr && <span className="text-[10px] text-st-dirty">PDF failed</span>}
          </div>
        }
      />
      {/* Mobile date bar — PageHeader hides its actions under md, so on a
          phone the report had no way to change the date (and no Live badge
          or day numbers, which live in the md-only subtitle). */}
      <div className="flex items-center gap-2 border-b border-hairline bg-surface/60 px-3 py-2 md:hidden">
        <button
          type="button"
          aria-label="Previous run day"
          onClick={() => setRunDate(previousRunDate(runDate))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-lg leading-none text-ink-soft active:scale-95"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <input
            className="input w-full text-sm [color-scheme:dark]"
            type="date"
            max={todayIso()}
            value={runDate}
            onChange={(e) => e.target.value && setRunDate(e.target.value)}
          />
          <p className="mt-1 truncate text-center text-[10px] text-ink-muted">
            Load Day {loadDay} · Unload Day {unloadsDay}
          </p>
        </div>
        <button
          type="button"
          aria-label="Next run day"
          disabled={isToday}
          onClick={() => setRunDate(nextRunDate(runDate, todayIso()))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-lg leading-none text-ink-soft active:scale-95 disabled:opacity-30"
        >
          ›
        </button>
        {isToday ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-st-inprogress">
            <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
            Live
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setRunDate(todayIso())}
            className="shrink-0 rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink-soft active:scale-95"
          >
            Today
          </button>
        )}
        {kioskButton}
        {pdfButton}
      </div>

      {/* Horizontal padding respects the landscape safe area so the system nav
          bar (right side in landscape) doesn't cover the grid's last columns. */}
      {!kiosk && reportBody}
    </>
  );
}
