import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface Props {
  label: string;
  value: string | number;
  change?: number | null;
  direction?: "up" | "down" | "stable";
  status?: "Improving" | "Stable" | "Watch" | "Critical";
  icon?: ReactNode;
  children?: ReactNode;
}

const STATUS_STYLES: Record<string, string> = {
  Improving: "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
  Stable: "bg-blue-900/40 text-blue-400 border-blue-700/40",
  Watch: "bg-amber-900/40 text-amber-400 border-amber-700/40",
  Critical: "bg-red-900/40 text-red-400 border-red-700/40",
};

export default function KpiCard({ label, value, change, direction, status, icon, children }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ scale: 1.02 }}
      className="card group relative flex flex-col gap-2 transition-shadow hover:shadow-lg hover:shadow-blue-900/10">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-slate-100">{value}</span>
        {change != null && (
          <span
            className={
              "flex items-center gap-0.5 text-xs font-semibold tabular-nums " +
              (change > 0
                ? "text-emerald-400"
                : change < 0
                  ? "text-red-400"
                  : "text-slate-400")
            }
          >
            {direction === "up" && (
              <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
            )}
            {direction === "down" && (
              <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
            )}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {status && (
          <span
            className={
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
              (STATUS_STYLES[status] ?? STATUS_STYLES.Stable)
            }
          >
            {status}
          </span>
        )}
      </div>

      {children && <div className="mt-1">{children}</div>}
    </motion.div>
  );
}
