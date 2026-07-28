import clsx from "clsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "load-ops", label: "Load & Unload" },
  { id: "shortages", label: "Shortages" },
  { id: "staffing", label: "Staffing & Anomalies" },
];

export default function TrendTabBar({
  active,
  onChange,
}: {
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="-mx-3 overflow-x-auto border-b border-hairline px-3 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={clsx(
              "whitespace-nowrap rounded-t-md px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm",
              active === tab.id
                ? "border-b-2 border-accent bg-surface-2/50 text-sky-300"
                : "text-ink-muted hover:bg-surface-2/40 hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
