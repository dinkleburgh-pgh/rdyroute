import { useMemo } from "react";
import type { TrendSummary } from "../../api/hooks";
import { DownloadIcon } from "../icons";

const RANGES = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

interface Props {
  days: number;
  onChangeDays: (d: number) => void;
  summary: TrendSummary | undefined;
  isLoading: boolean;
}

export default function TrendsHeader({ days, onChangeDays, summary, isLoading }: Props) {
  const csvContent = useMemo(() => {
    if (!summary?.daily_series?.length) return null;
    const header = "Date,Quantity,Entries";
    const rows = summary.daily_series.map(
      (d) => `${d.run_date},${d.total_qty},${d.entry_count}`,
    );
    return [header, ...rows].join("\n");
  }, [summary]);

  const handleExport = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trends-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black md:text-4xl">Trends</h2>
        <p className="mt-0.5 text-sm text-slate-400">
          Audit &amp; operational performance over the last{" "}
          <span className="font-semibold text-slate-200">{days} days</span>
        </p>
      </div>

      <div className="flex items-center gap-3">
        {isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Loading...
          </span>
        )}

        <div className="flex gap-1 rounded-lg bg-slate-900 p-0.5 ring-1 ring-slate-700/50">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => onChangeDays(r.value)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-all " +
                (days === r.value
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200")
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={!csvContent}
          className="btn-ghost gap-1.5 text-xs"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>
    </div>
  );
}
