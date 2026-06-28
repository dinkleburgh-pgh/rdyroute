import { motion } from "framer-motion";
import { Line } from "react-chartjs-2";
import type { ShortageSummary } from "../../api/hooks";
import KpiCard from "./KpiCard";

interface Props {
  summary: ShortageSummary | undefined;
  isLoading: boolean;
}

function MiniSparkline({ data }: { data: number[] }) {
  return (
    <div className="h-8 w-full">
      <Line
        data={{
          labels: data.map(() => ""),
          datasets: [
            {
              data,
              borderColor: "#f59e0b",
              backgroundColor: "rgba(245,158,11,0.1)",
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              borderWidth: 1.5,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, beginAtZero: true },
          },
        }}
      />
    </div>
  );
}

export default function ShortageKpiSection({ summary, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="mb-2 h-3 w-16 rounded bg-slate-800" />
            <div className="mb-1 h-7 w-20 rounded bg-slate-800" />
            <div className="h-3 w-12 rounded bg-slate-800" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const dailyTotals = summary.daily_series.map((d) => d.total_qty);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }}>
        <KpiCard
          label="Total Pieces"
          value={summary.total_qty.toLocaleString()}
          change={summary.change_vs_prior_pct}
          direction={summary.trend_direction === "up" ? "up" : summary.trend_direction === "down" ? "down" : "stable"}
          status={summary.trend_direction === "down" ? "Improving" : summary.trend_direction === "up" ? "Critical" : "Stable"}
        >
          <MiniSparkline data={dailyTotals} />
        </KpiCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }}>
        <KpiCard
          label="Avg / Day"
          value={summary.avg_per_day.toFixed(1)}
          status="Stable"
        >
          <MiniSparkline data={dailyTotals} />
        </KpiCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }}>
        <KpiCard
          label="Peak Day"
          value={summary.peak_day ?? "—"}
          status="Watch"
        >
          {summary.peak_qty > 0 && (
            <span className="text-xs text-slate-500">{summary.peak_qty.toLocaleString()} pieces</span>
          )}
        </KpiCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }}>
        <KpiCard
          label="Data Days"
          value={summary.days_with_data}
          status="Stable"
        >
          <span className="text-xs text-slate-500">{summary.entry_count} entries</span>
        </KpiCard>
      </motion.div>
    </div>
  );
}