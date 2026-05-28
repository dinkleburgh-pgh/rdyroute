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
  useShortageCategories,
  useTruckNotes,
  useUpsertTruckState,
} from "../api/hooks";
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
// Truck notes floating popup — shows applicable notes for the current truck
// ---------------------------------------------------------------------------

const NOTE_TYPE_CHIP: Record<TruckNote["note_type"], string> = {
  constant: "bg-blue-900/60 text-blue-300 border border-blue-700/40",
  workday:  "bg-violet-900/60 text-violet-300 border border-violet-700/40",
  one_off:  "bg-amber-900/60 text-amber-300 border border-amber-700/40",
};
const NOTE_TYPE_LABEL: Record<TruckNote["note_type"], string> = {
  constant: "Constant",
  workday:  "Workday",
  one_off:  "One-off",
};

function TruckNotesPopup({ truckNumber, loadDayNum }: { truckNumber: number; loadDayNum: number | null }) {
  const { data: notes = [] } = useTruckNotes({ truckNumber, activeOnly: true });
  const [dismissed, setDismissed] = useState(false);

  const applicable = notes.filter((n) => {
    if (n.note_type === "constant") return true;
    if (n.note_type === "workday") return n.workday_num === loadDayNum;
    if (n.note_type === "one_off") return n.expires_on == null || n.expires_on >= new Date().toISOString().slice(0, 10);
    return false;
  });

  if (applicable.length === 0 || dismissed) return null;

  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/25 p-3 shadow-lg ring-1 ring-amber-400/15">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            Notes · {applicable.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-0.5 text-slate-500 hover:text-slate-300"
          aria-label="Dismiss notes"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="space-y-2">
        {applicable.map((n) => (
          <div key={n.id} className="flex items-start gap-2">
            <span className={clsx("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", NOTE_TYPE_CHIP[n.note_type])}>
              {NOTE_TYPE_LABEL[n.note_type]}
            </span>
            <span className="text-sm leading-snug text-slate-200">{n.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top panel: current truck identity + Next Up shortcuts + elapsed timer
// ---------------------------------------------------------------------------

const DAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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
      ? `Day ${dayNum} (${DAY_NAMES[dayNum]})`
      : null;

  return (
    <section className="card">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(180px,240px)_1fr]">
        {/* Left: identity + Next Up shortcuts */}
        <div className="flex flex-col items-center gap-3 md:items-start">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Current Truck
          </p>
          <p className="text-6xl font-extrabold leading-none text-amber-300">
            #{truck.truck_number}
          </p>
          {dayLabel && (
            <span className="inline-flex items-center rounded-full border border-emerald-700/60 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span className="mr-2 text-[10px] uppercase tracking-wide text-emerald-500">
                Load day
              </span>
              {dayLabel}
            </span>
          )}

          <div className="mt-2 flex w-full flex-col gap-2">
            <button
              className="btn-ghost w-full"
              onClick={() => setPickerOpen((o) => !o)}
            >
              {nextUp != null ? `Next Up: #${nextUp}` : "Set Next Up"}
            </button>
            <Link
              to={nextUp != null ? `/audit?truck=${nextUp}` : "/audit"}
              className={clsx(
                "rounded-md border border-slate-700 px-3 py-2 text-center text-sm font-medium transition-colors",
                nextUp != null
                  ? "bg-slate-800 hover:bg-slate-700"
                  : "pointer-events-none bg-slate-900/40 text-slate-600",
              )}
              aria-disabled={nextUp == null}
            >
              Audit Next Up
            </Link>
          </div>
        </div>

        {/* Right: elapsed timer */}
        <ElapsedCard
          startSec={truck.state?.load_start_time ?? null}
          paceAvgSeconds={paceAvgSeconds}
        />
      </div>

      {/* Notes for this truck */}
      <TruckNotesPopup truckNumber={truck.truck_number} loadDayNum={dayNum} />

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

function ElapsedCard({
  startSec,
  paceAvgSeconds,
}: {
  startSec: number | null;
  paceAvgSeconds: number | null;
}) {
  const [elapsed, setElapsed] = useState(() =>
    startSec ? Math.max(0, Math.round(Date.now() / 1000 - startSec)) : 0,
  );

  useEffect(() => {
    if (!startSec) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.max(0, Math.round(Date.now() / 1000 - startSec)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startSec]);

  const onPace = paceAvgSeconds == null ? null : elapsed <= paceAvgSeconds;
  const accent =
    onPace == null
      ? "border-slate-700 from-slate-900 to-slate-950 text-slate-200"
      : onPace
        ? "border-emerald-600/60 from-emerald-950/60 to-slate-950 text-emerald-300"
        : "border-red-700/60 from-red-950/60 to-slate-950 text-red-300";

  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-xl border-2 bg-gradient-to-b px-6 py-8 shadow-inner",
        accent,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
        Elapsed Time
      </p>
      {startSec ? (
        <>
          <p className="mt-2 font-mono text-6xl font-bold tabular-nums sm:text-7xl">
            {formatDuration(elapsed)}
          </p>
          {paceAvgSeconds != null && (
            <p className="mt-1 text-xs">
              {onPace ? "on pace" : "over pace"} · avg{" "}
              {formatDuration(paceAvgSeconds)}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No start time recorded.</p>
      )}
    </div>
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
  const { data: categories } = useShortageCategories();
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Top-level shortage categories from /shorts/categories (e.g. 3x10, Paper, Bulk).
  // V1 also offered a "Recents" tab; we render it as a final shortcut into the
  // Shorts page for this truck.
  const categoryKeys = useMemo(
    () => (categories ? Object.keys(categories) : []),
    [categories],
  );

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

  const shortsHref = (cat?: string) => {
    const params = new URLSearchParams({
      truck: String(truck.truck_number),
      run_date: runDate,
    });
    if (cat) params.set("category", cat);
    return `/shorts?${params.toString()}`;
  };

  return (
    <section className="card space-y-4">
      <div>
        <h3 className="text-lg font-bold tracking-wide">Select Shortages</h3>
        <p className="text-xs text-slate-500">
          Quick-jump to the Shorts form pre-filled for #{truck.truck_number}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categoryKeys.length === 0 ? (
          <p className="col-span-full text-xs text-slate-500">
            No shortage categories configured.
          </p>
        ) : (
          categoryKeys.map((cat) => (
            <Link
              key={cat}
              to={shortsHref(cat)}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-3 text-center text-sm font-semibold transition-colors hover:bg-slate-700"
            >
              {cat}
            </Link>
          ))
        )}
        <Link
          to={shortsHref()}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-3 text-center text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
        >
          Recents
        </Link>
      </div>

      <Link
        to={`/audit?truck=${truck.truck_number}`}
        className="block rounded-md border border-slate-700 bg-slate-800 px-3 py-3 text-center text-sm font-semibold transition-colors hover:bg-slate-700"
      >
        Audit
      </Link>

      <button
        type="button"
        onClick={finishLoading}
        disabled={busy}
        className="w-full rounded-md border-2 border-emerald-500/60 bg-emerald-950/40 px-4 py-4 text-lg font-bold uppercase tracking-wider text-emerald-300 shadow-inner transition-colors hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-60"
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

function formatDuration(totalSeconds: number): string {
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
