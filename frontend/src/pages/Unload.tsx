import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAssignBatch, useBoard, useBatchSummary, useHolidayLoad, useHolidayUnload, useLoadDayOverride, usePrevDayCarriers, usePrevDaySplitHelpers, useRouteSwapLog, useSettings, useUnloadsDayOverride, useUpsertTruckState } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import {
  buildOperationalDayContext,
  buildPrevDayCoverage,
  countLoaded,
  countUnloadedFromContext,
  getCoverageRouteNumber,
  getOperationalTruckType,
  previousRunDate,
} from "../utils/truckStatus";
import CoverageTag from "../components/CoverageTag";
import OverbatchedChip from "../components/OverbatchedChip";
import LoadWorkflowCard from "../components/WorkflowCard";
import PageHeader from "../components/PageHeader";
import type { TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import { motion } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";

/**
 * Unload workflow (V1 parity):
 *   dirty → unloaded (single click; the in_progress step is reserved for LOAD).
 *
 * Two layouts, per-device toggle ("unload:style"):
 *   cards (default) — the Load page's look: full-width, Dusts/Uniforms/Spares
 *     stat cards, progress bars, big WorkflowCard truck cards, batch cards.
 *   list — the classic compact horizontal rows with inline actions.
 *
 * COVERAGE on this page is always PREVIOUS-day (the route a truck actually
 * carried on the prior load day — i.e. what's being unloaded now), never
 * tonight's assignment. The truck membership/counting logic (allTrucks/dirty/
 * unloaded/toGo/unloadCtx) is unchanged.
 */
export default function Unload() {
  const runDate = todayIso();
  const { unloadsDay: computedUnloadsDay, loadDay: computedLoadDay } = workdayNumbers();
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const { data: loadDayOverride } = useLoadDayOverride(runDate);
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;
  const loadDay = loadDayOverride ?? computedLoadDay;
  const { data: holidayUnload } = useHolidayUnload(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data } = useBoard(runDate);
  const { data: batches } = useBatchSummary(runDate);
  const { data: settings } = useSettings();
  // Previous-day coverage: the loads being unloaded today were covered on the
  // prior run day. Resolve who covered which route from the route-swap log so
  // returning trucks are unloaded as the right route. Shared with Day Overview.
  const prevRunDate = useMemo(() => previousRunDate(runDate), [runDate]);
  const { data: prevSwapLog = [] } = useRouteSwapLog(14);
  const prevCoverage = useMemo(() => buildPrevDayCoverage(prevSwapLog, prevRunDate), [prevSwapLog, prevRunDate]);
  // Route this truck carried on the PREVIOUS load day (what it's unloaded as),
  // or null. This — not today's assignment — is the coverage the unload
  // workflow cares about.
  const prevCoverOf = (t: TruckWithState): number | null => prevCoverage.byCover.get(t.truck_number) ?? null;
  // Route whose SPLIT overflow this truck carried on the prev load day. A
  // split truck ran too, so it comes back dirty and needs calling out for the
  // route it helped — but the route ALSO ran itself (byCover excludes splits),
  // so this is a separate signal.
  const prevSplitCoverOf = (t: TruckWithState): number | null => prevCoverage.splitHelpers.get(t.truck_number) ?? null;
  const isSplitHelper = (t: TruckWithState): boolean => prevSplitCoverOf(t) != null;
  // What this truck is unloaded AS: prev-day coverage (route → truck), or a
  // prev-day split it carried (route + truck), or nothing.
  const coverDisplay = (t: TruckWithState): { route: number | null; split: boolean } => {
    const c = prevCoverOf(t);
    if (c != null) return { route: c, split: false };
    const s = prevSplitCoverOf(t);
    if (s != null) return { route: s, split: true };
    return { route: null, split: false };
  };

  const batchingDisabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "batching_disabled")?.value === true,
    [settings],
  );
  const wearerCap = useMemo(() => {
    const v = Number((settings ?? []).find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : 1800;
  }, [settings]);
  const upsert = useUpsertTruckState();
  const assign = useAssignBatch();
  const [busy, setBusy] = useState<number | null>(null);
  const [batchNum, setBatchNum] = useState("1");
  const [wearers, setWearers] = useState("0");
  const [batchOpen, setBatchOpen] = useState<number | null>(null);
  const [overflowOpen, setOverflowOpen] = useState<number | null>(null);
  const [unloadedSort, setUnloadedSort] = useState<"number" | "order">("number");
  const [statFilter, setStatFilter] = useState<"dust" | "uniform" | "spare" | "total" | null>(null);
  // Per-device layout preference: "cards" (Load-page look, default) | "list".
  const [style, setStyle] = useState<"cards" | "list">(() => (localStorage.getItem("unload:style") === "list" ? "list" : "cards"));
  const setStylePref = (s: "cards" | "list") => { setStyle(s); localStorage.setItem("unload:style", s); };
  // Trucks marked unloaded this session — the card stays in its section (styled
  // done, with undo) until navigation.
  const [recentlyUnloaded, setRecentlyUnloaded] = useState<Set<number>>(new Set());
  // The truck whose action menu is open (cards style).
  const [menuTruck, setMenuTruck] = useState<TruckWithState | null>(null);

  // Route numbers being covered by some other truck today.
  const coveredRouteNumbers = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      const r = getCoverageRouteNumber(t);
      if (r != null) s.add(r);
    }
    return s;
  }, [data]);
  // Routes taken over per UNLOAD semantics: only a SPARE carrier substitutes on
  // the unload side (a route-truck carrier ran its own route too — both come
  // back dirty). Gates the additive extras below.
  const spareTakenOverRoutes = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      if (t.truck_type === "Spare") {
        const r = getCoverageRouteNumber(t);
        if (r != null) s.add(r);
      }
    }
    return s;
  }, [data]);

  // Core roster = the SAME unload-day context every counting surface uses
  // (sidebar unload bar, Day Overview, Report). The page can therefore never
  // show fewer trucks than the denominator counts; page-specific inclusions
  // are strictly ADDITIVE on top.
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const unloadCtx = useMemo(
    () => buildOperationalDayContext(data ?? [], unloadsDay, holidayUnload ?? false, false, "unload", prevSplitHelpers),
    [data, unloadsDay, holidayUnload, prevSplitHelpers],
  );

  const allTrucks = useMemo(() => {
    const core = new Set(unloadCtx.activeTrucks.map((t) => t.truck_number));
    return (data ?? []).filter((t) => {
      if (core.has(t.truck_number)) return true;
      // ---- deliberate extras beyond the counted roster (additive only) ----
      // Coverage carriers always appear even when off-schedule.
      if (t.route_swap_route != null || t.state?.oos_spare_route != null) return true;
      // A route taken over by a Spare never shows — the spare stands in.
      if (spareTakenOverRoutes.has(t.truck_number)) return false;
      // A covered OOS truck is represented by its cover.
      if ((t.is_oos || t.state?.status === "oos") && coveredRouteNumbers.has(t.truck_number)) return false;
      // Physical work ALWAYS appears regardless of schedule or type — dirty /
      // unfinished / "Unload and Hold" trucks (incl. dirty Spares and
      // scheduled-off trucks that ran anyway). NOTE: "in_progress" is LOAD
      // work, not unload work — it must not pull a truck in here.
      const s = t.state?.status;
      if (s === "dirty" || s === "unfinished" || t.state?.priority_hold === true) return true;
      return false; // idle Spares and off-schedule clean trucks stay out
    });
  }, [data, unloadCtx, spareTakenOverRoutes, coveredRouteNumbers]);
  // "Needs unloading" = any truck in allTrucks not yet unloaded/loaded/unfinished.
  const dirty = useMemo(
    () =>
      allTrucks.filter((t) => {
        if (recentlyUnloaded.has(t.truck_number)) return true;
        const s = t.state?.status;
        return s !== "unloaded" && s !== "loaded" && s !== "unfinished";
      }),
    [allTrucks, recentlyUnloaded],
  );
  const dirtyRoute = useMemo(
    () => dirty.filter((t) => t.truck_type !== "Spare" && t.route_swap_route == null && t.state?.oos_spare_route == null && !isSplitHelper(t) && t.state?.priority_hold !== true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty, prevCoverage],
  );
  // Coverage section = today's covering trucks + prev-day SPLIT helpers (they
  // carried a route's overflow yesterday, so call them out for that route).
  const dirtyCoverages = useMemo(
    () => dirty.filter((t) => (t.truck_type === "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null || isSplitHelper(t)) && t.state?.priority_hold !== true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty, prevCoverage],
  );
  const requested = useMemo(
    () => dirty.filter((t) => t.state?.priority_hold === true),
    [dirty],
  );
  const unfinished = useMemo(
    () => allTrucks.filter((t) => t.state?.status === "unfinished" && !recentlyUnloaded.has(t.truck_number)),
    [allTrucks, recentlyUnloaded],
  );
  // Unloaded today = every truck that went dirty → unloaded this shift, i.e.
  // status "unloaded" AND anything further along that lifecycle ("in_progress"
  // /"loaded"). Excludes day-init seeds (auto/no unloaded_at) — nobody unloaded
  // those today.
  const unloaded = useMemo(
    () =>
      allTrucks.filter((t) => {
        const s = t.state?.status;
        if (!(s === "unloaded" || s === "in_progress" || s === "loaded")) return false;
        if (s === "unloaded" && t.state?.state_source === "auto" && t.state?.unloaded_at == null) return false;
        return true;
      }),
    [allTrucks],
  );
  const unloadedSorted = useMemo(() => {
    const arr = [...unloaded];
    if (unloadedSort === "order") {
      const toEpoch = (t: TruckWithState): number => {
        if (t.state?.unloaded_at != null) return t.state.unloaded_at;
        const ua = t.state?.updated_at;
        return ua ? new Date(ua).getTime() / 1000 : Number.POSITIVE_INFINITY;
      };
      arr.sort((a, b) => {
        const diff = toEpoch(a) - toEpoch(b);
        if (diff !== 0) return diff;
        return a.truck_number - b.truck_number;
      });
    } else {
      arr.sort((a, b) => a.truck_number - b.truck_number);
    }
    return arr;
  }, [unloaded, unloadedSort]);

  // ── Stat cards — Dusts / Uniforms / Spares still needing unload ─────────
  const stillDirty = useMemo(
    () => dirty.filter((t) => !recentlyUnloaded.has(t.truck_number)),
    [dirty, recentlyUnloaded],
  );
  const dustsLeftTrucks = useMemo(
    () => stillDirty.filter((t) => getOperationalTruckType(t, unloadCtx.routeTruckByNumber) === "Dust"),
    [stillDirty, unloadCtx.routeTruckByNumber],
  );
  const uniformsLeftTrucks = useMemo(
    () => stillDirty.filter((t) => getOperationalTruckType(t, unloadCtx.routeTruckByNumber) === "Uniform"),
    [stillDirty, unloadCtx.routeTruckByNumber],
  );
  const sparesLeftTrucks = useMemo(
    () => stillDirty.filter((t) => getOperationalTruckType(t, unloadCtx.routeTruckByNumber) === "Spare"),
    [stillDirty, unloadCtx.routeTruckByNumber],
  );
  const dustsLeft = dustsLeftTrucks.length;
  const uniformsLeft = uniformsLeftTrucks.length;
  const sparesLeft = sparesLeftTrucks.length;
  const totalLeft = dustsLeft + uniformsLeft + sparesLeft;
  const totalLeftTrucks = useMemo(() => [...stillDirty].sort((a, b) => a.truck_number - b.truck_number), [stillDirty]);

  // ── Progress bars — schedule-based, matching the sidebar/Report/Day Overview
  const prevDayCarriers = usePrevDayCarriers(runDate, data ?? []);
  const unloadTotal = unloadCtx.activeTrucks.length;
  const unloadDone = useMemo(() => countUnloadedFromContext(unloadCtx, prevDayCarriers), [unloadCtx, prevDayCarriers]);
  const unloadPct = unloadTotal > 0 ? Math.round((unloadDone / unloadTotal) * 100) : 0;
  const loadContext = useMemo(() => buildOperationalDayContext(data ?? [], loadDay, holidayLoad, false), [data, loadDay, holidayLoad]);
  const loadTotal = loadContext.activeTrucks.length;
  const loadDone = useMemo(() => countLoaded(data ?? [], loadDay, holidayLoad, unloadsDay, holidayUnload ?? false), [data, loadDay, unloadsDay, holidayLoad, holidayUnload]);
  const loadPct = loadTotal > 0 ? Math.round((loadDone / loadTotal) * 100) : 0;

  const toGo = Math.max(0, unloadTotal - unloadDone);

  async function assignBatch(truckNumber: number) {
    await assign.mutateAsync({ run_date: runDate, batch_number: Number(batchNum), truck_number: truckNumber, wearers: Number(wearers || 0) });
    setBatchOpen(null);
  }

  async function markUnfinished(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    try {
      await upsert.mutateAsync({ truck_number: t.truck_number, run_date: runDate, status: "unfinished", wearers: t.state?.wearers ?? 0 });
    } finally {
      setBusy(null);
    }
  }

  async function markUnloaded(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    // Pin BEFORE the mutation so the card stays in its section (styled done)
    // the moment the optimistic update flips status — avoids a jump/flash.
    setRecentlyUnloaded((prev) => new Set([...prev, t.truck_number]));
    try {
      await upsert.mutateAsync({ truck_number: t.truck_number, run_date: runDate, status: "unloaded", wearers: t.state?.wearers ?? 0 });
    } catch {
      setRecentlyUnloaded((prev) => { const next = new Set(prev); next.delete(t.truck_number); return next; });
    } finally {
      setBusy(null);
    }
  }

  async function undoUnload(truckNumber: number) {
    setBusy(truckNumber);
    try {
      await upsert.mutateAsync({ truck_number: truckNumber, run_date: runDate, status: "dirty" });
      setRecentlyUnloaded((prev) => { const next = new Set(prev); next.delete(truckNumber); return next; });
    } finally {
      setBusy(null);
    }
  }

  function openTruckMenu(t: TruckWithState) {
    setBatchNum(String(t.state?.batch_id ?? 1));
    setWearers(String(t.state?.wearers ?? 0));
    setMenuTruck(t);
  }
  function toggleBatch(t: TruckWithState) {
    const isOpen = batchOpen === t.truck_number;
    setBatchOpen(isOpen ? null : t.truck_number);
    setBatchNum(String(t.state?.batch_id ?? 1));
    setWearers(String(t.state?.wearers ?? 0));
    setOverflowOpen(null);
  }
  function toggleOverflow(truckNumber: number) {
    setOverflowOpen(overflowOpen === truckNumber ? null : truckNumber);
    setBatchOpen(null);
  }

  const GRID = "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]";

  // The dirty-family sections, shared by both layouts.
  const dirtySections = [
    { key: "requested", title: "Requested — priority hold", titleClass: "text-st-inprogress", trucks: requested, accent: "text-amber-300", label: "HOLD", labelClass: "bg-amber-500 text-black", rowAccent: "border-l-st-inprogress", actionLabel: "Mark Unloaded", overflow: "dirty" as const },
    { key: "unfinished", title: "Unfinished", titleClass: "text-st-unfinished", trucks: unfinished, accent: "text-st-unfinished", label: "Unfinished", labelClass: "bg-[#b45309] text-white", rowAccent: "border-l-st-unfinished", actionLabel: "Finish unload", ghost: true, overflow: "unfinished" as const },
    { key: "coverage", title: "Dirty — coverage", titleClass: "text-st-spare", trucks: dirtyCoverages, accent: "text-st-spare", label: "Dirty", labelClass: "bg-[#b91c1c] text-white", rowAccent: "border-l-st-spare", actionLabel: "Mark Unloaded", overflow: "dirty" as const },
    { key: "route", title: "Dirty — route trucks", titleClass: "text-st-dirty", trucks: dirtyRoute, accent: "text-red-300", label: "Dirty", labelClass: "bg-[#b91c1c] text-white", rowAccent: "border-l-st-dirty", actionLabel: "Mark Unloaded", overflow: "dirty" as const },
  ];

  /** Cards style: a tappable dirty-family truck card (opens the action menu). */
  function DirtyCard({ t, index, accent, label, labelClass }: { t: TruckWithState; index: number; accent: string; label: string; labelClass: string }) {
    const isUndo = recentlyUnloaded.has(t.truck_number);
    const cd = coverDisplay(t);
    return (
      <AnimateCard key={t.truck_number} delay={index * 0.03} hoverScale={1.02} className="h-full">
        <button type="button" onClick={() => openTruckMenu(t)} className="h-full w-full text-left transition-all duration-150 active:scale-[0.98]">
          <LoadWorkflowCard
            truck={t}
            accent={isUndo ? "text-st-unloaded" : accent}
            statusLabel={isUndo ? "Unloaded" : label}
            statusClassName={isUndo ? "bg-st-unloaded text-[#052e16]" : labelClass}
            coverageRoute={cd.route}
            coverageSplit={cd.split}
            footer={t.state?.wearers ? <span className="text-xs text-ink-muted">{t.state.wearers} wearers</span> : null}
            interactive
            ringClassName={isUndo ? "hover:ring-st-unloaded" : "hover:ring-st-dirty"}
          />
        </button>
      </AnimateCard>
    );
  }

  /** List style: a compact horizontal dirty-family row with inline actions. */
  function renderRow(t: TruckWithState, index: number, opts: { accentClass?: string; actionLabel: string; ghost?: boolean; overflow: "dirty" | "unfinished" }) {
    const isUndo = recentlyUnloaded.has(t.truck_number);
    const isBusy = busy === t.truck_number;
    const isBatchOpen = batchOpen === t.truck_number;
    const isOverflowOpen = overflowOpen === t.truck_number;
    const cd = coverDisplay(t); // prev-day coverage / split — what it's unloaded as
    const detailParts: string[] = [];
    if (t.truck_type === "Spare") detailParts.push("Spare");
    if (t.state?.batch_id != null) detailParts.push(`Batch ${t.state.batch_id}`);
    const detail = detailParts.join("  ·  ");
    return (
      <AnimateCard key={t.truck_number} delay={index * 0.03} className={clsx("card flex flex-col !p-0", opts.accentClass)}>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="font-mono text-[22px] font-black leading-none text-ink">#{t.truck_number}</span>
          {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{detail}</span>
          {t.state?.needs_checked && <span className="badge shrink-0 bg-st-inprogress text-black">Needs check</span>}
          {isUndo ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="badge bg-st-unloaded text-[#052e16]">Unloaded</span>
              <button className="btn-ghost" disabled={isBusy} onClick={() => undoUnload(t.truck_number)}>{isBusy ? "…" : "Undo"}</button>
            </div>
          ) : (
            <div className="relative flex shrink-0 items-center gap-1.5">
              <button className={clsx(opts.ghost ? "btn-ghost" : "btn-primary", "px-4 py-2")} disabled={isBusy} onClick={() => markUnloaded(t)}>{isBusy ? "…" : opts.actionLabel}</button>
              <button className="flex h-9 w-8 items-center justify-center rounded-md border border-hairline bg-surface-2 text-lg leading-none text-ink-muted transition-colors hover:text-ink" onClick={() => toggleOverflow(t.truck_number)} title="More actions" aria-label="More actions">···</button>
              {isOverflowOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-hairline bg-surface-3 py-1 shadow-card">
                  {opts.overflow === "unfinished" ? (
                    <button className="w-full px-3 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2" disabled={isBusy} onClick={() => { setOverflowOpen(null); upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "dirty" }); }}>Back to dirty</button>
                  ) : (
                    <>
                      <button className="w-full px-3 py-2 text-left text-sm font-medium text-st-unfinished transition-colors hover:bg-surface-2" disabled={isBusy} onClick={() => markUnfinished(t)}>Mark unfinished</button>
                      {!batchingDisabled && (
                        <button className="w-full px-3 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2" onClick={() => toggleBatch(t)}>{t.state?.batch_id != null ? `Batch ${t.state.batch_id}` : "Assign batch"}</button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {!batchingDisabled && isBatchOpen && (
          <div className="space-y-2 rounded-b-xl border-t border-hairline bg-surface-2 p-3">
            <div className="grid grid-cols-6 gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} type="button" onClick={() => setBatchNum(String(n))} className={batchNum === String(n) ? "rounded-md bg-st-unloaded py-2 text-center text-base font-bold text-black ring-2 ring-st-unloaded/60" : "rounded-md bg-surface-3 py-2 text-center text-base font-bold text-ink-soft hover:bg-track"}>{n}</button>
              ))}
            </div>
            <input type="number" min={0} className="input" placeholder="Wearers" value={wearers} onChange={(e) => setWearers(e.target.value)} />
            <button className="btn-primary w-full" disabled={assign.isPending} onClick={() => assignBatch(t.truck_number)}>{assign.isPending ? "Saving…" : "Assign"}</button>
          </div>
        )}
      </AnimateCard>
    );
  }

  const styleToggle = (
    <div className="inline-flex overflow-hidden rounded-md border border-hairline text-[11px] font-semibold">
      <button type="button" onClick={() => setStylePref("cards")} className={clsx("px-2.5 py-1 transition-colors", style === "cards" ? "bg-accent text-white" : "bg-surface-2 text-ink-muted hover:bg-surface")}>Cards</button>
      <button type="button" onClick={() => setStylePref("list")} className={clsx("border-l border-hairline px-2.5 py-1 transition-colors", style === "list" ? "bg-accent text-white" : "bg-surface-2 text-ink-muted hover:bg-surface")}>List</button>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Unload"
        subtitle={`Day ${unloadsDay} — mark returning trucks unloaded and assign batches.`}
        actions={
          <div className="flex items-center gap-2">
            {styleToggle}
            <span className="badge bg-st-dirty text-white">{toGo} to go</span>
          </div>
        }
      />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-5 p-3 md:p-6">

        {/* Previous load-day coverage */}
        {prevCoverage.items.length > 0 && (
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">Previous load-day coverage</span>
              {prevCoverage.date && (
                <span className="text-[10px] text-amber-500/70">({format(new Date(`${prevCoverage.date}T12:00:00`), "EEE MMM d")})</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {prevCoverage.items.map((c) => (
                <span key={`${c.route}-${c.loadOn}`} className="inline-flex items-center gap-1 rounded-full border border-amber-700/30 bg-surface-3 px-2 py-0.5 text-xs">
                  <span className={clsx("font-black", c.isSplit ? "text-amber-300" : "text-st-dirty")}>#{c.route}</span>
                  {c.isSplit ? <span className="font-bold text-amber-500">+</span> : <ArrowLeftRight className="h-3 w-3 text-ink-faint" />}
                  <span className="font-black text-amber-200">#{c.loadOn}</span>
                  {c.isSplit && <span className="text-[8px] font-bold uppercase tracking-wider text-amber-500">Split</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats grid — left to unload by type */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Dusts Left" value={dustsLeft} accent="#ef4444" active={statFilter === "dust"} onClick={() => setStatFilter(statFilter === "dust" ? null : "dust")} />
          <StatCard label="Uniforms Left" value={uniformsLeft} accent="#6366f1" active={statFilter === "uniform"} onClick={() => setStatFilter(statFilter === "uniform" ? null : "uniform")} />
          <StatCard label="Spares Left" value={sparesLeft} accent="#22c55e" active={statFilter === "spare"} onClick={() => setStatFilter(statFilter === "spare" ? null : "spare")} />
          <StatCard label="Total Left" value={totalLeft} accent="#dbe3ee" active={statFilter === "total"} onClick={() => setStatFilter(statFilter === "total" ? null : "total")} />
        </div>

        {/* Stat drill-down */}
        {statFilter && (() => {
          const trucks = statFilter === "dust" ? dustsLeftTrucks : statFilter === "uniform" ? uniformsLeftTrucks : statFilter === "spare" ? sparesLeftTrucks : totalLeftTrucks;
          return (
            <div className="card animate-slide-down space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {statFilter === "dust" ? "Dusts" : statFilter === "uniform" ? "Uniforms" : statFilter === "spare" ? "Spares" : "All"} still to unload ({trucks.length})
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {trucks.map((t) => {
                  const cd = coverDisplay(t);
                  return (
                    <span key={t.truck_number} className="flex min-h-[3.35rem] items-start justify-between rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5">
                      <span className="pt-0.5 text-lg font-extrabold tracking-tight tabular-nums text-ink">#{t.truck_number}</span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="rounded-full bg-red-950/60 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-300 ring-1 ring-red-900/80">Dirty</span>
                        {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} />}
                        {t.state?.priority_hold && (
                          <span className="inline-flex items-center rounded-pill bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-300 ring-1 ring-amber-900/80">Hold</span>
                        )}
                      </span>
                    </span>
                  );
                })}
                {trucks.length === 0 && <span className="col-span-full text-sm text-ink-faint">All clear!</span>}
              </div>
            </div>
          );
        })()}

        {/* Load / Unload progress */}
        <div className="card space-y-2">
          <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
          <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
        </div>

        {/* Dirty-family sections */}
        {dirtySections.map((sec) => sec.trucks.length > 0 && (
          <section key={sec.key}>
            <h3 className={clsx("mb-2 text-sm font-semibold uppercase tracking-wide", sec.titleClass)}>{sec.title} ({sec.trucks.length})</h3>
            {style === "list" ? (
              <div className="flex flex-col gap-2">
                {sec.trucks.map((t, i) => renderRow(t, i, { accentClass: `border-l-[3px] ${sec.rowAccent}`, actionLabel: sec.actionLabel, ghost: sec.ghost, overflow: sec.overflow }))}
              </div>
            ) : (
              <div className={GRID}>
                {sec.trucks.map((t, i) => <DirtyCard key={t.truck_number} t={t} index={i} accent={sec.accent} label={sec.label} labelClass={sec.labelClass} />)}
              </div>
            )}
          </section>
        ))}

        {dirty.length === 0 && unfinished.length === 0 && (
          <p className="rounded-xl border border-dashed border-hairline bg-surface/50 p-6 text-center text-sm text-ink-muted">
            Everything's unloaded. Nice work.
          </p>
        )}

        {/* Unloaded today */}
        {unloaded.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-st-unloaded">Unloaded today ({unloaded.length})</h3>
              <div className="inline-flex overflow-hidden rounded-md border border-hairline text-[11px] font-semibold">
                <button type="button" onClick={() => setUnloadedSort("number")} className={clsx("px-2 py-1 transition-colors", unloadedSort === "number" ? "bg-st-unloaded text-[#052e16]" : "bg-surface-2 text-ink-muted hover:bg-surface")}># Number</button>
                <button type="button" onClick={() => setUnloadedSort("order")} className={clsx("border-l border-hairline px-2 py-1 transition-colors", unloadedSort === "order" ? "bg-st-unloaded text-[#052e16]" : "bg-surface-2 text-ink-muted hover:bg-surface")}>Unload order</button>
              </div>
            </div>
            {style === "list" ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {unloadedSorted.map((t, index) => {
                  const time = t.state?.unloaded_at != null ? format(new Date(t.state.unloaded_at * 1000), "h:mm a") : "—";
                  const cd = coverDisplay(t);
                  return (
                    <AnimateCard key={t.truck_number} delay={index * 0.02} className="h-full">
                      <button type="button" onClick={() => openTruckMenu(t)} className="flex h-full min-h-[6rem] w-full flex-col items-center justify-center rounded-[10px] border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.06)] px-1.5 py-2.5 text-center transition-shadow hover:ring-2 hover:ring-st-unloaded">
                        <span className="font-mono text-[17px] font-extrabold leading-none text-ink">#{t.truck_number}</span>
                        {cd.route != null && <span className="mt-1 flex justify-center"><CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} /></span>}
                        <span className="mt-1 font-mono text-[10px] text-ink-muted">{unloadedSort === "order" ? `#${index + 1} · ${time}` : time}</span>
                      </button>
                    </AnimateCard>
                  );
                })}
              </div>
            ) : (
              <div className={GRID}>
                {unloadedSorted.map((t, idx) => {
                  const time = t.state?.unloaded_at != null ? format(new Date(t.state.unloaded_at * 1000), "h:mm a") : "—";
                  return (
                    <AnimateCard key={t.truck_number} delay={idx * 0.02} className="h-full">
                      <div className="relative h-full">
                        {unloadedSort === "order" && (
                          <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-surface-2 px-1 text-[10px] font-bold text-st-unloaded ring-1 ring-st-unloaded/60">{idx + 1}</span>
                        )}
                        <button type="button" onClick={() => openTruckMenu(t)} className="h-full w-full text-left transition-all duration-150 active:scale-[0.98]">
                          <LoadWorkflowCard truck={t} accent="text-st-unloaded" statusLabel="Unloaded" statusClassName="bg-st-unloaded text-[#052e16]" coverageRoute={coverDisplay(t).route} coverageSplit={coverDisplay(t).split} footer={<span className="text-xs text-ink-muted">{time}</span>} interactive ringClassName="hover:ring-st-unloaded" />
                        </button>
                      </div>
                    </AnimateCard>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Batches */}
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Batches</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(batches ?? Array.from({ length: 6 }, (_, i) => ({ batch_number: i + 1, trucks: [], total_wearers: 0 }))).map((b, index) => (
              <AnimateCard key={b.batch_number} delay={index * 0.03} className="card space-y-2 p-4">
                <p className="flex items-center gap-2 font-bold text-ink">
                  Batch {b.batch_number}
                  <OverbatchedChip show={b.total_wearers > wearerCap} />
                </p>
                <div className="flex min-h-[1.5rem] flex-wrap gap-1">
                  {b.trucks.length === 0 ? (
                    <span className="text-xs text-ink-muted">No trucks</span>
                  ) : (
                    b.trucks.map((t) => <span key={t.truck_number} className="badge bg-track text-ink-soft">#{t.truck_number}</span>)
                  )}
                </div>
                <p className="text-xs text-ink-muted">
                  Total wearers:{" "}
                  <span className={b.total_wearers > 0 ? "font-semibold text-st-unloaded" : ""}>{b.total_wearers}</span>{" "}/ {wearerCap}
                </p>
              </AnimateCard>
            ))}
          </div>
        </section>

        {/* Truck action menu (cards style + unloaded-today taps) */}
        {menuTruck && (() => {
          const t = allTrucks.find((x) => x.truck_number === menuTruck.truck_number) ?? menuTruck;
          const isUndo = recentlyUnloaded.has(t.truck_number);
          const isUnfin = t.state?.status === "unfinished";
          const cd = coverDisplay(t);
          const isBusy = busy === t.truck_number;
          const close = () => setMenuTruck(null);
          return createPortal(
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={close}>
              <div className="max-h-[90svh] w-full max-w-sm space-y-4 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Truck #{t.truck_number}</h3>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                      {t.truck_type}
                      {isUnfin ? " · Unfinished" : ""}
                      {cd.route != null && <CoverageTag route={cd.route} truck={t.truck_number} split={cd.split} />}
                    </p>
                  </div>
                  <button className="btn-ghost" onClick={close}>Close</button>
                </div>

                {isUndo ? (
                  <button className="w-full rounded-lg border border-slate-600 bg-slate-800 py-3.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50" disabled={isBusy} onClick={async () => { await undoUnload(t.truck_number); close(); }}>
                    {isBusy ? "…" : "Undo — back to Dirty"}
                  </button>
                ) : (
                  <>
                    <button className="w-full rounded-lg bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-50" disabled={isBusy} onClick={async () => { await markUnloaded(t); close(); }}>
                      {isBusy ? "…" : isUnfin ? "Finish Unload" : "Mark Unloaded"}
                    </button>

                    {!batchingDisabled && (
                      <section>
                        <p className="label">Batch</p>
                        <div className="grid grid-cols-6 gap-1.5">
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <button key={n} type="button" onClick={() => setBatchNum(String(n))} className={batchNum === String(n) ? "rounded-md bg-emerald-600 py-2 text-center text-base font-bold text-white ring-2 ring-emerald-400" : "rounded-md bg-slate-700 py-2 text-center text-base font-bold text-slate-300 hover:bg-slate-600"}>{n}</button>
                          ))}
                        </div>
                        <input type="number" min={0} className="input mt-2" placeholder="Wearers" value={wearers} onChange={(e) => setWearers(e.target.value)} />
                        <button className="btn-primary mt-2 w-full font-semibold" disabled={assign.isPending} onClick={async () => { await assignBatch(t.truck_number); close(); }}>
                          {assign.isPending ? "Saving…" : t.state?.batch_id != null ? `Assign (current: Batch ${t.state.batch_id})` : "Assign Batch"}
                        </button>
                      </section>
                    )}

                    {isUnfin ? (
                      <button className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700" onClick={() => { upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "dirty" }); close(); }}>
                        Back to Dirty
                      </button>
                    ) : (
                      <button className="w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2.5 text-sm font-medium text-st-unfinished transition-colors hover:bg-slate-700 disabled:opacity-50" disabled={isBusy} onClick={async () => { await markUnfinished(t); close(); }}>
                        Mark Unfinished
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>,
            document.body,
          );
        })()}
      </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (mirror the Load page)
// ---------------------------------------------------------------------------

function StatCard({ label, value, accent, active, onClick }: { label: string; value: number; accent: string; active?: boolean; onClick?: () => void }) {
  const isTotal = label === "Total Left";
  return (
    <AnimateCard>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "flex min-h-[5rem] w-full flex-col items-center justify-center rounded-xl border px-4 py-3 text-center shadow-inset-top transition-shadow",
          isTotal ? "border-hairline bg-surface" : "border-transparent",
          active && "ring-2 ring-white/30",
        )}
        style={!isTotal ? { background: `rgba(${parseInt(accent.slice(1, 3), 16)},${parseInt(accent.slice(3, 5), 16)},${parseInt(accent.slice(5, 7), 16)},0.10)`, borderColor: accent + "40" } : undefined}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent, opacity: 0.7 }}>{label}</p>
        <p className="mt-1 font-mono text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums" style={{ color: isTotal ? "#dbe3ee" : accent }}>{value}</p>
      </button>
    </AnimateCard>
  );
}

function ProgressRow({ label, done, total, pct, barColor }: { label: string; done: number; total: number; pct: number; barColor: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[58px] text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="w-24 text-right font-mono text-xs tabular-nums text-ink-muted">{done}/{total} ({pct}%)</span>
    </div>
  );
}
