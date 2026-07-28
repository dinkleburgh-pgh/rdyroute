import { useMemo } from "react";
import type { TrendSummary } from "../../api/hooks";
import { DownloadIcon } from "../icons";
import PageHeader from "../PageHeader";

const RANGES = [
  { label: "7d", mobileLabel: "7 days", value: 7 },
  { label: "14d", mobileLabel: "14 days", value: 14 },
  { label: "30d", mobileLabel: "1 month", value: 30 },
  { label: "90d", mobileLabel: "3 months", value: 90 },
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
    <>
    <PageHeader
      eyebrow="Analytics"
      title="Trends"
      subtitle={`Discrepancy tracking and operational performance over the last ${days} days.`}
      actions={
        <>
          {isLoading && (
            <span className="flex items-center justify-center gap-1.5 text-xs text-ink-faint md:justify-end">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              Loading...
            </span>
          )}

          <div className="flex gap-1 rounded-lg border border-hairline bg-surface-2/60 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => onChangeDays(r.value)}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-all " +
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

      {/* Mobile-only range filter — the desktop selector above lives in
          PageHeader's actions, which are hidden below md. Same four ranges as
          desktop so switching viewports never strands the selection. */}
      <div className="flex gap-1 rounded-lg border border-hairline bg-surface-2/60 p-1 md:hidden">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => onChangeDays(r.value)}
            className={
              "flex-1 rounded-md px-1 py-2 text-xs font-medium transition-all " +
              (days === r.value
                ? "bg-accent text-white shadow"
                : "text-ink-muted hover:text-ink")
            }
          >
            {r.mobileLabel}
          </button>
        ))}
      </div>
    </>
  );
}
