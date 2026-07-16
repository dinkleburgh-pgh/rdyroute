import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { useAssignBatch, useBatchSummary, useSettings, useUpsertTruckState } from "../api/hooks";
import { Package } from "lucide-react";
import { todayIso } from "../api/client";
import type { BatchSummary } from "../types";
import AnimateCard from "../components/AnimateCard";

const DEFAULT_WEARER_CAP = 1800;

function capacityColor(total: number, noCap: boolean, cap: number) {
  if (noCap) return { bar: "bg-violet-500", text: "text-violet-400" };
  if (total >= cap * 0.95) return { bar: "bg-red-500",    text: "text-red-400"    };
  if (total >= cap * 0.70) return { bar: "bg-amber-500",  text: "text-amber-400"  };
  return                          { bar: "bg-emerald-500", text: "text-emerald-400" };
}

function BatchCard({
  batch,
  runDate,
  truckNumber,
  onAssigned,
  selected,
  onSelect,
  noCap,
  cap,
  shouldFocus,
}: {
  batch: BatchSummary;
  runDate: string;
  truckNumber: string;
  onAssigned: () => void;
  selected: boolean;
  onSelect: () => void;
  noCap: boolean;
  cap: number;
  shouldFocus: boolean;
}) {
  const assign = useAssignBatch();
  // Pre-fill the wearers field with the Operations wearer_cap setting; still
  // editable before assigning.
  const [wearers, setWearers] = useState(String(cap));
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the field in sync when the wearer_cap setting changes.
  useEffect(() => {
    setWearers(String(cap));
  }, [cap]);

  useEffect(() => {
    if (shouldFocus && truckNumber) {
      // slight delay so the element is visible before focus
      const id = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [shouldFocus, truckNumber]);

  const previewWearers = Number(wearers || 0);
  const previewTotal = batch.total_wearers + (truckNumber ? previewWearers : 0);
  const displayTotal = truckNumber ? previewTotal : batch.total_wearers;
  const { bar, text } = capacityColor(displayTotal, noCap, cap);
  const pct = noCap ? 100 : Math.min(100, Math.round((displayTotal / cap) * 100));

  async function handleAssign() {
    if (!truckNumber) return;
    await assign.mutateAsync({
      run_date: runDate,
      batch_number: batch.batch_number,
      truck_number: Number(truckNumber),
      wearers: previewWearers,
    });
    setWearers(String(cap));
    onAssigned();
  }

  return (
    <AnimateCard
      className={clsx(
        "card flex flex-col gap-2 md:gap-3",
        selected && "ring-2 ring-blue-500",
      )}
      delay={0.1}
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
            <span className="text-slate-500"> / {noCap ? "∞" : cap}</span>
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

      {/* Wearers + Assign — only shown when a truck is selected */}
      {truckNumber && (
        <div className="flex items-center gap-1.5 border-t border-slate-800 pt-2 md:pt-3">
          <input
            ref={inputRef}
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
            disabled={assign.isPending}
            onClick={handleAssign}
          >
            {assign.isPending ? "…" : "Assign"}
          </button>
        </div>
      )}
    </AnimateCard>
  );
}

export default function Batches() {
  const [params] = useSearchParams();
  const [runDate, setRunDate] = useState(params.get("run_date") ?? todayIso());
  const { data, isLoading } = useBatchSummary(runDate);
  const { data: settings = [] } = useSettings();
  const noCap = settings.some((s) => s.key === "batch_no_cap" && s.value === true);
  const wearerCap = (() => {
    const v = Number(settings.find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEARER_CAP;
  })();
  const [truck, setTruck] = useState(params.get("truck") ?? "");
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const source = params.get("source");
  const navigate = useNavigate();
  const upsert = useUpsertTruckState();

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
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
    <div className="space-y-4 p-3 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold">Batches</h2>
        <div className="flex flex-wrap items-end gap-3">

          <div>
            <label className="label">Run date</label>
            <input
              className="input"
              type="date"
              max={todayIso()}
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
            />
          </div>
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
        </div>
      </div>

      {/* Centered hint — visible when truck entered but no batch selected yet */}
      {truck && selectedBatch === null && (
        <div className="flex items-center justify-center">
          <div className="flex animate-pulse items-center gap-2 rounded-full border border-blue-500/40 bg-blue-950/50 px-5 py-2.5 shadow-lg shadow-blue-900/20">
            <Package className="h-4 w-4 shrink-0 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">Tap a batch card to assign</span>
          </div>
        </div>
      )}

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
              noCap={noCap}
              cap={wearerCap}
              onAssigned={async () => {
                if (source === "unload" && truck) {
                  await upsert.mutateAsync({
                    truck_number: Number(truck),
                    run_date: runDate,
                    status: "unloaded",
                    wearers: 0,
                  });
                  navigate("/unload");
                } else {
                  setTruck("");
                  setSelectedBatch(null);
                }
              }}
              selected={selectedBatch === b.batch_number}
              onSelect={() => setSelectedBatch(b.batch_number)}
              shouldFocus={selectedBatch === b.batch_number}
            />
          ))}
        </div>
      )}
    </div>
    </motion.div>
  );
}
