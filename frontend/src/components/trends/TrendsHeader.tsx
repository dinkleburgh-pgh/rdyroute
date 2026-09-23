import { useMemo } from "react";
import type { TrendSummary } from "../../api/hooks";
import { DownloadIcon } from "../icons";
import PageHeader from "../PageHeader";

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
    <PageHeader
      title="Trends"
      meta={
        isLoading ? (
          <span
            title="Loading"
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
          />
        ) : undefined
      }
      actions={
        <>
          <div className="flex gap-0.5 rounded-lg border border-hairline bg-surface-2/60 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => onChangeDays(r.value)}
                className={
                  "rounded-md px-2 py-1 text-xs font-medium transition-all " +
                  (days === r.value
                    ? "bg-accent text-white shadow"
                    : "text-ink-muted hover:text-ink")
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
        </>
      }
    />
  );
}
