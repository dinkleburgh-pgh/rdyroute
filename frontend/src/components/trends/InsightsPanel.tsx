import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  ClipboardList,
  Repeat2,
  Route,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";
import type { TrendSummary } from "../../api/hooks";

interface Props {
  summary: TrendSummary | undefined;
  topTrucks: { label: string; value: number }[];
  topRoutes: { label: string; value: number }[];
  swapCount: number;
  swapDays: number;
  isLoading: boolean;
}

export default function InsightsPanel({
  summary,
  topTrucks,
  topRoutes,
  swapCount,
  swapDays,
  isLoading,
}: Props) {
  if (isLoading) {
    return (
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Operational Insights</h3>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-3 w-3/4 rounded bg-slate-800" />
              <div className="h-2 w-1/2 rounded bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const insights: Array<{ icon: LucideIcon; iconClass: string; iconBg: string; title: string; body: string }> = [];

  // Peak day insight
  if (summary.peak_day) {
    insights.push({
      icon: TrendingUp,
      iconClass: "text-blue-400",
      iconBg: "bg-blue-900/30",
      title: "Peak Activity",
      body: `Peak day was ${summary.peak_day} with ${summary.peak_qty.toLocaleString()} items removed — ${summary.entry_count} entries logged.`,
    });
  }

  // Trend direction insight — fewer removals = improvement
  if (summary.trend_direction === "down" && summary.change_vs_prior_pct != null) {
    insights.push({
      icon: TrendingDown,
      iconClass: "text-emerald-400",
      iconBg: "bg-emerald-900/30",
      title: "Discrepancies Decreasing",
      body: `Items removed decreased ${Math.abs(summary.change_vs_prior_pct).toFixed(1)}% vs the prior period — more items delivered.`,
    });
  } else if (summary.trend_direction === "up" && summary.change_vs_prior_pct != null) {
    insights.push({
      icon: BarChart3,
      iconClass: "text-red-400",
      iconBg: "bg-red-900/30",
      title: "Discrepancies Increasing",
      body: `Items removed increased ${Math.abs(summary.change_vs_prior_pct).toFixed(1)}% compared to the prior period — fewer items delivered.`,
    });
  }

  // Top truck insight
  if (topTrucks.length > 0) {
    const t = topTrucks[0];
    insights.push({
      icon: Truck,
      iconClass: "text-violet-400",
      iconBg: "bg-violet-900/30",
      title: "Highest Volume Truck",
      body: `${t.label} leads with ${t.value.toLocaleString()} total items removed over the selected period.`,
    });
  }

  // Top route insight
  if (topRoutes.length > 0) {
    const r = topRoutes[0];
    insights.push({
      icon: Route,
      iconClass: "text-amber-400",
      iconBg: "bg-amber-900/30",
      title: "Busiest Route",
      body: `${r.label} accounts for ${r.value.toLocaleString()} items removed — the highest of any route.`,
    });
  }

  // Coverage insight
  if (swapCount > 0) {
    insights.push({
      icon: Repeat2,
      iconClass: "text-cyan-400",
      iconBg: "bg-cyan-900/30",
      title: "Route Coverage",
      body: `${swapCount} route coverage events logged in the last ${swapDays} days.`,
    });
  }

  // Average daily insight
  if (summary.days_with_data > 0) {
    const aboveAvg = summary.daily_series.filter((d) => d.total_qty > summary.avg_per_day).length;
    if (aboveAvg > 0) {
      insights.push({
        icon: ClipboardList,
        iconClass: "text-slate-400",
        iconBg: "bg-slate-800",
        title: "Above-Average Days",
        body: `${aboveAvg} of ${summary.days_with_data} days exceeded the daily average of ${summary.avg_per_day.toFixed(1)} items.`,
      });
    }
  }

  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-slate-200">Operational Insights</h3>
      <p className="mb-3 text-xs text-slate-500">What changed? Key observations from your data.</p>
      {insights.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">
          Not enough data in this range to draw observations yet.
        </p>
      )}
      <div className="space-y-2.5">
        {insights.map((insight, i) => {
          const Icon = insight.icon;
          return (
            <div key={i} className="flex gap-2.5 rounded-lg border border-slate-800/60 bg-slate-900/50 p-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${insight.iconBg}`}
              >
                <Icon className={`h-4 w-4 ${insight.iconClass}`} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200">{insight.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{insight.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
