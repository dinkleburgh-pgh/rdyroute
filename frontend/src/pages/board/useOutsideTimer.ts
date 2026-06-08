/**
 * Outside-timer logic (dev feature — enabled via outside_timer_enabled setting).
 *
 * Lets fleet set a truck to "Outside" — a 10-minute countdown that
 * auto-transitions the truck to "unloaded" when it expires. Timers persist in
 * localStorage keyed by run date so they survive a page reload.
 *
 * Extracted from Board.tsx.
 */
import { useEffect, useRef, useState } from "react";
import type { TruckStatus, TruckWithState } from "../../types";

const _OUTSIDE_LS_KEY = "rr_outside_timers";

function _loadOutsideTimers(runDate: string): Map<number, number> {
  try {
    const raw = localStorage.getItem(_OUTSIDE_LS_KEY);
    if (!raw) return new Map();
    const all = JSON.parse(raw) as Record<string, Record<string, number>>;
    return new Map(Object.entries(all[runDate] ?? {}).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}

function _saveOutsideTimers(runDate: string, timers: Map<number, number>): void {
  try {
    const raw = localStorage.getItem(_OUTSIDE_LS_KEY);
    const all: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
    if (timers.size === 0) delete all[runDate];
    else all[runDate] = Object.fromEntries([...timers].map(([k, v]) => [String(k), v]));
    localStorage.setItem(_OUTSIDE_LS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
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

export interface OutsideTimerApi {
  /** Remaining seconds per truck number, updated every second. */
  countdowns: Map<number, number>;
  /** Start a 10-minute outside timer for a truck. */
  start: (truckNum: number) => void;
  /** Cancel an active timer. */
  cancel: (truckNum: number) => void;
}

/**
 * @param runDate  current board run date
 * @param data     current board data (used to read wearers on auto-unload)
 * @param upsert   the useUpsertTruckState() mutation
 */
export function useOutsideTimer(
  runDate: string,
  data: TruckWithState[] | undefined,
  upsert: UpsertFn,
): OutsideTimerApi {
  const [outsideTimers, setOutsideTimers] = useState<Map<number, number>>(new Map());
  const [outsideCountdowns, setOutsideCountdowns] = useState<Map<number, number>>(new Map());

  // Stable refs for use inside the setInterval callback (avoids stale closures)
  const _outsideTimersRef = useRef<Map<number, number>>(new Map());
  const _runDateRef = useRef(runDate);
  const _dataRef = useRef(data);
  const _upsertRef = useRef(upsert);
  useEffect(() => { _outsideTimersRef.current = outsideTimers; }, [outsideTimers]);
  useEffect(() => { _runDateRef.current = runDate; }, [runDate]);
  useEffect(() => { _dataRef.current = data; }, [data]);
  useEffect(() => { _upsertRef.current = upsert; }, [upsert]);

  // Load persisted timers when the run-date changes
  useEffect(() => {
    const stored = _loadOutsideTimers(runDate);
    const now = Date.now();
    const active = new Map([...stored].filter(([, exp]) => exp > now));
    setOutsideTimers(active);
    setOutsideCountdowns(new Map([...active].map(([n, e]) => [n, Math.ceil((e - now) / 1000)])));
  }, [runDate]);

  // 1-second tick — fires auto-unload when a timer expires
  useEffect(() => {
    const id = setInterval(() => {
      const timers = _outsideTimersRef.current;
      if (timers.size === 0) return;
      const now = Date.now();
      const expired: number[] = [];
      const countdowns = new Map<number, number>();
      timers.forEach((expiry, truckNum) => {
        const rem = Math.ceil((expiry - now) / 1000);
        if (rem <= 0) expired.push(truckNum);
        else countdowns.set(truckNum, rem);
      });
      if (expired.length > 0) {
        const next = new Map(timers);
        expired.forEach((num) => {
          next.delete(num);
          const t = (_dataRef.current ?? []).find((x) => x.truck_number === num);
          _upsertRef.current.mutate({
            truck_number: num,
            run_date: _runDateRef.current,
            status: "unloaded",
            wearers: t?.state?.wearers ?? 0,
          });
        });
        _saveOutsideTimers(_runDateRef.current, next);
        setOutsideTimers(next);
      }
      setOutsideCountdowns(countdowns);
    }, 1000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function start(truckNum: number) {
    const expiry = Date.now() + 10 * 60 * 1000;
    setOutsideTimers((prev) => {
      const next = new Map(prev);
      next.set(truckNum, expiry);
      _saveOutsideTimers(runDate, next);
      return next;
    });
    setOutsideCountdowns((prev) => {
      const next = new Map(prev);
      next.set(truckNum, 900);
      return next;
    });
  }

  function cancel(truckNum: number) {
    setOutsideTimers((prev) => {
      const next = new Map(prev);
      next.delete(truckNum);
      _saveOutsideTimers(runDate, next);
      return next;
    });
    setOutsideCountdowns((prev) => {
      const next = new Map(prev);
      next.delete(truckNum);
      return next;
    });
  }

  return { countdowns: outsideCountdowns, start, cancel };
}
