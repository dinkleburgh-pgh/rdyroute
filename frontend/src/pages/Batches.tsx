import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  useAssignBatch,
  useBatchSummary,
  useBoard,
  useBatchUnit,
  usePrevDaySplitHelpers,
  useSettings,
  useUnloadDayTemplate,
  useUnloadsDayOverride,
  useUpsertTruckState,
} from "../api/hooks";
import { Package } from "lucide-react";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { BatchSummary } from "../types";
import AnimateCard from "../components/AnimateCard";
import OverbatchedChip from "../components/OverbatchedChip";
import { capacityColor } from "../utils/batchCapacity";

const DEFAULT_WEARER_CAP = 1800;

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
  awaitingPick,
  pulseDelayMs,
  defaultWearers,
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
  /** A truck is waiting and no batch is chosen — the card is the next action. */
  awaitingPick: boolean;
  /** Staggers the pulse across the grid so it reads as a wave rather than six
   *  things flashing at once, which looks like an error state. */
  pulseDelayMs: number;
  /** This truck's standing wearers off the day sheet; undefined = not on it. */
  defaultWearers: number | undefined;
}) {
  const assign = useAssignBatch();
  // Prefill this truck's standing count off the day sheet. Empty when the sheet
  // has no entry — a blank box asks for a number, where a wrong prefill gets
  // accepted at a glance.
  const [wearers, setWearers] = useState(defaultWearers != null ? String(defaultWearers) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed when the truck changes (its default differs) — but only for the
  // truck currently being assigned, so typing isn't overwritten mid-entry.
  useEffect(() => {
    setWearers(defaultWearers != null ? String(defaultWearers) : "");
  }, [defaultWearers, truckNumber]);

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
  const pct = Math.min(100, Math.round((displayTotal / cap) * 100));

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
        awaitingPick && "cursor-pointer border animate-pick-me",
      )}
      style={awaitingPick ? { animationDelay: `${pulseDelayMs}ms` } : undefined}
      delay={0.1}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-base font-bold md:text-xl">Batch {batch.batch_number}</h3>
          <OverbatchedChip show={displayTotal > cap} />
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">
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
            className="inline-flex items-baseline gap-1 rounded-full bg-slate-700 px-2 py-0.5 md:px-2.5"
          >
            <span className="text-base font-black tabular-nums text-white md:text-lg">#{t.truck_number}</span>
            {t.wearers > 0 && <span className="text-[11px] text-slate-400 md:text-xs">({t.wearers})</span>}
          </span>
        ))}
        {truckNumber && (
          <span className="inline-flex items-baseline gap-1 rounded-full border border-dashed border-blue-400 bg-blue-900/30 px-2 py-0.5 text-blue-300 md:px-2.5">
            <span className="text-base font-black tabular-nums md:text-lg">#{truckNumber}</span>
            {previewWearers > 0 && <span className="text-[11px] text-blue-400 md:text-xs">({previewWearers})</span>}
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
            placeholder={defaultWearers != null ? "wearers" : "wearers?"}
            value={wearers}
            onChange={(e) => setWearers(e.target.value.replace(/\D/g, ""))}
          />
          <button
            className="btn-primary shrink-0 px-2 py-1.5 text-xs md:px-5 md:py-2 md:text-sm"
            // Blank is not zero. With no sheet default the field starts empty,
            // and assigning then would silently record 0 wearers.
            disabled={assign.isPending || wearers.trim() === ""}
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
  const prebatchMode = settings.some((s) => s.key === "prebatch_mode" && s.value === true);
  const wearerCap = (() => {
    const v = Number(settings.find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEARER_CAP;
  })();
  const [truck, setTruck] = useState(params.get("truck") ?? "");
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);

  // The wearers field used to prefill with wearer_cap (1,800) — the batch
  // CAPACITY, not anything to do with this truck. Accepting it silently loaded
  // a whole batch's worth onto one truck. Prefill the day sheet's standing
  // count instead, resolved through coverage so a spare running someone else's
  // route gets that route's number; with no sheet entry the field stays EMPTY
  // and asks, which is honest rather than confidently wrong.
  const { data: board = [] } = useBoard(runDate);
  const { data: unloadsOverride } = useUnloadsDayOverride(runDate);
  const [uy, um, ud] = runDate.split("-").map(Number);
  const unloadsDay = unloadsOverride ?? workdayNumbers(new Date(uy, um - 1, ud, 12)).unloadsDay;
  const dayTemplate = useUnloadDayTemplate(unloadsDay);
  const { prevCarriers, batchUnitFor, carrierOf } = useBatchUnit(runDate, board);
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const defaultWearers = useMemo(() => {
    const n = Number(truck);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    // A split helper's load is part of a route that also ran and is counted in
    // full on that route — prefilling the helper's own sheet line would add the
    // same garments to the batch a second time. Same rule as the wizard.
    if (prevSplitHelpers.has(n)) return 0;
    return dayTemplate.wearers[batchUnitFor(n)];
  }, [truck, batchUnitFor, prevSplitHelpers, dayTemplate]);

  /** Typed a carrier? The route it will be batched as. */
  const redirectedTo = useMemo(() => {
    const n = Number(truck);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = batchUnitFor(n);
    return unit !== n ? unit : null;
  }, [truck, batchUnitFor]);
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
            <>
            <input
              className="input mt-1 w-32 text-center text-2xl font-bold"
              type="number"
              value={truck}
              placeholder="—"
              autoFocus
              onChange={(e) => setTruck(e.target.value)}
              // A carrier owns no batch card — the route does. Correct it as
              // soon as the number is committed, rather than letting the server
              // 409 it after a batch has been picked.
              onBlur={() => {
                const n = Number(truck);
                if (!Number.isFinite(n) || n <= 0) return;
                const unit = batchUnitFor(n);
                if (unit !== n) setTruck(String(unit));
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
            {redirectedTo != null && (
              <p className="mt-1 text-[11px] font-semibold text-amber-300">
                #{truck} carried route {redirectedTo} — batching as #{redirectedTo}
              </p>
            )}
            </>
          )}
        </div>
      </div>

      {/* Centered hint — visible when truck entered but no batch selected yet */}
      {truck && selectedBatch === null && (
        <div className="flex items-center justify-center">
          {/* Solid. The cards themselves now carry the motion, and a pulsing
              label above them competed with the thing it was pointing at. */}
          <div className="flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-950/50 px-5 py-2.5 shadow-lg shadow-blue-900/20">
            <Package className="h-4 w-4 shrink-0 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">Tap a batch card below to assign:</span>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
          {(data ?? []).map((b, i) => (
            <BatchCard
              key={b.batch_number}
              awaitingPick={Boolean(truck) && selectedBatch === null}
              pulseDelayMs={i * 90}
              defaultWearers={defaultWearers}
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
                  // Coming from the Unload workflow, assigning a batch has also
                  // meant "and it's unloaded" since f31a21c. Pre-batch mode is
                  // exactly the case where that must not happen — the whole
                  // point is to batch ahead of the unload.
                  // `wearers` is deliberately NOT sent: the assign just wrote
                  // the entered count, and this PUT applies whatever fields it
                  // is given, so passing 0 here silently zeroed it.
                  if (!prebatchMode) {
                    await upsert.mutateAsync({
                      truck_number: Number(truck),
                      run_date: runDate,
                      status: "unloaded",
                    });
                  }
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
