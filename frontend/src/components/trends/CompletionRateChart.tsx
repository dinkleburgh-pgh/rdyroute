import { motion } from "framer-motion";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { CompletionDailyPoint } from "../../api/hooks";
import TrendChartCard from "./TrendChartCard";
import { format, parseISO } from "date-fns";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler);

interface Props {
  data: CompletionDailyPoint[] | undefined;
  isLoading: boolean;
}

export default function CompletionRateChart({ data, isLoading }: Props) {
  return (
    <TrendChartCard
      title="Completion Rate"
      subtitle="% of scheduled trucks loaded per day"
      isLoading={isLoading}
      isEmpty={!isLoading && (!data || data.length === 0)}
    >
      {data && data.length > 0 && (
        <motion.div className="h-64" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Line
            data={{
              labels: data.map((d) => {
                const dt = parseISO(d.run_date);
                return format(dt, "MMM d");
              }),
              datasets: [
                {
                  label: "Completion %",
                  data: data.map((d) => d.pct),
                  borderColor: "#3b82f6",
                  backgroundColor: "rgba(59, 130, 246, 0.1)",
                  fill: true,
                  tension: 0.3,
                  pointRadius: 3,
                  pointBackgroundColor: "#3b82f6",
                  borderWidth: 2,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: "#1e293b",
                  titleColor: "#f1f5f9",
                  bodyColor: "#cbd5e1",
                  borderColor: "#334155",
                  borderWidth: 1,
                  padding: 10,
                  callbacks: {
                    label: (ctx) => `${ctx.parsed.y}%`,
                    afterLabel: (ctx) => {
                      const pt = data[ctx.dataIndex];
                      return pt ? `${pt.loaded_trucks} / ${pt.total_trucks} trucks` : "";
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
                  max: 100,
                  grid: { color: "rgba(148,163,184,0.08)" },
                  ticks: {
                    color: "#64748b",
                    font: { size: 11 },
                    callback: (v) => `${v}%`,
                  },
                },
              },
            }}
          />
        </motion.div>
      )}
    </TrendChartCard>
  );
}
