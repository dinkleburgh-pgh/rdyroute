import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  useAuditByTruck,
  useAuditByRoute,
  useAuditDailyTrend,
  useLoadPaceTrend,
  useCompletionTrend,
  useWearersTrend,
  useCycleTimeTrend,
  useShortageDailyTrend,
  useShortageByCategory,
  useShortageSummary,
  useTruckAnomalies,
  useAuditAnomalies,
  useTrendSummary,
} from "../../api/hooks";
import KpiCard from "../../components/trends/KpiCard";
import clsx from "clsx";
import { format, parseISO } from "date-fns";

const METRICS: Record<string, { label: string; color: string }> = {
  volume:     { label: "Discrepancy Volume",    color: "text-blue-400" },
  pace:       { label: "Load Pace",       color: "text-green-400" },
  completion: { label: "Completion Rate", color: "text-amber-400" },
  wearers:    { label: "Wearers",         color: "text-violet-400" },
  cycle:      { label: "Cycle Time",      color: "text-teal-400" },
  shortages:  { label: "Shortages",       color: "text-orange-400" },
  anomalies:  { label: "Anomalies",       color: "text-red-400" },
};

export default function TrendDetail() {
  const { metric } = useParams<{ metric: string }>();
  const cfg = metric ? METRICS[metric] : null;
  const days = 30;

  const { data: summary } = useTrendSummary(days, days);
  const { data: byTruck } = useAuditByTruck(days);
  const { data: byRoute } = useAuditByRoute(days);
  const { data: daily } = useAuditDailyTrend(days);
  const { data: pace } = useLoadPaceTrend(days);
  const { data: completion } = useCompletionTrend(days);
  const { data: wearers } = useWearersTrend(days);
  const { data: cycle } = useCycleTimeTrend(days);
  const { data: shortageDaily } = useShortageDailyTrend(days);
  const { data: shortageByCat } = useShortageByCategory(days);
  const { data: shortageSummary } = useShortageSummary(days, days);
  const { data: truckAnomalies } = useTruckAnomalies(90);
  const { data: auditAnomalies } = useAuditAnomalies(90);

  const anomalies = useMemo(
    () => [...(truckAnomalies ?? []), ...(auditAnomalies ?? [])],
    [truckAnomalies, auditAnomalies],
  );

  if (!cfg) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-slate-500">Unknown metric.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-4 p-3 md:p-6">
      <div className="flex items-center gap-4">
        <Link to="/trends" className="text-sm font-semibold text-blue-400 hover:text-blue-300">&larr; Back to Trends</Link>
        <h2 className={clsx("text-2xl font-black uppercase tracking-widest", cfg.color)}>
          {cfg.label}
        </h2>
      </div>

      {metric === "volume" && <VolumeTable data={byTruck} daily={daily} summary={summary} />}
      {metric === "pace" && <PaceTable data={pace} />}
      {metric === "completion" && <CompletionTable data={completion} />}
      {metric === "wearers" && <WearersTable data={wearers} />}
      {metric === "cycle" && <CycleTable data={cycle} />}
      {metric === "shortages" && <ShortageTable data={shortageDaily} byCat={shortageByCat} summary={shortageSummary} />}
      {metric === "anomalies" && <AnomalyTable data={anomalies} />}
    </motion.div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={clsx("border-b border-slate-800/50 px-3 py-2 text-slate-200", className)}>{children}</td>;
}

function VolumeTable({ data, daily, summary }: { data: { truck_number: number; item_label: string; total_qty: number }[] | undefined; daily: { run_date: string; total_qty: number; entry_count: number }[] | undefined; summary: { total_qty: number; avg_per_day: number; peak_qty: number; entry_count: number; days_with_data: number } | undefined }) {
  const s = summary ?? { total_qty: 0, avg_per_day: 0, peak_qty: 0, entry_count: 0, days_with_data: 0 };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Qty" value={s.total_qty.toLocaleString()} status="Stable" />
        <KpiCard label="Avg / Day" value={s.avg_per_day.toFixed(1)} status="Stable" />
        <KpiCard label="Days" value={s.days_with_data} status="Stable" />
        <KpiCard label="Total Entries" value={s.entry_count.toLocaleString()} status="Stable" />
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Truck #</Th>
            <Th>Item</Th>
            <Th>Total Qty</Th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).length === 0 && (
            <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
          )}
          {(data ?? []).slice(0, 100).map((r, i) => (
            <tr key={i} className="hover:bg-slate-800/40">
              <Td>#{r.truck_number}</Td>
              <Td>{r.item_label}</Td>
              <Td className="font-semibold">{r.total_qty}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function PaceTable({ data }: { data: { run_date: string; avg_seconds: number; load_count: number }[] | undefined }) {
  const avg = data && data.length > 0 ? data.reduce((s, d) => s + d.avg_seconds, 0) / data.length : 0;
  const totalLoads = data?.reduce((s, d) => s + d.load_count, 0) ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Avg Pace" value={avg > 0 ? `${Math.floor(avg / 60)}m ${Math.round(avg % 60)}s` : "—"} status="Stable" />
        <KpiCard label="Total Loads" value={totalLoads.toLocaleString()} status="Stable" />
        <KpiCard label="Days" value={data?.length ?? 0} status="Stable" />
      </div>
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Avg Duration</Th>
          <Th>Loads</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).length === 0 && (
          <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
        )}
        {(data ?? []).map((r, i) => (
          <tr key={i} className="hover:bg-slate-800/40">
            <Td>{format(parseISO(r.run_date), "MMM d, yyyy")}</Td>
            <Td>{Math.floor(r.avg_seconds / 60)}m {Math.round(r.avg_seconds % 60)}s</Td>
            <Td>{r.load_count}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
    </div>
  );
}

function CompletionTable({ data }: { data: { run_date: string; total_trucks: number; loaded_trucks: number; pct: number }[] | undefined }) {
  const totalLoaded = data?.reduce((s, d) => s + d.loaded_trucks, 0) ?? 0;
  const avgPct = data && data.length > 0 ? data.reduce((s, d) => s + d.pct, 0) / data.length : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Avg Completion" value={`${avgPct.toFixed(1)}%`} status={avgPct >= 90 ? "Stable" : avgPct >= 70 ? "Watch" : "Critical"} />
        <KpiCard label="Total Loaded" value={totalLoaded.toLocaleString()} status="Stable" />
        <KpiCard label="Days" value={data?.length ?? 0} status="Stable" />
      </div>
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Loaded / Total</Th>
          <Th>%</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).length === 0 && (
          <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
        )}
        {(data ?? []).map((r, i) => (
          <tr key={i} className="hover:bg-slate-800/40">
            <Td>{format(parseISO(r.run_date), "MMM d, yyyy")}</Td>
            <Td>{r.loaded_trucks} / {r.total_trucks}</Td>
            <Td className={clsx("font-semibold", r.pct >= 90 ? "text-emerald-400" : r.pct >= 70 ? "text-amber-400" : "text-red-400")}>{r.pct}%</Td>
          </tr>
        ))}
      </tbody>
    </Table>
    </div>
  );
}

function WearersTable({ data }: { data: { run_date: string; avg_wearers: number; truck_count: number }[] | undefined }) {
  const avgW = data && data.length > 0 ? data.reduce((s, d) => s + d.avg_wearers, 0) / data.length : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Avg Wearers" value={avgW.toFixed(1)} status="Stable" />
        <KpiCard label="Days" value={data?.length ?? 0} status="Stable" />
      </div>
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Avg Wearers</Th>
          <Th>Trucks</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).length === 0 && (
          <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
        )}
        {(data ?? []).map((r, i) => (
          <tr key={i} className="hover:bg-slate-800/40">
            <Td>{format(parseISO(r.run_date), "MMM d, yyyy")}</Td>
            <Td className="font-semibold">{r.avg_wearers.toFixed(1)}</Td>
            <Td>{r.truck_count}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
    </div>
  );
}

function CycleTable({ data }: { data: { run_date: string; avg_seconds: number; truck_count: number }[] | undefined }) {
  const avgCycle = data && data.length > 0 ? data.reduce((s, d) => s + d.avg_seconds, 0) / data.length : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label="Avg Cycle" value={avgCycle > 0 ? `${Math.floor(avgCycle / 60)}m ${Math.round(avgCycle % 60)}s` : "—"} status="Stable" />
        <KpiCard label="Days" value={data?.length ?? 0} status="Stable" />
      </div>
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Avg Cycle Time</Th>
          <Th>Trucks</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).length === 0 && (
          <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
        )}
        {(data ?? []).map((r, i) => (
          <tr key={i} className="hover:bg-slate-800/40">
            <Td>{format(parseISO(r.run_date), "MMM d, yyyy")}</Td>
            <Td>{Math.floor(r.avg_seconds / 60)}m {Math.round(r.avg_seconds % 60)}s</Td>
            <Td>{r.truck_count}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
    </div>
  );
}

function ShortageTable({ data, byCat, summary }: { data: { run_date: string; total_qty: number; entry_count: number }[] | undefined; byCat: { category: string; total_qty: number }[] | undefined; summary: { total_qty: number; avg_per_day: number; peak_qty: number; entry_count: number; days_with_data: number } | undefined }) {
  const s = summary ?? { total_qty: 0, avg_per_day: 0, peak_qty: 0, entry_count: 0, days_with_data: 0 };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Shortages" value={s.total_qty.toLocaleString()} status="Stable" />
        <KpiCard label="Avg / Day" value={s.avg_per_day.toFixed(1)} status="Stable" />
        <KpiCard label="Days" value={s.days_with_data} status="Stable" />
        <KpiCard label="Entries" value={s.entry_count.toLocaleString()} status="Stable" />
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">By Category</h3>
      <Table>
        <thead>
          <tr>
            <Th>Category</Th>
            <Th>Total Qty</Th>
          </tr>
        </thead>
        <tbody>
          {(byCat ?? []).length === 0 && (
            <tr><td colSpan={2} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
          )}
          {(byCat ?? []).map((r, i) => (
            <tr key={i} className="hover:bg-slate-800/40">
              <Td>{r.category}</Td>
              <Td className="font-semibold">{r.total_qty}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Daily Breakdown</h3>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Items</Th>
            <Th>Entries</Th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).length === 0 && (
            <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No data.</td></tr>
          )}
          {(data ?? []).map((r, i) => (
            <tr key={i} className="hover:bg-slate-800/40">
              <Td>{format(parseISO(r.run_date), "MMM d, yyyy")}</Td>
              <Td className="font-semibold">{r.total_qty}</Td>
              <Td>{r.entry_count}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function AnomalyTable({ data }: { data: { run_date: string; metric: string; value: number; mean: number; z_score: number }[] | undefined }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Metric</Th>
          <Th>Value</Th>
          <Th>Mean</Th>
          <Th>Z-Score</Th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).length === 0 && (
          <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No anomalies found.</td></tr>
        )}
        {(data ?? []).map((r, i) => (
          <tr key={i} className="hover:bg-slate-800/40">
            <Td>{format(parseISO(r.run_date), "MMM d, yyyy")}</Td>
            <Td className="font-semibold text-red-400">{r.metric}</Td>
            <Td>{r.value.toFixed(1)}</Td>
            <Td>{r.mean.toFixed(1)}</Td>
            <Td className="font-mono">{r.z_score.toFixed(2)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
