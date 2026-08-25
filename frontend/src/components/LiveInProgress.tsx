/**
 * LiveInProgress — redesigned per "In Progress Redesign.dc.html" option 2a.
 *
 * Drop-in replacement for frontend/src/components/LiveInProgress.tsx.
 * All existing exports used elsewhere (PaceBar, ElapsedTimer, useElapsed,
 * StartNextUpBanner, NextUpPanel, formatDuration) are preserved unchanged.
 *
 * Layout changes only — every hook, mutation, guard, and navigation path is
 * the same as the current file:
 *   1. "Unloading now" strip across the very top (Layout.tsx's unloadingTruck
 *      pattern; links to /unload).
 *   2. Instrument header band: Loading now #N / elapsed + pace bar / Next up.
 *   3. Left column: Finish Loading + Audit actions, shortage card with a
 *      Buttons ⇄ Dropdowns entry-mode toggle, monochrome session stat strip.
 *   4. Right rail: LoadNotesPanel, then Recent Finishes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  useBoard,
  useClearNextUp,
  useNextUp,
  usePaceAverage,
  useRecordLoadDuration,
  useSetNextUp,
  useShortages,
  useUpsertTruckState,
  useHolidayLoad,
  useAssignSpare,
  useSpareAssignments,
  useTrackedItems,
  useCreateShortage,
} from "../api/hooks";
import type { TrackedItem } from "../api/hooks";
import { ShortageLogger } from "../pages/Shorts";
import { DEFAULT_TRACKED_ITEMS, findTrackedItem, topCatOf } from "./shorts/HierarchyPicker";
import { useAuth } from "../contexts/AuthContext";
import CoverageTag from "./CoverageTag";
import LoadNotesPanel from "./load/LoadNotesPanel";
import { workdayNumbers } from "./Clock";
import { buildOperationalDayContext, effectiveStatus, getCoverageRouteNumber, isScheduledOff } from "../utils/truckStatus";
import type { TruckWithState } from "../types";
import { truckTypeLabel } from "../utils/truckType";

export function LiveInProgress({ runDate }: { runDate: string }) {
  const { data: board } = useBoard(runDate);
  const { data: nextUp } = useNextUp(runDate);
  const { data: pace } = usePaceAverage(30);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);

  const inProgress = useMemo(
    () => (board ?? []).find((t) => t.state?.status === "in_progress") ?? null,
    [board],
  );
  const unloaded = useMemo(
    () => (board ?? []).filter((t) => t.state?.status === "unloaded"),
    [board],
  );
  const loadedToday = useMemo(
    () => (board ?? []).filter((t) => t.state?.status === "loaded" && t.state?.load_finish_time != null),
    [board],
  );
  // Same status-guarded derivation Layout.tsx uses for its rail.
  const unloadingTruck = useMemo(
    () =>
      (board ?? []).find(
        (t) =>
          t.state?.unloading_started_at != null &&
          (t.state.status === "dirty" || t.state.status === "unfinished"),
      ) ?? null,
    [board],
  );
  // Only trucks the board actually calls dirty. Counting rowless trucks too
  // (as this did) means an uninitialised day reports the entire fleet —
  // spares and scheduled-off trucks included — as waiting to be unloaded.
  const dirtyCount = useMemo(
    () => (board ?? []).filter((t) => t.state?.status === "dirty").length,
    [board],
  );

  const upsert = useUpsertTruckState();
  const clearNextUp = useClearNextUp(runDate);
  const [starting, setStarting] = useState(false);
  const nextUpTruck = useMemo(
    () => unloaded.find((t) => t.truck_number === nextUp && t.state?.priority_hold !== true) ?? null,
    [unloaded, nextUp],
  );
  async function startNextUp(t: TruckWithState) {
    setStarting(true);
    try {
      await upsert.mutateAsync({
        truck_number: t.truck_number,
        run_date: runDate,
        status: "in_progress",
        wearers: t.state?.wearers ?? 0,
        load_start_time: Date.now() / 1000,
        load_finish_time: null,
        load_duration_seconds: null,
      });
      clearNextUp.mutate();
    } catch (err) {
      console.error("start next up failed", err);
    } finally {
      setStarting(false);
    }
  }

  const loadDay = inProgress?.state?.load_day_num ?? null;
  const scheduledTotal = useMemo(
    () =>
      loadDay != null
        ? buildOperationalDayContext(board ?? [], loadDay, holidayLoad, false).activeTrucks.length
        : 0,
    [board, loadDay, holidayLoad],
  );

  if (!inProgress) {
    // Unchanged from the current file.
    return (
      <div className="p-4 sm:p-[22px_26px_40px]">
        <div className="mx-auto max-w-lg space-y-4">
          <div className="card flex flex-col items-center justify-center py-8 text-center">
            <p className="text-lg font-semibold text-st-loaded">No truck currently in progress.</p>
            <p className="mt-1 text-sm text-ink-muted">
              {nextUpTruck != null
                ? "The queued truck is ready to go — start it below."
                : nextUp != null
                  ? <>Next up <span className="font-mono font-bold text-sky-300">#{nextUp}</span> isn't ready to load right now.</>
                  : "Pick a next-up truck below to queue it."}
            </p>
          </div>
          {nextUpTruck && (
            <StartNextUpBanner
              truck={nextUpTruck}
              paceAvgSeconds={pace?.avg_seconds ?? null}
              busy={starting}
              onStart={() => void startNextUp(nextUpTruck)}
              blockedReason={
                nextUpTruck.truck_type === "Spare" && getCoverageRouteNumber(nextUpTruck) == null
                  ? "This spare has no route to cover yet — assign one on the board first."
                  : null
              }
            />
          )}
          <NextUpPanel runDate={runDate} nextUp={nextUp ?? null} unloaded={unloaded} anyInProgress={false} />
        </div>
      </div>
    );
  }

  return (
    <InProgressView
      truck={inProgress}
      paceAvgSeconds={pace?.avg_seconds ?? null}
      runDate={runDate}
      nextUp={nextUp ?? null}
      unloaded={unloaded}
      loadedToday={loadedToday}
      scheduledTotal={scheduledTotal}
      unloadingTruck={unloadingTruck}
      dirtyCount={dirtyCount}
    />
  );
}

// ---------------------------------------------------------------------------
// UnloadingNowStrip — slim full-width band above the loading header
// ---------------------------------------------------------------------------

function UnloadingNowStrip({ truck, dirtyCount }: { truck: TruckWithState; dirtyCount: number }) {
  const navigate = useNavigate();
  const elapsed = useElapsed(truck.state?.unloading_started_at ?? null);
  const startedAt = truck.state?.unloading_started_at;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-hairline bg-surface-3 px-4 py-3 sm:px-7">
      <span className="h-1.5 w-1.5 rounded-full bg-st-dirty animate-pulse" />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">Unloading now</span>
      <span className="font-mono text-xl font-black tabular-nums leading-none text-ink">#{truck.truck_number}</span>
      <span className="text-[11px] text-ink-faint">
        {startedAt != null &&
          `started ${new Date(startedAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · `}
        {dirtyCount} dirty in queue
      </span>
      <span className="ml-auto font-mono text-[15px] font-bold tabular-nums text-st-dirty">{formatDuration(elapsed)}</span>
      <button
        type="button"
        onClick={() => navigate(`/unload?truck=${truck.truck_number}`)}
        className="btn-ghost px-3.5 py-1.5 text-[11px]"
      >
        Open on Unload
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InProgressView — the redesigned live board (replaces InProgressHero)
// ---------------------------------------------------------------------------

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function InProgressView({
  truck,
  paceAvgSeconds,
  runDate,
  nextUp,
  unloaded,
  loadedToday,
  scheduledTotal,
  unloadingTruck,
  dirtyCount,
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  runDate: string;
  nextUp: number | null;
  unloaded: TruckWithState[];
  loadedToday: TruckWithState[];
  scheduledTotal: number;
  unloadingTruck: TruckWithState | null;
  dirtyCount: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const navigate = useNavigate();
  const { data: shorts = [] } = useShortages(runDate, truck.truck_number);

  const dayNum = truck.state?.load_day_num ?? null;
  const dayLabel = dayNum != null && dayNum >= 1 && dayNum <= 7 ? `Day ${dayNum} — ${DAY_NAMES[dayNum]}` : null;

  const elapsed = useElapsed(truck.state?.load_start_time ?? null);
  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? elapsed / paceAvgSeconds : null;
  const onPace = pct == null ? null : pct < 1;
  const timerColor =
    pct == null ? "text-ink" : pct >= 1 ? "text-st-dirty" : pct >= 0.85 ? "text-orange-400" : "text-st-inprogress";
  const paceLabel =
    paceAvgSeconds == null
      ? null
      : onPace
        ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
        : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;
  const paceLabelColor = onPace == null ? "text-ink-muted" : onPace ? "text-st-unloaded" : "text-st-dirty";

  async function finishLoading() {
    setBusy(true);
    try {
      const nowSec = Date.now() / 1000;
      const startSec = truck.state?.load_start_time ?? nowSec;
      const duration = Math.max(1, Math.round(nowSec - startSec));
      await upsert.mutateAsync({
        truck_number: truck.truck_number,
        run_date: runDate,
        status: "loaded",
        wearers: truck.state?.wearers ?? 0,
        load_finish_time: nowSec,
        load_duration_seconds: duration,
      });
      if (duration >= 30 && duration <= 7200) {
        try {
          await recordDuration.mutateAsync({
            truck_number: truck.truck_number,
            run_date: runDate,
            duration_seconds: duration,
            load_day_num: truck.state?.load_day_num ?? null,
          });
        } catch { /* non-fatal */ }
      }
      navigate(`/board?status=loaded`);
    } finally {
      setBusy(false);
    }
  }

  const loadedCount = loadedToday.length;
  const remaining = Math.max(0, scheduledTotal - loadedCount - 1);
  const onPacePct =
    paceAvgSeconds != null && loadedCount > 0
      ? Math.round(
          (loadedToday.filter(
            (t) => t.state?.load_duration_seconds != null && t.state.load_duration_seconds <= paceAvgSeconds,
          ).length /
            loadedCount) *
            100,
        )
      : null;

  return (
    <div className="p-4 sm:p-[22px_26px_40px]">
      <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-hero">
        {unloadingTruck && <UnloadingNowStrip truck={unloadingTruck} dirtyCount={dirtyCount} />}

        {/* Instrument header band: Loading now / elapsed / Next up */}
        <div className="flex flex-col gap-5 border-b border-hairline p-5 sm:px-7 lg:flex-row lg:items-center lg:gap-8">
          <div className="lg:min-w-[220px]">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-st-inprogress animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">Loading now</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[44px] font-black tabular-nums leading-none tracking-[-0.02em] text-ink">
                #{truck.truck_number}
              </span>
              <span className="text-xs text-ink-muted">
                {truckTypeLabel(truck.truck_type)}
                {dayLabel ? ` · ${dayLabel}` : ""}
              </span>
            </div>
          </div>
          <div className="hidden w-px self-stretch bg-hairline lg:block" />
          <div className="flex-1">
            <div className="mb-2 flex items-baseline justify-between">
              <span className={clsx("font-mono text-[44px] font-black tabular-nums leading-none tracking-[-0.02em]", timerColor)}>
                {formatDuration(elapsed)}
              </span>
              {paceLabel && <span className={clsx("text-xs font-medium", paceLabelColor)}>{paceLabel}</span>}
            </div>
            <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={6} />
          </div>
          <div className="hidden w-px self-stretch bg-hairline lg:block" />
          <div className="lg:min-w-[150px] lg:text-right">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">Next up</div>
            <div className="flex items-baseline gap-2.5 lg:justify-end">
              <span className="font-mono text-[28px] font-black tabular-nums leading-none text-ink-soft">
                {nextUp != null ? `#${nextUp}` : "—"}
              </span>
              {nextUp != null && paceAvgSeconds != null && (
                <span className="text-[11px] text-ink-faint">avg {formatDuration(paceAvgSeconds)}</span>
              )}
            </div>
            <button type="button" onClick={() => setPickerOpen(true)} className="btn-ghost mt-2 px-3 py-1 text-[11px]">
              {nextUp != null ? "Change" : "Set Next Up"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left column */}
          <div className="space-y-4 border-hairline p-5 sm:px-7 sm:pb-7 lg:border-r">
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={finishLoading}
                disabled={busy}
                className="flex-1 rounded-[10px] py-4 text-base font-bold text-white transition-opacity disabled:opacity-50"
                style={{ background: "#15803d" }}
              >
                {busy ? "Finishing…" : `Finish Loading #${truck.truck_number}`}
              </button>
              <Link to={`/audit?truck=${truck.truck_number}`} className="btn-ghost flex items-center justify-center px-7 py-4 text-sm">
                Audit
              </Link>
            </div>

            <ShortageCard truck={truck} shorts={shorts} runDate={runDate} />

            {/* Session stats — monochrome strip, hairline-divided */}
            <div className="card flex px-0 py-4">
              {[
                { value: <>{loadedCount}<span className="text-[13px] text-ink-faint">/{scheduledTotal}</span></>, label: "Loaded today" },
                { value: paceAvgSeconds ? formatDuration(paceAvgSeconds) : "—", label: "Avg pace · 30d" },
                { value: remaining, label: "Remaining" },
                { value: onPacePct != null ? `${onPacePct}%` : "—", label: "On pace today" },
              ].map((s, i) => (
                <div key={s.label} className={clsx("flex-1 text-center", i < 3 && "border-r border-hairline")}>
                  <div className="font-mono text-2xl font-black tabular-nums text-ink">{s.value}</div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right rail — notes first, then finishes */}
          <div className="flex flex-col bg-surface-3">
            <div className="border-b border-hairline p-5">
              <LoadNotesPanel truck={truck} loadDay={dayNum ?? 0} runDate={runDate} />
            </div>
            <div className="p-5">
              <RecentFinishes loadedToday={loadedToday} />
            </div>
          </div>
        </div>
      </section>

      {/* Next Up picker modal — unchanged */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPickerOpen(false)}>
          <div
            className="flex w-full max-w-lg flex-col rounded-xl border border-hairline bg-surface shadow-card"
            style={{ maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h3 className="text-base font-bold tracking-wide">Set Next Up</h3>
              <button onClick={() => setPickerOpen(false)} className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <NextUpPanel runDate={runDate} nextUp={nextUp} unloaded={unloaded} anyInProgress={true} onPick={() => setPickerOpen(false)} defaultOpen />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShortageCard — entry-mode toggle: Buttons (existing HierarchyPicker flow)
// ⇄ Dropdowns (compact selects + qty stepper). Per-device preference.
// ---------------------------------------------------------------------------

const SHORT_ENTRY_KEY = "inprogress:shortEntryMode";

function ShortageCard({ truck, shorts, runDate }: { truck: TruckWithState; shorts: import("../types").Shortage[]; runDate: string }) {
  const [mode, setMode] = useState<"buttons" | "dropdowns">(
    () => (localStorage.getItem(SHORT_ENTRY_KEY) === "dropdowns" ? "dropdowns" : "buttons"),
  );
  function pickMode(m: "buttons" | "dropdowns") {
    localStorage.setItem(SHORT_ENTRY_KEY, m);
    setMode(m);
  }
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Log shortages · #{truck.truck_number}
        </span>
        {shorts.length > 0 && <span className="text-[11px] text-ink-faint">{shorts.length} logged today</span>}
        <div className="ml-auto flex gap-0.5 rounded-lg border border-hairline bg-surface-2 p-0.5">
          {(["buttons", "dropdowns"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pickMode(m)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors",
                mode === m ? "bg-surface text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {mode === "buttons" ? (
        <ShortageLogger inline truck={truck} shorts={shorts} runDate={runDate} onBack={() => {}} />
      ) : (
        <ShortageDropdownEntry truck={truck} shorts={shorts} runDate={runDate} />
      )}
    </div>
  );
}

function ShortageDropdownEntry({
  truck,
  shorts,
  runDate,
}: {
  truck: TruckWithState;
  shorts: import("../types").Shortage[];
  runDate: string;
}) {
  const { user } = useAuth();
  const create = useCreateShortage();
  const { data: trackedRaw = [] } = useTrackedItems();
  const items: TrackedItem[] = trackedRaw.length > 0 ? trackedRaw : DEFAULT_TRACKED_ITEMS;

  // A TrackedItem carries `label` and a "Top > Sub" category string — there is
  // no `detail` field. The shortage record's item_detail IS the label, and its
  // item_category is the top-level category, which is exactly the pairing
  // findTrackedItem() resolves against. Deriving it any other way here would
  // write rows the Shorts page can't match back to an item.
  const categories = useMemo(() => [...new Set(items.map(topCatOf))], [items]);
  const [category, setCategory] = useState(() => categories[0] ?? "");
  const details = useMemo(() => items.filter((i) => topCatOf(i) === category), [items, category]);
  const [detail, setDetail] = useState(() => details[0]?.label ?? "");
  const [qty, setQty] = useState(1);

  // Keep detail valid when category changes.
  useEffect(() => {
    if (!details.some((d) => d.label === detail)) setDetail(details[0]?.label ?? "");
  }, [details, detail]);

  const unit = findTrackedItem(items, category, detail)?.unit_label;

  async function add() {
    if (create.isPending || !category) return;
    await create.mutateAsync({
      truck_number: truck.truck_number,
      run_date: runDate,
      item_category: category,
      item_detail: detail,
      quantity: Math.max(1, qty),
      initials: user?.username?.slice(0, 3).toUpperCase() ?? "",
    });
    setQty(1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <select className="input w-[150px] text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input min-w-[150px] flex-1 text-sm" value={detail} onChange={(e) => setDetail(e.target.value)}>
          {details.map((d) => <option key={d.label} value={d.label}>{d.label}{d.unit_label ? ` (${d.unit_label}s)` : ""}</option>)}
        </select>
        <div className="flex items-center overflow-hidden rounded-lg border border-hairline">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-[46px] w-12 bg-surface-2 text-xl text-ink">−</button>
          <span className="w-[52px] text-center font-mono text-[17px] font-bold tabular-nums text-ink">{qty}</span>
          <button type="button" onClick={() => setQty((q) => q + 1)} className="h-[46px] w-12 bg-surface-2 text-xl text-ink">+</button>
        </div>
        <button type="button" onClick={add} disabled={create.isPending} className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
          {create.isPending ? "Adding…" : "Add"}
        </button>
      </div>
      {shorts.length > 0 && (
        <div className="space-y-1.5 border-t border-hairline pt-2.5">
          {[...shorts].reverse().map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 text-xs">
              <span className="font-mono font-semibold text-ink">
                {s.item_detail ? `${s.item_category} ${s.item_detail}` : s.item_category} ×{s.quantity}
              </span>
              <span className="text-ink-faint">
                logged {new Date(Date.parse(s.recorded_at)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
          ))}
          <p className="text-[10px] text-ink-faint">Edit or delete entries in Buttons mode or on the Shorts page.</p>
        </div>
      )}
      {unit ? <p className="text-[10px] text-ink-faint">Quantity is in {unit}s.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Finishes — flat hairline rows (was bg-surface-2 pills)
// ---------------------------------------------------------------------------

function RecentFinishes({ loadedToday }: { loadedToday: TruckWithState[] }) {
  const finishes = useMemo(
    () =>
      [...loadedToday]
        .filter((t) => t.state?.load_finish_time != null)
        .sort((a, b) => (b.state?.load_finish_time ?? 0) - (a.state?.load_finish_time ?? 0))
        .slice(0, 5),
    [loadedToday],
  );

  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Recent Finishes</h4>
      {finishes.length === 0 ? (
        <p className="text-xs text-ink-faint">No finishes yet.</p>
      ) : (
        <div>
          {finishes.map((t, i) => {
            const finish = t.state?.load_finish_time;
            const start = t.state?.load_start_time;
            const duration = finish && start ? Math.round(finish - start) : null;
            const isSlow = duration != null && duration >= 900;
            return (
              <div key={t.truck_number} className={clsx("flex items-center gap-2.5 py-[7px] text-xs", i < finishes.length - 1 && "border-b border-hairline")}>
                <span className="w-11 font-mono font-bold tabular-nums text-ink">#{t.truck_number}</span>
                {finish && (
                  <span className="text-ink-faint">
                    {new Date(finish * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                )}
                {duration != null && (
                  <span className={clsx("ml-auto font-mono font-medium tabular-nums", isSlow ? "text-st-dirty" : "text-st-unloaded")}>
                    {formatDuration(duration)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Everything below is UNCHANGED from the current LiveInProgress.tsx —
// preserved because Load.tsx and others import these.
// ===========================================================================

export function StartNextUpBanner({
  truck,
  paceAvgSeconds,
  busy,
  onStart,
  blockedReason,
}: {
  truck: TruckWithState;
  paceAvgSeconds?: number | null;
  busy?: boolean;
  onStart: () => void;
  blockedReason?: string | null;
}) {
  const coverageRoute = getCoverageRouteNumber(truck);
  return (
    <section
      className="overflow-hidden rounded-xl border-2"
      style={{ borderColor: "rgba(125,211,252,0.45)", background: "rgba(125,211,252,0.07)" }}
    >
      <div className="h-[3px] w-full" style={{ background: "#7dd3fc" }} />
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Next up</div>
          <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 sm:justify-start">
            <span className="font-mono text-[46px] font-black leading-none tabular-nums tracking-[-0.02em]" style={{ color: "#7dd3fc" }}>
              #{truck.truck_number}
            </span>
            <span className="text-sm text-ink-muted">
              {truckTypeLabel(truck.truck_type)}
              {truck.state?.wearers ? ` · ${truck.state.wearers} wearers` : ""}
              {paceAvgSeconds != null ? ` · avg ${formatDuration(paceAvgSeconds)}` : ""}
            </span>
          </div>
          {coverageRoute != null && <CoverageTag route={coverageRoute} truck={truck.truck_number} className="mt-1.5" />}
          {blockedReason && <p className="mt-1.5 text-xs text-st-inprogress">{blockedReason}</p>}
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={busy || Boolean(blockedReason)}
          className="w-full rounded-lg px-5 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-50 sm:w-auto"
          style={{ background: "#16a34a" }}
        >
          {busy ? "Starting…" : `Start Loading #${truck.truck_number}`}
        </button>
      </div>
    </section>
  );
}

export function PaceBar({
  elapsed,
  paceAvgSeconds,
  height = 12,
}: {
  elapsed: number;
  paceAvgSeconds: number | null;
  height?: number;
}) {
  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? Math.min(1, elapsed / paceAvgSeconds) : 0;
  const barColor =
    paceAvgSeconds == null ? "#475569" : pct >= 1 ? "#ef4444" : pct >= 0.85 ? "#f97316" : "#f59e0b";
  return (
    <div className="relative w-full overflow-hidden rounded-full" style={{ height, background: "#1c2434" }}>
      {paceAvgSeconds != null && (
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(2, pct * 100)}%`,
            backgroundColor: barColor,
            transition: "width 0.7s ease-out, background-color 0.4s ease",
          }}
        />
      )}
    </div>
  );
}

export function useElapsed(startSec: number | null): number {
  const [elapsed, setElapsed] = useState(() =>
    startSec ? Math.max(0, Math.round(Date.now() / 1000 - startSec)) : 0,
  );
  useEffect(() => {
    if (!startSec) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.max(0, Math.round(Date.now() / 1000 - startSec)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startSec]);
  return elapsed;
}

export function ElapsedTimer({
  startSec,
  paceAvgSeconds,
  size = 200,
}: {
  startSec: number | null;
  paceAvgSeconds: number | null;
  size?: number;
}) {
  const elapsed = useElapsed(startSec);
  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? elapsed / paceAvgSeconds : null;
  const onPace = pct == null ? null : pct < 1;
  const timerColor =
    pct == null ? "text-ink" : pct >= 1 ? "text-st-dirty" : pct >= 0.85 ? "text-orange-400" : "text-st-inprogress";
  const paceLabel =
    paceAvgSeconds == null
      ? null
      : onPace
        ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
        : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;
  const paceLabelColor = onPace == null ? "text-ink-muted" : onPace ? "text-st-unloaded" : "text-st-dirty";
  const w = size;
  return (
    <div className="flex w-full flex-col gap-2" style={{ maxWidth: w }}>
      <div className="flex items-baseline justify-between">
        <span
          className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", timerColor)}
          style={{ fontSize: Math.round(size * 0.22) }}
        >
          {startSec ? formatDuration(elapsed) : "—"}
        </span>
        {paceLabel && <span className={clsx("text-right text-xs font-medium", paceLabelColor)}>{paceLabel}</span>}
      </div>
      <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={Math.round(size * 0.055)} />
    </div>
  );
}

function QueueRow({
  truck,
  index,
  isNext,
  onSelect,
}: {
  truck: TruckWithState;
  index: number;
  isNext: boolean;
  onSelect: () => void;
}) {
  const coverRoute = getCoverageRouteNumber(truck);
  const spareNeedsRoute = truck.truck_type === "Spare" && coverRoute == null;
  const parts: string[] = [truckTypeLabel(truck.truck_type)];
  if (truck.state?.batch_id != null) parts.push(`Batch ${truck.state.batch_id}`);
  const meta = parts.join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
        isNext ? "border border-sky-700/40 bg-sky-950/50" : "border border-transparent bg-surface-2 hover:bg-surface",
      )}
    >
      <span className="w-4 shrink-0 text-center text-[11px] font-bold tabular-nums text-ink-faint">{index + 1}</span>
      <span className="font-mono tabular-nums text-sm font-bold text-ink">#{truck.truck_number}</span>
      {coverRoute != null && <CoverageTag route={coverRoute} truck={truck.truck_number} className="shrink-0" />}
      <span className="flex-1 truncate text-[11px] text-ink-muted">{meta}</span>
      {spareNeedsRoute && (
        <span className="shrink-0 rounded-pill bg-amber-900/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
          Needs route
        </span>
      )}
      {isNext && (
        <span className="shrink-0 rounded-pill bg-sky-900/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">
          NEXT
        </span>
      )}
    </button>
  );
}

const SHOW_SPARES_KEY = "nextup:showSpares";

export function NextUpPanel({
  runDate,
  nextUp,
  unloaded,
  anyInProgress: _anyInProgress,
  onPick,
  defaultOpen = false,
}: {
  runDate: string;
  nextUp: number | null;
  unloaded: TruckWithState[];
  anyInProgress: boolean;
  onPick?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showSpares, setShowSpares] = useState(() => localStorage.getItem(SHOW_SPARES_KEY) === "1");
  function toggleSpares() {
    setShowSpares((v) => {
      localStorage.setItem(SHOW_SPARES_KEY, v ? "0" : "1");
      return !v;
    });
  }
  const setNext = useSetNextUp(runDate);
  const clearNext = useClearNextUp(runDate);
  const assignSpare = useAssignSpare();
  const { data: board = [] } = useBoard(runDate);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { data: spareAssignments = [] } = useSpareAssignments(runDate);
  const { loadDay } = workdayNumbers();

  const [assignFor, setAssignFor] = useState<TruckWithState | null>(null);

  const options = useMemo(() => [...unloaded].sort((a, b) => a.truck_number - b.truck_number), [unloaded]);

  const coveredRoutes = useMemo(
    () =>
      new Set<number>([
        ...spareAssignments.filter((a) => !a.returned).map((a) => a.covering_route_truck),
        ...board.filter((t) => t.route_swap_route != null).map((t) => t.route_swap_route as number),
      ]),
    [spareAssignments, board],
  );
  const routeTrucks = useMemo(
    () =>
      board
        .filter((t) => t.truck_type !== "Spare" && (holidayLoad || !isScheduledOff(t, loadDay)))
        .sort((a, b) => a.truck_number - b.truck_number),
    [board, holidayLoad, loadDay],
  );
  const oosUncovered = routeTrucks.filter(
    (t) => effectiveStatus(t, loadDay, holidayLoad) === "oos" && !coveredRoutes.has(t.truck_number),
  );
  const otherRoutes = routeTrucks.filter(
    (t) => !(effectiveStatus(t, loadDay, holidayLoad) === "oos" && !coveredRoutes.has(t.truck_number)),
  );

  function needsRoute(t: TruckWithState) {
    return t.truck_type === "Spare" && getCoverageRouteNumber(t) == null;
  }

  async function assignAndQueue(spareNum: number, routeNum: number) {
    try {
      await assignSpare.mutateAsync({ run_date: runDate, spare_truck_number: spareNum, covering_route_truck: routeNum });
      setNext.mutate(spareNum);
      setAssignFor(null);
      onPick?.();
    } catch (err) {
      console.error("assign spare route failed", err);
    }
  }

  const nextStillAvailable = nextUp != null && options.some((t) => t.truck_number === nextUp);
  const spareCount = options.filter((t) => t.truck_type === "Spare").length;
  const visibleOptions = useMemo(
    () =>
      showSpares ? options : options.filter((t) => t.truck_type !== "Spare" || t.truck_number === nextUp),
    [options, showSpares, nextUp],
  );

  return (
    <div className="card space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Next-Up Queue</h4>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint">
          {nextUp != null ? <span className="font-mono font-bold text-sky-300">#{nextUp}</span> : `${options.length} ready`}
          <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {nextUp != null && !nextStillAvailable && (
        <p className="rounded-md border border-st-dirty/30 bg-st-dirty/10 px-3 py-2 text-xs text-st-dirty">
          Truck #{nextUp} is no longer Unloaded — pick another.
        </p>
      )}

      {assignFor && (
        <div className="space-y-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
          <p className="text-xs text-amber-200">
            Spare <span className="font-black text-amber-100">#{assignFor.truck_number}</span> has no route. Pick the route it should load on:
          </p>
          <select
            className="input w-full text-sm"
            defaultValue=""
            onChange={(e) => { if (e.target.value) assignAndQueue(assignFor.truck_number, parseInt(e.target.value)); }}
          >
            <option value="">— select route —</option>
            {oosUncovered.length > 0 && (
              <optgroup label="OOS — needs covering">
                {oosUncovered.map((t) => (
                  <option key={t.truck_number} value={t.truck_number}>#{t.truck_number} — OOS</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Route trucks">
              {otherRoutes.map((t) => (
                <option key={t.truck_number} value={t.truck_number}>
                  #{t.truck_number}{coveredRoutes.has(t.truck_number) ? " ✓ covered" : ""}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" className="btn-ghost w-full text-xs" onClick={() => setAssignFor(null)}>
            Cancel
          </button>
        </div>
      )}

      {open && (
        <>
          {spareCount > 0 && (
            <button
              type="button"
              onClick={toggleSpares}
              className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              {showSpares ? `Hide spares (${spareCount})` : `Show spares (${spareCount})`}
            </button>
          )}

          {options.length === 0 ? (
            <p className="text-center text-xs text-ink-faint">No Unloaded trucks available.</p>
          ) : visibleOptions.length === 0 ? (
            <p className="text-center text-xs text-ink-faint">Only spares are ready — use "Show spares" above.</p>
          ) : (
            <div className="space-y-1">
              {visibleOptions.map((truck, i) => (
                <QueueRow
                  key={truck.truck_number}
                  truck={truck}
                  index={i}
                  isNext={truck.truck_number === nextUp}
                  onSelect={() =>
                    needsRoute(truck) ? setAssignFor(truck) : (setNext.mutate(truck.truck_number), onPick?.())
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {nextUp != null && (
        <button
          type="button"
          className="btn-ghost w-full text-xs"
          disabled={clearNext.isPending}
          onClick={() => { clearNext.mutate(); onPick?.(); }}
        >
          Clear Next Up
        </button>
      )}
    </div>
  );
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}
