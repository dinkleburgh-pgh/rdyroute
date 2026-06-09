import { useEffect, useMemo, useState } from "react";
import {
  useAuditAnomalies,
  useAuditByRoute,
  useAuditByTruck,
  useAuditDailyTrend,
  useCompletionTrend,
  useCycleTimeTrend,
  useLoadPaceTrend,
  useRouteSwapLog,
  useShortageByCategory,
  useShortageDailyTrend,
  useTrendComparison,
  useTrendSummary,
  useTruckAnomalies,
  useWearersTrend,
} from "../api/hooks";
import "../components/trends/chartSetup";
import TrendsHeader from "../components/trends/TrendsHeader";
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
import AnomalyPanel from "../components/trends/AnomalyPanel";

export default function Trends() {
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
  const { data: truckAnomalies } = useTruckAnomalies(90);
  const { data: auditAnomalies } = useAuditAnomalies(90);

  // Sync swapDays when days changes (swap range should be >= trend range)
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

  return (
    <div className="space-y-4 p-3 md:p-6">
      <TrendsHeader
        days={days}
        onChangeDays={setDays}
        summary={summary}
        isLoading={summaryLoading}
      />

      <KpiSection summary={summary} isLoading={summaryLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyVolumeChart data={daily} isLoading={dailyLoading} />
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

      <ComparisonChart data={comparison} isLoading={comparisonLoading} />

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

      {/* ── Load Operations ──────────────────────────────────────────────── */}

      <LoadPaceChart data={paceData} isLoading={paceLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CompletionRateChart data={completionData} isLoading={completionLoading} />
        <CycleTimeChart data={cycleData} isLoading={cycleLoading} />
      </div>

      {/* ── Shortages ────────────────────────────────────────────────────── */}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <ShortageVolumeChart data={shortageDaily} isLoading={shortageDailyLoading} />
        </div>
        <TopNCard
          title="Top Shortage Items"
          subtitle="Most shorted categories"
          rows={topShortageItems}
          accentColor="bg-amber-500"
        />
      </div>

      {/* ── Staffing ─────────────────────────────────────────────────────── */}

      <WearersChart data={wearersData} isLoading={wearersLoading} />

      {/* ── Anomalies ────────────────────────────────────────────────────── */}

      <AnomalyPanel
        truckAnomalies={truckAnomalies}
        auditAnomalies={auditAnomalies}
        isLoading={false}
      />
    </div>
  );
}
