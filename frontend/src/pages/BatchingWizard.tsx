/**
 * Batching Wizard — a full-page, batch-first guided flow for entering the paper
 * "UNLOADING DAY" batch sheet start to finish: step through Batch 1 → 6, and on
 * each step (Zone A) select which trucks are in that batch, then (Zone B) give
 * each truck its wearers, watching the running total against the ~1,800 cap. A
 * final Review step summarises all six batches.
 *
 * Everything saves as you go through the existing batching API (useAssignBatch /
 * useRemoveTruckFromBatch) — the same "saves instantly" model as the Management
 * BatchingPanel — so the wizard is resumable and stays in sync with the other
 * batching surfaces. useBatchSummary is the single source of truth.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  useAssignBatch,
  useBatchSummary,
  useBoard,
  useHolidayUnload,
  useRemoveTruckFromBatch,
  useSettings,
  useUnloadsDayOverride,
  useUnloadDayTemplate,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import { buildOperationalDayContext } from "../utils/truckStatus";
import { capacityColor, capacityPct } from "../utils/batchCapacity";
import { useToast } from "../contexts/ToastContext";
import PageHeader from "../components/PageHeader";
import OverbatchedChip from "../components/OverbatchedChip";
import ConfirmDialog from "../components/ConfirmDialog";
import { DustGarmentIcon } from "../components/icons";
import WorkflowDayNotes from "../components/WorkflowDayNotes";
import WearerDefaultsEditor from "../components/batching/WearerDefaultsEditor";
import { useAuth } from "../contexts/AuthContext";
import type { TruckWithState } from "../types";

const BATCH_NUMBERS = [1, 2, 3, 4, 5, 6];
const REVIEW_STEP = 7;
const DEFAULT_WEARER_CAP = 1800;

export default function BatchingWizard() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [runDate, setRunDate] = useState(params.get("run_date") || todayIso());
  const [step, setStep] = useState(1); // 1..6 = a batch each; 7 = Review
  const [showAll, setShowAll] = useState(false);
  // Default ON: while filling a batch you only care about trucks that still
  // need one (plus this batch's own picks, which the filter keeps).
  const [hideBatched, setHideBatched] = useState(true);
  const [filter, setFilter] = useState("");
  const [wearerDrafts, setWearerDrafts] = useState<Record<number, string>>({});
  const [busyTruck, setBusyTruck] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState<number | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ truck: number; from: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ truck: number; from: number } | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  const { data: board = [] } = useBoard(runDate);
  const { data: batches = [] } = useBatchSummary(runDate);
  const { data: settings = [] } = useSettings();
  const { data: unloadsOverride } = useUnloadsDayOverride(runDate);
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const assign = useAssignBatch();
  const removeFromBatch = useRemoveTruckFromBatch();

  const noCap = settings.some((s) => s.key === "batch_no_cap" && s.value === true);
  const wearerCap = (() => {
    const v = Number(settings.find((s) => s.key === "wearer_cap")?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEARER_CAP;
  })();

  const [yr, mo, dy] = runDate.split("-").map(Number);
  const unloadsDay = unloadsOverride ?? workdayNumbers(new Date(yr, mo - 1, dy, 12)).unloadsDay;
  // Standing sheet for this unload day: wearer counts + notes.
  const dayTemplate = useUnloadDayTemplate(unloadsDay);

  // Which batch each truck currently sits in (from the live summary).
  const batchByTruck = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of batches) for (const t of b.trucks) map.set(t.truck_number, b.batch_number);
    return map;
  }, [batches]);

  const boardByNum = useMemo(() => {
    const map = new Map<number, TruckWithState>();
    for (const t of board) map.set(t.truck_number, t);
    return map;
  }, [board]);

  // Roster = today's unload-day trucks, plus anything already batched (so a
  // stray assignment is always visible/fixable); entire fleet when "show all".
  // Mirrors BatchingPanel's rosterTrucks.
  const rosterTrucks = useMemo(() => {
    if (showAll) return [...board].sort((a, b) => a.truck_number - b.truck_number);
    const ctx = buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload");
    const nums = new Set(ctx.activeTrucks.map((t) => t.truck_number));
    return board
      .filter((t) => nums.has(t.truck_number) || batchByTruck.has(t.truck_number))
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [board, showAll, unloadsDay, holidayUnload, batchByTruck]);

  const gridTrucks = useMemo(() => {
    let list = rosterTrucks;
    const f = filter.trim();
    if (f) list = list.filter((t) => String(t.truck_number).includes(f));
    if (hideBatched) {
      // Hide the noise of already-batched trucks, but keep the ones in THIS
      // batch so the current step's picks stay visible and removable.
      list = list.filter((t) => {
        const b = batchByTruck.get(t.truck_number);
        return b == null || b === step;
      });
    }
    return list;
  }, [rosterTrucks, filter, hideBatched, batchByTruck, step]);

  function batchInfo(n: number) {
    const b = batches.find((x) => x.batch_number === n);
    return { trucks: b?.trucks ?? [], total: b?.total_wearers ?? 0 };
  }

  // Wearers: whatever is already on the truck wins (someone set it tonight);
  // otherwise fall back to this unload day's standing sheet, so the common case
  // is confirming a number rather than typing one.
  function draftWearers(truckNumber: number): string {
    if (wearerDrafts[truckNumber] != null) return wearerDrafts[truckNumber];
    const live = boardByNum.get(truckNumber)?.state?.wearers ?? 0;
    if (live > 0) return String(live);
    return String(dayTemplate.wearers[truckNumber] ?? 0);
  }

  /** True when the shown value came from the day sheet, not from tonight's board. */
  function wearersFromTemplate(truckNumber: number): boolean {
    if (wearerDrafts[truckNumber] != null) return false;
    const live = boardByNum.get(truckNumber)?.state?.wearers ?? 0;
    return live === 0 && (dayTemplate.wearers[truckNumber] ?? 0) > 0;
  }

  async function assignTruck(truckNumber: number, batchNumber: number) {
    setBusyTruck(truckNumber);
    try {
      await assign.mutateAsync({
        run_date: runDate,
        batch_number: batchNumber,
        truck_number: truckNumber,
        wearers: Number(draftWearers(truckNumber)) || 0,
      });
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? `Could not assign truck ${truckNumber} to batch ${batchNumber}.`);
    } finally {
      setBusyTruck(null);
    }
  }

  async function unassignTruck(truckNumber: number, batchNumber: number) {
    setBusyTruck(truckNumber);
    try {
      await removeFromBatch.mutateAsync({ run_date: runDate, batch_number: batchNumber, truck_number: truckNumber });
    } catch {
      toast.error(`Could not remove truck ${truckNumber} from batch ${batchNumber}.`);
    } finally {
      setBusyTruck(null);
    }
  }

  // Tap in the grid: add to / remove from / move into the current batch.
  // Removing (tap a truck already in this batch) and moving (tap a truck in
  // ANOTHER batch) are both confirmed first, so a stray tap can't undo work.
  function toggleTruck(t: TruckWithState) {
    const current = batchByTruck.get(t.truck_number);
    if (current === step) setConfirmRemove({ truck: t.truck_number, from: step });
    else if (current != null) setConfirmMove({ truck: t.truck_number, from: current });
    else void assignTruck(t.truck_number, step);
  }

  async function clearBatch(batchNumber: number) {
    const { trucks } = batchInfo(batchNumber);
    for (const t of trucks) {
      try {
        await removeFromBatch.mutateAsync({ run_date: runDate, batch_number: batchNumber, truck_number: t.truck_number });
      } catch {
        toast.error(`Could not clear batch ${batchNumber}.`);
        return;
      }
    }
  }

  const isDust = (t: TruckWithState | undefined) => t?.truck_type === "Dust";

  // Writing an AppSetting is admin-gated server-side, so only offer the editor
  // to roles that can actually save — a button that always 403s is worse than
  // no button.
  const { user } = useAuth();
  const canEditDefaults = ["admin", "fleet", "supervisor"].includes(user?.role ?? "");

  return (
    <div className="space-y-4 p-3 md:p-6">
      <PageHeader
        eyebrow="Operations"
        title="Batching Wizard"
        subtitle={`Work batch by batch for ${runDate}. Target ${noCap ? "∞" : wearerCap.toLocaleString()} wearers per batch — as close as possible, don't go over.`}
      />

      {/* The sheet notes ARE batching constraints ("69 must be in its own
          batch"), so they belong in front of whoever is batching. */}
      <WorkflowDayNotes scope="unload" day={unloadsDay} />

      {/* Run date + roster scope */}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Run date
          <input
            type="date"
            className="input"
            max={todayIso()}
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              showAll
                ? "border-blue-500 bg-blue-900/50 text-blue-100"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
            )}
          >
            Show entire fleet
          </button>
          <button
            type="button"
            onClick={() => setHideBatched((v) => !v)}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              hideBatched
                ? "border-blue-500 bg-blue-900/50 text-blue-100"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500",
            )}
          >
            Hide batched
          </button>
          {canEditDefaults && (
            <button
              type="button"
              onClick={() => setDefaultsOpen(true)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-500"
            >
              Wearer defaults
            </button>
          )}
        </div>
      </div>

      <WearerDefaultsEditor
        open={defaultsOpen}
        initialDay={unloadsDay}
        onClose={() => setDefaultsOpen(false)}
      />

      {/* Progress pills — Batch 1-6 + Review, click to jump */}
      <div className="flex flex-wrap gap-2">
        {BATCH_NUMBERS.map((n) => {
          const { trucks, total } = batchInfo(n);
          const cap = capacityColor(total, noCap, wearerCap);
          const over = total > wearerCap;
          return (
            <button
              key={n}
              onClick={() => setStep(n)}
              title={over ? "Overbatched" : undefined}
              className={clsx(
                "relative flex min-w-[76px] flex-1 flex-col items-center rounded-lg border px-2 py-1.5 transition-colors sm:flex-none",
                step === n ? "border-blue-500 bg-blue-950/40" : "border-slate-700 bg-slate-900/60 hover:border-slate-600",
                over && "ring-1 ring-red-500/70",
              )}
            >
              {over && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
              <span className="text-xs font-bold text-slate-200">Batch {n}</span>
              <span className="text-[10px] text-slate-500">
                {trucks.length} truck{trucks.length !== 1 ? "s" : ""} ·{" "}
                <span className={clsx("font-semibold tabular-nums", cap.text)}>{total}</span>
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setStep(REVIEW_STEP)}
          className={clsx(
            "flex min-w-[76px] flex-1 flex-col items-center justify-center rounded-lg border px-2 py-1.5 transition-colors sm:flex-none",
            step === REVIEW_STEP ? "border-blue-500 bg-blue-950/40" : "border-slate-700 bg-slate-900/60 hover:border-slate-600",
          )}
        >
          <span className="text-xs font-bold text-slate-200">Review</span>
          <span className="text-[10px] text-slate-500">all batches</span>
        </button>
      </div>

      {step <= 6 ? (
        <BatchStep
          step={step}
          gridTrucks={gridTrucks}
          batchByTruck={batchByTruck}
          boardByNum={boardByNum}
          info={batchInfo(step)}
          noCap={noCap}
          wearerCap={wearerCap}
          filter={filter}
          setFilter={setFilter}
          busyTruck={busyTruck}
          draftWearers={draftWearers}
          wearersFromTemplate={wearersFromTemplate}
          setWearerDrafts={setWearerDrafts}
          onToggleTruck={toggleTruck}
          onAssignTruck={assignTruck}
          onRequestRemove={(truck, batch) => setConfirmRemove({ truck, from: batch })}
          onClearBatch={() => setConfirmClear(step)}
          onPrev={() => setStep((n) => Math.max(1, n - 1))}
          onNext={() => setStep((n) => n + 1)}
          isDust={isDust}
        />
      ) : (
        <ReviewStep
          batches={batches}
          boardByNum={boardByNum}
          noCap={noCap}
          wearerCap={wearerCap}
          isDust={isDust}
          onEditBatch={setStep}
        />
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2">
        <button className="btn-ghost" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
          ← Back
        </button>
        {step < REVIEW_STEP ? (
          <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
            {step === 6 ? "Review →" : "Next batch →"}
          </button>
        ) : (
          <button className="btn-primary" onClick={() => navigate("/fleet")}>
            Done
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear != null}
        variant="danger"
        title={`Clear batch ${confirmClear}?`}
        description={`Removes every truck from batch ${confirmClear} for ${runDate}. Truck statuses are not changed.`}
        confirmLabel="Clear batch"
        onConfirm={() => {
          const n = confirmClear;
          setConfirmClear(null);
          if (n != null) void clearBatch(n);
        }}
        onCancel={() => setConfirmClear(null)}
      />

      <ConfirmDialog
        open={confirmMove != null}
        title={`Move truck ${confirmMove?.truck} to Batch ${step}?`}
        description={`Truck ${confirmMove?.truck} is currently in Batch ${confirmMove?.from}. Moving it here removes it from Batch ${confirmMove?.from}.`}
        confirmLabel={`Move to Batch ${step}`}
        onConfirm={() => {
          const m = confirmMove;
          setConfirmMove(null);
          if (m) void assignTruck(m.truck, step);
        }}
        onCancel={() => setConfirmMove(null)}
      />

      <ConfirmDialog
        open={confirmRemove != null}
        variant="danger"
        title={`Remove truck ${confirmRemove?.truck} from Batch ${confirmRemove?.from}?`}
        description={`Truck ${confirmRemove?.truck} will no longer be assigned to a batch.`}
        confirmLabel="Remove"
        onConfirm={() => {
          const m = confirmRemove;
          setConfirmRemove(null);
          if (m) void unassignTruck(m.truck, m.from);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function BatchStep({
  step,
  gridTrucks,
  batchByTruck,
  boardByNum,
  info,
  noCap,
  wearerCap,
  filter,
  setFilter,
  busyTruck,
  draftWearers,
  wearersFromTemplate,
  setWearerDrafts,
  onToggleTruck,
  onAssignTruck,
  onRequestRemove,
  onClearBatch,
  onPrev,
  onNext,
  isDust,
}: {
  step: number;
  gridTrucks: TruckWithState[];
  batchByTruck: Map<number, number>;
  boardByNum: Map<number, TruckWithState>;
  info: { trucks: { truck_number: number; wearers: number }[]; total: number };
  noCap: boolean;
  wearerCap: number;
  filter: string;
  setFilter: (v: string) => void;
  busyTruck: number | null;
  draftWearers: (n: number) => string;
  wearersFromTemplate: (n: number) => boolean;
  setWearerDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onToggleTruck: (t: TruckWithState) => void;
  onAssignTruck: (truckNumber: number, batchNumber: number) => void;
  onRequestRemove: (truckNumber: number, batchNumber: number) => void;
  onClearBatch: () => void;
  onPrev: () => void;
  onNext: () => void;
  isDust: (t: TruckWithState | undefined) => boolean;
}) {
  const { total } = info;
  const cap = capacityColor(total, noCap, wearerCap);
  const pct = capacityPct(total, wearerCap);
  const selectedNums = info.trucks.map((t) => t.truck_number).sort((a, b) => a - b);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Zone A — select trucks */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Which trucks are in Batch {step}?</h3>
          <input
            className="input w-24 px-2 py-1 text-xs"
            type="text"
            inputMode="numeric"
            placeholder="find #"
            value={filter}
            onChange={(e) => setFilter(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        {gridTrucks.length === 0 ? (
          <p className="text-sm text-slate-500">
            No trucks match. Clear the filter, or adjust <span className="font-semibold">Show entire fleet</span> /{" "}
            <span className="font-semibold">Hide batched</span> above.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5">
            {gridTrucks.map((t) => {
              const current = batchByTruck.get(t.truck_number);
              const inThis = current === step;
              const inOther = current != null && current !== step;
              const busy = busyTruck === t.truck_number;
              return (
                <button
                  key={t.truck_number}
                  disabled={busy}
                  onClick={() => onToggleTruck(t)}
                  className={clsx(
                    "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 text-sm font-bold transition-colors",
                    inThis
                      ? "border-blue-500 bg-blue-900/50 text-blue-100"
                      : inOther
                        ? "border-slate-700 bg-slate-900/40 text-slate-500"
                        : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500",
                    busy && "opacity-50",
                  )}
                >
                  <span className="tabular-nums">#{t.truck_number}</span>
                  {inOther && (
                    <span className="rounded-full bg-slate-700/70 px-1.5 text-[9px] font-semibold text-slate-300">
                      in B{current}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Mobile only: the page footer's Back/Next sits below the whole wearers
            list, which is a long scroll away on a phone. Repeat it here so you
            can move on right after picking this batch's trucks. */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-3 md:hidden">
          <button className="btn-ghost flex-1" disabled={step <= 1} onClick={onPrev}>
            ← {step > 1 ? `Batch ${step - 1}` : "Back"}
          </button>
          <button className="btn-primary flex-1" onClick={onNext}>
            {step >= 6 ? "Review" : `Batch ${step + 1}`} →
          </button>
        </div>
      </div>

      {/* Zone B — wearers for the selected trucks */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">
            Wearers · Batch {step}
            <span className="ml-2 text-xs font-normal text-slate-500">{selectedNums.length} trucks</span>
          </h3>
          {selectedNums.length > 0 && (
            <button className="text-[11px] text-slate-500 hover:text-red-400" onClick={onClearBatch}>
              clear batch
            </button>
          )}
        </div>

        {/* Capacity bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300">
              Total
              <OverbatchedChip show={total > wearerCap} />
            </span>
            <span className="tabular-nums">
              <span className={clsx("font-bold", cap.text)}>{total.toLocaleString()}</span>
              <span className="text-slate-600"> / {noCap ? "∞" : wearerCap.toLocaleString()}</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div className={clsx("h-full rounded-full transition-all", cap.bar)} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {selectedNums.length === 0 ? (
          <p className="text-sm text-slate-500">Pick trucks on the left, then enter each truck's wearers here.</p>
        ) : (
          <div className="space-y-1.5">
            {selectedNums.map((num, idx) => {
              const isLast = idx === selectedNums.length - 1;
              const t = boardByNum.get(num);
              const busy = busyTruck === num;
              const saved = info.trucks.find((x) => x.truck_number === num)?.wearers ?? 0;
              return (
                <div
                  key={num}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1.5"
                >
                  <span className="flex w-16 shrink-0 items-center gap-1 text-base font-extrabold tabular-nums text-white">
                    #{num}
                    {isDust(t) && <DustGarmentIcon className="h-3.5 w-3.5 text-amber-400" />}
                  </span>
                  <input
                    id={`wearers-${step}-${num}`}
                    className="input w-24 px-2 py-1 text-sm"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    enterKeyHint={isLast ? "go" : "next"}
                    title="Wearers on this truck"
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (!isLast) {
                        // Focusing the next field blurs this one, which saves it.
                        const nextNum = selectedNums[idx + 1];
                        const el = document.getElementById(`wearers-${step}-${nextNum}`) as HTMLInputElement | null;
                        if (el) { el.focus(); el.select(); return; }
                      }
                      // Last field: commit it, then move on to the next batch.
                      e.currentTarget.blur();
                      onNext();
                    }}
                    value={draftWearers(num)}
                    onChange={(e) => setWearerDrafts((d) => ({ ...d, [num]: e.target.value.replace(/\D/g, "") }))}
                    onBlur={() => {
                      const next = Number(draftWearers(num)) || 0;
                      if (next !== saved) onAssignTruck(num, step); // re-assign updates the stored count
                    }}
                  />
                  <span className="text-xs text-slate-500">wearers</span>
                  {wearersFromTemplate(num) && (
                    <span
                      className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300"
                      title="Prefilled from this unload day's standing sheet — edit if it's different tonight"
                    >
                      sheet
                    </span>
                  )}
                  <button
                    disabled={busy}
                    className="ml-auto h-7 w-7 rounded-md bg-slate-800 text-xs text-slate-500 hover:bg-red-900/60 hover:text-red-300"
                    title="Remove from batch"
                    onClick={() => onRequestRemove(num, step)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReviewStep({
  batches,
  boardByNum,
  noCap,
  wearerCap,
  isDust,
  onEditBatch,
}: {
  batches: { batch_number: number; trucks: { truck_number: number; wearers: number }[]; total_wearers: number }[];
  boardByNum: Map<number, TruckWithState>;
  noCap: boolean;
  wearerCap: number;
  isDust: (t: TruckWithState | undefined) => boolean;
  onEditBatch: (n: number) => void;
}) {
  const grandTotal = BATCH_NUMBERS.reduce(
    (sum, n) => sum + (batches.find((b) => b.batch_number === n)?.total_wearers ?? 0),
    0,
  );
  const totalTrucks = BATCH_NUMBERS.reduce(
    (sum, n) => sum + (batches.find((b) => b.batch_number === n)?.trucks.length ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Review — all batches</h3>
        <span className="text-xs text-slate-400">
          {totalTrucks} trucks · <span className="font-bold text-slate-200 tabular-nums">{grandTotal.toLocaleString()}</span> wearers total
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BATCH_NUMBERS.map((n) => {
          const b = batches.find((x) => x.batch_number === n);
          const trucks = [...(b?.trucks ?? [])].sort((a, c) => a.truck_number - c.truck_number);
          const total = b?.total_wearers ?? 0;
          const cap = capacityColor(total, noCap, wearerCap);
          const pct = capacityPct(total, wearerCap);
          return (
            <div key={n} className="card space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-bold text-slate-200">
                  Batch {n}
                  <OverbatchedChip show={total > wearerCap} />
                </span>
                <button className="text-[11px] text-blue-400 hover:text-blue-300" onClick={() => onEditBatch(n)}>
                  edit
                </button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{trucks.length} trucks</span>
                <span className="tabular-nums">
                  <span className={clsx("font-bold", cap.text)}>{total.toLocaleString()}</span>
                  <span className="text-slate-600"> / {noCap ? "∞" : wearerCap.toLocaleString()}</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className={clsx("h-full rounded-full", cap.bar)} style={{ width: `${pct}%` }} />
              </div>
              {trucks.length === 0 ? (
                <p className="text-xs text-slate-600">empty</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {trucks.map((t) => (
                    <span
                      key={t.truck_number}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                    >
                      #{t.truck_number}
                      {isDust(boardByNum.get(t.truck_number)) && (
                        <DustGarmentIcon className="h-3 w-3 text-amber-400" />
                      )}
                      <span className="text-slate-500 tabular-nums">({t.wearers})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
