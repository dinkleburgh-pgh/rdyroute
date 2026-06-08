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
} from "../api/hooks";
import { ShortageLogger } from "../pages/Shorts";
import { todayIso } from "../api/client";
import type { TruckNote, TruckWithState } from "../types";

/**
 * Live "In Progress" page (V1 parity):
 *
 *   CURRENT TRUCK #N        ELAPSED TIME 00:46
 *   LOAD DAY · Day 2 (Tue)
 *   [ Set Next Up ]
 *   [ Audit Next Up ]
 *
 *   Select Shortages
 *   [3x10] [3x5] [4x6]
 *   [Paper] [Bulk] [Recents]
 *
 *   [        Audit         ]
 *   [    FINISH LOADING    ]
 *
 * Rendered on /board?status=in_progress. Pulls the single in-progress truck
 * from the board and drives the load-completion flow.
 */
export function LiveInProgress({ runDate }: { runDate: string }) {
  const { data: board } = useBoard(runDate);
  const { data: nextUp } = useNextUp(runDate);
  const { data: pace } = usePaceAverage(30);

  const inProgress = useMemo(
    () => (board ?? []).find((t) => t.state?.status === "in_progress") ?? null,
    [board],
  );
  const unloaded = useMemo(
    () => (board ?? []).filter((t) => t.state?.status === "unloaded"),
    [board],
  );

  if (!inProgress) {
    return (
      <div className="space-y-4">
        <div className="card flex flex-col items-center justify-center py-10 text-center">
          <p className="text-lg font-semibold text-blue-300">
            No truck currently in progress.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Set a next-up truck and start it to begin loading.
          </p>
        </div>
        <NextUpPanel
          runDate={runDate}
          nextUp={nextUp ?? null}
          unloaded={unloaded}
          anyInProgress={false}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CurrentLoadPanel
        truck={inProgress}
        paceAvgSeconds={pace?.avg_seconds ?? null}
        runDate={runDate}
        nextUp={nextUp ?? null}
        unloaded={unloaded}
      />
      <ShortagesPanel truck={inProgress} runDate={runDate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaceArc — SVG radial progress ring around the timer
// ---------------------------------------------------------------------------

function PaceArc({
  elapsed,
  paceAvgSeconds,
  size = 200,
  strokeWidth = 8,
}: {
  elapsed: number;
  paceAvgSeconds: number | null;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;

  const pct = paceAvgSeconds && paceAvgSeconds > 0
    ? Math.min(1, elapsed / paceAvgSeconds)
    : 0;

  const offset = circumference * (1 - pct);

  // Color zones
  const arcColor =
    paceAvgSeconds == null ? "#334155"        // no pace data — slate-700
    : pct >= 1             ? "#ef4444"        // over pace — red
    : pct >= 0.85          ? "#f97316"        // warning zone — orange
    :                        "#f59e0b";       // on pace — amber

  // Track (background ring) color
  const trackColor = "#1e293b"; // slate-800

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
      aria-hidden="true"
    >
      {/* Track */}
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      {paceAvgSeconds != null && (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.4s ease" }}
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ElapsedTimer — the arc + number + pace label, self-contained
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

  const pct = paceAvgSeconds && paceAvgSeconds > 0 ? elapsed / paceAvgSeconds : null;
  const onPace = pct == null ? null : pct < 1;

  const timerColor =
    pct == null    ? "text-slate-200"
    : pct >= 1     ? "text-red-400"
    : pct >= 0.85  ? "text-orange-400"
    :                "text-amber-300";

  const paceLabel =
    paceAvgSeconds == null ? null
    : onPace
      ? `on pace · avg ${formatDuration(paceAvgSeconds)}`
      : `+${formatDuration(elapsed - paceAvgSeconds)} over · avg ${formatDuration(paceAvgSeconds)}`;

  const paceLabelColor =
    onPace == null  ? "text-slate-500"
    : onPace        ? "text-emerald-400"
    :                 "text-red-400";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Arc ring */}
      <PaceArc elapsed={elapsed} paceAvgSeconds={paceAvgSeconds} size={size} strokeWidth={Math.round(size * 0.045)} />

      {/* Content layered over arc */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        {startSec ? (
          <>
            <span className={clsx("font-mono font-bold tabular-nums leading-none", timerColor)}
              style={{ fontSize: size * 0.22 }}>
              {formatDuration(elapsed)}
            </span>
            {paceLabel && (
              <span className={clsx("text-center font-medium leading-none", paceLabelColor)}
                style={{ fontSize: size * 0.07 }}>
                {paceLabel}
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-slate-500">No start time</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Truck note cards — one card per applicable note
// ---------------------------------------------------------------------------

const NOTE_CARD: Record<TruckNote["note_type"], { border: string; bg: string; chip: string; label: string }> = {
  constant: {
    border: "border-blue-700/40",
    bg:     "bg-blue-950/30",
    chip:   "bg-blue-900/60 text-blue-300 border border-blue-700/40",
    label:  "Constant",
  },
  workday: {
    border: "border-violet-700/40",
    bg:     "bg-violet-950/30",
    chip:   "bg-violet-900/60 text-violet-300 border border-violet-700/40",
    label:  "Workday",
  },
  one_off: {
    border: "border-amber-700/40",
    bg:     "bg-amber-950/30",
    chip:   "bg-amber-900/60 text-amber-300 border border-amber-700/40",
    label:  "One-off",
  },
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
    <div className="mt-4 flex flex-col gap-2">
      {applicable.map((n) => {
        const s = NOTE_CARD[n.note_type];
        return (
          <div key={n.id} className={clsx("rounded-xl border px-4 py-3", s.border, s.bg)}>
            <div className="flex items-start gap-3">
              <span className={clsx("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", s.chip)}>
                {s.label}
              </span>
              <span className="text-sm leading-snug text-slate-200">{n.body}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top panel: current truck identity + Next Up shortcuts + elapsed timer
// ---------------------------------------------------------------------------

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function CurrentLoadPanel({
  truck,
  paceAvgSeconds,
  runDate,
  nextUp,
  unloaded,
}: {
  truck: TruckWithState;
  paceAvgSeconds: number | null;
  runDate: string;
  nextUp: number | null;
  unloaded: TruckWithState[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const dayNum = truck.state?.load_day_num ?? null;
  const dayLabel =
    dayNum != null && dayNum >= 1 && dayNum <= 7
      ? `Day ${dayNum} · ${DAY_NAMES[dayNum]}`
      : null;

  return (
    <section className="card overflow-hidden">
      {/* Amber pulse bar at top */}
      <div className="mb-4 h-0.5 w-full animate-pulse rounded-full bg-amber-500/60" />

      {/* Main content: centered column */}
      <div className="flex flex-col items-center gap-4">

        {/* Truck number + day label */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Current Truck
          </p>
          <p className="font-black leading-none text-amber-300" style={{ fontSize: "4.5rem" }}>
            #{truck.truck_number}
          </p>
          {dayLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/50 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {dayLabel}
            </span>
          )}
        </div>

        {/* Arc timer — the dominant element */}
        <ElapsedTimer
          startSec={truck.state?.load_start_time ?? null}
          paceAvgSeconds={paceAvgSeconds}
          size={220}
        />

        {/* Next Up controls */}
        <div className="flex w-full max-w-xs flex-col gap-2">
          <button
            className={clsx(
              "w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors",
              nextUp != null
                ? "border-sky-700/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/40"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700",
            )}
            onClick={() => setPickerOpen((o) => !o)}
          >
            {nextUp != null ? `Next Up: #${nextUp}` : "Set Next Up"}
          </button>
          <Link
            to={nextUp != null ? `/audit?truck=${nextUp}` : "/audit"}
            className={clsx(
              "block rounded-lg border px-4 py-2.5 text-center text-sm font-semibold transition-colors",
              nextUp != null
                ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                : "pointer-events-none border-slate-800 bg-slate-900/40 text-slate-600",
            )}
            aria-disabled={nextUp == null}
          >
            Audit Next Up
          </Link>
        </div>
      </div>

      {/* Truck notes */}
      <TruckNotesPanel truckNumber={truck.truck_number} loadDayNum={dayNum} />

      {/* Next Up picker — expanded inline */}
      {pickerOpen && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <NextUpPanel
            runDate={runDate}
            nextUp={nextUp}
            unloaded={unloaded}
            anyInProgress={true}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shortages quick-add + Audit / Finish Loading actions
// ---------------------------------------------------------------------------

function ShortagesPanel({
  truck,
  runDate,
}: {
  truck: TruckWithState;
  runDate: string;
}) {
  const { data: shorts = [] } = useShortages(runDate, truck.truck_number);
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

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
        } catch {
          /* non-fatal */
        }
      }
      navigate(`/board?status=loaded`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <ShortageLogger
        inline
        truck={truck}
        shorts={shorts}
        runDate={runDate}
        onBack={() => {}}
      />

      <Link
        to={`/audit?truck=${truck.truck_number}`}
        className="block rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-center text-sm font-semibold transition-colors hover:bg-slate-700"
      >
        Audit
      </Link>

      <button
        type="button"
        onClick={finishLoading}
        disabled={busy}
        className="w-full rounded-xl border-2 border-emerald-500/60 bg-emerald-950/40 px-4 py-4 text-lg font-bold uppercase tracking-wider text-emerald-300 shadow-inner transition-colors hover:bg-emerald-900/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Finishing…" : "Finish Loading"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Next Up panel — V1 render_next_up_controls parity
// ---------------------------------------------------------------------------

function NextUpPanel({
  runDate,
  nextUp,
  unloaded,
  anyInProgress,
}: {
  runDate: string;
  nextUp: number | null;
  unloaded: TruckWithState[];
  anyInProgress: boolean;
}) {
  const setNext = useSetNextUp(runDate);
  const clearNext = useClearNextUp(runDate);
  const upsert = useUpsertTruckState();
  const [pick, setPick] = useState<number | null>(null);

  const options = useMemo(
    () => unloaded.map((t) => t.truck_number).sort((a, b) => a - b),
    [unloaded],
  );

  useEffect(() => {
    if (pick == null) {
      setPick(nextUp ?? options[0] ?? null);
    } else if (pick != null && !options.includes(pick) && pick !== nextUp) {
      setPick(options[0] ?? null);
    }
  }, [nextUp, options, pick]);

  const nextStillAvailable = nextUp != null && options.includes(nextUp);

  async function startNextUp() {
    if (nextUp == null || anyInProgress) return;
    const truck = unloaded.find((t) => t.truck_number === nextUp);
    if (!truck) return;
    const nowSec = Date.now() / 1000;
    await upsert.mutateAsync({
      truck_number: nextUp,
      run_date: runDate,
      status: "in_progress",
      wearers: truck.state?.wearers ?? 0,
      load_start_time: nowSec,
      load_finish_time: null,
      load_duration_seconds: null,
    });
    await clearNext.mutateAsync();
  }

  return (
    <div>
      <h3 className="mb-2 text-center text-lg font-bold tracking-wide">
        Next up queue
      </h3>

      {nextUp != null ? (
        <div
          className={clsx(
            "mb-3 rounded-md border px-3 py-2 text-sm",
            nextStillAvailable
              ? "border-blue-800/60 bg-blue-950/40 text-blue-100"
              : "border-red-800/60 bg-red-950/40 text-red-200",
          )}
        >
          {nextStillAvailable
            ? `Current next up: Truck #${nextUp}`
            : `Truck #${nextUp} is no longer Unloaded — clear or pick another.`}
        </div>
      ) : (
        <p className="mb-3 text-center text-xs text-slate-500">
          No next-up truck set.
        </p>
      )}

      {nextUp != null && nextStillAvailable && !anyInProgress && (
        <button
          className="btn-primary mb-3 w-full"
          disabled={upsert.isPending || clearNext.isPending}
          onClick={startNextUp}
        >
          Start Next Up (Truck #{nextUp})
        </button>
      )}
      {nextUp != null && anyInProgress && (
        <p className="mb-3 text-center text-xs text-amber-400">
          Finish the in-progress truck before starting Next Up.
        </p>
      )}

      {options.length === 0 ? (
        <p className="text-center text-xs text-slate-500">
          No Unloaded trucks available.
        </p>
      ) : (
        <>
          <label className="label">Select next up</label>
          <select
            className="input mb-2"
            value={pick ?? ""}
            onChange={(e) =>
              setPick(e.target.value ? parseInt(e.target.value, 10) : null)
            }
          >
            {options.map((n) => (
              <option key={n} value={n}>
                Truck #{n}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn-primary"
              disabled={pick == null || setNext.isPending}
              onClick={() => pick != null && setNext.mutate(pick)}
            >
              Set Next Up
            </button>
            <button
              className="btn-ghost"
              disabled={nextUp == null || clearNext.isPending}
              onClick={() => clearNext.mutate()}
            >
              Clear Next Up
            </button>
          </div>
        </>
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


/**
 * Live "In Progress" page (V1 parity):
 *
 *   CURRENT TRUCK #N        ELAPSED TIME 00:46
 *   LOAD DAY · Day 2 (Tue)
 *   [ Set Next Up ]
 *   [ Audit Next Up ]
 *
 *   Select Shortages
 *   [3x10] [3x5] [4x6]
 *   [Paper] [Bulk] [Recents]
 *
 *   [        Audit         ]
 *   [    FINISH LOADING    ]
 *
 * Rendered on /board?status=in_progress. Pulls the single in-progress truck
 * from the board and drives the load-completion flow.
 */
