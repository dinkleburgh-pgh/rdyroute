import { motion } from "framer-motion";
import KpiCard from "./KpiCard";
import { Line } from "react-chartjs-2";
import type { TrendSummary } from "../../api/hooks";

interface Props {
  summary: TrendSummary | undefined;
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
              borderColor: "#3b82f6",
              backgroundColor: "rgba(59,130,246,0.1)",
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

export default function KpiSection({ summary, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
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
  const stableStatus = summary.trend_direction === "stable" ? "Stable" : "Watch";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }}>
        <KpiCard
          label="Items Removed"
          value={summary.total_qty.toLocaleString()}
          change={summary.change_vs_prior_pct}
          direction={summary.trend_direction === "up" ? "up" : summary.trend_direction === "down" ? "down" : "stable"}
          status={summary.trend_direction === "up" ? "Improving" : stableStatus}
        >
          <MiniSparkline data={dailyTotals} />
        </KpiCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }}>
        <KpiCard
          label="Avg / Day"
          value={summary.avg_per_day >= 1000 ? summary.avg_per_day.toLocaleString(undefined, { maximumFractionDigits: 0 }) : summary.avg_per_day.toFixed(1)}
          change={summary.change_vs_prior_pct}
          direction={summary.trend_direction === "up" ? "up" : summary.trend_direction === "down" ? "down" : "stable"}
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
            <span className="text-xs text-slate-500">{summary.peak_qty} items</span>
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

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 4 * 0.05 }}>
        <KpiCard
          label="Trend"
          value={summary.trend_direction === "up" ? "↑ Up" : summary.trend_direction === "down" ? "↓ Down" : "→ Stable"}
          change={summary.change_vs_prior_pct}
          direction={summary.trend_direction === "up" ? "up" : summary.trend_direction === "down" ? "down" : "stable"}
          status={summary.trend_direction === "up" ? "Improving" : summary.trend_direction === "down" ? "Critical" : "Stable"}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 5 * 0.05 }}>
        <KpiCard
          label="Total Entries"
          value={summary.entry_count.toLocaleString()}
          status="Stable"
        />
      </motion.div>
    </div>
  );
}
