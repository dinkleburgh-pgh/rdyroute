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
 *
 * SAVED days. At the end of 3rd shift the server archives the day's report
 * INPUTS — the exact API data this page reads (routers/report_archive.py). A
 * past day that has a snapshot opens from it by default, so the report reads
 * as it stood then rather than as today's database recomputes it. Both
 * readings render through ONE body (ReportBody) from ONE inputs object
 * (ReportInputs): LiveReportData fills it from the hooks, SavedReportData from
 * the snapshot via the same pure parsers those hooks use. So the two can't
 * drift, and Kiosk / Images / PDF work the same on a saved day.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import PageHeader, { HeaderPill } from "../components/PageHeader";
import DownloadImageButton from "../components/DownloadImageButton";
import ConfirmDialog from "../components/ConfirmDialog";
import { captureNodeToPngBlob } from "../lib/captureImage";
import { exportFile } from "../lib/exportFile";
import AnimateCard from "../components/AnimateCard";
import OverbatchedChip from "../components/OverbatchedChip";
import {
  catalogOrDefault,
  itemDisplayNameFor,
  paletteForCatalog,
  shortageItemLabel,
  topCatOf,
  useCategoryPalette,
  useItemDisplayName,
  type CategoryPalette,
} from "../components/shorts/HierarchyPicker";
import { buildShortageMatrix } from "../components/shorts/shortageMatrix";
import { downloadReportPdf, type ReportViewModel } from "../lib/reportPdf";
import { capacityColor, resolveNoCap, resolveWearerCap } from "../utils/batchCapacity";
import { Archive, ChevronLeft, ChevronRight, FileDown, Image as ImageIcon, Maximize2, Pause, Play, X } from "lucide-react";
import { ShortageSheetContent } from "../components/shorts/ShortageSheetView";
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
  useReportSnapshot,
  useCaptureReport,
  dayOverrideKey,
  holidayOpKey,
  parseDayOverride,
  parseHolidayFlag,
  parseTrackedItemCategories,
  parseTrackedItems,
  prevDayCarriersFrom,
  prevDaySplitHelpersFrom,
  type ReportSnapshot,
  type TrackedItem,
} from "../api/hooks";
import { buildOperationalDayContext, cargoCarriers, countUnloadedFromContext, nextRunDate, previousRunDate } from "../utils/truckStatus";
import type { AuditEntry, BatchSummary, RecurringRouteSwap, RouteSwap, Shortage, SpareAssignment, TruckWithState } from "../types";
import Modal from "../components/Modal";
import PageStatus, { pageStatusFor } from "../components/PageStatus";
import { useLoadTimerVisible } from "../hooks/useLoadTimerVisible";
import { useAuth } from "../contexts/AuthContext";
import { can } from "../utils/permissions";
import { ArchiveModal, ArchiveStrip, SavedPill, savedAtLabel } from "./report/ReportArchive";

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
type SectionKey = "batches" | "coverage" | "cargo" | "loadTimes" | "shortages" | "shortSheet" | "audit";

// topCatOf is imported from the shared picker module — this file used to keep
// its own byte-identical copy "mirroring Audit.tsx", which is exactly how the
// three versions drifted.

function clock(epochSec: number | null | undefined): string {
  return epochSec ? formatEasternTime(epochSec) : "—";
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={clsx("mt-0.5 text-2xl font-bold leading-tight tabular-nums", tone ?? "text-ink")}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-muted">{sub}</p> : null}
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
  sectionKey,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  /** Stable id so the Images generator can find this block in the DOM. */
  sectionKey?: string;
  /** When set, renders a "Download image" button that snapshots this whole
   *  section (title + content) to a PNG with the given base filename. */
  downloadName?: string;
}) {
  const captureRef = useRef<HTMLElement>(null);
  const inKioskSlide = useContext(KioskSlideContext);
  return (
    <section ref={captureRef} data-report-section={sectionKey} className="space-y-3">
      {!inKioskSlide && (
        <h2 className="flex items-baseline gap-2 text-xl font-bold text-ink">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{eyebrow}</span>
          {title}
        </h2>
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
        <span className={clsx("shrink-0 whitespace-nowrap font-mono text-sm font-semibold tabular-nums", text)}>
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
            <span key={t.truck_number} className="inline-flex items-baseline gap-1 rounded-md bg-surface-2 px-2 py-0.5">
              <span className="font-mono text-base font-black tabular-nums text-ink">#{t.truck_number}</span>
              <span className="text-xs text-ink-faint">({t.wearers})</span>
            </span>
          ))}
        </div>
      )}
    </AnimateCard>
  );
}

/**
 * Everything the report derives and renders, in one object. LiveReportData
 * fills it from the per-run-date hooks; SavedReportData from an archived
 * snapshot. The body reads nothing else about the day.
 */
interface ReportInputs {
  runDate: string;
  /** Today's live view — coverage then hides returned spares. Never true for a saved day. */
  isToday: boolean;
  board: TruckWithState[];
  batches: BatchSummary[];
  shorts: Shortage[];
  auditEntries: AuditEntry[];
  spares: SpareAssignment[];
  routeSwaps: RouteSwap[];
  /** The app settings the report reads (wearer_cap, batch_no_cap, batching_disabled, recurring_route_swaps). */
  settings: { key: string; value: unknown }[];
  /** The catalog as the hook returns it — [] until loaded; the body falls back to the defaults. */
  trackedItems: TrackedItem[];
  palette: CategoryPalette;
  itemDisplayName: (label: string) => string;
  /** 30-day load pace average, seconds. */
  paceAvg: number | null;
  loadDayOverride: number | null;
  unloadsDayOverride: number | null;
  holidayUnload: boolean;
  prevSplitHelpers: Set<number>;
  prevDayCarriers: Map<number, TruckWithState>;
}

/** What the page wraps around the body: header pill, date bar, PDF handoff. */
interface ReportChrome {
  /** Beside the title and in the kiosk bar — LIVE, or "Saved 5:58 AM". */
  badge?: ReactNode;
  /** The date bar under the header. Handed the VIEWED day's numbers, which are
   *  override-aware and so come from the report's own inputs. */
  dateBar: (days: { loadDay: number; unloadsDay: number }) => ReactNode;
  /** `?pdf=1` is pending. The page owns the one-shot flag so a body that
   *  remounts (Saved ⇄ Live) can't fire the download twice. */
  autoPdf: boolean;
  onAutoPdfFired: () => void;
  /** Extra PDF header line — a saved day says when it was saved. */
  pdfNote: string | null;
  /** Keep the date bar (and its Saved/Live toggle) above a loading/unreachable gate. */
  keepDateBarOnGate: boolean;
}

/**
 * The Report page: which day, and which reading of it. Today is always live. A
 * past day opens from its end-of-shift snapshot when it has one (with a
 * Saved/Live toggle), else live with a note that it isn't archived.
 */
export default function LiveReport() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const canArchive = can(user?.role, "archive:reports");
  const [runDate, setRunDate] = useState(params.get("run_date") ?? todayIso());
  // The shell polls nothing (LiveReportData does), so nothing else re-renders
  // it at the 6 AM rollover. Keep "today" fresh on a clock — an unchanged
  // string bails out, so this re-renders only when the run day actually flips.
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    const id = window.setInterval(() => setToday(todayIso()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const isToday = runDate === today;
  // Which reading of the day is on screen. null = the day's default: its
  // snapshot when it has one, else live. A day opened as TODAY is pinned live,
  // so a wall kiosk left running across the 6 AM rollover keeps rotating the
  // live day instead of dropping into the archive mid-slide.
  const [view, setView] = useState<"saved" | "live" | null>(() => (isToday ? "live" : null));
  const [autoPdf, setAutoPdf] = useState(() => params.get("pdf") === "1");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [confirmResave, setConfirmResave] = useState(false);

  // Today is never looked up — it hasn't been archived, and it's always live.
  const snapshotQuery = useReportSnapshot(isToday ? null : runDate);
  const snapshot = snapshotQuery.data ?? null;
  // null is the archive ANSWERING "not archived"; undefined is no answer yet
  // (loading, paused offline, or the lookup failed) — unknown, not absent.
  const archiveAnswered = snapshotQuery.data !== undefined;
  // ...and null only counts as "not archived" while it is the CURRENT answer.
  // v5 keeps the last data when a refetch fails, and a persisted or stale null
  // is being refetched; either way the state is unknown again.
  const answeredNotArchived =
    snapshotQuery.data === null && snapshotQuery.isSuccess && snapshotQuery.fetchStatus === "idle";
  const savedSnapshot = !isToday && view !== "live" ? snapshot : null;
  const capture = useCaptureReport();

  /** Move to another run day. A past day goes in the URL (replace — stepping
   *  days shouldn't pile up Back entries) so it can be shared; today keeps the
   *  URL bare, so a reload after the rollover opens the new today, not
   *  yesterday's saved report. The PDF handoff belonged to the day it arrived
   *  with, so it's dropped. */
  function goTo(date: string) {
    const now = todayIso();
    setRunDate(date);
    setView(date === now ? "live" : null);
    setAutoPdf(false);
    const next = new URLSearchParams(params);
    if (date === now) next.delete("run_date");
    else next.set("run_date", date);
    next.delete("pdf");
    setParams(next, { replace: true });
  }

  // Re-saving replaces the day's snapshot — normally the end-of-shift record —
  // so it asks first. Only a day the archive has just answered "not archived"
  // for saves straight away: unknown must never skip the question.
  function handleCapture(archivedElsewhere = false) {
    if (answeredNotArchived && !archivedElsewhere) capture.mutate(runDate);
    else setConfirmResave(true);
  }

  // A past day opens saved when it has a snapshot, so hold the body until the
  // archive answers rather than flash the live recompute first. (An explicit
  // view choice doesn't wait on it.) The live body stays mounted meanwhile —
  // its section picks survive and its queries start alongside the lookup.
  // (data === undefined && isFetching, not v5's isLoading: that is false while
  // a lookup that failed before is retried, which would flash the live day.)
  const holdForLookup =
    !isToday && view === null && snapshotQuery.data === undefined && snapshotQuery.isFetching;

  const chrome: ReportChrome = {
    badge: isToday ? (
      <HeaderPill tone="inprogress" pulse>Live</HeaderPill>
    ) : savedSnapshot ? (
      <SavedPill item={savedSnapshot} />
    ) : undefined,
    // Hold the ?pdf=1 handoff until the archive lookup (or a stale snapshot's
    // background refetch) has settled, so it prints the reading the page will
    // actually show: the saved snapshot when there is one, otherwise live.
    autoPdf: autoPdf && !holdForLookup && !snapshotQuery.isFetching,
    onAutoPdfFired: () => setAutoPdf(false),
    pdfNote: savedSnapshot ? `Saved ${savedAtLabel(savedSnapshot, true)}` : null,
    // An archived day keeps its Saved/Live toggle through a live-mode outage —
    // the saved reading needs no network.
    keepDateBarOnGate: !isToday && snapshot != null,
    dateBar: ({ loadDay, unloadsDay }) => (
      <>
        {/* Date scope — one toolbar at every width (the old phone-only bar,
            promoted; desktop gains the prev/next arrows it never had). Day
            numbers stay out: the top bar's L/U chips own them. */}
        <div className="flex items-center gap-2 border-b border-hairline bg-surface/60 px-3 py-2 md:px-6">
          <button
            type="button"
            aria-label="Previous run day"
            onClick={() => goTo(previousRunDate(runDate))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-lg leading-none text-ink-soft active:scale-95"
          >
            ‹
          </button>
          <input
            className="input min-w-0 flex-1 text-sm [color-scheme:dark] md:w-44 md:flex-none"
            type="date"
            max={today}
            value={runDate}
            onChange={(e) => e.target.value && goTo(e.target.value)}
          />
          <button
            type="button"
            aria-label="Next run day"
            disabled={isToday}
            onClick={() => goTo(nextRunDate(runDate, today))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-lg leading-none text-ink-soft active:scale-95 disabled:opacity-30"
          >
            ›
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => goTo(today)}
              className="shrink-0 rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink-soft active:scale-95"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            aria-label="Archived reports"
            title="Archived reports"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink-soft active:scale-95"
          >
            <Archive className="h-4 w-4" />
            <span className="hidden sm:inline">Archive</span>
          </button>
          {/* The VIEWED date's day numbers (override-aware) — the top bar's
              chips only know about today, so a historical report needs its own.
              Short form on phones, where the Archive button took the room. */}
          <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-ink-muted">
            <span className="sm:hidden">L{loadDay} · U{unloadsDay}</span>
            <span className="hidden sm:inline">Load {loadDay} · Unload {unloadsDay}</span>
          </span>
        </div>
        {!isToday && (
          <ArchiveStrip
            snapshot={snapshot}
            lookupFailed={snapshotQuery.isError}
            lookupPending={!snapshotQuery.isError && !answeredNotArchived}
            saved={savedSnapshot != null}
            onViewChange={setView}
            // No Save button until the archive has answered — "Save this day
            // now" on a day whose state is unknown could replace its snapshot.
            canArchive={canArchive && archiveAnswered}
            capturing={capture.isPending}
            onCapture={() => handleCapture()}
          />
        )}
      </>
    ),
  };

  return (
    <>
      {archiveOpen && (
        <ArchiveModal
          onClose={() => setArchiveOpen(false)}
          selectedDate={runDate}
          selectedIsToday={isToday}
          selectedArchived={snapshot != null}
          selectedUnknown={snapshot == null && !answeredNotArchived}
          onOpenDay={(date) => {
            goTo(date);
            setArchiveOpen(false);
          }}
          canArchive={canArchive}
          capturing={capture.isPending}
          onCapture={handleCapture}
        />
      )}
      <ConfirmDialog
        open={confirmResave}
        title={`Re-save ${formatRunDate(runDate)}?`}
        description={
          snapshot
            ? `This replaces the snapshot saved ${savedAtLabel(snapshot, true)} with the day as the server has it now. The replaced snapshot can't be brought back.`
            : `${formatRunDate(runDate)} may already be saved. If it is, this replaces that snapshot with the day as the server has it now, and it can't be brought back.`
        }
        confirmLabel="Re-save"
        variant="danger"
        busy={capture.isPending}
        onConfirm={() => capture.mutate(runDate, { onSettled: () => setConfirmResave(false) })}
        onCancel={() => setConfirmResave(false)}
      />
      {savedSnapshot ? (
        <SavedReportData snapshot={savedSnapshot} chrome={chrome} />
      ) : (
        <LiveReportData runDate={runDate} isToday={isToday} hold={holdForLookup} chrome={chrome} />
      )}
    </>
  );
}

/** Live mode: the report inputs straight from the per-run-date hooks. */
function LiveReportData({
  runDate,
  isToday,
  hold,
  chrome,
}: {
  runDate: string;
  /** The shell's — so the body's coverage rule and the chrome's LIVE pill flip together. */
  isToday: boolean;
  /** The archive lookup is still out: show "loading" instead of the live recompute. */
  hold: boolean;
  chrome: ReportChrome;
}) {
  const { data: loadDayOverride } = useLoadDayOverride(runDate);
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const { data: settings = [] } = useSettings();

  // Per-run-date data (all keyed by runDate; poll/WS keep them live).
  const boardQuery = useBoard(runDate);
  const { data: board = [] } = boardQuery;
  const { data: batches = [] } = useBatchSummary(runDate);
  const { data: shorts = [] } = useShortages(runDate);
  const { data: auditEntries = [] } = useAuditEntries(runDate);
  const { data: trackedItems = [] } = useTrackedItems();
  const palette = useCategoryPalette();
  const itemDisplayName = useItemDisplayName();
  const { data: spares = [] } = useSpareAssignments(runDate);
  const { data: routeSwaps = [] } = useRouteSwaps(runDate);
  const { data: pace } = usePaceAverage(30);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const prevDayCarriers = usePrevDayCarriers(runDate, board);

  // The audit query has no websocket/poll of its own — refresh it on an interval
  // so this "live" report doesn't show a stale audit section.
  const qc = useQueryClient();
  useEffect(() => {
    const id = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["audit", runDate] });
    }, 20000);
    return () => window.clearInterval(id);
  }, [qc, runDate]);

  const inputs: ReportInputs = {
    runDate,
    isToday,
    board,
    batches,
    shorts,
    auditEntries,
    spares,
    routeSwaps,
    settings,
    trackedItems,
    palette,
    itemDisplayName,
    paceAvg: pace?.avg_seconds ?? null,
    loadDayOverride: loadDayOverride ?? null,
    unloadsDayOverride: unloadsDayOverride ?? null,
    holidayUnload,
    prevSplitHelpers,
    prevDayCarriers,
  };
  // Loading / dead-connection gate — never render the fake empty day.
  const gate = hold ? ({ kind: "loading" } as const) : pageStatusFor(boardQuery);
  return <ReportBody inputs={inputs} gate={gate} chrome={chrome} />;
}

/**
 * A saved day's snapshot → the same ReportInputs the live hooks produce,
 * through the same pure parsers they use (catalog, category palette, display
 * names, day overrides, holiday flag, previous-day coverage). Nothing here
 * derives a rule of its own — if it did, the saved and live readings could
 * drift. Every list defaults to empty so a thin snapshot degrades to empty
 * sections rather than a crash.
 */
function inputsFromSnapshot(snapshot: ReportSnapshot): ReportInputs {
  const runDate = snapshot.run_date;
  const s = snapshot.inputs;
  const stored = s.settings ?? {};
  const board = s.board ?? [];
  const swapLog = s.route_swap_log ?? [];
  const prevOp = s.prev_operating_day ?? null;
  const trackedItems = parseTrackedItems(stored.tracked_items_map);
  return {
    runDate,
    // A saved day is over, so coverage keeps the spares returned since.
    isToday: false,
    board,
    batches: s.batches ?? [],
    shorts: s.shortages ?? [],
    auditEntries: s.audit_entries ?? [],
    spares: s.spares ?? [],
    routeSwaps: s.route_swaps ?? [],
    settings: Object.entries(stored).map(([key, value]) => ({ key, value })),
    trackedItems,
    palette: paletteForCatalog(trackedItems, parseTrackedItemCategories(stored.tracked_item_categories)),
    itemDisplayName: itemDisplayNameFor(trackedItems),
    paceAvg: s.pace_avg_seconds ?? null,
    loadDayOverride: parseDayOverride(stored[dayOverrideKey("load_day", runDate)]),
    unloadsDayOverride: parseDayOverride(stored[dayOverrideKey("unloads_day", runDate)]),
    holidayUnload: parseHolidayFlag(stored[holidayOpKey("unload", runDate)]),
    prevSplitHelpers: prevDaySplitHelpersFrom(swapLog, runDate, prevOp),
    prevDayCarriers: prevDayCarriersFrom(swapLog, runDate, prevOp, board),
  };
}

/** Saved mode: the report inputs from the archived snapshot. Fetches nothing. */
function SavedReportData({ snapshot, chrome }: { snapshot: ReportSnapshot; chrome: ReportChrome }) {
  const inputs = useMemo(() => inputsFromSnapshot(snapshot), [snapshot]);
  return <ReportBody inputs={inputs} gate={null} chrome={chrome} />;
}

/** The report itself — sections, KPIs, kiosk, Images, PDF — for one day's inputs. */
function ReportBody({
  inputs,
  gate,
  chrome,
}: {
  inputs: ReportInputs;
  gate: ReturnType<typeof pageStatusFor>;
  chrome: ReportChrome;
}) {
  const {
    runDate,
    isToday,
    board,
    batches,
    shorts,
    auditEntries,
    spares,
    routeSwaps,
    settings,
    trackedItems,
    palette,
    itemDisplayName,
    paceAvg,
    loadDayOverride,
    unloadsDayOverride,
    holidayUnload,
    prevSplitHelpers,
    prevDayCarriers,
  } = inputs;

  // Day numbers for the header, with the same per-run-date overrides Load/Unload use.
  const dayDate = useMemo(() => new Date(runDate + "T12:00:00"), [runDate]);
  const { loadDay: computedLoadDay, unloadsDay: computedUnloadsDay } = workdayNumbers(dayDate);
  const loadDay = loadDayOverride ?? computedLoadDay;
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;

  // Settings-derived caps/flags.
  const noCap = resolveNoCap(settings);
  const batchingDisabled = settings.some((s) => s.key === "batching_disabled" && s.value === true);
  const cap = useMemo(() => resolveWearerCap(settings), [settings]);
  const recurringRules = useMemo(() => {
    // Guard against a non-array value (the setting is admin-editable) so
    // isRecurring's `.some(...)` can't throw and crash the coverage section.
    const row = settings.find((s) => s.key === "recurring_route_swaps");
    return Array.isArray(row?.value) ? (row!.value as RecurringRouteSwap[]) : [];
  }, [settings]);

  const boardByNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);

  // ---- Unload / batches ----
  const trucksBatched = useMemo(() => batches.reduce((n, b) => n + b.trucks.length, 0), [batches]);
  const totalWearers = useMemo(() => batches.reduce((n, b) => n + b.total_wearers, 0), [batches]);
  const batchesUsed = useMemo(() => batches.filter((b) => b.trucks.length > 0).length, [batches]);
  // Same counting as the Unload page: unload-day roster only, pure day-init
  // seeds pending (not done), "loaded" still counts as unloaded-then-moved-on.
  // The old whole-fleet raw-status filter started the day at the seed count
  // and climbed past the roster size as trucks loaded overnight.
  const unloadCtx = useMemo(
    () => buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload", prevSplitHelpers),
    [board, unloadsDay, holidayUnload, prevSplitHelpers],
  );
  const unloadedCount = countUnloadedFromContext(unloadCtx, prevDayCarriers);
  const unloadRosterSize = unloadCtx.activeTrucks.length;

  // ---- Coverage ("routes covered") ----
  const coverageRows = useMemo(() => {
    type Row = {
      routeTruck: number;
      loadOnTruck: number | null;
      type: string;
      returned: boolean;
      split: boolean;
      crossload?: boolean;
      pending?: boolean;
    };
    const rows: Row[] = [];
    const seen = new Set<string>();
    const seenRoutes = new Set<number>();
    const add = (
      routeTruck: number,
      loadOnTruck: number | null,
      type: string,
      returned = false,
      split = false,
      extra: { crossload?: boolean; pending?: boolean } = {},
    ) => {
      const key = `${routeTruck}->${loadOnTruck ?? "?"}`;
      if (seen.has(key)) return;
      seen.add(key);
      seenRoutes.add(routeTruck);
      rows.push({ routeTruck, loadOnTruck, type, returned, split, ...extra });
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
      // A crossload's assignment row IS the durable "freight moved" record —
      // label it as such; classic (and pre-migration) rows stay "Spare cover".
      const isXload = s.kind === "crossload";
      add(s.covering_route_truck, s.spare_truck_number, isXload ? "Crossloaded" : "Spare cover", s.returned, false, { crossload: isXload });
    }
    // Pending crossloads LAST: the flag lingers on the source truck until the
    // move happens (or is cleared), so any performed coverage for the same
    // route wins the dedupe. Target may still be unassigned.
    for (const t of board) {
      if (!(t.state?.needs_crossload || t.state?.crossload_to_truck != null)) continue;
      if (seenRoutes.has(t.truck_number)) continue;
      add(t.truck_number, t.state?.crossload_to_truck ?? null, "Needs crossload", false, false, { crossload: true, pending: true });
    }
    return rows.sort((a, b) => a.routeTruck - b.routeTruck);
  }, [routeSwaps, spares, isToday, board]);

  const isRecurring = (routeTruck: number, loadOnTruck: number) =>
    recurringRules.some((r) => r.route_truck === routeTruck && r.load_on_truck === loadOnTruck && r.days.includes(loadDay));

  // ---- F.S. garments & NOGs ----
  // What was SUPPOSED to go out with each load (the day's garments / NOGs
  // flags, set at Setup Day) and whether it did. Same rule as the Load page's
  // strips: a flag is out the door once the truck CARRYING that route's load
  // is loaded — its own truck, or the coverage carrier. A loaded truck whose
  // freight still has to be crossloaded (taken out of service after loading)
  // has NOT gone out: the coverage section shows it "Not moved yet", and this
  // section must agree.
  const cargo = useMemo(() => {
    const carriers = cargoCarriers(board);
    type CargoRow = { truck: number; carrier: number | null; loaded: boolean; loading: boolean; xload: boolean; finish: number | null };
    const rowOf = (t: TruckWithState): CargoRow => {
      const carrier = carriers.get(t.truck_number) ?? null;
      const st = (carrier ?? t).state;
      const xload = st?.needs_crossload === true || st?.crossload_to_truck != null;
      return {
        truck: t.truck_number,
        carrier: carrier?.truck_number ?? null,
        loaded: st?.status === "loaded" && !xload,
        loading: st?.status === "in_progress",
        xload,
        finish: st?.load_finish_time ?? null,
      };
    };
    const byNum = (a: TruckWithState, b: TruckWithState) => a.truck_number - b.truck_number;
    const garments = board.filter((t) => t.state?.has_dust_garment === true).sort(byNum).map(rowOf);
    const nogs = board.filter((t) => t.state?.has_nogs === true).sort(byNum).map(rowOf);
    return { garments, nogs };
  }, [board]);
  const cargoLabel = (r: { loaded: boolean; loading: boolean; xload: boolean; finish: number | null }) =>
    r.xload ? "Needs crossload" : r.loaded ? `Loaded${r.finish ? ` · ${clock(r.finish)}` : ""}` : r.loading ? "Loading…" : "Not loaded";
  const cargoTotal = cargo.garments.length + cargo.nogs.length;

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
  const durTone = (d: number) =>
    paceAvg == null ? "text-ink" : d <= paceAvg ? "text-emerald-400" : d <= paceAvg * 1.25 ? "text-amber-400" : "text-red-400";

  // ---- Shortages ----
  const itemsForLabels = catalogOrDefault(trackedItems);
  const shortLabel = (s: Shortage) => shortageItemLabel(s.item_category, s.item_detail, itemsForLabels);
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
  // Short-sheet layout is owned here (not inside ShortageSheetView) so the
  // Images export can flip it to capture BOTH the grid and the paper sheet.
  const [sheetLayout, setSheetLayout] = useState<"grid" | "paper">("grid");
  // Images export — same section choice as the PDF, one PNG per section.
  const [imagesOpen, setImagesOpen] = useState(false);
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [imgDone, setImgDone] = useState(0);
  const [imgErr, setImgErr] = useState(false);
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
    batches: true, coverage: true, cargo: true, loadTimes: true, shortages: true, shortSheet: true, audit: true,
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
      shift_label: chrome.pdfNote,
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
          const st = r.loadOnTruck != null ? boardByNum.get(r.loadOnTruck)?.state : undefined;
          const done = !r.pending && st?.status === "loaded";
          const status_label = r.pending
            ? "Not moved yet"
            : done
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
            recurring: r.loadOnTruck != null && isRecurring(r.routeTruck, r.loadOnTruck),
            returned: r.returned,
            split: r.split,
            crossload: r.crossload === true,
            pending: r.pending === true,
            loaded: done,
            status_label,
            status_hex: done ? "#3b82f6" : "#7a8698",
          };
        }),
      };
    }

    if (sel.cargo) {
      const row = (r: (typeof cargo.garments)[number]) => ({
        truck_number: r.truck,
        carrier_truck: r.carrier,
        loaded: r.loaded,
        status_label: cargoLabel(r),
        status_hex: r.xload ? "#f0abfc" : r.loaded ? "#3b82f6" : r.loading ? "#7a8698" : "#f59e0b",
      });
      const kpi = (label: string, rows: typeof cargo.garments) => {
        const out = rows.filter((r) => r.loaded).length;
        return {
          label,
          value: `${out}/${rows.length}`,
          sub: rows.length === 0 ? "none set" : out === rows.length ? "all out the door" : `${rows.length - out} not loaded`,
          tone: rows.length === 0 ? null : out === rows.length ? "#3b82f6" : "#f59e0b",
        };
      };
      vm.cargo = {
        kpis: [kpi("F.S. garments", cargo.garments), kpi("NOGs", cargo.nogs)],
        garments: cargo.garments.map(row),
        nogs: cargo.nogs.map(row),
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
      const items = itemsForLabels;
      // Printed-sheet order, so the PDF's short sheet reads in the same
      // sequence as the paper and as the on-screen editor.
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
                split_by_truck: Object.fromEntries(
                  (board ?? [])
                    .filter((t) => t.route_split_route != null && m.trucks.includes(t.truck_number))
                    .map((t) => [t.truck_number, t.route_split_route as number]),
                ),
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
          ...(openWarnings > 0 ? [{ label: "Open warnings", value: String(openWarnings), tone: "#fbbf24" }] : []),
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
            // Qualify for the PDF: the stored label for a garment is only its
            // colour, so this read "Black" instead of "Black Aprons".
            item_label: itemDisplayName(e.item_label),
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

  // `?pdf=1` — download the full report and stop, so another surface can hand
  // off to THIS composer instead of growing a second one. buildViewModel closes
  // over ~44 memos from this component; the report router's own docstring says
  // the browser composes the view-model here by design, so Management's PDF
  // download drives this page rather than re-deriving any of it.
  //
  // Waits on `board`: the memos feed off it, and firing on the first render
  // would post a view-model full of empty sections. On a past day with a
  // snapshot this is the saved report, like everything else on the page.
  // Never while gated — a held or loading body isn't the reading on screen.
  const { autoPdf, onAutoPdfFired } = chrome;
  const gated = gate != null;
  useEffect(() => {
    if (!autoPdf || gated) return;
    if (board.length === 0) return;
    onAutoPdfFired();
    void handleDownloadPdf(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPdf, board.length, gated]);

  // Which sections have content today (drives the picker's muted hints).
  // `phase` mirrors each Section's eyebrow so kiosk mode can show it in the
  // toolbar instead of inside the slide.
  // Order matches the report page AND the PDF: coverage first (who is carrying
  // whose route is the first thing to know), batches last.
  const sectionDefs: { key: SectionKey; label: string; phase: "Load" | "Unload"; hint?: string }[] = [
    { key: "coverage", label: "Routes covered", phase: "Load", hint: coverageRows.length ? undefined : "empty" },
    { key: "cargo", label: "Garments & NOGs", phase: "Load", hint: cargoTotal ? undefined : "empty" },
    { key: "shortages", label: "Shortages", phase: "Load", hint: shorts.length ? undefined : "empty" },
    { key: "shortSheet", label: "Short sheet", phase: "Load", hint: shorts.length ? undefined : "empty" },
    { key: "loadTimes", label: "Load times", phase: "Load", hint: finished.length ? undefined : "empty" },
    { key: "audit", label: "Audit", phase: "Load", hint: auditByTruck.length ? undefined : "empty" },
    { key: "batches", label: "Batches", phase: "Unload", hint: batchingDisabled ? "off" : batches.length ? undefined : "empty" },
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
  // The kiosk is a wall screen the crew sees, so it follows the Operations
  // "Load timer" switch: off, the Load times slide and the coverage cards'
  // durations stay off the wall. The report itself keeps every number.
  const showLoadTimer = useLoadTimerVisible();
  const [kioskTick, setKioskTick] = useState(0); // drives the progress bar

  // Only rotate through sections the user picked that actually have something
  // to show — nobody wants a wall display parked on "No shortages logged".
  const kioskSlides = useMemo(() => {
    const has: Record<SectionKey, boolean> = {
      shortages: shorts.length > 0,
      shortSheet: shorts.length > 0,
      batches: (batches?.length ?? 0) > 0,
      coverage: coverageRows.length > 0,
      cargo: cargoTotal > 0,
      loadTimes: finished.length > 0,
      audit: auditEntries.length > 0,
    };
    const allowed = (d: (typeof sectionDefs)[number]) => selected[d.key] && (showLoadTimer || d.key !== "loadTimes");
    const live = sectionDefs.filter((d) => allowed(d) && has[d.key]);
    // Fall back to whatever is selected so kiosk mode is never empty.
    return (live.length > 0 ? live : sectionDefs.filter(allowed)).map((d) => d.key);
  }, [selected, shorts.length, batches, coverageRows.length, cargoTotal, finished.length, auditEntries.length, sectionDefs, showLoadTimer]);

  // null = nothing left to rotate: only Load times was picked and the Load
  // timer switch hides it. Show that plainly rather than an unpicked section.
  const kioskKey: SectionKey | null = kioskSlides[Math.min(kioskIdx, Math.max(0, kioskSlides.length - 1))] ?? null;
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

  /**
   * Save one PNG per selected section. Each section is captured from the live
   * DOM by its data-report-section id, through the same desktop-width iframe the
   * per-section download uses — so the images come out at report-page width and
   * resolution rather than whatever the current viewport happens to be.
   *
   * Downloads are sequential with a beat between them: browsers throttle (or
   * silently drop) a burst of programmatic saves.
   */
  async function handleDownloadImages(sel: Record<SectionKey, boolean>) {
    const wanted = sectionDefs.filter((d) => sel[d.key]);
    if (wanted.length === 0) return;
    setImgErr(false);
    setImgDone(0);
    let failed = false;
    const restoreLayout = sheetLayout;
    for (const def of wanted) {
      // The short sheet has two readings — the truck x item grid and the paper
      // sheet cards — and the PDF prints both, so the images do too.
      const variants: { suffix: string; layout?: "grid" | "paper" }[] =
        def.key === "shortSheet"
          ? [{ suffix: "Grid", layout: "grid" }, { suffix: "Sheet", layout: "paper" }]
          : [{ suffix: "" }];
      for (const v of variants) {
        if (v.layout) {
          setSheetLayout(v.layout);
          // Let React commit the layout switch before the DOM is cloned.
          await new Promise((r) => setTimeout(r, 250));
        }
        const node = document.querySelector<HTMLElement>(`[data-report-section="${def.key}"]`);
        if (!node) continue; // section not rendered (e.g. deselected earlier)
        setImgBusy(v.suffix ? `${def.label} (${v.suffix})` : def.label);
        try {
          const blob = await captureNodeToPngBlob(node);
          const name = v.suffix ? `${def.label}-${v.suffix}` : def.label;
          const safe = `ReadyRoute-${name}-${runDate}`.replace(/\s+/g, "-").replace(/[^\w.-]/g, "").replace(/-{2,}/g, "-");
          await exportFile(blob, `${safe}.png`, "image/png");
          setImgDone((n) => n + 1);
        } catch (e) {
          console.error("report images: capture failed for", def.key, v.suffix, e);
          failed = true;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    setSheetLayout(restoreLayout);
    setImgBusy(null);
    if (failed) setImgErr(true);
    else setImagesOpen(false);
  }

  // The short sheet yields two images (grid + paper sheet), so the progress
  // denominator isn't simply the number of ticked sections.
  const imgTotal = sectionDefs.filter((d) => selected[d.key])
    .reduce((n, d) => n + (d.key === "shortSheet" ? 2 : 1), 0);

  const imagesButton = (
    <button
      type="button"
      onClick={() => {
        setImgErr(false);
        setImgDone(0);
        setImagesOpen(true);
      }}
      disabled={imgBusy !== null}
      title="Download the report as images"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-soft active:scale-95 disabled:opacity-50"
    >
      <ImageIcon className="h-4 w-4" />
      {imgBusy ? "…" : "Images"}
    </button>
  );

  const imagesPicker = imagesOpen
    ? createPortal(
        <Modal open onClose={() => imgBusy === null && setImagesOpen(false)} size="sm">
            <h3 className="text-base font-semibold text-ink">Download report images</h3>
            <p className="mt-1 text-sm text-ink-muted">
              One PNG per section, at report-page size — the short sheet gives you both the
              grid and the paper sheet. Your browser may ask to allow multiple downloads.
            </p>
            <div className="mt-4 space-y-0.5">
              {sectionDefs.map((sec) => (
                <label
                  key={sec.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2/60"
                >
                  <input
                    type="checkbox"
                    checked={selected[sec.key]}
                    disabled={imgBusy !== null}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [sec.key]: e.target.checked }))}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <span className="flex-1 text-sm text-ink-soft">{sec.label}</span>
                  {sec.hint && <span className="text-[11px] text-ink-muted">{sec.hint}</span>}
                </label>
              ))}
            </div>
            {imgBusy && (
              <p className="mt-3 text-xs text-sky-300">
                Capturing {imgBusy}… ({imgDone}/{imgTotal})
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {imgErr && <span className="mr-auto text-xs text-st-dirty">Some sections failed — try again.</span>}
              <button className="btn-ghost" onClick={() => setImagesOpen(false)} disabled={imgBusy !== null}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => void handleDownloadImages(selected)}
                disabled={imgBusy !== null || !anySelected}
              >
                {imgBusy ? "Generating…" : "Download images"}
              </button>
            </div>
                  </Modal>,
        document.body,
      )
    : null;

  const sectionPicker = pickerOpen
    ? createPortal(
        <Modal open onClose={() => !pdfBusy && setPickerOpen(false)} size="sm">
            <h3 className="text-base font-semibold text-ink">Download report PDF</h3>
            <p className="mt-1 text-sm text-ink-muted">Choose which sections to include.</p>
            <div className="mt-4 space-y-0.5">
              {sectionDefs.map((s) => (
                <label
                  key={s.key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2/60"
                >
                  <input
                    type="checkbox"
                    checked={selected[s.key]}
                    onChange={(e) => setSelected((p) => ({ ...p, [s.key]: e.target.checked }))}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <span className="flex-1 text-sm text-ink-soft">{s.label}</span>
                  {s.hint && <span className="text-[11px] text-ink-muted">{s.hint}</span>}
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
                  </Modal>,
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
        {/* ===================== LOAD · COVERAGE ===================== */}
        {showSection("coverage") && (
        <Section eyebrow="Load" title="Routes covered" sectionKey="coverage">
          {coverageRows.length === 0 ? (
            <Empty>No route coverage recorded for this day.</Empty>
          ) : (<>
            <p className="mb-2 text-[11px] text-ink-muted">
              Spare cover / Crossloaded = freight moved · Needs crossload = still waiting
            </p>
            {/* Full coverage cards — the canonical big ROUTE → TRUCK paired
                numbers (same read as a fleet coverage card), not a dense list. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {coverageRows.map((r) => {
                const st = r.loadOnTruck != null ? boardByNum.get(r.loadOnTruck)?.state : undefined;
                const done = !r.pending && st?.status === "loaded";
                return (
                  <div
                    key={`${r.routeTruck}-${r.loadOnTruck ?? "unassigned"}`}
                    className="rounded-xl border border-hairline bg-surface p-4"
                  >
                    <div className="flex items-center justify-center gap-4">
                      <div className="text-center">
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">Route</p>
                        <p className="font-mono text-3xl font-black leading-none tabular-nums text-sky-300">
                          #{r.routeTruck}
                        </p>
                      </div>
                      {/* A split isn't a handoff — the route runs on BOTH
                          trucks — so it reads "+", matching CoverageCards and
                          the truck cards. Only real coverage gets the arrow. */}
                      <span className="text-2xl font-black leading-none text-ink-faint">{r.split ? "+" : "→"}</span>
                      <div className="text-center">
                        {/* Past tense only once the carrier has actually loaded. */}
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                          {done ? "Loaded on" : "Loads on"}
                        </p>
                        <p className="font-mono text-3xl font-black leading-none tabular-nums text-ink">
                          {r.loadOnTruck != null ? `#${r.loadOnTruck}` : <span className="text-ink-faint">?</span>}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                      <span
                        className={
                          r.pending
                            ? "rounded bg-fuchsia-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300 ring-1 ring-fuchsia-800/50"
                            : r.crossload
                              ? "rounded bg-violet-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-800/50"
                              : "rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted"
                        }
                      >
                        {r.type}
                      </span>
                      {r.pending && r.loadOnTruck == null && (
                        <span className="rounded bg-fuchsia-950/25 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300/80">assign a truck</span>
                      )}
                      {r.loadOnTruck != null && isRecurring(r.routeTruck, r.loadOnTruck) && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">recurring</span>
                      )}
                      {r.returned && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">returned</span>
                      )}
                    </div>
                    <p className="mt-2.5 border-t border-hairline pt-2 text-center text-sm">
                      {done ? (
                        <span className="text-st-loaded">
                          Loaded
                          {st?.load_finish_time ? ` · ${clock(st.load_finish_time)}` : ""}
                          {(!kiosk || showLoadTimer) && st?.load_duration_seconds != null ? ` · ${formatDuration(st.load_duration_seconds)}` : ""}
                        </span>
                      ) : r.pending ? (
                        <span className="text-fuchsia-300/80">Not moved yet</span>
                      ) : (
                        <span className="text-ink-faint">{st?.status === "in_progress" ? "Loading…" : "Not loaded"}</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </>)}
        </Section>
        )}
        {/* ===================== LOAD · GARMENTS & NOGS ===================== */}
        {showSection("cargo") && (
        <Section eyebrow="Load" title="Garments & NOGs" sectionKey="cargo" downloadName={dlName("Garments-NOGs")}>
          {cargoTotal === 0 ? (
            <Empty>No F.S. garments or NOGs were set for this day.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {([
                { title: "F.S. garments", tone: "text-amber-400", rows: cargo.garments },
                { title: "NOGs", tone: "text-rose-400", rows: cargo.nogs },
              ] as const).map(({ title, tone, rows }) => {
                const out = rows.filter((r) => r.loaded).length;
                return (
                  <div key={title} className="rounded-xl border border-hairline bg-surface p-4">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <p className={clsx("text-xs font-semibold uppercase tracking-wide", tone)}>{title}</p>
                      {rows.length > 0 && (
                        <p className={clsx("text-sm font-bold tabular-nums", out === rows.length ? "text-st-loaded" : "text-amber-400")}>
                          {out}/{rows.length} out
                        </p>
                      )}
                    </div>
                    {rows.length === 0 ? (
                      <p className="py-1 text-sm text-ink-faint">None set for this day.</p>
                    ) : (
                      <ul className="divide-y divide-hairline">
                        {rows.map((r) => (
                          <li key={r.truck} className="flex items-baseline justify-between gap-3 py-1.5">
                            {/* Covered route: ROUTE → the truck its load rode on. */}
                            <span className="font-mono text-lg font-black tabular-nums text-ink">
                              {r.carrier != null ? (
                                <>
                                  <span className="text-sky-300">{r.truck}</span>
                                  <span className="px-1 text-sm text-ink-faint">→</span>
                                  {r.carrier}
                                </>
                              ) : (
                                <>#{r.truck}</>
                              )}
                            </span>
                            <span className={clsx("text-sm", r.xload ? "text-fuchsia-300" : r.loaded ? "text-st-loaded" : r.loading ? "text-ink-muted" : "text-amber-400")}>
                              {cargoLabel(r)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        )}
        {/* ===================== LOAD · SHORTAGES ===================== */}
        {showSection("shortages") && (
        <Section eyebrow="Load" title="Shortages" sectionKey="shortages" downloadName={dlName("Shortages")}>
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
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Top shorted trucks
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {topTrucks.map((t, i) => (
                  <div key={t.truck} className="rounded-xl border border-hairline bg-surface p-3">
                    {/* Place + qty flank the truck number so the number itself
                        stays centred as the card's focal point. */}
                    {/* One line: place · truck · qty. The number stays the focal
                        point by weight, not by owning a row of its own. */}
                    <div className="flex items-baseline gap-2.5 border-b border-hairline pb-1.5">
                      <span className="text-xs font-bold text-ink-faint">#{i + 1}</span>
                      <span className="flex-1 font-mono text-2xl font-black leading-tight tabular-nums text-ink">#{t.truck}</span>
                      <span className="font-mono text-base font-bold tabular-nums text-amber-300">
                        {t.total.toLocaleString()} <span className="text-[11px] font-normal text-ink-faint">qty</span>
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {t.items.map((it) => (
                        <li key={it.label} className="flex items-baseline justify-between gap-2 text-sm">
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
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Top shorted items
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {topItems.map((it, i) => (
                  <div key={it.label} className="rounded-xl border border-hairline bg-surface p-3">
                    {/* One line: place · item · qty. */}
                    <div className="flex items-center gap-2 border-b border-hairline pb-1.5">
                      <span className="shrink-0 text-xs font-bold text-ink-faint">#{i + 1}</span>
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", palette.dotClass(it.category))} />
                      <span className="min-w-0 flex-1 truncate text-base font-bold leading-tight text-ink" title={it.label}>
                        {it.label}
                      </span>
                      <span className="shrink-0 font-mono text-base font-bold tabular-nums text-amber-300">
                        {it.qty.toLocaleString()} <span className="text-[11px] font-normal text-ink-faint">qty</span>
                      </span>
                    </div>
                    {/* Which trucks this item was short on — the mirror of the
                        per-truck cards above, which list items. */}
                    {/* One truck per line, always — two per line read as one
                        row of four numbers, and on a phone a full-width card
                        made that worse. A long list just makes a taller card;
                        nothing is ever cut to a "+14 more". (The PDF splits
                        only when a column would overrun the printed page.) */}
                    <ul className="mt-1.5">
                      {it.trucks.map((t) => (
                        <li
                          key={t.truck}
                          className="flex items-baseline justify-between gap-2 break-inside-avoid text-sm leading-relaxed"
                        >
                          <span className="font-mono font-semibold tabular-nums text-ink-soft">#{t.truck}</span>
                          <span className="shrink-0 font-mono font-semibold tabular-nums text-amber-300">
                            {t.qty.toLocaleString()}
                          </span>
                        </li>
                      ))}
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
        <Section eyebrow="Load" title="Short sheet" sectionKey="shortSheet" downloadName={dlName("Short sheet")}>
          {shorts.length === 0 ? (
            <Empty>No shortages logged for this day.</Empty>
          ) : (
            /* Same Grid / Sheet views as the Short Sheet page, so the report
               shows the crew's actual sheet. */
            <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
              <ShortageSheetContent
                shorts={shorts}
                board={board}
                items={itemsForLabels}
                palette={palette}
                layout={sheetLayout}
                onLayoutChange={setSheetLayout}
              />
            </div>
          )}
        </Section>
        )}
        {/* ===================== LOAD · LOAD TIMES ===================== */}
        {showSection("loadTimes") && (
        <Section eyebrow="Load" title="Load times" sectionKey="loadTimes">
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
                    <span className="w-16 text-center text-sm text-ink-muted">{clock(t.state?.load_finish_time)}</span>
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
        <Section eyebrow="Load" title="Audit" sectionKey="audit">
          {/* Open warnings counts legacy arm-first flags only; every return
              now reminds by itself (Last return), so the tile hides at 0. */}
          <div className={clsx("grid grid-cols-2 gap-2", openWarnings > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            <Kpi label="Trucks audited" value={auditByTruck.length} />
            <Kpi label="Items logged" value={itemsLogged} />
            <Kpi label="Pieces removed" value={piecesRemoved} />
            {openWarnings > 0 && <Kpi label="Open warnings" value={openWarnings} tone="text-amber-400" />}
          </div>
          {catRollup.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {catRollup.map(([cat, qty]) => (
                <span key={cat} className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface px-2.5 py-1 text-sm">
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
                          <span className="ml-1 text-xs font-normal text-ink-faint">(route {routeOverride})</span>
                        )}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {entries.length} item{entries.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {entries.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-ink-soft">{itemDisplayName(e.item_label)}</span>
                            {e.warn_on_next_load && (
                              <span
                                className={clsx(
                                  "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase",
                                  e.warning_applied ? "bg-track text-ink-soft" : "bg-amber-500/20 text-amber-300",
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
        {/* ===================== UNLOAD ===================== */}
        {showSection("batches") && (
        <Section eyebrow="Unload" title="Batches" sectionKey="batches" downloadName={dlName("Batches")}>
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
      {chrome.badge}
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
                i === kioskIdx ? "w-8 bg-sky-400" : "w-3 bg-track hover:bg-slate-500",
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

  // Loading / dead-connection gate (live mode's board) — never render the fake
  // empty day. Checked here, after every hook, so a dropped connection doesn't
  // unmount the body and throw a wall display out of kiosk mode.
  if (gate)
    return chrome.keepDateBarOnGate ? (
      <>
        {chrome.dateBar({ loadDay, unloadsDay })}
        <PageStatus {...gate} />
      </>
    ) : (
      <PageStatus {...gate} />
    );

  return (
    <>
      {sectionPicker}
      {imagesPicker}
      {kiosk && (
        <div className="fixed inset-0 z-[95] flex flex-col overflow-hidden bg-app pt-[env(safe-area-inset-top)]">
          {kioskBar}
          {/* progress through the current slide */}
          <div className="h-0.5 w-full bg-surface-2">
            <div
              className="h-full bg-sky-500"
              style={{ width: `${Math.round(kioskTick * 100)}%`, transition: "width 0.1s linear" }}
            />
          </div>
          <div ref={kioskScrollRef} className="min-h-0 flex-1 overflow-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={kioskKey ?? "none"}
                initial={{ opacity: 0, y: 24, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -24, scale: 0.99 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="px-6 py-5"
                style={{ zoom: kioskZoom }}
              >
                {kioskKey ? (
                  <KioskSlideContext.Provider value>{reportBody}</KioskSlideContext.Provider>
                ) : (
                  <p className="py-24 text-center text-lg text-ink-muted">
                    Load times are hidden on the floor (Operations → Workflows → Load timer).
                    Pick another section to show here.
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
      <PageHeader
        title="Run Report"
        titleBadge={chrome.badge}
        meta={<span>{formatRunDate(runDate)}</span>}
        actions={
          <>
            {kioskButton}
            {pdfButton}
            {imagesButton}
            {pdfErr && <span className="text-[10px] text-st-dirty">PDF failed</span>}
          </>
        }
      />
      {chrome.dateBar({ loadDay, unloadsDay })}

      {/* Horizontal padding respects the landscape safe area so the system nav
          bar (right side in landscape) doesn't cover the grid's last columns. */}
      {!kiosk && reportBody}
    </>
  );
}
