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
import type { PaceDailyPoint } from "../../api/hooks";
import TrendChartCard from "./TrendChartCard";
import { format, parseISO } from "date-fns";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Filler);

interface Props {
  data: PaceDailyPoint[] | undefined;
  isLoading: boolean;
  onViewDetails?: () => void;
  trend?: "up" | "down" | "stable" | null;
  trendLabel?: string;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function LoadPaceChart({ data, isLoading, onViewDetails, trend, trendLabel }: Props) {
  return (
    <TrendChartCard
      title="Load Pace"
      subtitle="Average load duration per day"
      isLoading={isLoading}
      isEmpty={!isLoading && (!data || data.length === 0)}
      onViewDetails={onViewDetails}
      trend={trend}
      trendLabel={trendLabel}
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
                  label: "Avg load time",
                  data: data.map((d) => d.avg_seconds),
                  backgroundColor: data.map((d) => {
                    if (d.avg_seconds <= 120) return "rgba(34, 197, 94, 0.6)";
                    if (d.avg_seconds <= 240) return "rgba(245, 158, 11, 0.6)";
                    return "rgba(239, 68, 68, 0.6)";
                  }),
                  borderColor: data.map((d) => {
                    if (d.avg_seconds <= 120) return "#22c55e";
                    if (d.avg_seconds <= 240) return "#f59e0b";
                    return "#ef4444";
                  }),
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
                      return pt ? `${pt.load_count} loads` : "";
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
