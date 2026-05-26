import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { useAssignBatch, useBatchSummary } from "../api/hooks";
import { todayIso } from "../api/client";
import type { BatchSummary } from "../types";

const BATCH_CAP = 400;

function capacityColor(total: number) {
  if (total >= BATCH_CAP * 0.95) return { bar: "bg-red-500",    text: "text-red-400"    };
  if (total >= BATCH_CAP * 0.70) return { bar: "bg-amber-500",  text: "text-amber-400"  };
  return                                { bar: "bg-emerald-500", text: "text-emerald-400" };
}

function BatchCard({
  batch,
  runDate,
  truckNumber,
  onAssigned,
  selected,
  onSelect,
}: {
  batch: BatchSummary;
  runDate: string;
  truckNumber: string;
  onAssigned: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const assign = useAssignBatch();
  const [wearers, setWearers] = useState("");

  const previewWearers = Number(wearers || 0);
  const previewTotal = batch.total_wearers + (truckNumber ? previewWearers : 0);
  const displayTotal = truckNumber ? previewTotal : batch.total_wearers;
  const { bar, text } = capacityColor(displayTotal);
  const pct = Math.min(100, Math.round((displayTotal / BATCH_CAP) * 100));

  async function handleAssign() {
    if (!truckNumber) return;
    await assign.mutateAsync({
      run_date: runDate,
      batch_number: batch.batch_number,
      truck_number: Number(truckNumber),
      wearers: previewWearers,
    });
    setWearers("");
    onAssigned();
  }

  return (
    <div
      className={clsx(
        "card flex flex-col gap-2 md:gap-3",
        selected && "ring-2 ring-blue-500",
      )}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold md:text-xl">Batch {batch.batch_number}</h3>
        <span className="text-xs text-slate-500">
          {batch.trucks.length} truck{batch.trucks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Wearer capacity — live updates with preview */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs text-slate-400">
          <span>Wearers</span>
          <span>
            <span className={clsx("text-sm font-extrabold tabular-nums transition-colors md:text-lg", text)}>
              {displayTotal}
            </span>
            <span className="text-slate-500"> / {BATCH_CAP}</span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={clsx("h-full rounded-full transition-all", bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Truck chips + live preview chip */}
      <div className="flex min-h-[1.25rem] flex-wrap gap-1 md:min-h-[2rem] md:gap-1.5">
        {batch.trucks.length === 0 && !truckNumber && (
          <span className="text-xs italic text-slate-600">Empty</span>
        )}
        {batch.trucks.map((t) => (
          <span
            key={t.truck_number}
            className="inline-flex items-center gap-0.5 rounded-full bg-slate-700 px-1.5 py-0.5 text-xs font-medium md:gap-1 md:px-2.5 md:text-sm"
          >
            #{t.truck_number}
            {t.wearers > 0 && <span className="text-slate-400">({t.wearers})</span>}
          </span>
        ))}
        {truckNumber && (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-blue-400 bg-blue-900/30 px-1.5 py-0.5 text-xs font-medium text-blue-300 md:gap-1 md:px-2.5 md:text-sm">
            #{truckNumber}
            {previewWearers > 0 && <span className="text-blue-400">({previewWearers})</span>}
          </span>
        )}
      </div>

      {/* Wearers + Assign */}
      <div className="flex items-center gap-1.5 border-t border-slate-800 pt-2 md:pt-3">
        <input
          className="input min-w-0 flex-1"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="wearers"
          value={wearers}
          onChange={(e) => setWearers(e.target.value.replace(/\D/g, ""))}
        />
        <button
          className="btn-primary shrink-0 px-2 py-1.5 text-xs md:px-5 md:py-2 md:text-sm"
          disabled={assign.isPending || !truckNumber}
          onClick={handleAssign}
        >
          {assign.isPending ? "…" : "Assign"}
        </button>
      </div>
    </div>
  );
}

export default function Batches() {
  const [params] = useSearchParams();
  const [runDate, setRunDate] = useState(params.get("run_date") ?? todayIso());
  const { data, isLoading } = useBatchSummary(runDate);
  const [truck, setTruck] = useState(params.get("truck") ?? "");
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!truck) {
      setSelectedBatch(null);
    }
  }, [truck]);

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div className="flex items-end justify-between">
        <h2 className="text-2xl font-semibold">Batches</h2>
        <div>
          <label className="label">Run date</label>
          <input
            className="input"
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
          />
        </div>
      </div>

      {/* Truck selector */}
      <div className="card animate-slide-down border border-blue-500/40 bg-slate-900 p-6">
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Truck</p>
          {truck ? (
            <>
              <span className="text-6xl font-extrabold tabular-nums text-blue-300">#{truck}</span>
              <button
                className="text-xs text-slate-500 hover:text-slate-300"
                onClick={() => setTruck("")}
              >
                change
              </button>
            </>
          ) : (
            <input
              className="input mt-1 w-32 text-center text-2xl font-bold"
              type="number"
              value={truck}
              placeholder="—"
              autoFocus
              onChange={(e) => setTruck(e.target.value)}
            />
          )}
          {truck && (
            <p className="text-xs text-slate-600">
              {isDesktop
                ? "Select a batch card, then enter wearers and click Assign"
                : "Enter wearers on a batch card and click Assign"}
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
          {(data ?? []).map((b) => (
            <BatchCard
              key={b.batch_number}
              batch={b}
              runDate={runDate}
              truckNumber={
                isDesktop
                  ? (selectedBatch === b.batch_number ? truck : "")
                  : truck
              }
              onAssigned={() => setTruck("")}
              selected={selectedBatch === b.batch_number}
              onSelect={() => setSelectedBatch(b.batch_number)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
