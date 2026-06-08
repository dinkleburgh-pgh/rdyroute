import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAssignBatch, useBoard, useBatchSummary, useSettings, useUpsertTruckState } from "../api/hooks";
import { todayIso } from "../api/client";
import type { TruckWithState } from "../types";

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

  const nonSpare = useMemo(
    () =>
      (data ?? []).filter(
        (t) =>
          t.truck_type !== "Spare" ||
          t.route_swap_route != null ||
          t.state?.oos_spare_route != null,
      ),
    [data],
  );
  const dirty = useMemo(
    () =>
      nonSpare.filter(
        (t) =>
          t.state?.status === "dirty" ||
          t.state == null ||
          recentlyUnloaded.has(t.truck_number),
      ),
    [nonSpare, recentlyUnloaded],
  );
  const unfinished = useMemo(
    () => nonSpare.filter((t) => t.state?.status === "unfinished" && !recentlyUnloaded.has(t.truck_number)),
    [nonSpare, recentlyUnloaded],
  );
  const unloaded = useMemo(
    () =>
      nonSpare.filter(
        (t) => t.state?.status === "unloaded" && !recentlyUnloaded.has(t.truck_number),
      ),
    [nonSpare, recentlyUnloaded],
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
    try {
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "unloaded",
        wearers: t.state?.wearers ?? 0,
      });
      setRecentlyUnloaded((prev) => new Set([...prev, t.truck_number]));
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

  return (
    <div className="space-y-6 p-3 md:p-6">
      <h2 className="text-2xl font-semibold">Unload</h2>

      {/* ── Dirty ──────────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-400">
          Dirty ({dirty.length})
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {dirty.map((t) => {
            const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
            const isUndo = recentlyUnloaded.has(t.truck_number);
            const isBatchOpen = batchOpen === t.truck_number;
            const isOverflowOpen = overflowOpen === t.truck_number;
            const batchLabel = t.state?.batch_id != null ? `Batch ${t.state.batch_id}` : "Assign batch";
            const isBusy = busy === t.truck_number;

            return (
              <div key={t.truck_number} className="card flex flex-col gap-2 p-3">
                {/* Header: truck number + status badge */}
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <span className="text-3xl font-black leading-none text-red-400">
                      #{t.truck_number}
                    </span>
                    {coveredRoute != null && (
                      <div className="text-[10px] font-medium text-sky-400">cov. #{coveredRoute}</div>
                    )}
                  </div>
                  <span className="badge bg-status-dirty mt-0.5 shrink-0">Dirty</span>
                </div>

                {isUndo ? (
                  /* ── Undo state ── */
                  <button
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
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
                        className="flex-1 rounded-lg bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50"
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
            );
          })}
          {dirty.length === 0 && (
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
          {unfinished.map((t) => {
            const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
            const isOverflowOpen = overflowOpen === t.truck_number;
            const isBusy = busy === t.truck_number;

            return (
              <div key={t.truck_number} className="card flex flex-col gap-2 p-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <span className="text-3xl font-black leading-none text-orange-400">
                      #{t.truck_number}
                    </span>
                    {coveredRoute != null && (
                      <div className="text-[10px] font-medium text-sky-400">cov. #{coveredRoute}</div>
                    )}
                  </div>
                  <span className="badge bg-status-unfinished mt-0.5 shrink-0">Unfinished</span>
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
              </div>
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
        <div className="flex flex-wrap gap-2">
          {unloaded.map((t) => (
            <span key={t.truck_number} className="badge bg-status-unloaded">
              #{t.truck_number}
            </span>
          ))}
          {unloaded.length === 0 && (
            <p className="text-sm text-slate-500">Nothing unloaded yet.</p>
          )}
        </div>
      </section>

      {/* ── Batches ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Batches
        </h3>
        <div className="columns-2 gap-3 md:columns-3">
          {(batches ?? Array.from({ length: 6 }, (_, i) => ({ batch_number: i + 1, trucks: [], total_wearers: 0 }))).map((b) => (
            <div key={b.batch_number} className="card mb-3 break-inside-avoid p-4 space-y-2">
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
            </div>
          ))}
        </div>
      </section>
    </div>
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
