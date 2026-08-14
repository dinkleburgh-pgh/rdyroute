/**
 * Batching quick entry — type a truck, type its wearers, repeat.
 *
 * The existing /batching wizard is batch-first and TAP-first: pick a batch step,
 * hunt the truck in a 40-tile grid, then fill wearers in a second zone. That
 * suits working from the board. It does not suit the other job — sitting with
 * the paper batch sheet and reading straight down a column, where the hands
 * never want to leave the number keys.
 *
 * This is that flow: one batch at a time, two fields, Enter between them, and
 * the row commits and puts you back on the truck field for the next line.
 *
 * Wearers prefill off the day sheet with the same resolution every other
 * batching surface uses (coverage-resolved, split helpers at 0), so the usual
 * keystroke sequence is `51 ⏎ ⏎` — the number is already right and Enter just
 * confirms it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  useAssignBatch,
  useBatchSummary,
  useBoard,
  useHolidayUnload,
  useBatchUnit,
  usePrevDaySplitHelpers,
  useRemoveTruckFromBatch,
  useSettings,
  useUnloadDayTemplate,
  useUnloadsDayOverride,
} from "../../api/hooks";
import { todayIso } from "../../api/client";
import { workdayNumbers } from "../../components/Clock";
import { capacityColor, capacityPct } from "../../utils/batchCapacity";
import { useToast } from "../../contexts/ToastContext";
import OverbatchedChip from "../OverbatchedChip";
import { FieldRow } from "./shared";

const BATCH_NUMBERS = [1, 2, 3, 4, 5, 6];
const DEFAULT_WEARER_CAP = 1800;

export default function BatchingQuickEntry() {
  const toast = useToast();
  const [runDate, setRunDate] = useState(todayIso());
  const [batchNo, setBatchNo] = useState(1);
  const [truck, setTruck] = useState("");
  const [wearers, setWearers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const truckRef = useRef<HTMLInputElement>(null);
  const wearersRef = useRef<HTMLInputElement>(null);

  const { data: board = [] } = useBoard(runDate);
  const { data: batches = [] } = useBatchSummary(runDate);
  const { data: settings = [] } = useSettings();
  const { data: unloadsOverride } = useUnloadsDayOverride(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const assign = useAssignBatch();
  const removeFromBatch = useRemoveTruckFromBatch();

  const noCap = settings.some((s) => s.key === "batch_no_cap" && s.value === true);
  const cap = (() => {
    const v = Number(settings.find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEARER_CAP;
  })();

  const [yr, mo, dy] = runDate.split("-").map(Number);
  const unloadsDay = unloadsOverride ?? workdayNumbers(new Date(yr, mo - 1, dy, 12)).unloadsDay;
  const dayTemplate = useUnloadDayTemplate(unloadsDay);
  const { prevCarriers, batchUnitFor, carrierOf } = useBatchUnit(runDate, board);
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);

  const routeByCarrier = useMemo(() => {
    const m = new Map<number, number>();
    for (const [route, carrier] of prevCarriers) m.set(carrier.truck_number, route);
    return m;
  }, [prevCarriers]);

  const boardByNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);
  const batchByTruck = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of batches) for (const t of b.trucks) m.set(t.truck_number, b.batch_number);
    return m;
  }, [batches]);

  const current = batches.find((b) => b.batch_number === batchNo);
  const currentTotal = current?.total_wearers ?? 0;
  const { bar, text } = capacityColor(currentTotal, noCap, cap);

  /** Same rule as the wizard, the Batches page and the Unload panel. */
  function defaultWearersFor(n: number): string {
    if (prevSplitHelpers.has(n)) return "0";
    const live = boardByNum.get(n)?.state?.wearers ?? 0;
    if (live > 0) return String(live);
    const sheetRoute = routeByCarrier.get(n) ?? n;
    const entry = dayTemplate.wearers[sheetRoute];
    return entry != null ? String(entry) : "";
  }

  /** If the typed number is a carrier, the route whose card it will become. */
  const redirectedTo = (() => {
    const n = Number(truck);
    if (!Number.isFinite(n)) return null;
    const unit = batchUnitFor(n);
    return unit !== n ? unit : null;
  })();
  /** If the typed number IS a route that was covered, which truck brought it. */
  const broughtBackBy = (() => {
    const n = Number(truck);
    return Number.isFinite(n) ? carrierOf(n) : null;
  })();

  const known = (() => {
    const n = Number(truck);
    return Number.isFinite(n) && n > 0 && boardByNum.has(n);
  })();

  // Advancing from the truck field prefills wearers so the common case is just
  // Enter-Enter; focus lands on it selected so a different number overwrites.
  function commitTruck() {
    const n = Number(truck);
    if (!truck.trim()) return;
    if (!Number.isFinite(n) || !boardByNum.has(n)) {
      setErr(`#${truck} isn't in the fleet for ${runDate}.`);
      return;
    }
    setErr(null);
    // A carrier owns no card — the route does, and the crew types whichever
    // number is in front of them. Redirect rather than reject: the server would
    // 409 this on save, and an error at the end of a Enter-Enter rhythm is a
    // worse place to learn it than the field correcting itself now.
    const unit = batchUnitFor(n);
    if (unit !== n) setTruck(String(unit));
    setWearers(defaultWearersFor(unit));
    // The wearers input is always mounted, so focus can move now — no need to
    // wait on a render. Only the select() has to wait for React to paint the
    // prefilled value, and a timeout is used rather than requestAnimationFrame
    // because rAF does not run while the tab is backgrounded, which would leave
    // the caret stranded on a display that had been left in another window.
    wearersRef.current?.focus();
    window.setTimeout(() => wearersRef.current?.select(), 0);
  }

  async function commitRow() {
    const n = Number(truck);
    if (!Number.isFinite(n) || !boardByNum.has(n)) return;
    // Blank is not zero — an empty box means "I haven't said", and assigning
    // then would silently record 0. Same rule as the Batches page.
    if (wearers.trim() === "") {
      setErr("Enter a wearer count (0 is allowed, blank is not).");
      wearersRef.current?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await assign.mutateAsync({
        run_date: runDate,
        batch_number: batchNo,
        truck_number: n,
        wearers: Number(wearers) || 0,
      });
      setTruck("");
      setWearers("");
      truckRef.current?.focus();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(typeof detail === "string" ? detail : `Could not add #${n}.`);
    } finally {
      setBusy(false);
    }
  }

  async function undo(truckNumber: number) {
    try {
      await removeFromBatch.mutateAsync({
        run_date: runDate,
        batch_number: batchNo,
        truck_number: truckNumber,
      });
    } catch {
      toast.error(`Could not remove #${truckNumber}.`);
    }
  }

  // Moving to another batch starts a clean line.
  useEffect(() => {
    setTruck("");
    setWearers("");
    setErr(null);
    truckRef.current?.focus();
  }, [batchNo, runDate]);

  const movingFrom = known ? batchByTruck.get(Number(truck)) : undefined;

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Quick entry</h3>
        <p className="mt-1 text-xs text-slate-500">
          Type a truck, press Enter, confirm the wearers, press Enter. Built for working straight
          down the paper batch sheet without leaving the number keys.
        </p>
      </div>

      <FieldRow label="Run date" hint="Which day these batches belong to.">
        <input
          type="date"
          className="input w-44"
          value={runDate}
          max={todayIso()}
          onChange={(e) => setRunDate(e.target.value)}
        />
      </FieldRow>

      {/* Batch selector — totals live here so you can see a batch filling up. */}
      <div className="flex flex-wrap gap-1.5">
        {BATCH_NUMBERS.map((n) => {
          const b = batches.find((x) => x.batch_number === n);
          const total = b?.total_wearers ?? 0;
          const active = n === batchNo;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setBatchNo(n)}
              className={clsx(
                "flex min-w-[74px] flex-col items-center rounded-lg border px-2.5 py-1.5 transition-colors",
                active
                  ? "border-blue-500 bg-blue-950/40"
                  : "border-slate-700 bg-slate-900/60 hover:border-slate-600",
              )}
            >
              <span className="text-xs font-bold text-slate-200">Batch {n}</span>
              <span className={clsx("text-[10px] tabular-nums", total > cap ? "text-red-400" : "text-slate-500")}>
                {total.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Running total for the batch being filled */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs text-slate-400">
          <span className="flex items-center gap-2">
            Batch {batchNo} <OverbatchedChip show={currentTotal > cap} />
          </span>
          <span>
            <span className={clsx("text-lg font-extrabold tabular-nums", text)}>{currentTotal.toLocaleString()}</span>
            <span className="text-slate-500"> / {noCap ? "∞" : cap.toLocaleString()}</span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div className={clsx("h-full rounded-full transition-all", bar)} style={{ width: `${capacityPct(currentTotal, cap)}%` }} />
        </div>
      </div>

      {/* The two fields */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Truck</span>
          <input
            ref={truckRef}
            className="input w-24 text-center text-xl font-black"
            inputMode="numeric"
            autoComplete="off"
            placeholder="#"
            value={truck}
            onChange={(e) => { setTruck(e.target.value.replace(/\D/g, "")); setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTruck(); } }}
          />
        </label>
        <span className="pb-3 text-slate-600">→</span>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Wearers</span>
          <input
            ref={wearersRef}
            className="input w-28 text-center text-xl font-black"
            inputMode="numeric"
            autoComplete="off"
            placeholder="—"
            value={wearers}
            onChange={(e) => { setWearers(e.target.value.replace(/\D/g, "")); setErr(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void commitRow(); }
              // Backspace on an empty box walks back to the truck field.
              if (e.key === "Backspace" && wearers === "") { e.preventDefault(); truckRef.current?.focus(); }
            }}
          />
        </label>
        <button
          type="button"
          className="btn-primary mb-0.5"
          disabled={busy || !known || wearers.trim() === ""}
          onClick={() => void commitRow()}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>

      {/* Context for the truck currently typed, before it is committed */}
      <div className="min-h-[1.25rem] text-xs">
        {err ? (
          <span className="font-semibold text-red-400">{err}</span>
        ) : redirectedTo != null ? (
          <span className="text-amber-300">
            #{truck} carried route #{redirectedTo} — batching as #{redirectedTo} (one card per load).
          </span>
        ) : broughtBackBy != null ? (
          <span className="text-slate-400">
            Route #{truck} came back on #{broughtBackBy} — this is its one card.
          </span>
        ) : movingFrom != null && movingFrom !== batchNo ? (
          <span className="text-amber-300">#{truck} is in batch {movingFrom} — adding here moves it.</span>
        ) : prevSplitHelpers.has(Number(truck)) ? (
          <span className="text-amber-300">#{truck} carried a split — its wearers count on the route, so 0 here.</span>
        ) : null}
      </div>

      {/* What is already in this batch, newest last, each removable */}
      <div className="space-y-1.5 border-t border-slate-800 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          In batch {batchNo} · {current?.trucks.length ?? 0} truck{(current?.trucks.length ?? 0) === 1 ? "" : "s"}
        </p>
        {(current?.trucks.length ?? 0) === 0 ? (
          <p className="text-xs italic text-slate-600">Nothing yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {current!.trucks.map((t) => (
              <span
                key={t.truck_number}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-slate-200"
              >
                <span className="text-sm font-black tabular-nums text-white">#{t.truck_number}</span>
                <span className="text-[11px] text-slate-400">({t.wearers})</span>
                <button
                  type="button"
                  onClick={() => void undo(t.truck_number)}
                  className="text-slate-500 transition-colors hover:text-red-300"
                  title="Remove from batch"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
