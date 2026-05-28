import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAssignBatch, useBoard, useBatchSummary, useUpsertTruckState } from "../api/hooks";
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
  const upsert = useUpsertTruckState();
  const assign = useAssignBatch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const [batchOpen, setBatchOpen] = useState<number | null>(null);
  const [batchNum, setBatchNum] = useState("1");
  const [wearers, setWearers] = useState("0");
  // Trucks marked unloaded this session — card stays in dirty section with Undo until navigation.
  const [recentlyUnloaded, setRecentlyUnloaded] = useState<Set<number>>(new Set());

  // Spare-type trucks normally sit idle, but a spare covering an OOS route
  // runs a real route and must appear in the unload workflow.
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
  // Keep recently-unloaded trucks in the dirty section so the Undo button stays visible.
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
  // Exclude recently-unloaded from this section — they're still shown above with Undo.
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

  async function markUnloaded(t: TruckWithState) {
    setBusy(t.truck_number);
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

  return (
    <div className="space-y-6 p-3 md:p-6">
      <h2 className="text-2xl font-semibold">Unload</h2>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-400">
          Dirty ({dirty.length})
        </h3>
        <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3 lg:grid-cols-4">
          {dirty.map((t) => {
            const coveredRoute = t.route_swap_route ?? t.state?.oos_spare_route ?? null;
            return (
            <div key={t.truck_number} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-2xl font-bold text-red-400">#{t.truck_number}</span>
                  {coveredRoute != null && (
                    <div className="text-xs text-sky-400 font-medium">cov. #{coveredRoute}</div>
                  )}
                </div>
                <span className="badge bg-status-dirty">Dirty</span>
              </div>
              {recentlyUnloaded.has(t.truck_number) ? (
                <button
                  className="btn-ghost w-full"
                  disabled={busy === t.truck_number}
                  onClick={() => undoUnload(t.truck_number)}
                >
                  Undo
                </button>
              ) : (
                <>
                  {/* Mobile: inline batch panel */}
                  <button
                    className="btn-primary w-full bg-emerald-600 text-sm hover:bg-emerald-500 md:hidden"
                    onClick={() => {
                      setBatchNum(String(t.state?.batch_id ?? 1));
                      setWearers(String(t.state?.wearers ?? 0));
                      setBatchOpen(batchOpen === t.truck_number ? null : t.truck_number);
                    }}
                  >
                    {t.state?.batch_id != null ? `Batch ${t.state.batch_id}` : "Batch"}
                  </button>
                  {batchOpen === t.truck_number && (
                    <div className="space-y-2 rounded-lg bg-slate-800 p-2 md:hidden">
                      <div className="grid grid-cols-3 gap-1.5">
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setBatchNum(String(n))}
                            className={batchNum === String(n)
                              ? "rounded-md bg-emerald-600 py-2 text-center text-base font-bold text-white ring-2 ring-emerald-400"
                              : "rounded-md bg-slate-700 py-2 text-center text-base font-bold text-slate-300 hover:bg-slate-600"}
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
                  {/* Desktop: navigate to full batching page */}
                  <button
                    className="btn-primary hidden w-full bg-emerald-600 text-sm hover:bg-emerald-500 md:block"
                    onClick={() => navigate(`/batches?truck=${t.truck_number}&run_date=${runDate}&source=unload`)}
                  >
                    {t.state?.batch_id != null ? `Batch ${t.state.batch_id}` : "Assign Batch"}
                  </button>
                  <button
                    className="btn-primary w-full"
                    disabled={busy === t.truck_number}
                    onClick={() => markUnloaded(t)}
                  >
                    Mark Unloaded
                  </button>
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
