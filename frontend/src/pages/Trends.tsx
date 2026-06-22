import { useEffect, useMemo, useState } from "react";
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
  useShortageByCategory,
  useShortageDailyTrend,
  useShortageSummary,
  useTrendComparison,
  useTrendSummary,
  useTruckAnomalies,
  useWearersTrend,
} from "../api/hooks";
import "../components/trends/chartSetup";
import TrendsHeader from "../components/trends/TrendsHeader";
import TrendTabBar from "../components/trends/TrendTabBar";
import KpiSection from "../components/trends/KpiSection";
import DailyVolumeChart from "../components/trends/DailyVolumeChart";
import ComparisonChart from "../components/trends/ComparisonChart";
import TopNCard from "../components/trends/TopNCard";
import RouteCoverageTable from "../components/trends/RouteCoverageTable";
import InsightsPanel from "../components/trends/InsightsPanel";
import LoadPaceChart from "../components/trends/LoadPaceChart";
import CompletionRateChart from "../components/trends/CompletionRateChart";
import WearersChart from "../components/trends/WearersChart";
import CycleTimeChart from "../components/trends/CycleTimeChart";
import ShortageVolumeChart from "../components/trends/ShortageVolumeChart";
import ShortageKpiSection from "../components/trends/ShortageKpiSection";
import QualityRateCard from "../components/trends/QualityRateCard";
import AnomalyPanel from "../components/trends/AnomalyPanel";

export default function Trends() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get("tab") || "overview";
  const [days, setDays] = useState(14);
  const [swapDays, setSwapDays] = useState(30);

  const { data: summary, isLoading: summaryLoading } = useTrendSummary(days, days);
  const { data: comparison, isLoading: comparisonLoading } = useTrendComparison(days);
  const { data: daily, isLoading: dailyLoading } = useAuditDailyTrend(days);
  const { data: byTruck } = useAuditByTruck(days);
  const { data: byRoute } = useAuditByRoute(days);
  const { data: swapLog = [], isLoading: swapLoading } = useRouteSwapLog(swapDays);
  const { data: paceData, isLoading: paceLoading } = useLoadPaceTrend(days);
  const { data: completionData, isLoading: completionLoading } = useCompletionTrend(days);
  const { data: wearersData, isLoading: wearersLoading } = useWearersTrend(days);
  const { data: cycleData, isLoading: cycleLoading } = useCycleTimeTrend(days);
  const { data: shortageDaily, isLoading: shortageDailyLoading } = useShortageDailyTrend(days);
  const { data: shortageByCat } = useShortageByCategory(days);
  const { data: shortageSummary, isLoading: shortageSummaryLoading } = useShortageSummary(days, days);
  const { data: qualityRate, isLoading: qualityRateLoading } = useQualityRate(days, days);
  const { data: truckAnomalies } = useTruckAnomalies(90);
  const { data: auditAnomalies } = useAuditAnomalies(90);

  useEffect(() => {
    if (swapDays < days) setSwapDays(days);
  }, [days, swapDays]);

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
      .map((t) => ({ label: t.item_label, value: t.total_qty }));
  }, [byTruck]);

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
    return (shortageByCat ?? [])
      .map((r) => ({ label: r.category, value: r.total_qty }))
      .sort((a, b) => b.value - a.value);
  }, [shortageByCat]);

    function computeTrend(values: number[] | undefined): "up" | "down" | "stable" | null {
    if (!values || values.length < 4) return null;
    const nums = values;
    const mid = Math.floor(nums.length / 2);
    const first = nums.slice(0, mid).reduce((s, v) => s + v, 0);
    const second = nums.slice(mid).reduce((s, v) => s + v, 0);
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
    navigate(`/trends/${metric}`);
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
          <KpiSection summary={summary} isLoading={summaryLoading} />

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
            />
            <TopNCard
              title="Top Items"
              subtitle="Most frequently removed items"
              rows={topItems}
              accentColor="bg-violet-500"
            />
            <TopNCard
              title="Top Routes"
              subtitle="Routes with highest volume"
              rows={topRoutes}
              accentColor="bg-emerald-500"
            />
          </div>

          <RouteCoverageTable data={swapLog} isLoading={swapLoading} />
        </>
      )}

      {tab === "load-ops" && (
        <>
          <ComparisonChart data={comparison} isLoading={comparisonLoading} onViewDetails={() => viewDetails("volume")} />

          <LoadPaceChart data={paceData} isLoading={paceLoading} onViewDetails={() => viewDetails("pace")} trend={paceTrend} trendLabel={paceTrend === "up" ? "Slowing" : paceTrend === "down" ? "Faster" : undefined} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CompletionRateChart data={completionData} isLoading={completionLoading} onViewDetails={() => viewDetails("completion")} trend={completionTrend} trendLabel={completionTrend === "up" ? "Improving" : completionTrend === "down" ? "Declining" : undefined} />
            <CycleTimeChart data={cycleData} isLoading={cycleLoading} onViewDetails={() => viewDetails("cycle")} trend={cycleTrend} trendLabel={cycleTrend === "up" ? "Slowing" : cycleTrend === "down" ? "Faster" : undefined} />
          </div>
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
              subtitle="Most shorted categories"
              rows={topShortageItems}
              accentColor="bg-amber-500"
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
            isLoading={false}
          />
        </>
      )}
    </div>
  );
}
