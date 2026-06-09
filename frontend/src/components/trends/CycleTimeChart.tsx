import { motion } from "framer-motion";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { CycleDailyPoint } from "../../api/hooks";
import TrendChartCard from "./TrendChartCard";
import { format, parseISO } from "date-fns";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Filler);

interface Props {
  data: CycleDailyPoint[] | undefined;
  isLoading: boolean;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function CycleTimeChart({ data, isLoading }: Props) {
  return (
    <TrendChartCard
      title="Cycle Time"
      subtitle="Avg time trucks spent in load workflow per day"
      isLoading={isLoading}
      isEmpty={!isLoading && (!data || data.length === 0)}
    >
      {data && data.length > 0 && (
        <motion.div className="h-64" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Bar
            data={{
              labels: data.map((d) => {
                const dt = parseISO(d.run_date);
                return format(dt, "MMM d");
              }),
              datasets: [
                {
                  label: "Avg cycle time",
                  data: data.map((d) => d.avg_seconds),
                  backgroundColor: "rgba(20, 184, 166, 0.5)",
                  borderColor: "#14b8a6",
                  borderWidth: 1,
                  borderRadius: 3,
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
                    label: (ctx) => `${fmtDuration(ctx.parsed.y ?? 0)}`,
                    afterLabel: (ctx) => {
                      const pt = data[ctx.dataIndex];
                      return pt ? `${pt.truck_count} trucks` : "";
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
                  ticks: {
                    color: "#64748b",
                    font: { size: 11 },
                    callback: (v) => fmtDuration(Number(v)),
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
