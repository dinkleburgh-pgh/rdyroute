import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  isLoading?: boolean;
  isEmpty?: boolean;
  children?: ReactNode;
  className?: string;
}

export default function TrendChartCard({
  title,
  subtitle,
  isLoading,
  isEmpty,
  children,
  className = "",
}: Props) {
  return (
    <motion.div className={`card ${className}`} whileHover={{ scale: 1.01 }}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
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
