import { useMemo, useState } from "react";
import { ClipboardList, AlertTriangle } from "lucide-react";
import { useAuditEntries, useShortages, useTrackedItems } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { aggregateByCategory, catalogIndex, type CategoryAgg, type RawEntry } from "../../utils/itemUnits";
import CategoryCard from "./CategoryCard";

/**
 * Daily standup snapshot — what came off the trucks today, grouped by category
 * and shown in real units (cases / bags / bundles) + pieces. No cross-category
 * "total items" number: rolls of paper are never summed with apron pieces.
 */
export default function SnapshotPanel() {
  const [runDate, setRunDate] = useState(todayIso());
  const { data: catalog } = useTrackedItems();
  const { data: auditEntries, isLoading: auditLoading } = useAuditEntries(runDate);
  const { data: shortages, isLoading: shortLoading } = useShortages(runDate);

  const index = useMemo(() => catalogIndex(catalog), [catalog]);

  const removedCats = useMemo(() => {
    const entries: RawEntry[] = (auditEntries ?? []).map((e) => ({ label: e.item_label, quantity: e.quantity }));
    return aggregateByCategory(entries, index);
  }, [auditEntries, index]);

  const shortageCats = useMemo(() => {
    const entries: RawEntry[] = (shortages ?? []).map((s) => ({
      label: s.item_detail,
      quantity: s.quantity,
      fallbackCategory: s.item_category,
    }));
    return aggregateByCategory(entries, index);
  }, [shortages, index]);

  const isToday = runDate === todayIso();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Daily Snapshot</h2>
          <p className="text-xs text-slate-500">
            {isToday ? "Today" : runDate} · grouped by category, shown in their own units
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={runDate}
            max={todayIso()}
            onChange={(e) => setRunDate(e.target.value || todayIso())}
            className="input text-sm"
          />
          {!isToday && (
            <button className="btn-ghost text-xs" onClick={() => setRunDate(todayIso())}>
              Today
            </button>
          )}
        </div>
      </div>

      <Section
        title="Removed"
        subtitle="Pulled off trucks (audit)"
        icon={<ClipboardList className="h-4 w-4 text-blue-400" />}
        cats={removedCats}
        loading={auditLoading}
        accent="bg-blue-500"
      />

      <Section
        title="Shortages"
        subtitle="Logged short on the dock"
        icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
        cats={shortageCats}
        loading={shortLoading}
        accent="bg-amber-500"
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  cats,
  loading,
  accent,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  cats: CategoryAgg[];
  loading: boolean;
  accent: string;
}) {
  const totalEntries = cats.reduce((s, c) => s + c.entryCount, 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <span className="text-xs text-slate-500">· {subtitle}</span>
        {!loading && cats.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">
            {cats.length} categor{cats.length !== 1 ? "ies" : "y"} · {totalEntries} entr{totalEntries !== 1 ? "ies" : "y"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-slate-800 bg-slate-900" />
          ))}
        </div>
      ) : cats.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
          Nothing logged for this day.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <CategoryCard key={c.key} cat={c} accent={accent} defaultOpen={cats.length <= 3} />
          ))}
        </div>
      )}
    </section>
  );
}
