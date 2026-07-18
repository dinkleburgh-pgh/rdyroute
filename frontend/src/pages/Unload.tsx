import { useMemo, useState } from "react";
import { useAssignBatch, useBoard, useBatchSummary, useHolidayUnload, useRouteSwapLog, useSettings, useUnloadsDayOverride, useUpsertTruckState } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import { buildPrevDayCoverage, getCoverageRouteNumber, isScheduledOff, previousRunDate, takenOverRouteNumber } from "../utils/truckStatus";
import CoverageTag from "../components/CoverageTag";
import type { TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import { motion } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";

/**
 * Unload workflow (V1 parity + 2026 redesign):
 *   dirty → unloaded (single click; V1 had no in_progress step for unloading —
 *   the in_progress state is reserved for the LOAD workflow).
 *
 * Layout follows design_handoff_unload_workflow: a single centered 560px column,
 * horizontal cards, and the section order Requested → Unfinished → Dirty·coverage
 * → Dirty·route → Unloaded today. Membership logic is unchanged — only the render
 * order and styling changed. An "Undo" button lets the user revert a truck back to
 * dirty if marked by mistake (matches V1 unload_mobile_undo_state behavior).
 */
export default function Unload() {
  const runDate = todayIso();
  const { unloadsDay: computedUnloadsDay } = workdayNumbers();
  const { data: unloadsDayOverride } = useUnloadsDayOverride(runDate);
  const unloadsDay = unloadsDayOverride ?? computedUnloadsDay;
  const { data: holidayUnload } = useHolidayUnload(runDate);
  const { data } = useBoard(runDate);
  const { data: batches } = useBatchSummary(runDate);
  const { data: settings } = useSettings();
  // Previous-day coverage: the loads being unloaded today were covered on the
  // prior run day. Resolve who covered which route from the route-swap log so
  // returning trucks are unloaded as the right route. Shared with Day Overview.
  const prevRunDate = useMemo(() => previousRunDate(runDate), [runDate]);
  const { data: prevSwapLog = [] } = useRouteSwapLog(14);
  const prevCoverage = useMemo(() => buildPrevDayCoverage(prevSwapLog, prevRunDate), [prevSwapLog, prevRunDate]);
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
  const [batchOpen, setBatchOpen] = useState<number | null>(null);
  const [batchNum, setBatchNum] = useState("1");
  const [wearers, setWearers] = useState("0");
  const [overflowOpen, setOverflowOpen] = useState<number | null>(null);
  const [unloadedSort, setUnloadedSort] = useState<"number" | "order">("number");
  // Trucks marked unloaded this session — card stays in dirty section with Undo until navigation.
  const [recentlyUnloaded, setRecentlyUnloaded] = useState<Set<number>>(new Set());

  // Route numbers that ARE being covered by some other truck today — derived
  // from the board itself (the covering truck carries route_swap_route /
  // oos_spare_route pointing at the route it covers).
  const coveredRouteNumbers = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      const r = getCoverageRouteNumber(t);
      if (r != null) s.add(r);
    }
    return s;
  }, [data]);
  // Routes physically taken over (cover stands in; covered truck never shows).
  const takenOverRoutes = useMemo(() => {
    const s = new Set<number>();
    for (const t of data ?? []) {
      const r = takenOverRouteNumber(t);
      if (r != null) s.add(r);
    }
    return s;
  }, [data]);

  // Fleet Schedule is the single source of truth for which trucks appear.
  // Covering spares always included; pure spares excluded; route trucks included
  // iff they run on unloadsDay per scheduled_off_days.
  const allTrucks = useMemo(
    () =>
      (data ?? []).filter((t) => {
        // Coverage trucks always appear (spare has oos_spare_route; route-swap trucks
        // have route_swap_route). The OOS truck they cover is excluded below.
        if (t.route_swap_route != null || t.state?.oos_spare_route != null) return true;
        // An OOS route truck is only dropped once it's actually COVERED — the
        // covering truck (above) represents it then. An uncovered OOS truck is
        // still physically here; if it's dirty someone must unload it, so keep
        // it in the workflow. Matches truckStatus.ts / the Board / the sidebar,
        // which only reclassify is_oos as OOS once coverage exists.
        // A taken-over route (any truck carrying oos_spare_route for it, or a
        // covering Spare) did NOT run — its cover represents it, regardless of
        // the covered truck's own is_oos flag or type. Without this, #53
        // appeared in "Dirty — route trucks" while its cover #75 sat in
        // "Dirty — coverage": one physical load, two cards, double counts.
        if (takenOverRoutes.has(t.truck_number)) return false;
        if ((t.is_oos || t.state?.status === "oos") && coveredRouteNumbers.has(t.truck_number)) return false;
        // A truck someone must physically unload ALWAYS appears, regardless of
        // the spare/schedule exclusions below — e.g. a spare marked
        // "Unload and Hold" (dirty + priority_hold) or a scheduled-off truck
        // that ran anyway. Excluding these left the sidebar counting a dirty
        // truck the Unload page never showed. NOTE: "in_progress" is NOT
        // unload work — it's the LOAD workflow — so it must not pull a truck
        // in here (it briefly inflated the Unloaded-today tally for every
        // spare/off-day truck mid-load, since the tally counts in_progress).
        const s = t.state?.status;
        if (s === "dirty" || s === "unfinished" || t.state?.priority_hold === true) return true;
        if (t.truck_type === "Spare") return false;
        return holidayUnload || !isScheduledOff(t, unloadsDay);
      }),
    [data, unloadsDay, holidayUnload, coveredRouteNumbers],
  );
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
    () => dirty.filter((t) => t.truck_type !== "Spare" && t.route_swap_route == null && t.state?.oos_spare_route == null && t.state?.priority_hold !== true),
    [dirty],
  );
  const dirtyCoverages = useMemo(
    () => dirty.filter((t) => (t.truck_type === "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) && t.state?.priority_hold !== true),
    [dirty],
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
  // /"loaded" — already loading/loaded, but was unloaded to get there). Without
  // in_progress/loaded here, a truck would drop OUT of this list the moment it
  // starts loading, making the card read like "what's still waiting" instead of
  // "everyone unloaded today." Reflects status immediately (including trucks
  // just marked this session) so the card appears the moment Mark Unloaded is
  // clicked; the truck also stays pinned in the Dirty section with Undo via
  // recentlyUnloaded.
  const unloaded = useMemo(
    () =>
      allTrucks.filter((t) => {
        const s = t.state?.status;
        return s === "unloaded" || s === "in_progress" || s === "loaded";
      }),
    [allTrucks],
  );
  // Sort variant for the "Unloaded today" grid — mirrors the Load page's
  // Number/Load order toggle. There's no dedicated unload-finish timestamp (the
  // unload workflow is single-click, no timed step), so updated_at is the order
  // proxy — the same fallback the Load page uses for trucks that skip the timed
  // workflow.
  const unloadedSorted = useMemo(() => {
    const arr = [...unloaded];
    if (unloadedSort === "order") {
      const toEpoch = (t: TruckWithState): number => {
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

  // Header count: everything not yet unloaded across every dirty-family section.
  // The dirty memos keep recently-unloaded trucks pinned (with Undo), so exclude
  // those; unfinished already excludes them.
  const notDone = (t: TruckWithState) => !recentlyUnloaded.has(t.truck_number);
  const toGo =
    requested.filter(notDone).length +
    unfinished.length +
    dirtyCoverages.filter(notDone).length +
    dirtyRoute.filter(notDone).length;

  async function assignBatch(truckNumber: number) {
    await assign.mutateAsync({
      run_date: runDate,
      batch_number: Number(batchNum),
      truck_number: truckNumber,
      wearers: Number(wearers || 0),
    });
    setBatchOpen(null);
  }

  async function markUnfinished(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    try {
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "unfinished",
        wearers: t.state?.wearers ?? 0,
      });
    } finally {
      setBusy(null);
    }
  }

  async function markUnloaded(t: TruckWithState) {
    setBusy(t.truck_number);
    setOverflowOpen(null);
    // Mark recently-unloaded *before* the mutation so the card stays pinned in
    // the Dirty section (with Undo) the moment the optimistic update flips its
    // status to "unloaded". Otherwise it briefly drops into the Unloaded section
    // and snaps back, which reads as a page flash/jitter.
    setRecentlyUnloaded((prev) => new Set([...prev, t.truck_number]));
    try {
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "unloaded",
        wearers: t.state?.wearers ?? 0,
      });
    } catch {
      // Roll back the optimistic pin if the save failed.
      setRecentlyUnloaded((prev) => {
        const next = new Set(prev);
        next.delete(t.truck_number);
        return next;
      });
    } finally {
      setBusy(null);
    }
  }

  async function undoUnload(truckNumber: number) {
    setBusy(truckNumber);
    try {
      await upsert.mutateAsync({
        truck_number: truckNumber,
        run_date: runDate,
        status: "dirty",
      });
      setRecentlyUnloaded((prev) => {
        const next = new Set(prev);
        next.delete(truckNumber);
        return next;
      });
    } finally {
      setBusy(null);
    }
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

  /**
   * A single horizontal dirty-family row. Used by every dirty-family section
   * (requested / unfinished / dirty-coverage / dirty-route); the section passes
   * its accent border, action label/style, and overflow menu variant via opts.
   */
  function renderRow(
    t: TruckWithState,
    index: number,
    opts: {
      accentClass?: string;
      actionLabel: string;
      ghost?: boolean;
      coverageBadge?: boolean;
      overflow: "dirty" | "unfinished";
    },
  ) {
    const isUndo = recentlyUnloaded.has(t.truck_number);
    const isBusy = busy === t.truck_number;
    const isBatchOpen = batchOpen === t.truck_number;
    const isOverflowOpen = overflowOpen === t.truck_number;
    const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
    const prevCov = prevCoverage.byCover.get(t.truck_number) ?? null;

    // Detail line — concise context: prev-day coverage hint, today's coverage
    // (when not already shown as a badge), spare/batch tags.
    const detailParts: string[] = [];
    if (prevCov != null) detailParts.push(`Unload as #${prevCov} · prev-day cover`);
    else if (coveredRoute != null && !opts.coverageBadge) detailParts.push(`Covering #${coveredRoute}`);
    if (t.truck_type === "Spare") detailParts.push("Spare");
    if (t.state?.batch_id != null) detailParts.push(`Batch ${t.state.batch_id}`);
    const detail = detailParts.join("  ·  ");

    return (
      <AnimateCard
        key={t.truck_number}
        delay={index * 0.03}
        className={clsx("card flex flex-col !p-0", opts.accentClass)}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="font-mono text-[22px] font-black leading-none text-ink">#{t.truck_number}</span>
          {opts.coverageBadge && coveredRoute != null && (
            <CoverageTag route={coveredRoute} truck={t.truck_number} className="shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{detail}</span>
          {t.state?.needs_checked && (
            <span className="badge shrink-0 bg-st-inprogress text-black">Needs check</span>
          )}

          {isUndo ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="badge bg-st-unloaded text-[#052e16]">Unloaded</span>
              <button className="btn-ghost" disabled={isBusy} onClick={() => undoUnload(t.truck_number)}>
                {isBusy ? "…" : "Undo"}
              </button>
            </div>
          ) : (
            <div className="relative flex shrink-0 items-center gap-1.5">
              <button
                className={clsx(opts.ghost ? "btn-ghost" : "btn-primary", "px-4 py-2")}
                disabled={isBusy}
                onClick={() => markUnloaded(t)}
              >
                {isBusy ? "…" : opts.actionLabel}
              </button>
              <button
                className="flex h-9 w-8 items-center justify-center rounded-md border border-hairline bg-surface-2 text-lg leading-none text-ink-muted transition-colors hover:text-ink"
                onClick={() => toggleOverflow(t.truck_number)}
                title="More actions"
                aria-label="More actions"
              >
                ···
              </button>
              {isOverflowOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-hairline bg-surface-3 py-1 shadow-card">
                  {opts.overflow === "unfinished" ? (
                    <button
                      className="w-full px-3 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
                      disabled={isBusy}
                      onClick={() => {
                        setOverflowOpen(null);
                        upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "dirty" });
                      }}
                    >
                      Back to dirty
                    </button>
                  ) : (
                    <>
                      <button
                        className="w-full px-3 py-2 text-left text-sm font-medium text-st-unfinished transition-colors hover:bg-surface-2"
                        disabled={isBusy}
                        onClick={() => markUnfinished(t)}
                      >
                        Mark unfinished
                      </button>
                      {!batchingDisabled && (
                        <button
                          className="w-full px-3 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
                          onClick={() => toggleBatch(t)}
                        >
                          {t.state?.batch_id != null ? `Batch ${t.state.batch_id}` : "Assign batch"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inline batch panel (opened from the overflow menu) */}
        {!batchingDisabled && isBatchOpen && (
          <div className="space-y-2 rounded-b-xl border-t border-hairline bg-surface-2 p-3">
            <div className="grid grid-cols-6 gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBatchNum(String(n))}
                  className={
                    batchNum === String(n)
                      ? "rounded-md bg-st-unloaded py-2 text-center text-base font-bold text-black ring-2 ring-st-unloaded/60"
                      : "rounded-md bg-surface-3 py-2 text-center text-base font-bold text-ink-soft hover:bg-track"
                  }
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0}
              className="input"
              placeholder="Wearers"
              value={wearers}
              onChange={(e) => setWearers(e.target.value)}
            />
            <button className="btn-primary w-full" disabled={assign.isPending} onClick={() => assignBatch(t.truck_number)}>
              {assign.isPending ? "Saving…" : "Assign"}
            </button>
          </div>
        )}
      </AnimateCard>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-6"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
            ReadyRoute · Unload
          </div>
          <h1 className="text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
            Day {unloadsDay} Unload
          </h1>
        </div>
        <span className="badge shrink-0 bg-st-dirty text-white">{toGo} to go</span>
      </header>

      {/* Previous load-day coverage — what's being unloaded today was covered by
          these trucks on the prior run day (also shown per-card as "Unload as #N"). */}
      {prevCoverage.items.length > 0 && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
              Previous load-day coverage
            </span>
            {prevCoverage.date && (
              <span className="text-[10px] text-amber-500/70">
                ({format(new Date(`${prevCoverage.date}T12:00:00`), "EEE MMM d")})
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {prevCoverage.items.map((c) => (
              <span
                key={c.route}
                className="inline-flex items-center gap-1 rounded-full border border-amber-700/30 bg-surface-3 px-2 py-0.5 text-xs"
              >
                <span className="font-black text-st-dirty">#{c.route}</span>
                <ArrowLeftRight className="h-3 w-3 text-ink-faint" />
                <span className="font-black text-amber-200">#{c.loadOn}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 1. Requested — priority hold ───────────────────────────────── */}
      {requested.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-st-inprogress">
            Requested — priority hold
          </div>
          {requested.map((t, i) =>
            renderRow(t, i, {
              accentClass: "border-l-[3px] border-l-st-inprogress",
              actionLabel: "Mark Unloaded",
              overflow: "dirty",
            }),
          )}
        </section>
      )}

      {/* ── 2. Unfinished ──────────────────────────────────────────────── */}
      {unfinished.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-st-unfinished">Unfinished</div>
          {unfinished.map((t, i) =>
            renderRow(t, i, {
              accentClass: "border-l-[3px] border-l-st-unfinished",
              actionLabel: "Finish unload",
              ghost: true,
              overflow: "unfinished",
            }),
          )}
        </section>
      )}

      {/* ── 3. Dirty — coverage ────────────────────────────────────────── */}
      {dirtyCoverages.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Dirty — coverage</div>
          {dirtyCoverages.map((t, i) =>
            renderRow(t, i, {
              accentClass: "border-l-[3px] border-l-st-spare",
              actionLabel: "Mark Unloaded",
              coverageBadge: true,
              overflow: "dirty",
            }),
          )}
        </section>
      )}

      {/* ── 4. Dirty — route trucks ────────────────────────────────────── */}
      {dirtyRoute.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Dirty — route trucks</div>
          {dirtyRoute.map((t, i) =>
            renderRow(t, i, { accentClass: "border-l-[3px] border-l-st-dirty", actionLabel: "Mark Unloaded", overflow: "dirty" }),
          )}
        </section>
      )}

      {/* ── 5. Unloaded today ──────────────────────────────────────────── */}
      {unloaded.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-st-unloaded">
              Unloaded today · {unloaded.length}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setUnloadedSort("number")}
              className={clsx(
                "rounded-pill border bg-surface px-3 py-1 text-[11px] font-bold text-ink-soft transition-colors",
                unloadedSort === "number" ? "border-accent" : "border-hairline",
              )}
            >
              Number
            </button>
            <button
              type="button"
              onClick={() => setUnloadedSort("order")}
              className={clsx(
                "rounded-pill border bg-surface px-3 py-1 text-[11px] font-bold text-ink-soft transition-colors",
                unloadedSort === "order" ? "border-accent" : "border-hairline",
              )}
            >
              Unload order
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {unloadedSorted.map((t, index) => {
              const time = t.state?.updated_at ? format(new Date(t.state.updated_at), "HH:mm") : "—";
              return (
                <AnimateCard key={t.truck_number} delay={index * 0.02}>
                  <div className="rounded-[10px] border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.06)] px-1.5 py-2.5 text-center">
                    <span className="block font-mono text-[17px] font-extrabold leading-none text-ink">
                      #{t.truck_number}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-ink-muted">
                      {unloadedSort === "order" ? `#${index + 1} · ${time}` : time}
                    </span>
                  </div>
                </AnimateCard>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Batches ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Batches</div>
        <div className="columns-2 gap-3">
          {(batches ?? Array.from({ length: 6 }, (_, i) => ({ batch_number: i + 1, trucks: [], total_wearers: 0 }))).map((b, index) => (
            <AnimateCard key={b.batch_number} delay={index * 0.03} className="card mb-3 break-inside-avoid space-y-2 p-4">
              <p className="font-bold text-ink">Batch {b.batch_number}</p>
              <div className="flex flex-wrap gap-1">
                {b.trucks.length === 0 ? (
                  <span className="text-xs text-ink-muted">No trucks</span>
                ) : (
                  b.trucks.map((t) => (
                    <span key={t.truck_number} className="badge bg-track text-ink-soft">
                      #{t.truck_number}
                    </span>
                  ))
                )}
              </div>
              <p className="text-xs text-ink-muted">
                Total wearers:{" "}
                <span className={b.total_wearers > 0 ? "font-semibold text-st-unloaded" : ""}>
                  {b.total_wearers}
                </span>{" "}
                / {wearerCap}
              </p>
            </AnimateCard>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
