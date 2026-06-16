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
  useTruckAnomalies,
  useAuditAnomalies,
  useTrendSummary,
} from "../../api/hooks";
import clsx from "clsx";
import { format, parseISO } from "date-fns";

const METRICS: Record<string, { label: string; color: string }> = {
  volume:     { label: "Audit Volume",    color: "text-blue-400" },
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

      {metric === "volume" && <VolumeTable data={byTruck} daily={daily} />}
      {metric === "pace" && <PaceTable data={pace} />}
      {metric === "completion" && <CompletionTable data={completion} />}
      {metric === "wearers" && <WearersTable data={wearers} />}
      {metric === "cycle" && <CycleTable data={cycle} />}
      {metric === "shortages" && <ShortageTable data={shortageDaily} byCat={shortageByCat} />}
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

function VolumeTable({ data, daily }: { data: { truck_number: number; item_label: string; total_qty: number }[] | undefined; daily: { run_date: string; total_qty: number; entry_count: number }[] | undefined }) {
  const dailyTotal = daily?.reduce((s, d) => s + d.total_qty, 0) ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <span className="text-slate-400">Total items: <span className="font-semibold text-slate-200">{dailyTotal}</span></span>
        <span className="text-slate-400">Days: <span className="font-semibold text-slate-200">{daily?.length ?? 0}</span></span>
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
  return (
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
  );
}

function CompletionTable({ data }: { data: { run_date: string; total_trucks: number; loaded_trucks: number; pct: number }[] | undefined }) {
  return (
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
  );
}

function WearersTable({ data }: { data: { run_date: string; avg_wearers: number; truck_count: number }[] | undefined }) {
  return (
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
  );
}

function CycleTable({ data }: { data: { run_date: string; avg_seconds: number; truck_count: number }[] | undefined }) {
  return (
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
  );
}

function ShortageTable({ data, byCat }: { data: { run_date: string; total_qty: number; entry_count: number }[] | undefined; byCat: { category: string; total_qty: number }[] | undefined }) {
  const total = data?.reduce((s, d) => s + d.total_qty, 0) ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <span className="text-slate-400">Total shortage items: <span className="font-semibold text-slate-200">{total}</span></span>
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
