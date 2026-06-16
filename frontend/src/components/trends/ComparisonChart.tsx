import { motion } from "framer-motion";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { TrendComparison } from "../../api/hooks";
import TrendChartCard from "./TrendChartCard";
import { format, parseISO } from "date-fns";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Filler);

interface Props {
  data: TrendComparison | undefined;
  isLoading: boolean;
  onViewDetails?: () => void;
}

export default function ComparisonChart({ data, isLoading, onViewDetails }: Props) {
  const current = data?.current ?? [];
  const prior = data?.prior ?? [];

  const labels = Array.from(
    new Set([...prior, ...current].map((d) => d.run_date)),
  ).sort();

  return (
    <TrendChartCard
      title="Period Comparison"
      subtitle="Current vs prior period — daily audit volume"
      isLoading={isLoading}
      isEmpty={!isLoading && current.length === 0 && prior.length === 0}
      onViewDetails={onViewDetails}
    >
      {labels.length > 0 && (
        <motion.div className="h-56" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Bar
            data={{
              labels: labels.map((d) => {
                const dt = parseISO(d);
                return format(dt, "MMM d");
              }),
              datasets: [
                {
                  label: "Prior period",
                  data: labels.map(
                    (l) => prior.find((p) => p.run_date === l)?.total_qty ?? 0,
                  ),
                  backgroundColor: "rgba(100, 116, 139, 0.4)",
                  borderColor: "#64748b",
                  borderWidth: 1,
                  borderRadius: 3,
                },
                {
                  label: "Current period",
                  data: labels.map(
                    (l) => current.find((c) => c.run_date === l)?.total_qty ?? 0,
                  ),
                  backgroundColor: "rgba(59, 130, 246, 0.6)",
                  borderColor: "#3b82f6",
                  borderWidth: 1,
                  borderRadius: 3,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: "top",
                  labels: { color: "#94a3b8", boxWidth: 12, padding: 12, font: { size: 11 } },
                },
                tooltip: {
                  backgroundColor: "#1e293b",
                  titleColor: "#f1f5f9",
                  bodyColor: "#cbd5e1",
                  borderColor: "#334155",
                  borderWidth: 1,
                  padding: 10,
                },
              },
              scales: {
                x: {
                  grid: { color: "rgba(148,163,184,0.08)" },
                  ticks: { color: "#64748b", maxRotation: 45, font: { size: 11 } },
                },
                y: {
                  beginAtZero: true,
                  grid: { color: "rgba(148,163,184,0.08)" },
                  ticks: { color: "#64748b", font: { size: 11 } },
                },
              },
            }}
          />
        </motion.div>
      )}
    </TrendChartCard>
  );
}
