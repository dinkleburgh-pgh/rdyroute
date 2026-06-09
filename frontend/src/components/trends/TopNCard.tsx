import { motion } from "framer-motion";

interface Row {
  label: string;
  value: number;
  subtitle?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  rows: Row[];
  accentColor?: string;
}

export default function TopNCard({ title, subtitle, rows, accentColor = "bg-blue-500" }: Props) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>

      {rows.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">No data in this range.</p>
      )}

      <ul className="space-y-2">
        {rows.map((r, i) => (
          <motion.li key={r.label} className="group" whileHover={{ scale: 1.01 }}>
            <div className="mb-0.5 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-500">
                  {i + 1}
                </span>
                <span className="truncate text-sm text-slate-300 group-hover:text-slate-100">
                  {r.label}
                </span>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-100">
                {r.value.toLocaleString()}
              </span>
            </div>
            {r.subtitle && (
              <p className="mb-0.5 truncate pl-7 text-[11px] text-slate-500">{r.subtitle}</p>
            )}
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${accentColor}`}
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
