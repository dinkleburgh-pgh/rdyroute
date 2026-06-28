import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAssignBatch, useBoard, useBatchSummary, useHolidayUnload, useSettings, useUnloadsDayOverride, useUpsertTruckState } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import { isScheduledOff } from "../utils/truckStatus";
import type { TruckWithState } from "../types";
import AnimateCard from "../components/AnimateCard";
import WorkflowCard from "../components/WorkflowCard";
import PageHeader from "../components/PageHeader";
import { motion } from "framer-motion";
import clsx from "clsx";

/**
 * Unload workflow (V1 parity):
 *   dirty → unloaded (single click; V1 had no in_progress step for unloading —
 *   the in_progress state is reserved for the LOAD workflow).
 *
 * An "Undo" button lets the user revert a truck back to dirty if it was
 * marked by mistake (matches V1 unload_mobile_undo_state behavior).
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
  const batchingDisabled = useMemo(
    () => (settings ?? []).find((s) => s.key === "batching_disabled")?.value === true,
    [settings],
  );
  const upsert = useUpsertTruckState();
  const assign = useAssignBatch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const [batchOpen, setBatchOpen] = useState<number | null>(null);
  const [batchNum, setBatchNum] = useState("1");
  const [wearers, setWearers] = useState("0");
  const [overflowOpen, setOverflowOpen] = useState<number | null>(null);
  // Trucks marked unloaded this session — card stays in dirty section with Undo until navigation.
  const [recentlyUnloaded, setRecentlyUnloaded] = useState<Set<number>>(new Set());

  // Fleet Schedule is the single source of truth for which trucks appear.
  // Covering spares always included; pure spares excluded; route trucks included
  // iff they run on unloadsDay per scheduled_off_days.
  const allTrucks = useMemo(
    () =>
      (data ?? []).filter((t) => {
        // Coverage trucks always appear (spare has oos_spare_route; route-swap trucks
        // have route_swap_route). The OOS truck they cover is excluded below.
        if (t.route_swap_route != null || t.state?.oos_spare_route != null) return true;
        // OOS trucks can't go through the normal unload workflow. Exclude them
        // here — if coverage is assigned the covering truck appears above instead.
        if (t.is_oos || t.state?.status === "oos") return false;
        if (t.truck_type === "Spare") return false;
        return holidayUnload || !isScheduledOff(t, unloadsDay);
      }),
    [data, unloadsDay, holidayUnload],
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
  // Unloaded today reflects status immediately (including trucks just marked
  // this session) so the card appears the moment Mark Unloaded is clicked. The
  // truck also remains pinned in the Dirty section with Undo via recentlyUnloaded.
  const unloaded = useMemo(
    () => allTrucks.filter((t) => t.state?.status === "unloaded"),
    [allTrucks],
  );
  const needsChecked = useMemo(
    () =>
      allTrucks.filter(
        (t) =>
          t.state?.needs_checked === true &&
          (t.state?.status === "dirty" || t.state?.status === "unfinished" || t.state == null) &&
          !recentlyUnloaded.has(t.truck_number),
      ),
    [allTrucks, recentlyUnloaded],
  );

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

  function renderDirtyCard(t: TruckWithState, index: number = 0) {
    const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
    const isUndo = recentlyUnloaded.has(t.truck_number);
    const isBatchOpen = batchOpen === t.truck_number;
    const isOverflowOpen = overflowOpen === t.truck_number;
    const batchLabel = t.state?.batch_id != null ? `Batch ${t.state.batch_id}` : "Assign batch";
    const isBusy = busy === t.truck_number;
    const isPriority = t.state?.priority_hold === true;

    const cardClass = isPriority
      ? "card animate-priority-glow flex flex-col gap-2 p-3 min-h-[8rem] border-2 border-red-500/30 bg-gradient-to-br from-slate-900 via-red-950/10 to-slate-900"
      : "card flex flex-col gap-2 p-3 min-h-[8rem]";

    const numberColor = isPriority ? "text-amber-300" : "text-red-400";

    return (
      <AnimateCard key={t.truck_number} delay={index * 0.03} className={cardClass}>
        {/* Header: truck number + status badge */}
        <div className="flex items-start justify-between gap-1">
          <div>
            <span className={clsx("text-3xl font-black leading-none", numberColor)}>
              #{t.truck_number}
            </span>
            {coveredRoute != null && (
              <span className="mt-0.5 inline-flex items-center gap-1 self-start rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                Cov. #{coveredRoute}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 mt-0.5 shrink-0">
            {isPriority && (
              <motion.span
                animate={{ opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="badge bg-amber-500 font-bold text-black"
              >
                REQUEST
              </motion.span>
            )}
            <span className="badge bg-status-dirty">Dirty</span>
            {t.state?.needs_checked && (
              <span className="badge bg-amber-700 text-white">Needs Checked</span>
            )}
          </div>
        </div>

        {/* Action region — fixed min-height + bottom-aligned so marking a truck
            unloaded swaps in the Undo button without changing the card height or
            the button position (no grid reflow / jitter). */}
        <div className="mt-auto flex min-h-[6rem] flex-col justify-end gap-2">
        {isUndo ? (
          /* ── Undo state ── */
          <button
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-3.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
            disabled={isBusy}
            onClick={() => undoUnload(t.truck_number)}
          >
            {isBusy ? "…" : "Undo"}
          </button>
        ) : (
          <>
            {/* Batch chip — hidden when batching is disabled */}
            {!batchingDisabled && (
              <>
                <button
                  className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-700/60 md:hidden"
                  onClick={() => toggleBatch(t)}
                >
                  <span>{batchLabel}</span>
                  <span className="text-slate-500">{isBatchOpen ? "▲" : "▼"}</span>
                </button>
                <button
                  className="hidden w-full items-center justify-between rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-700/60 md:flex"
                  onClick={() => navigate(`/batches?truck=${t.truck_number}&run_date=${runDate}&source=unload`)}
                >
                  <span>{batchLabel}</span>
                  <span className="text-slate-500">↗</span>
                </button>
              </>
            )}

            {/* Inline batch panel (mobile) */}
            {!batchingDisabled && isBatchOpen && (
              <div className="space-y-2 rounded-lg bg-slate-800 p-2 md:hidden">
                <div className="grid grid-cols-3 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setBatchNum(String(n))}
                      className={
                        batchNum === String(n)
                          ? "rounded-md bg-emerald-600 py-2 text-center text-base font-bold text-white ring-2 ring-emerald-400"
                          : "rounded-md bg-slate-700 py-2 text-center text-base font-bold text-slate-300 hover:bg-slate-600"
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={0}
                  className="input w-full"
                  placeholder="Wearers"
                  value={wearers}
                  onChange={(e) => setWearers(e.target.value)}
                />
                <button
                  className="btn-primary w-full font-semibold"
                  disabled={assign.isPending}
                  onClick={() => assignBatch(t.truck_number)}
                >
                  {assign.isPending ? "Saving…" : "Assign"}
                </button>
              </div>
            )}

            {/* Primary action: Mark Unloaded */}
            <div className="flex gap-1.5">
              <button
                className={clsx(
                  "flex-1 rounded-lg py-3.5 text-sm font-bold text-white shadow-sm transition-colors active:scale-[0.98] disabled:opacity-50",
                  isPriority
                    ? "bg-amber-600 hover:bg-amber-500"
                    : "bg-emerald-600 hover:bg-emerald-500",
                )}
                disabled={isBusy}
                onClick={() => markUnloaded(t)}
              >
                {isBusy ? "…" : "Mark Unloaded"}
              </button>

              {/* Overflow: Mark Unfinished */}
              <div className="relative">
                <button
                  className="flex h-full items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 px-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                  onClick={() => toggleOverflow(t.truck_number)}
                  title="More actions"
                  aria-label="More actions"
                >
                  <span className="text-base leading-none">···</span>
                </button>
                {isOverflowOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
                    <button
                      className="w-full px-3 py-2 text-left text-sm font-medium text-orange-400 transition-colors hover:bg-slate-800"
                      disabled={isBusy}
                      onClick={() => markUnfinished(t)}
                    >
                      Mark Unfinished
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        </div>
      </AnimateCard>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-6 p-3 md:p-6">
      <PageHeader
        eyebrow="Workflow"
        title="Unload"
        subtitle="Work dirty and unfinished trucks into unloaded status and batch them when needed."
      />

      {/* ── Requests ─────────────────────────────────────────────────── */}
      {requested.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-400">
            Requests ({requested.length})
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {requested.map((t, index) => renderDirtyCard(t, index))}
          </div>
        </section>
      )}

      {/* ── Needs Checked ─────────────────────────────────────────────── */}
      {needsChecked.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-400">
            Needs Checked ({needsChecked.length})
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {needsChecked.map((t, index) => renderDirtyCard(t, index))}
          </div>
        </section>
      )}

      {/* ── Dirty (route trucks) ───────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-400">
          Dirty ({dirtyRoute.length})
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {dirtyRoute.map((t, index) => renderDirtyCard(t, index))}
          {dirtyRoute.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">No dirty trucks.</p>
          )}
        </div>
      </section>

      {/* ── Unfinished ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-orange-400">
          Unfinished ({unfinished.length})
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {unfinished.map((t, index) => {
            const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
            const isOverflowOpen = overflowOpen === t.truck_number;
            const isBusy = busy === t.truck_number;

            return (
              <AnimateCard key={t.truck_number} delay={index * 0.03} className="card flex flex-col gap-2 p-3 min-h-[8rem]">
                {/* Header */}
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <span className="text-3xl font-black leading-none text-orange-400">
                      #{t.truck_number}
                    </span>
                    {coveredRoute != null && (
                      <span className="mt-0.5 inline-flex items-center gap-1 self-start rounded-full bg-sky-900/40 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-700/40">
                        Cov. #{coveredRoute}
                      </span>
                    )}
                  </div>
                  <span className="flex flex-col items-end gap-1 mt-0.5 shrink-0">
                    <span className="badge bg-status-unfinished">Unfinished</span>
                    {t.state?.needs_checked && (
                      <span className="badge bg-amber-700 text-white">Needs Checked</span>
                    )}
                  </span>
                </div>

                {/* Primary action + overflow */}
                <div className="flex gap-1.5">
                  <button
                    className="flex-1 rounded-lg bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() => markUnloaded(t)}
                  >
                    {isBusy ? "…" : "Mark Unloaded"}
                  </button>

                  {/* Overflow: Back to Dirty */}
                  <div className="relative">
                    <button
                      className="flex h-full items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 px-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                      onClick={() => toggleOverflow(t.truck_number)}
                      title="More actions"
                      aria-label="More actions"
                    >
                      <span className="text-base leading-none">···</span>
                    </button>
                    {isOverflowOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
                        <button
                          className="w-full px-3 py-2 text-left text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
                          disabled={isBusy}
                          onClick={() => {
                            setOverflowOpen(null);
                            upsert.mutate({ truck_number: t.truck_number, run_date: runDate, status: "dirty" });
                          }}
                        >
                          Back to Dirty
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </AnimateCard>
            );
          })}
          {unfinished.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">No unfinished trucks.</p>
          )}
        </div>
      </section>

      {/* ── Unloaded ───────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-400">
          Unloaded today ({unloaded.length})
        </h3>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(152px,1fr))]">
          {unloaded.map((t, index) => (
            <AnimateCard key={t.truck_number} delay={index * 0.03}>
              <WorkflowCard
                truck={t}
                accent="text-st-unloaded"
                statusLabel="Unloaded"
                statusClassName="bg-[#16a34a] text-white"
              />
            </AnimateCard>
          ))}
          {unloaded.length === 0 && (
            <p className="col-span-full text-sm text-slate-500">Nothing unloaded yet.</p>
          )}
        </div>
      </section>

      {/* ── Spares / Coverages ─────────────────────────────────────────── */}
      {dirtyCoverages.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-violet-400">
            Spares / Coverages ({dirtyCoverages.length})
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {dirtyCoverages.map((t, index) => renderDirtyCard(t, index))}
          </div>
        </section>
      )}

      {/* ── Batches ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Batches
        </h3>
        <div className="columns-2 gap-3 md:columns-3">
          {(batches ?? Array.from({ length: 6 }, (_, i) => ({ batch_number: i + 1, trucks: [], total_wearers: 0 }))).map((b, index) => (
            <AnimateCard key={b.batch_number} delay={index * 0.03} className="card mb-3 break-inside-avoid p-4 space-y-2">
              <p className="font-bold text-slate-100">Batch {b.batch_number}</p>
              <div className="flex flex-wrap gap-1">
                {b.trucks.length === 0 ? (
                  <span className="text-xs text-slate-500">No trucks</span>
                ) : (
                  b.trucks.map((t) => (
                    <span key={t.truck_number} className="badge bg-slate-700 text-slate-200">
                      #{t.truck_number}
                    </span>
                  ))
                )}
              </div>
              <p className="text-xs text-slate-400">
                Total wearers:{" "}
                <span className={b.total_wearers > 0 ? "text-emerald-400 font-semibold" : ""}>
                  {b.total_wearers}
                </span>{" "}
                / 400
              </p>
            </AnimateCard>
          ))}
        </div>
      </section>
    </motion.div>
  );
}


/**
 * Unload workflow (V1 parity):
 *   dirty → unloaded (single click; V1 had no in_progress step for unloading —
 *   the in_progress state is reserved for the LOAD workflow).
 *
 * An "Undo" button lets the user revert a truck back to dirty if it was
 * marked by mistake (matches V1 unload_mobile_undo_state behavior).
 */
