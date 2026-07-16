import { motion } from "framer-motion";
import { Line } from "react-chartjs-2";
import type { QualityRateSummary } from "../../api/hooks";
import KpiCard from "./KpiCard";

interface Props {
  data: QualityRateSummary | undefined;
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
              borderColor: "#22c55e",
              backgroundColor: "rgba(34,197,94,0.1)",
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

export default function QualityRateCard({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="card animate-pulse">
        <div className="mb-2 h-3 w-20 rounded bg-slate-800" />
        <div className="mb-1 h-7 w-16 rounded bg-slate-800" />
        <div className="h-3 w-24 rounded bg-slate-800" />
      </div>
    );
  }

  if (!data) return null;

  const series = data.daily_series ?? [];
  const values = series.map((d) => d.items_per_truck ?? 0);
  const value = data.avg_items_per_truck?.toFixed(2) ?? "—";

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <KpiCard
        label="Avg Items per Truck"
        value={value}
        change={data.change_vs_prior_pct}
        direction={
          data.trend_direction === "up"
            ? "up"
            : data.trend_direction === "down"
              ? "down"
              : "stable"
        }
        status={
          data.trend_direction === "down"
            ? "Improving"
            : data.trend_direction === "up"
              ? "Critical"
              : "Stable"
        }
      >
        {values.length > 0 && <MiniSparkline data={values} />}
        <span className="mt-1 block text-[10px] text-slate-500">
          Lower = better delivery quality
        </span>
      </KpiCard>
    </motion.div>
  );
}