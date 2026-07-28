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

  // Pair the halves BY POSITION (1st day of prior half vs 1st day of current
  // half, etc.) so the two bars at each x actually compare. Charting both on a
  // shared date axis just read as one long timeline in two colours.
  const n = Math.max(current.length, prior.length);
  const idx = Array.from({ length: n }, (_, i) => i);
  const fmt = (d?: string) => (d ? format(parseISO(d), "MMM d") : null);

  return (
    <TrendChartCard
      title="Period Comparison"
      subtitle="First half vs second half of the window, paired day-by-day"
      isLoading={isLoading}
      isEmpty={!isLoading && current.length === 0 && prior.length === 0}
      onViewDetails={onViewDetails}
    >
      {n > 0 && (
        <motion.div className="h-56" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Bar
            data={{
              labels: idx.map((i) => `Day ${i + 1}`),
              datasets: [
                {
                  label: "Prior half",
                  data: idx.map((i) => prior[i]?.total_qty ?? null),
                  backgroundColor: "rgba(100, 116, 139, 0.4)",
                  borderColor: "#64748b",
                  borderWidth: 1,
                  borderRadius: 3,
                },
                {
                  label: "Current half",
                  data: idx.map((i) => current[i]?.total_qty ?? null),
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
                  callbacks: {
                    // Each bar shows the real calendar date it represents.
                    label: (ctx) => {
                      const src = ctx.datasetIndex === 0 ? prior : current;
                      const d = fmt(src[ctx.dataIndex]?.run_date);
                      const qty = ctx.parsed.y ?? 0;
                      return d ? `${ctx.dataset.label}: ${qty} (${d})` : `${ctx.dataset.label}: ${qty}`;
                    },
                  },
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
