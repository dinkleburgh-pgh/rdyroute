/**
 * Timed status-transition hooks for the fleet board.
 *
 * Outside timer  — enabled via outside_timer_enabled setting.
 *   20 minutes → sets truck to "unloaded"
 *
 * Paper Bay timer — enabled via paper_bay_enabled setting.
 *   25 minutes → sets truck to "loaded"
 *   Also cancels any active Outside timer for the same truck.
 *
 * Timers persist in localStorage keyed by run date so they survive page reloads.
 */
import { useEffect, useRef, useState } from "react";
import type { TruckStatus, TruckWithState } from "../../types";

// ---------------------------------------------------------------------------
// localStorage helpers (one per timer type)
// ---------------------------------------------------------------------------

function _load(storageKey: string, runDate: string): Map<number, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Map();
    const all = JSON.parse(raw) as Record<string, Record<string, number>>;
    return new Map(Object.entries(all[runDate] ?? {}).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}

function _save(storageKey: string, runDate: string, timers: Map<number, number>): void {
  try {
    const raw = localStorage.getItem(storageKey);
    const all: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
    if (timers.size === 0) delete all[runDate];
    else all[runDate] = Object.fromEntries([...timers].map(([k, v]) => [String(k), v]));
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type UpsertFn = {
  mutate: (args: {
    truck_number: number;
    run_date: string;
    status?: TruckStatus;
    wearers?: number;
  }) => void;
};

export interface TimerApi {
  countdowns: Map<number, number>;
  start: (truckNum: number) => void;
  cancel: (truckNum: number) => void;
}

// ---------------------------------------------------------------------------
// Generic timed status-transition hook
// ---------------------------------------------------------------------------

function useTimedStatusTransition({
  storageKey,
  durationMs,
  targetStatus,
  runDate,
  data,
  upsert,
  onExpire,
}: {
  storageKey: string;
  durationMs: number;
  targetStatus: TruckStatus;
  runDate: string;
  data: TruckWithState[] | undefined;
  upsert: UpsertFn;
  /** Optional: called with truckNum just before the status mutation fires. */
  onExpire?: (truckNum: number) => void;
}): TimerApi {
  const [timers, setTimers] = useState<Map<number, number>>(new Map());
  const [countdowns, setCountdowns] = useState<Map<number, number>>(new Map());

  const _timersRef  = useRef<Map<number, number>>(new Map());
  const _runDateRef = useRef(runDate);
  const _dataRef    = useRef(data);
  const _upsertRef  = useRef(upsert);
  const _expireRef  = useRef(onExpire);
  useEffect(() => { _timersRef.current  = timers;    }, [timers]);
  useEffect(() => { _runDateRef.current = runDate;   }, [runDate]);
  useEffect(() => { _dataRef.current    = data;      }, [data]);
  useEffect(() => { _upsertRef.current  = upsert;    }, [upsert]);
  useEffect(() => { _expireRef.current  = onExpire;  }, [onExpire]);

  // Restore persisted timers when run-date changes
  useEffect(() => {
    const stored = _load(storageKey, runDate);
    const now = Date.now();
    const active = new Map([...stored].filter(([, exp]) => exp > now));
    setTimers(active);
    setCountdowns(new Map([...active].map(([n, e]) => [n, Math.ceil((e - now) / 1000)])));
  }, [runDate, storageKey]);

  // 1-second tick — fires status mutation when a timer expires
  useEffect(() => {
    const id = setInterval(() => {
      const t = _timersRef.current;
      if (t.size === 0) return;
      const now = Date.now();
      const expired: number[] = [];
      const remaining = new Map<number, number>();
      t.forEach((expiry, truckNum) => {
        const rem = Math.ceil((expiry - now) / 1000);
        if (rem <= 0) expired.push(truckNum);
        else remaining.set(truckNum, rem);
      });
      if (expired.length > 0) {
        const next = new Map(t);
        expired.forEach((num) => {
          next.delete(num);
          _expireRef.current?.(num);
          const truck = (_dataRef.current ?? []).find((x) => x.truck_number === num);
          _upsertRef.current.mutate({
            truck_number: num,
            run_date: _runDateRef.current,
            status: targetStatus,
            wearers: truck?.state?.wearers ?? 0,
          });
        });
        _save(storageKey, _runDateRef.current, next);
        setTimers(next);
      }
      setCountdowns(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [storageKey, targetStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  function start(truckNum: number) {
    const expiry = Date.now() + durationMs;
    setTimers((prev) => {
      const next = new Map(prev);
      next.set(truckNum, expiry);
      _save(storageKey, runDate, next);
      return next;
    });
    setCountdowns((prev) => {
      const next = new Map(prev);
      next.set(truckNum, Math.ceil(durationMs / 1000));
      return next;
    });
  }

  function cancel(truckNum: number) {
    setTimers((prev) => {
      const next = new Map(prev);
      next.delete(truckNum);
      _save(storageKey, runDate, next);
      return next;
    });
    setCountdowns((prev) => {
      const next = new Map(prev);
      next.delete(truckNum);
      return next;
    });
  }

  return { countdowns, start, cancel };
}

// ---------------------------------------------------------------------------
// Outside timer — 20 min → "unloaded"
// ---------------------------------------------------------------------------

const _OUTSIDE_LS_KEY = "rr_outside_timers";
const _OUTSIDE_DURATION_MS = 20 * 60 * 1000; // 20 minutes

export function useOutsideTimer(
  runDate: string,
  data: TruckWithState[] | undefined,
  upsert: UpsertFn,
): TimerApi {
  return useTimedStatusTransition({
    storageKey: _OUTSIDE_LS_KEY,
    durationMs: _OUTSIDE_DURATION_MS,
    targetStatus: "unloaded",
    runDate,
    data,
    upsert,
  });
}

// ---------------------------------------------------------------------------
// Paper Bay timer — 25 min → "loaded"
// Also cancels any active Outside timer for the same truck on start/expire.
// ---------------------------------------------------------------------------

const _PAPER_BAY_LS_KEY = "rr_paper_bay_timers";
const _PAPER_BAY_DURATION_MS = 25 * 60 * 1000; // 25 minutes

export function usePaperBayTimer(
  runDate: string,
  data: TruckWithState[] | undefined,
  upsert: UpsertFn,
  cancelOutside: (truckNum: number) => void,
): TimerApi {
  const api = useTimedStatusTransition({
    storageKey: _PAPER_BAY_LS_KEY,
    durationMs: _PAPER_BAY_DURATION_MS,
    targetStatus: "loaded",
    runDate,
    data,
    upsert,
    // When the paper bay timer fires, also clear any outside timer
    onExpire: cancelOutside,
  });

  // Wrap start() to also cancel the outside timer immediately
  const originalStart = api.start;
  const wrappedStart = (truckNum: number) => {
    cancelOutside(truckNum);
    originalStart(truckNum);
  };

  return { ...api, start: wrappedStart };
}
