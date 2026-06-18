import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  useBoard,
  useClearNextUp,
  useNextUp,
  usePaceAverage,
  useRecordLoadDuration,
  useSetNextUp,
  useShortages,
  useTruckNotes,
  useUpsertTruckState,
  useHolidayLoad,
} from "../api/hooks";
import { ShortageLogger } from "../pages/Shorts";
import { todayIso } from "../api/client";
import { buildOperationalDayContext } from "../utils/truckStatus";
import type { TruckNote, TruckWithState } from "../types";

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

  const loadDay = inProgress?.state?.load_day_num ?? null;
  const scheduledTotal = useMemo(
    () =>
      loadDay != null
        ? buildOperationalDayContext(board ?? [], loadDay, holidayLoad, false).activeTrucks.length
        : 0,
    [board, loadDay, holidayLoad],
  );

  if (!inProgress) {
    return (
      <div className="p-4 sm:p-[22px_26px_40px]">
        <div className="card flex flex-col items-center justify-center py-10 text-center">
          <p className="text-lg font-semibold text-st-loaded">No truck currently in progress.</p>
          <p className="mt-1 text-sm text-ink-muted">Set a next-up truck and start it to begin loading.</p>
        </div>
      </div>
    );
  }

  const dayNum = inProgress.state?.load_day_num ?? null;

  return (
    <div className="p-4 sm:p-[22px_26px_40px]">
      {/* Eyebrow header — hidden on mobile (shown in PageHeader instead) */}
      <div className="mb-[18px] hidden md:block">
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-st-inprogress/30 bg-st-inprogress/10 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-st-inprogress">
          <span className="h-1.5 w-1.5 rounded-full bg-st-inprogress animate-pulse" />
          Live
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Left column */}
        <div className="space-y-4">
          <InProgressHero
            truck={inProgress}
            paceAvgSeconds={pace?.avg_seconds ?? null}
            runDate={runDate}
            nextUp={nextUp ?? null}
            unloaded={unloaded}
            loadedToday={loadedToday}
          />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <SessionStats inProgress={inProgress} unloaded={unloaded} loadedToday={loadedToday} paceAvgSeconds={pace?.avg_seconds ?? null} scheduledTotal={scheduledTotal} />
          <RecentFinishes loadedToday={loadedToday} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaceBar — exported for Load.tsx
// ---------------------------------------------------------------------------

export function PaceBar({
  elapsed,
  paceAvgSeconds,
  height = 12,
}: {
  elapsed: number;
  paceAvgSeconds: number | null;
  height?: number;
}) {
  const pct = paceAvgSeconds && paceAvgSeconds > 0
    ? Math.min(1, elapsed / paceAvgSeconds)
    : 0;

  const barColor =
    paceAvgSeconds == null ? "#475569"
    : pct >= 1             ? "#ef4444"
    : pct >= 0.85          ? "#f97316"
    :                        "#f59e0b";

  return (
    <div
      className="relative w-full overflow-hidden rounded-full"
      style={{ height, background: "#1c2434" }}
    >
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

// ---------------------------------------------------------------------------
// Elapsed hook — shared ticker
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ElapsedTimer — kept for Load.tsx (now wraps PaceBar)
// ---------------------------------------------------------------------------

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
    pct == null   ? "text-ink"
    : pct >= 1    ? "text-st-dirty"
    : pct >= 0.85 ? "text-orange-400"
    :               "text-st-inprogress";

  const paceLabel =
    paceAvgSeconds == null ? null
    : onPace
      ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
      : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;

  const paceLabelColor =
    onPace == null ? "text-ink-muted"
    : onPace       ? "text-st-unloaded"
    :                "text-st-dirty";

  const w = size;
  const h = Math.round(size * 0.55);

  return (
    <div className="flex w-full flex-col gap-2" style={{ maxWidth: w }}>
      <div className="flex items-baseline justify-between">
        <span className={clsx("font-mono font-black tabular-nums tracking-[-0.02em] leading-none", timerColor)}
          style={{ fontSize: Math.round(size * 0.22) }}>
          {startSec ? formatDuration(elapsed) : "—"}
        </span>
        {paceLabel && (
          <span className={clsx("text-right text-xs font-medium", paceLabelColor)}>
            {paceLabel}
          </span>
        )}
      </div>
      <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={Math.round(size * 0.055)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Truck note cards
// ---------------------------------------------------------------------------

const NOTE_CARD: Record<TruckNote["note_type"], { border: string; bg: string; chip: string; label: string }> = {
  constant: { border: "border-st-loaded/30", bg: "bg-st-loaded/10", chip: "bg-st-loaded/25 text-st-loaded", label: "Constant" },
  workday:  { border: "border-st-shop/30", bg: "bg-st-shop/10", chip: "bg-st-shop/25 text-st-shop", label: "Workday" },
  one_off:  { border: "border-st-inprogress/30", bg: "bg-st-inprogress/10", chip: "bg-st-inprogress/25 text-st-inprogress", label: "One-off" },
};

function TruckNotesPanel({ truckNumber, loadDayNum }: { truckNumber: number; loadDayNum: number | null }) {
  const { data: notes = [] } = useTruckNotes({ truckNumber, activeOnly: true });
  const applicable = notes.filter((n) => {
    if (n.note_type === "constant") return true;
    if (n.note_type === "workday") return n.workday_num === loadDayNum;
    if (n.note_type === "one_off") return n.expires_on == null || n.expires_on >= todayIso();
    return false;
  });
  if (applicable.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {applicable.map((n) => {
        const s = NOTE_CARD[n.note_type];
        return (
          <div key={n.id} className={clsx("rounded-xl border px-4 py-3", s.border, s.bg)}>
            <div className="flex items-start gap-3">
              <span className={clsx("mt-0.5 shrink-0 rounded-pill px-1.5 py-0.5 text-[10px] font-semibold", s.chip)}>{n.note_type === "workday" ? `Day ${n.workday_num}` : s.label}</span>
              <span className="text-sm leading-snug text-ink">{n.body}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session stats
// ---------------------------------------------------------------------------

function SessionStats({
  inProgress: _inProgress,
  unloaded,
  loadedToday,
  paceAvgSeconds,
  scheduledTotal,
}: {
  inProgress: TruckWithState;
  unloaded: TruckWithState[];
  loadedToday: TruckWithState[];
  paceAvgSeconds: number | null;
  scheduledTotal: number;
}) {
  const loadedCount = loadedToday.length;
  const remaining = Math.max(0, scheduledTotal - loadedCount - 1);

  const onPacePct = paceAvgSeconds != null && loadedCount > 0
    ? Math.round(
        loadedToday.filter(
          (t) => t.state?.load_duration_seconds != null && t.state.load_duration_seconds <= paceAvgSeconds,
        ).length / loadedCount * 100,
      )
    : null;

  const stats = [
    { label: "Loaded Today", value: loadedCount, sub: `of ${scheduledTotal} scheduled`, color: "#3b82f6" },
    { label: "Avg Pace",     value: paceAvgSeconds ? formatDuration(paceAvgSeconds) : "—", sub: "30-day average", color: "#22c55e" },
    { label: "Remaining",    value: remaining, sub: "still to load", color: "#f59e0b" },
    { label: "On Pace",      value: onPacePct != null ? `${onPacePct}%` : "—", sub: "finishes today", color: "#06b6d4" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border px-4 py-3 shadow-inset-top"
          style={{
            background: `rgba(${parseInt(s.color.slice(1,3),16)},${parseInt(s.color.slice(3,5),16)},${parseInt(s.color.slice(5,7),16)},0.10)`,
            borderColor: `${s.color}40`,
          }}
        >
          <p className="text-[26px] font-mono font-black tabular-nums tracking-[-0.02em] leading-none" style={{ color: s.color }}>{s.value}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: s.color, opacity: 0.7 }}>{s.label}</p>
          <p className="mt-0.5 text-[10px] text-ink-faint">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Finishes
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
    <div className="card space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Recent Finishes</h4>
      {finishes.length === 0 ? (
        <p className="text-xs text-ink-faint">No finishes yet.</p>
      ) : (
        <div className="space-y-2">
          {finishes.map((t) => {
            const finish = t.state?.load_finish_time;
            const start = t.state?.load_start_time;
            const duration = finish && start ? Math.round(finish - start) : null;
            const isSlow = duration != null && duration >= 900;
            return (
              <div key={t.truck_number} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
                <span className="font-mono font-bold tabular-nums text-sm text-ink">#{t.truck_number}</span>
                <div className="flex items-center gap-3 text-xs">
                  {finish && (
                    <span className="text-ink-muted">
                      {new Date(finish * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                  {duration != null && (
                    <span className={clsx("font-mono tabular-nums font-medium", isSlow ? "text-st-dirty" : "text-st-unloaded")}>
                      {formatDuration(duration)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InProgressHero — main left-column card
// ---------------------------------------------------------------------------

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function InProgressHero({
  truck,
  paceAvgSeconds,
  runDate,
  nextUp,
  unloaded,
  loadedToday,
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  runDate: string;
  nextUp: number | null;
  unloaded: TruckWithState[];
  loadedToday: TruckWithState[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const navigate = useNavigate();
  const { data: shorts = [] } = useShortages(runDate, truck.truck_number);

  const dayNum = truck.state?.load_day_num ?? null;
  const dayLabel = dayNum != null && dayNum >= 1 && dayNum <= 7
    ? `Day ${dayNum} · ${DAY_NAMES[dayNum]}`
    : null;

  const elapsed = useElapsed(truck.state?.load_start_time ?? null);
  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? elapsed / paceAvgSeconds : null;
  const onPace = pct == null ? null : pct < 1;

  const timerColor =
    pct == null   ? "text-ink"
    : pct >= 1    ? "#fb7185"
    : pct >= 0.85 ? "#fb923c"
    :               "#fbbf5c";

  const paceLabelColor =
    onPace == null ? "text-ink-muted"
    : onPace       ? "text-st-unloaded"
    :                "text-st-dirty";

  const paceLabel =
    paceAvgSeconds == null ? null
    : onPace
      ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
      : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;

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

  return (
    <section
      className="overflow-hidden rounded-xl border shadow-hero"
      style={{ borderColor: "rgba(245,158,11,0.45)", background: "#161d2b" }}
    >
      {/* Amber pulse strip */}
      <div className="h-[3px] w-full animate-pulse" style={{ background: "#f59e0b" }} />

      <div className="p-4 space-y-4">
        {/* Current Truck / Next Up row */}
        <div className="flex items-start gap-4">
          <div className="flex-1 text-center">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Current Truck</p>
            <p className="font-mono font-black tabular-nums tracking-[-0.02em] text-[46px] sm:text-[58px] leading-none" style={{ color: "#fbbf5c" }}>
              #{truck.truck_number}
            </p>
            {dayLabel && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-st-unloaded/50 bg-st-unloaded/10 px-2.5 py-0.5 text-xs font-semibold text-st-unloaded">
                <span className="h-1.5 w-1.5 rounded-full bg-st-unloaded" />
                {dayLabel}
              </span>
            )}
          </div>

          <div className="w-px self-stretch bg-hairline" />

          <div className="flex-1 text-center">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Next Up</p>
            {nextUp != null ? (
              <>
                <p className="font-mono font-black tabular-nums tracking-[-0.02em] text-[46px] sm:text-[58px] leading-none" style={{ color: "#7dd3fc" }}>
                  #{nextUp}
                </p>
                {paceAvgSeconds != null && (
                  <div className="mt-1.5 text-xs text-ink-muted">
                    avg <span className="text-ink font-mono tabular-nums">{formatDuration(paceAvgSeconds)}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="mt-2 rounded-lg border border-sky-700/40 bg-sky-950/50 px-3 py-1 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-900/50"
                >
                  Change
                </button>
              </>
            ) : (
              <>
                <p className="font-mono font-black tabular-nums tracking-[-0.02em] text-[46px] sm:text-[58px] leading-none text-ink-faint">—</p>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="mt-2 rounded-lg border border-hairline bg-surface-2 px-3 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface"
                >
                  Set Next Up
                </button>
              </>
            )}
          </div>
        </div>

        {/* Timer */}
        <div className="flex flex-col items-center gap-2 py-1">
          <span
            className="font-mono font-black tabular-nums tracking-[-0.02em] leading-none text-[44px] sm:text-[56px]"
            style={{ color: timerColor }}
          >
            {formatDuration(elapsed)}
          </span>
          {paceLabel && (
            <span className={clsx("text-sm font-medium", paceLabelColor)}>
              {paceLabel}
            </span>
          )}
        </div>

        {/* Full-width pace bar */}
        <PaceBar elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} height={14} />

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={finishLoading}
            disabled={busy}
            className="flex-1 rounded-xl py-4 text-lg font-bold text-white shadow transition-colors disabled:opacity-50"
            style={{ background: "#16a34a" }}
          >
            {busy ? "Finishing…" : "Finish Loading"}
          </button>
          <Link
            to={`/audit?truck=${truck.truck_number}`}
            className="flex items-center justify-center rounded-xl border px-6 py-4 text-sm font-semibold transition-colors"
            style={{ borderColor: "rgba(255,255,255,0.06)", color: "#cdd6e2" }}
          >
            Audit
          </Link>
        </div>

        {/* Truck Notes */}
        <TruckNotesPanel truckNumber={truck.truck_number} loadDayNum={dayNum} />

        {/* Log Shortages */}
        <div className="border-t border-hairline pt-4">
          <ShortageLogger
            inline
            truck={truck}
            shorts={shorts}
            runDate={runDate}
            onBack={() => {}}
          />
        </div>
      </div>

      {/* Next Up picker modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex w-full max-w-lg flex-col rounded-xl border border-hairline bg-surface shadow-card"
            style={{ maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h3 className="text-base font-bold tracking-wide">Set Next Up</h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <NextUpPanel
                runDate={runDate}
                nextUp={nextUp}
                unloaded={unloaded}
                anyInProgress={true}
                onPick={() => setPickerOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Next Up panel
// ---------------------------------------------------------------------------

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
  const coverRoute = truck.state?.oos_spare_route ?? truck.route_swap_route ?? null;
  const parts: string[] = [truck.truck_type];
  if (truck.state?.batch_id != null) parts.push(`Batch ${truck.state.batch_id}`);
  if (coverRoute != null) parts.push(`Cov. #${coverRoute}`);
  const meta = parts.join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
        isNext
          ? "border border-sky-700/40 bg-sky-950/50"
          : "border border-transparent bg-surface-2 hover:bg-surface",
      )}
    >
      <span className="w-4 shrink-0 text-center text-[11px] font-bold tabular-nums text-ink-faint">{index + 1}</span>
      <span className="font-mono tabular-nums text-sm font-bold text-ink">#{truck.truck_number}</span>
      <span className="flex-1 truncate text-[11px] text-ink-muted">{meta}</span>
      {isNext && (
        <span className="shrink-0 rounded-pill bg-sky-900/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">
          NEXT
        </span>
      )}
    </button>
  );
}

function NextUpPanel({
  runDate,
  nextUp,
  unloaded,
  anyInProgress: _anyInProgress,
  onPick,
}: {
  runDate: string;
  nextUp: number | null;
  unloaded: TruckWithState[];
  anyInProgress: boolean;
  onPick?: () => void;
}) {
  const setNext = useSetNextUp(runDate);
  const clearNext = useClearNextUp(runDate);

  const options = useMemo(
    () => [...unloaded].sort((a, b) => a.truck_number - b.truck_number),
    [unloaded],
  );

  const nextStillAvailable = nextUp != null && options.some((t) => t.truck_number === nextUp);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Next-Up Queue</h4>
        {options.length > 0 && (
          <span className="text-[11px] text-ink-faint">{options.length} ready</span>
        )}
      </div>

      {nextUp != null && !nextStillAvailable && (
        <p className="rounded-md border border-st-dirty/30 bg-st-dirty/10 px-3 py-2 text-xs text-st-dirty">
          Truck #{nextUp} is no longer Unloaded — pick another.
        </p>
      )}

      {options.length === 0 ? (
        <p className="text-center text-xs text-ink-faint">No Unloaded trucks available.</p>
      ) : (
        <div className="space-y-1">
          {options.map((truck, i) => (
            <QueueRow
              key={truck.truck_number}
              truck={truck}
              index={i}
              isNext={truck.truck_number === nextUp}
              onSelect={() => { setNext.mutate(truck.truck_number); onPick?.(); }}
            />
          ))}
        </div>
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
