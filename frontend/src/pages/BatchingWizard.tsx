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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  useAssignBatch,
  useBatchSummary,
  useBoard,
  useHolidayUnload,
  usePrevDayCarriers,
  usePrevDaySplitHelpers,
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
import { AlertTriangleIcon, DustGarmentIcon } from "../components/icons";
import WorkflowDayNotes from "../components/WorkflowDayNotes";
import PreBatchBanner from "../components/PreBatchBanner";
import WearerSheetStatus from "../components/batching/WearerSheetStatus";
import { can } from "../utils/permissions";
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

  // Drafts are keyed by truck number only, and the date picker above changes
  // runDate without remounting — so a number typed for truck 12 on one date
  // would otherwise still be sitting there, and get written to the next date
  // that truck is assigned on.
  useEffect(() => {
    setWearerDrafts({});
  }, [runDate]);

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

  // Coverage from the PREVIOUS load day: which truck physically came back
  // carrying which route's freight. When spare #11 ran route #4, the truck at
  // the dock is #11 but the paper sheet — and the wearer template — say "4".
  // Without this the roster shows #11 with no wearers and no clue which line of
  // the sheet it is, while #4 (which never left the yard) looks unbatched.
  const prevCarriers = usePrevDayCarriers(runDate, board);
  // Trucks that carried another route's SPLIT overflow yesterday.
  const prevSplitHelpers = usePrevDaySplitHelpers(runDate);
  const routeByCarrier = useMemo(() => {
    const m = new Map<number, number>();
    for (const [route, carrier] of prevCarriers) m.set(carrier.truck_number, route);
    return m;
  }, [prevCarriers]);

  /** The sheet line a truck is unloading: the route it carried, else itself. */
  const sheetRouteFor = useCallback(
    (truckNumber: number) => routeByCarrier.get(truckNumber) ?? truckNumber,
    [routeByCarrier],
  );
  /**
   * The day sheet's entry for a truck, resolved through coverage.
   * `undefined` means "not on this sheet" and is deliberately distinct from a
   * stored 0, which means "runs empty" — the Review flag depends on telling a
   * forgotten number from a real zero.
   */
  const templateEntryFor = useCallback(
    (truckNumber: number): number | undefined => {
      // A SPLIT helper carried the overflow of a route that also ran itself.
      // Both trucks come back and both need batching, but the garments are one
      // route's — already counted in full on that route's own card. Charging
      // the helper its own sheet line (a route it did not run) added a second
      // route's worth of wearers to the batch for a single route's freight.
      // A real 0, not undefined: it ran, it just carries no count of its own,
      // so Review must not flag it as a forgotten number.
      if (prevSplitHelpers.has(truckNumber)) return 0;
      return dayTemplate.wearers[sheetRouteFor(truckNumber)];
    },
    [dayTemplate, sheetRouteFor, prevSplitHelpers],
  );

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

  // Routes whose freight came back on ANOTHER truck. The route truck itself
  // never left the yard, so it is not a thing to batch — its carrier stands in
  // for it and wears the "rt N" chip. Without this the grid offered both, and
  // the same route could be batched twice (#4 and #11 both showing under
  // Batch 2 on 2026-07-30).
  const coveredRoutes = useMemo(() => new Set(prevCarriers.keys()), [prevCarriers]);

  // Roster = today's unload-day trucks, plus anything already batched (so a
  // stray assignment is always visible/fixable); entire fleet when "show all".
  // Mirrors BatchingPanel's rosterTrucks.
  const rosterTrucks = useMemo(() => {
    if (showAll) return [...board].sort((a, b) => a.truck_number - b.truck_number);
    const ctx = buildOperationalDayContext(board, unloadsDay, holidayUnload, false, "unload");
    const nums = new Set(ctx.activeTrucks.map((t) => t.truck_number));
    return board
      .filter((t) => !coveredRoutes.has(t.truck_number))
      .filter((t) => nums.has(t.truck_number) || batchByTruck.has(t.truck_number))
      .sort((a, b) => a.truck_number - b.truck_number);
  }, [board, showAll, unloadsDay, holidayUnload, batchByTruck, coveredRoutes]);

  // Batched, but not something this day should be batching — a covered route
  // truck that never came back. Excluding it from the roster above stops it
  // being picked again; surfacing it here stops the existing assignment going
  // silently unnoticed.
  const strandedBatched = useMemo(() => {
    if (showAll) return [];
    const rosterNums = new Set(rosterTrucks.map((t) => t.truck_number));
    return [...batchByTruck.entries()]
      .filter(([num]) => !rosterNums.has(num))
      .map(([num, batch]) => ({ truck: num, batch, carrier: prevCarriers.get(num)?.truck_number ?? null }))
      .sort((a, b) => a.truck - b.truck);
  }, [batchByTruck, rosterTrucks, prevCarriers, showAll]);

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
    // Split helpers are checked BEFORE the live value. Day setup stamps every
    // truck its sheet number, so the helper arrives carrying a full route's
    // worth of wearers for a load that is only the overflow of a route already
    // counted in full on its own card — that stored number is a default nobody
    // chose, not a deliberate entry, and taking it added the same garments to
    // the batch twice. Anything typed this session still wins (checked above).
    if (prevSplitHelpers.has(truckNumber)) return "0";
    const live = boardByNum.get(truckNumber)?.state?.wearers ?? 0;
    if (live > 0) return String(live);
    return String(templateEntryFor(truckNumber) ?? 0);
  }

  /** True when the shown value came from the day sheet, not from tonight's board. */
  function wearersFromTemplate(truckNumber: number): boolean {
    if (wearerDrafts[truckNumber] != null) return false;
    // A helper's 0 is a deliberate rule, not a sheet number worth badging.
    if (prevSplitHelpers.has(truckNumber)) return false;
    const live = boardByNum.get(truckNumber)?.state?.wearers ?? 0;
    return live === 0 && (templateEntryFor(truckNumber) ?? 0) > 0;
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
  const canEditDefaults = can(user?.role, "edit:wearer-defaults");

  return (
    <div className="space-y-4 p-3 md:p-6">
      <PageHeader
        eyebrow="Operations"
        title="Batching Wizard"
        subtitle={`Work batch by batch for ${runDate}. Target ${noCap ? "∞" : wearerCap.toLocaleString()} wearers per batch — as close as possible, don't go over.`}
      />

      {/* The sheet notes ARE batching constraints ("69 must be in its own
          batch"), so they belong in front of whoever is batching. */}
      <PreBatchBanner />
      <WorkflowDayNotes scope="unload" day={unloadsDay} />
      {/* This is where the sheet numbers actually get used, so it is where
          naming their month and their author earns its keep. Self-gating: one
          quiet line on a current month, amber only when it has fallen behind. */}
      <WearerSheetStatus onOpen={() => setDefaultsOpen(true)} />

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
          sheetRouteFor={sheetRouteFor}
        />
      ) : (
        <ReviewStep
          batches={batches}
          boardByNum={boardByNum}
          rosterTrucks={rosterTrucks}
          batchByTruck={batchByTruck}
          templateEntryFor={templateEntryFor}
          sheetRouteFor={sheetRouteFor}
          strandedBatched={strandedBatched}
          onRemoveStranded={(truck, batch) => setConfirmRemove({ truck, from: batch })}
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
  sheetRouteFor,
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
  /** Route this truck is unloading — differs from its own number when it
   *  carried another route's freight on the previous load day. */
  sheetRouteFor: (n: number) => number;
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
                  <span className="text-base font-black tabular-nums">#{t.truck_number}</span>
                  {/* Carrying someone else's route: the sheet says that route's
                      number, so show it or the operator can't match the line. */}
                  {sheetRouteFor(t.truck_number) !== t.truck_number && (
                    <span className="rounded-full bg-sky-500/20 px-1.5 text-[9px] font-bold text-sky-300">
                      rt {sheetRouteFor(t.truck_number)}
                    </span>
                  )}
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
                  <span className="flex w-16 shrink-0 flex-col items-start leading-tight">
                    <span className="flex items-center gap-1 text-base font-extrabold tabular-nums text-white">
                      #{num}
                      {isDust(t) && <DustGarmentIcon className="h-3.5 w-3.5 text-amber-400" />}
                    </span>
                    {sheetRouteFor(num) !== num && (
                      <span className="text-[9px] font-bold text-sky-300">rt {sheetRouteFor(num)}</span>
                    )}
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
  rosterTrucks,
  batchByTruck,
  templateEntryFor,
  sheetRouteFor,
  strandedBatched,
  onRemoveStranded,
  noCap,
  wearerCap,
  isDust,
  onEditBatch,
}: {
  batches: { batch_number: number; trucks: { truck_number: number; wearers: number }[]; total_wearers: number }[];
  boardByNum: Map<number, TruckWithState>;
  /** Today's unload roster — the denominator for "which trucks still need a batch". */
  rosterTrucks: TruckWithState[];
  batchByTruck: Map<number, number>;
  /** The day sheet's entry for a truck, resolved through coverage. `undefined`
   *  = not on the sheet, which is NOT the same as a stored 0 ("runs empty"). */
  templateEntryFor: (n: number) => number | undefined;
  /** Route this truck is unloading; differs when it carried another's freight. */
  sheetRouteFor: (n: number) => number;
  /** Batched trucks that aren't on today's roster — a covered route truck that
   *  never came back, so its batch entry is wrong. */
  strandedBatched: { truck: number; batch: number; carrier: number | null }[];
  onRemoveStranded: (truck: number, batch: number) => void;
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

  // A blank wearers box saves as 0, so 0 is all we can see here. But 0 is also
  // a REAL answer: the paper sheet prints 0 for dust trucks that run empty, and
  // those still get batched. Flagging every zero would nag about the same three
  // trucks every night until the warning stopped meaning anything — so a zero
  // is only suspicious when the day sheet doesn't also say zero.
  const missingWearers = BATCH_NUMBERS.flatMap((n) => {
    const b = batches.find((x) => x.batch_number === n);
    return (b?.trucks ?? [])
      .filter((t) => (t.wearers ?? 0) <= 0 && (templateEntryFor(t.truck_number) ?? -1) !== 0)
      .map((t) => ({ truck: t.truck_number, batch: n }));
  }).sort((a, b) => a.truck - b.truck);

  // Every truck working today that hasn't landed in a batch.
  //
  // A covered route and the truck that carried it are ONE thing to batch: the
  // freight came back on the carrier, so batching either satisfies the pair.
  // Without this the sheet could never come out clean — batch the route off the
  // paper and the carrier was flagged as missing; batch the carrier and the
  // route was. Route 4 covered by #11 is the standing example: it read as two
  // separate jobs when there was only ever one load.
  const unbatched = rosterTrucks
    .filter((t) => {
      if (batchByTruck.has(t.truck_number)) return false;
      const carried = sheetRouteFor(t.truck_number);
      return !(carried !== t.truck_number && batchByTruck.has(carried));
    })
    .map((t) => t.truck_number)
    .sort((a, b) => a - b);

  const clean =
    missingWearers.length === 0 && unbatched.length === 0 && strandedBatched.length === 0;

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Review — all batches</h3>
        <span className="text-xs text-slate-400">
          {totalTrucks} trucks · <span className="font-bold text-slate-200 tabular-nums">{grandTotal.toLocaleString()}</span> wearers total
        </span>
      </div>

      {/* The point of Review: what still needs doing before the sheet is done. */}
      {clean ? (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-300">
            Every truck is batched and has a wearer count.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-600/50 bg-amber-950/20 px-4 py-3 space-y-3">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-300">
            <AlertTriangleIcon className="h-4 w-4 shrink-0" />
            Needs attention before this sheet is done
          </p>

          {strandedBatched.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-200">
                {strandedBatched.length} truck{strandedBatched.length === 1 ? "" : "s"} batched but didn't run
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {strandedBatched.map(({ truck, batch, carrier }) => (
                  <button
                    key={truck}
                    type="button"
                    onClick={() => onRemoveStranded(truck, batch)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-600/50 bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-800/40"
                  >
                    #{truck}
                    <span className="text-[10px] font-normal text-amber-300/80">
                      batch {batch}{carrier != null ? ` · ran on #${carrier}` : ""}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-amber-200/70">
                Its route was covered, so this truck never came back — the carrier is the one to
                batch. Tap to remove it from the batch.
              </p>
            </div>
          )}

          {unbatched.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-200">
                {unbatched.length} truck{unbatched.length === 1 ? "" : "s"} not in any batch
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {unbatched.map((num) => (
                  <span
                    key={num}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-600/50 bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-100"
                  >
                    #{num}
                    {sheetRouteFor(num) !== num && (
                      <span className="text-[10px] font-normal text-sky-300">rt {sheetRouteFor(num)}</span>
                    )}
                    {isDust(boardByNum.get(num)) && <DustGarmentIcon className="h-3 w-3 text-amber-400" />}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-amber-200/70">
                Open any batch and tap them in the grid to assign.
              </p>
            </div>
          )}

          {missingWearers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-200">
                {missingWearers.length} truck{missingWearers.length === 1 ? "" : "s"} with no wearers entered
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {missingWearers.map(({ truck, batch }) => (
                  <button
                    key={truck}
                    type="button"
                    onClick={() => onEditBatch(batch)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-600/50 bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-800/40"
                  >
                    #{truck}
                    <span className="text-[10px] font-normal text-amber-300/80">batch {batch}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-amber-200/70">
                Tap one to jump to its batch. Trucks the day sheet lists as 0 aren't flagged.
              </p>
            </div>
          )}
        </div>
      )}
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
                  {trucks.map((t) => {
                    // Same rule as the summary above: a zero only reads as a
                    // gap when the day sheet doesn't also say zero.
                    const noWearers =
                      (t.wearers ?? 0) <= 0 && (templateEntryFor(t.truck_number) ?? -1) !== 0;
                    return (
                      <span
                        key={t.truck_number}
                        title={noWearers ? "No wearers entered" : undefined}
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                          noWearers
                            ? "border border-amber-600/50 bg-amber-900/30 text-amber-100"
                            : "bg-slate-800 text-slate-300",
                        )}
                      >
                        <span className="text-sm font-black tabular-nums">#{t.truck_number}</span>
                        {isDust(boardByNum.get(t.truck_number)) && (
                          <DustGarmentIcon className="h-3 w-3 text-amber-400" />
                        )}
                        <span
                          className={clsx(
                            "text-[11px] tabular-nums",
                            noWearers ? "font-bold text-amber-300" : "text-slate-500",
                          )}
                        >
                          ({noWearers ? "—" : t.wearers})
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
