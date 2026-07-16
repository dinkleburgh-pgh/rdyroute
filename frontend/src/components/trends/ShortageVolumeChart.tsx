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
import type { ShortageDailyPoint } from "../../api/hooks";
import TrendChartCard from "./TrendChartCard";
import { format, parseISO } from "date-fns";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Filler);

interface Props {
  data: ShortageDailyPoint[] | undefined;
  isLoading: boolean;
  onViewDetails?: () => void;
  trend?: "up" | "down" | "stable" | null;
  trendLabel?: string;
}

export default function ShortageVolumeChart({ data, isLoading, onViewDetails, trend, trendLabel }: Props) {
  return (
    <TrendChartCard
      title="Shortages"
      subtitle="Shortage items reported per day"
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
                  label: "Shortages",
                  data: data.map((d) => d.total_qty),
                  backgroundColor: "rgba(245, 158, 11, 0.5)",
                  borderColor: "#f59e0b",
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
                    label: (ctx) => `${ctx.parsed.y} items`,
                    afterLabel: (ctx) => {
                      const pt = data[ctx.dataIndex];
                      return pt ? `${pt.entry_count} entries` : "";
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
