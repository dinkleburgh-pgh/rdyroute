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
import type { UnloadDailyPoint } from "../../api/hooks";
import TrendChartCard from "./TrendChartCard";
import { format, parseISO } from "date-fns";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Filler);

interface Props {
  data: UnloadDailyPoint[] | undefined;
  isLoading: boolean;
  trend?: "up" | "down" | "stable" | null;
  trendLabel?: string;
}

function fmtDwell(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function UnloadChart({ data, isLoading, trend, trendLabel }: Props) {
  const hasAny = !!data && data.some((d) => d.unloaded_trucks > 0 || d.arrived_trucks > 0);
  return (
    <TrendChartCard
      title="Unload Throughput"
      subtitle="Trucks unloaded per day — hover for arrivals and arrival→unload dwell"
      isLoading={isLoading}
      isEmpty={!isLoading && !hasAny}
      trend={trend}
      trendLabel={trendLabel}
    >
      {data && hasAny && (
        <motion.div className="h-64" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Bar
            data={{
              labels: data.map((d) => format(parseISO(d.run_date), "MMM d")),
              datasets: [
                {
                  label: "Trucks unloaded",
                  data: data.map((d) => d.unloaded_trucks),
                  backgroundColor: "rgba(34, 197, 94, 0.5)",
                  borderColor: "#22c55e",
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
                    label: (ctx) => `${ctx.parsed.y ?? 0} unloaded`,
                    afterLabel: (ctx) => {
                      const pt = data[ctx.dataIndex];
                      if (!pt) return "";
                      const lines = [`${pt.arrived_trucks} arrivals tapped`];
                      if (pt.avg_dwell_seconds != null) {
                        lines.push(`avg dwell ${fmtDwell(pt.avg_dwell_seconds)}`);
                      }
                      return lines.join("\n");
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
                  ticks: { color: "#64748b", font: { size: 11 }, precision: 0 },
                },
              },
            }}
          />
        </motion.div>
      )}
    </TrendChartCard>
  );
}
