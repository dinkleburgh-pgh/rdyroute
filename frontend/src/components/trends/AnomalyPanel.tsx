import { motion } from "framer-motion";
import type { AnomalyDay } from "../../api/hooks";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface Props {
  truckAnomalies: AnomalyDay[] | undefined;
  auditAnomalies: AnomalyDay[] | undefined;
  isLoading: boolean;
}

const METRIC_LABELS: Record<string, string> = {
  completion: "Completion rate",
  pace: "Load pace",
  wearers: "Avg wearers",
  audit_volume: "Audit volume",
};

export default function AnomalyPanel({ truckAnomalies, auditAnomalies, isLoading }: Props) {
  const allAnomalies = [...(truckAnomalies ?? []), ...(auditAnomalies ?? [])];

  if (isLoading) {
    return (
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Anomaly Scan</h3>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  // Positive confirmation instead of silently vanishing — "no news" IS the news.
  if (allAnomalies.length === 0) {
    return (
      <motion.div
        className="card border border-emerald-800/40 bg-emerald-950/10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-emerald-300">No Anomalies</h3>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Completion, load pace, wearers, and audit volume all stayed within 2
          standard deviations of their means over the last 90 days.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="card border border-red-800/40 bg-red-950/10"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <h3 className="text-sm font-semibold text-red-300">Anomalies Detected</h3>
        <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-bold text-red-400">
          {allAnomalies.length}
        </span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Days where a metric strayed more than 2 standard deviations from its mean —
        always scanned over the last 90 days, independent of the range filter.
      </p>
      <div className="space-y-1.5">
        {allAnomalies.map((a, i) => {
          const isHigh = a.value > a.mean;
          const direction = isHigh ? "+" : "";
          return (
            <div
              key={`${a.run_date}-${a.metric}-${i}`}
              className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-300">
                  {format(parseISO(a.run_date), "MMM d")}
                </span>
                <span className="text-slate-500">
                  {METRIC_LABELS[a.metric] ?? a.metric}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={isHigh ? "text-red-400" : "text-amber-400"}>
                  {direction}{a.value.toFixed(1)}
                </span>
                <span className="text-slate-600">vs</span>
                <span className="text-slate-500">
                  avg {a.mean.toFixed(1)}
                </span>
                <span className="rounded bg-slate-700/50 px-1 py-0.5 text-[10px] font-bold text-slate-400">
                  {a.z_score > 0 ? "+" : ""}{a.z_score.toFixed(1)}σ
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
