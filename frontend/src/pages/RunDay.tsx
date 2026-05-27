import { useMemo } from "react";
import clsx from "clsx";
import { useBoard, useHolidayMode } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import type { TruckStatus, TruckWithState } from "../types";

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  shop: "Shop",
  in_progress: "Loading",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};

const STATUS_BG: Record<TruckStatus, string> = {
  dirty: "bg-status-dirty",
  shop: "bg-status-shop",
  in_progress: "bg-status-inprogress",
  unloaded: "bg-status-unloaded",
  loaded: "bg-status-loaded",
  off: "bg-status-off",
  oos: "bg-status-oos",
  spare: "bg-status-spare",
};

const STATUS_TEXT: Record<TruckStatus, string> = {
  dirty: "text-status-dirty",
  shop: "text-status-shop",
  in_progress: "text-status-inprogress",
  unloaded: "text-status-unloaded",
  loaded: "text-status-loaded",
  off: "text-status-off",
  oos: "text-status-oos",
  spare: "text-white",
};

const UNLOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, shop: 1, in_progress: 2, unloaded: 3, loaded: 4, oos: 5, off: 6,
};
const LOAD_SORT: Partial<Record<TruckStatus, number>> = {
  dirty: 0, unloaded: 1, shop: 2, in_progress: 3, loaded: 4, oos: 5, off: 6,
};

function effectiveStatus(
  t: TruckWithState,
  dayNum: number,
  holidayMode: boolean,
): TruckStatus {
  const raw = (t.state?.status ?? "dirty") as TruckStatus;
  if (
    !holidayMode &&
    t.truck_type !== "Spare" &&
    t.scheduled_off_days.includes(dayNum) &&
    (raw === "dirty" || raw === "unloaded")
  )
    return "off";
  return raw;
}

function isUnloadDone(s: TruckStatus) {
  return s === "unloaded" || s === "loaded";
}
function isLoadDone(s: TruckStatus) {
  return s === "loaded";
}

export default function RunDay() {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: holidayMode = false } = useHolidayMode(runDate);
  const { loadDay, unloadsDay } = workdayNumbers();

  const unloadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            t.truck_type !== "Spare" &&
            !t.scheduled_off_days.includes(unloadsDay),
        )
        .sort((a, b) => {
          const sa = effectiveStatus(a, unloadsDay, holidayMode);
          const sb = effectiveStatus(b, unloadsDay, holidayMode);
          const oa = UNLOAD_SORT[sa] ?? 9;
          const ob = UNLOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    [board, unloadsDay, holidayMode],
  );

  const loadTrucks = useMemo(
    () =>
      board
        .filter(
          (t) =>
            (t.truck_type !== "Spare" || t.route_swap_route != null) &&
            !t.scheduled_off_days.includes(loadDay),
        )
        .sort((a, b) => {
          const sa = effectiveStatus(a, loadDay, holidayMode);
          const sb = effectiveStatus(b, loadDay, holidayMode);
          const oa = LOAD_SORT[sa] ?? 9;
          const ob = LOAD_SORT[sb] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.truck_number - b.truck_number;
        }),
    [board, loadDay, holidayMode],
  );

  const unloadDone = unloadTrucks.filter((t) =>
    isUnloadDone(effectiveStatus(t, unloadsDay, holidayMode)),
  ).length;
  const loadDone = loadTrucks.filter((t) =>
    isLoadDone(effectiveStatus(t, loadDay, holidayMode)),
  ).length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-slate-200">
            Unload &mdash; Day {unloadsDay}
          </h2>
          <span className="text-sm text-slate-400">
            {unloadDone} / {unloadTrucks.length} done
          </span>
          {unloadTrucks.length > 0 && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((unloadDone / unloadTrucks.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
          {unloadTrucks.map((t) => {
            const status = effectiveStatus(t, unloadsDay, holidayMode);
            return (
              <TruckCard key={t.truck_number} t={t} status={status} done={isUnloadDone(status)} />
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-slate-200">
            Load &mdash; Day {loadDay}
          </h2>
          <span className="text-sm text-slate-400">
            {loadDone} / {loadTrucks.length} done
          </span>
          {loadTrucks.length > 0 && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.round((loadDone / loadTrucks.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
          {loadTrucks.map((t) => {
            const status = effectiveStatus(t, loadDay, holidayMode);
            return (
              <TruckCard key={t.truck_number} t={t} status={status} done={isLoadDone(status)} />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TruckCard({
  t,
  status,
  done,
}: {
  t: TruckWithState;
  status: TruckStatus;
  done: boolean;
}) {
  return (
    <div
      className={clsx(
        "card flex flex-col items-center gap-1 p-2 text-center transition-opacity",
        done && "opacity-40",
      )}
    >
      <span
        className={clsx(
          "text-3xl font-extrabold tabular-nums leading-none",
          STATUS_TEXT[status],
        )}
      >
        {t.truck_number}
      </span>
      <span
        className={clsx(
          "rounded px-1 py-0.5 text-[10px] font-semibold text-white",
          STATUS_BG[status],
        )}
      >
        {STATUS_LABELS[status]}
      </span>
      <span className="text-[10px] text-slate-500">{t.truck_type}</span>
    </div>
  );
}
