import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  isLoading?: boolean;
  isEmpty?: boolean;
  children?: ReactNode;
  className?: string;
  onViewDetails?: () => void;
  trend?: "up" | "down" | "stable" | null;
  trendLabel?: string;
}

const TREND_STYLES: Record<string, string> = {
  up: "bg-red-900/40 text-red-400 border-red-700/40",
  down: "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
  stable: "bg-slate-800 text-slate-400 border-slate-700/40",
};

export default function TrendChartCard({
  title,
  subtitle,
  isLoading,
  isEmpty,
  children,
  className = "",
  onViewDetails,
  trend,
  trendLabel,
}: Props) {
  return (
    <motion.div className={`card ${className}`} whileHover={{ scale: 1.01 }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {trend && (
            <span className={"shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " + (TREND_STYLES[trend] ?? TREND_STYLES.stable)}>
              {trend === "up" ? "↑ " : trend === "down" ? "↓ " : "→ "}{trendLabel ?? (trend === "up" ? "Rising" : trend === "down" ? "Falling" : "Stable")}
            </span>
          )}
        </div>
        {onViewDetails && (
          <button
            onClick={onViewDetails}
            className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            Details &rarr;
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex h-48 items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Loading chart...
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-slate-500">No data available for this period.</p>
        </div>
      )}

      {!isLoading && !isEmpty && children}
    </motion.div>
  );
}
