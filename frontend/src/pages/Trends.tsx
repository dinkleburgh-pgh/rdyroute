import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useAuditAnomalies,
  useAuditByRoute,
  useAuditByTruck,
  useAuditDailyTrend,
  useCompletionTrend,
  useCycleTimeTrend,
  useLoadPaceTrend,
  useQualityRate,
  useRouteSwapLog,
  useShortageByItem,
  useShortageByTruck,
  useShortageDailyTrend,
  useShortageSummary,
  useTrendComparison,
  useTrendSummary,
  useTruckAnomalies,
  useUnloadTrend,
  useWearersTrend,
} from "../api/hooks";
import "../components/trends/chartSetup";
import TrendsHeader from "../components/trends/TrendsHeader";
import TrendTabBar from "../components/trends/TrendTabBar";
import KpiSection from "../components/trends/KpiSection";
import KpiCard from "../components/trends/KpiCard";
import DailyVolumeChart from "../components/trends/DailyVolumeChart";
import ComparisonChart from "../components/trends/ComparisonChart";
import TopNCard from "../components/trends/TopNCard";
import RouteCoverageTable from "../components/trends/RouteCoverageTable";
import InsightsPanel from "../components/trends/InsightsPanel";
import LoadPaceChart from "../components/trends/LoadPaceChart";
import CompletionRateChart from "../components/trends/CompletionRateChart";
import WearersChart from "../components/trends/WearersChart";
import CycleTimeChart from "../components/trends/CycleTimeChart";
import UnloadChart from "../components/trends/UnloadChart";
import ShortageVolumeChart from "../components/trends/ShortageVolumeChart";
import ShortageKpiSection from "../components/trends/ShortageKpiSection";
import QualityRateCard from "../components/trends/QualityRateCard";
import AnomalyPanel from "../components/trends/AnomalyPanel";
import { useItemDisplayName } from "../components/shorts/HierarchyPicker";

function fmtPace(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtDwell(s: number | null): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Trends() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const itemDisplayName = useItemDisplayName();
  const tab = params.get("tab") || "overview";
  const daysParam = Number(params.get("days"));
  const days = [7, 14, 30, 90].includes(daysParam) ? daysParam : 14;
  // The coverage log follows the SAME window as every other metric — it used to
  // ratchet up to 30/90 days and silently stay there after narrowing the filter.
  const swapDays = days;

  const { data: summary, isLoading: summaryLoading } = useTrendSummary(days, days);
  const { data: comparison, isLoading: comparisonLoading } = useTrendComparison(days);
  const { data: daily, isLoading: dailyLoading } = useAuditDailyTrend(days);
  const { data: byTruck, isLoading: byTruckLoading } = useAuditByTruck(days);
  const { data: byRoute, isLoading: byRouteLoading } = useAuditByRoute(days);
  const { data: swapLog = [], isLoading: swapLoading } = useRouteSwapLog(swapDays);
  const { data: paceData, isLoading: paceLoading } = useLoadPaceTrend(days);
  const { data: completionData, isLoading: completionLoading } = useCompletionTrend(days);
  const { data: unloadData, isLoading: unloadLoading } = useUnloadTrend(days);
  const { data: wearersData, isLoading: wearersLoading } = useWearersTrend(days);
  const { data: cycleData, isLoading: cycleLoading } = useCycleTimeTrend(days);
  const { data: shortageDaily, isLoading: shortageDailyLoading } = useShortageDailyTrend(days);
  const { data: shortageByItem, isLoading: shortageByItemLoading } = useShortageByItem(days);
  const { data: shortageByTruck, isLoading: shortageByTruckLoading } = useShortageByTruck(days);
  const { data: shortageSummary, isLoading: shortageSummaryLoading } = useShortageSummary(days, days);
  const { data: qualityRate, isLoading: qualityRateLoading } = useQualityRate(days, days);
  const { data: truckAnomalies, isLoading: truckAnomaliesLoading } = useTruckAnomalies(90);
  const { data: auditAnomalies, isLoading: auditAnomaliesLoading } = useAuditAnomalies(90);

  function setDays(d: number) {
    const next = new URLSearchParams(params);
    if (d === 14) next.delete("days");
    else next.set("days", String(d));
    setParams(next, { replace: true });
  }

  const topTrucks = useMemo(() => {
    const totals = new Map<number, number>();
    (byTruck ?? []).forEach((r) =>
      totals.set(r.truck_number, (totals.get(r.truck_number) ?? 0) + r.total_qty),
    );
    return [...totals.entries()]
      .map(([truck_number, total_qty]) => ({ truck_number, total_qty }))
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 10)
      .map((t) => ({ label: `#${t.truck_number}`, value: t.total_qty }));
  }, [byTruck]);

  const topItems = useMemo(() => {
    const totals = new Map<string, number>();
    (byTruck ?? []).forEach((r) =>
      totals.set(r.item_label, (totals.get(r.item_label) ?? 0) + r.total_qty),
    );
    return [...totals.entries()]
      .map(([item_label, total_qty]) => ({ item_label, total_qty }))
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 10)
      // Group by the stored label (the stable key), display it qualified.
      .map((t) => ({ label: itemDisplayName(t.item_label), value: t.total_qty }));
  }, [byTruck, itemDisplayName]);

  const topRoutes = useMemo(() => {
    const totals = new Map<number, number>();
    (byRoute ?? []).forEach((r) =>
      totals.set(r.route, (totals.get(r.route) ?? 0) + r.total_qty),
    );
    return [...totals.entries()]
      .map(([route, total_qty]) => ({ route, total_qty }))
      .sort((a, b) => b.total_qty - a.total_qty)
      .slice(0, 10)
      .map((t) => ({ label: `Route ${t.route}`, value: t.total_qty }));
  }, [byRoute]);

  const topShortageItems = useMemo(() => {
    return (shortageByItem ?? [])
      .map((r) => ({ label: r.label, value: r.total_qty }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [shortageByItem]);

  const topShortageTrucks = useMemo(() => {
    return (shortageByTruck ?? [])
      .slice(0, 10)
      .map((r) => ({
        label: `#${r.truck_number}`,
        value: r.total_qty,
        subtitle: `${r.entry_count} ${r.entry_count === 1 ? "item" : "items"} shorted`,
      }));
  }, [shortageByTruck]);

  // Window-wide roll-ups for the Load & Unload KPI row (weighted by day counts,
  // matching how TrendDetail computes its averages).
  const loadOps = useMemo(() => {
    const paceRows = paceData ?? [];
    const timedLoads = paceRows.reduce((s, r) => s + r.load_count, 0);
    const paceAvg = timedLoads
      ? paceRows.reduce((s, r) => s + r.avg_seconds * r.load_count, 0) / timedLoads
      : null;
    const compRows = completionData ?? [];
    const rosterTotal = compRows.reduce((s, r) => s + r.total_trucks, 0);
    const rosterLoaded = compRows.reduce((s, r) => s + r.loaded_trucks, 0);
    const completionPct = rosterTotal ? (rosterLoaded / rosterTotal) * 100 : null;
    const unloadRows = unloadData ?? [];
    const unloads = unloadRows.reduce((s, r) => s + r.unloaded_trucks, 0);
    const dwellRows = unloadRows.filter((r) => r.avg_dwell_seconds != null);
    const dwellAvg = dwellRows.length
      ? dwellRows.reduce((s, r) => s + (r.avg_dwell_seconds as number), 0) / dwellRows.length
      : null;
    return { paceAvg, timedLoads, completionPct, rosterLoaded, rosterTotal, unloads, dwellAvg };
  }, [paceData, completionData, unloadData]);

  function computeTrend(values: number[] | undefined): "up" | "down" | "stable" | null {
    if (!values || values.length < 4) return null;
    // Equal halves — for an odd count drop the middle point so neither half is
    // longer (a longer second half biased every trend toward "up").
    const half = Math.floor(values.length / 2);
    const first = values.slice(0, half).reduce((s, v) => s + v, 0);
    const second = (values.length % 2 === 0 ? values.slice(half) : values.slice(half + 1)).reduce((s, v) => s + v, 0);
    if (first === 0) return null;
    const change = ((second - first) / first) * 100;
    if (change > 5) return "up";
    if (change < -5) return "down";
    return "stable";
  }

  const paceTrend = computeTrend(paceData?.map((d) => d.avg_seconds));
  const completionTrend = computeTrend(completionData?.map((d) => d.pct));
  const cycleTrend = computeTrend(cycleData?.map((d) => d.avg_seconds));
  const wearersTrend = computeTrend(wearersData?.map((d) => d.avg_wearers));

  function setTab(id: string) {
    const next = new URLSearchParams(params);
    if (id === "overview") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  }

  function viewDetails(metric: string) {
    navigate(`/trends/${metric}?days=${days}`);
  }

  return (
    <div className="space-y-4 p-3 md:p-6">
      <TrendsHeader
        days={days}
        onChangeDays={setDays}
        summary={summary}
        isLoading={summaryLoading}
      />

      <TrendTabBar active={tab} onChange={setTab} />

      {tab === "overview" && (
        <>
          <KpiSection
            summary={summary}
            isLoading={summaryLoading}
            swapCount={swapLog.length}
            days={days}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <QualityRateCard data={qualityRate} isLoading={qualityRateLoading} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <DailyVolumeChart data={daily} isLoading={dailyLoading} onViewDetails={() => viewDetails("volume")} />
            </div>
            <div>
              <InsightsPanel
                summary={summary}
                topTrucks={topTrucks}
                topRoutes={topRoutes}
                swapCount={swapLog.length}
                swapDays={swapDays}
                isLoading={summaryLoading}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TopNCard
              title="Top Trucks"
              subtitle="Highest total quantity removed"
              rows={topTrucks}
              isLoading={byTruckLoading}
            />
            <TopNCard
              title="Top Items"
              subtitle="Most frequently removed items"
              rows={topItems}
              accentColor="bg-violet-500"
              isLoading={byTruckLoading}
            />
            <TopNCard
              title="Top Routes"
              subtitle="Routes with highest volume"
              rows={topRoutes}
              accentColor="bg-emerald-500"
              isLoading={byRouteLoading}
            />
          </div>

          <RouteCoverageTable data={swapLog} isLoading={swapLoading} days={swapDays} />
        </>
      )}

      {tab === "load-ops" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Avg Load Pace" value={fmtPace(loadOps.paceAvg)}>
              <span className="text-xs text-ink-faint">{loadOps.timedLoads.toLocaleString()} timed loads</span>
            </KpiCard>
            <KpiCard
              label="Completion"
              value={loadOps.completionPct != null ? `${loadOps.completionPct.toFixed(1)}%` : "—"}
            >
              <span className="text-xs text-ink-faint">
                {loadOps.rosterLoaded.toLocaleString()} of {loadOps.rosterTotal.toLocaleString()} roster loads
              </span>
            </KpiCard>
            <KpiCard label="Trucks Unloaded" value={loadOps.unloads.toLocaleString()}>
              <span className="text-xs text-ink-faint">across the window</span>
            </KpiCard>
            <KpiCard label="Avg Yard Dwell" value={fmtDwell(loadOps.dwellAvg)}>
              <span className="text-xs text-ink-faint">arrival tap → unloaded</span>
            </KpiCard>
          </div>

          <ComparisonChart data={comparison} isLoading={comparisonLoading} onViewDetails={() => viewDetails("volume")} />

          <LoadPaceChart data={paceData} isLoading={paceLoading} onViewDetails={() => viewDetails("pace")} trend={paceTrend} trendLabel={paceTrend === "up" ? "Slowing" : paceTrend === "down" ? "Faster" : undefined} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CompletionRateChart data={completionData} isLoading={completionLoading} onViewDetails={() => viewDetails("completion")} trend={completionTrend} trendLabel={completionTrend === "up" ? "Improving" : completionTrend === "down" ? "Declining" : undefined} higherIsBetter />
            <CycleTimeChart data={cycleData} isLoading={cycleLoading} onViewDetails={() => viewDetails("cycle")} trend={cycleTrend} trendLabel={cycleTrend === "up" ? "Slowing" : cycleTrend === "down" ? "Faster" : undefined} />
          </div>

          <UnloadChart data={unloadData} isLoading={unloadLoading} />
        </>
      )}

      {tab === "shortages" && (
        <>
          <ShortageKpiSection summary={shortageSummary} isLoading={shortageSummaryLoading} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <ShortageVolumeChart data={shortageDaily} isLoading={shortageDailyLoading} onViewDetails={() => viewDetails("shortages")} trend={shortageSummary?.trend_direction === "down" ? "down" : shortageSummary?.trend_direction === "up" ? "up" : shortageSummary?.trend_direction === "stable" ? "stable" : null} trendLabel={shortageSummary?.trend_direction === "down" ? "Declining" : shortageSummary?.trend_direction === "up" ? "Rising" : undefined} />
            </div>
            <TopNCard
              title="Top Shortage Items"
              subtitle="Most shorted items"
              rows={topShortageItems}
              accentColor="bg-amber-500"
              isLoading={shortageByItemLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TopNCard
              title="Top Shorted Trucks"
              subtitle="Trucks that keep going out short"
              rows={topShortageTrucks}
              accentColor="bg-red-500"
              isLoading={shortageByTruckLoading}
            />
          </div>
        </>
      )}

      {tab === "staffing" && (
        <>
          <WearersChart data={wearersData} isLoading={wearersLoading} onViewDetails={() => viewDetails("wearers")} trend={wearersTrend} trendLabel={wearersTrend === "up" ? "More" : wearersTrend === "down" ? "Fewer" : undefined} />

          <AnomalyPanel
            truckAnomalies={truckAnomalies}
            auditAnomalies={auditAnomalies}
            isLoading={truckAnomaliesLoading || auditAnomaliesLoading}
          />
        </>
      )}
    </div>
  );
}
