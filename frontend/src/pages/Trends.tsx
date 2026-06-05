import { useMemo, useState } from "react";
import {
  useAuditByRoute,
  useAuditByTruck,
  useAuditDailyTrend,
  useRouteSwapLog,
} from "../api/hooks";

const RANGES = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

export default function Trends() {
  const [days, setDays] = useState(14);
  const [swapDays, setSwapDays] = useState(30);

  const { data: daily, isLoading: dailyLoading } = useAuditDailyTrend(days);
  const { data: byTruck } = useAuditByTruck(days);
  const { data: byRoute } = useAuditByRoute(days);
  const { data: swapLog = [], isLoading: swapLoading } = useRouteSwapLog(swapDays);

  const dailyMax = Math.max(1, ...(daily ?? []).map((d) => d.total_qty));

  const topTrucks = useMemo(() => {
    const totals = new Map<number, number>();
    (byTruck ?? []).forEach((r) =>
      totals.set(r.truck_number, (totals.get(r.truck_number) ?? 0) + r.total_qty),
    );
    return [...totals.entries()]
      .map(([truck_number, total_qty]) => ({ truck_number, total_qty }))
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 10);
  }, [byTruck]);

  const topItems = useMemo(() => {
    const totals = new Map<string, number>();
    (byTruck ?? []).forEach((r) =>
      totals.set(r.item_label, (totals.get(r.item_label) ?? 0) + r.total_qty),
    );
    return [...totals.entries()]
      .map(([item_label, total_qty]) => ({ item_label, total_qty }))
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 10);
  }, [byTruck]);

  const topRoutes = useMemo(() => {
    const totals = new Map<number, number>();
    (byRoute ?? []).forEach((r) =>
      totals.set(r.route, (totals.get(r.route) ?? 0) + r.total_qty),
    );
    return [...totals.entries()]
      .map(([route, total_qty]) => ({ route, total_qty }))
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 10);
  }, [byRoute]);

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Trends</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={
                "rounded-md px-3 py-1 text-sm transition-colors " +
                (days === r.value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Audit quantity per day — last {days} days
        </h3>
        {dailyLoading && <p className="text-slate-400">Loading…</p>}
        <div className="flex h-48 items-end gap-1">
          {(daily ?? []).map((d) => (
            <div
              key={d.run_date}
              className="flex-1 rounded-t bg-blue-600 hover:bg-blue-500"
              style={{ height: `${(d.total_qty / dailyMax) * 100}%` }}
              title={`${d.run_date}: ${d.total_qty} qty (${d.entry_count} entries)`}
            />
          ))}
          {(daily ?? []).length === 0 && !dailyLoading && (
            <p className="m-auto text-sm text-slate-500">No data in this range.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Leaderboard
          title="Top trucks (qty)"
          rows={topTrucks.map((t) => ({
            label: `#${t.truck_number}`,
            value: t.total_qty,
          }))}
        />
        <Leaderboard
          title="Top items (qty)"
          rows={topItems.map((t) => ({ label: t.item_label, value: t.total_qty }))}
        />
        <Leaderboard
          title="Top routes (qty)"
          rows={topRoutes.map((t) => ({
            label: `Route ${t.route}`,
            value: t.total_qty,
          }))}
        />
      </div>

      {/* Route Coverage History */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Route coverage / swap history
          </h3>
          <div className="flex gap-1">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setSwapDays(d)}
                className={
                  "rounded-md px-3 py-1 text-sm transition-colors " +
                  (swapDays === d
                    ? "bg-violet-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700")
                }
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {swapLoading && <p className="text-slate-400 text-sm">Loading…</p>}
        {!swapLoading && swapLog.length === 0 && (
          <p className="text-sm text-slate-500">No route coverage events in this range.</p>
        )}
        {swapLog.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Route truck</th>
                  <th className="pb-2">Loaded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {swapLog.map((row) => (
                  <tr key={row.id} className="text-slate-300">
                    <td className="py-1.5 pr-4 tabular-nums text-slate-400">{row.run_date}</td>
                    <td className="py-1.5 pr-4 font-semibold">#{row.route_truck}</td>
                    <td className="py-1.5">
                      {row.load_on_truck === row.route_truck ? (
                        <span className="text-slate-500 italic">self</span>
                      ) : (
                        <span className="text-violet-300">#{row.load_on_truck}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
        {title}
      </h3>
      {rows.length === 0 && (
        <p className="text-sm text-slate-500">No data in this range.</p>
      )}
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="text-sm">
            <div className="flex justify-between">
              <span className="truncate pr-2 text-slate-300">{r.label}</span>
              <span className="font-medium tabular-nums text-slate-100">{r.value}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
