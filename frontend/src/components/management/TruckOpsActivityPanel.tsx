import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { api } from "../../api/client";
import { useActivityEvents } from "../../api/hooks";
import ActivityEventCard from "../activity/ActivityEventCard";
import { groupActivityEvents, ActivityGroup } from "../activity/TruckActivityTimeline";
import { useToast } from "../../contexts/ToastContext";

const FAMILY_FILTERS = [
  { id: "", label: "All" },
  { id: "state", label: "State" },
  { id: "batch", label: "Batch" },
  { id: "coverage", label: "Coverage" },
  { id: "setup", label: "Setup" },
  { id: "recovery", label: "Recovery" },
  { id: "system", label: "System" },
];

const PAGE_SIZE = 25;

export default function TruckOpsActivityPanel({
  initialTruckNumber,
  initialRunDate,
}: {
  initialTruckNumber?: number | null;
  initialRunDate?: string | null;
}) {
  const toast = useToast();
  const [runDate, setRunDate] = useState(initialRunDate ?? "");
  const [truckInput, setTruckInput] = useState(initialTruckNumber ? String(initialTruckNumber) : "");
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState("");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setRunDate(initialRunDate ?? "");
  }, [initialRunDate]);

  useEffect(() => {
    setTruckInput(initialTruckNumber ? String(initialTruckNumber) : "");
  }, [initialTruckNumber]);

  useEffect(() => {
    setOffset(0);
  }, [runDate, truckInput, search, family]);

  const truckNumber = useMemo(() => {
    const parsed = Number(truckInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [truckInput]);

  const { data, isLoading, isFetching } = useActivityEvents({
    runDate: runDate || undefined,
    truckNumber,
    eventFamily: family || undefined,
    q: search || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = offset + items.length;

  async function downloadExport() {
    setExporting(true);
    try {
      const response = await api.get("/exports/activity-events.json", {
        params: {
          run_date: runDate || undefined,
          truck_number: truckNumber,
          event_family: family || undefined,
          q: search || undefined,
        },
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity-events-${runDate || "all"}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Activity export downloaded.");
    } catch {
      toast.error("Could not download activity export.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="rounded-xl border border-hairline bg-surface/70 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">History & activity</h3>
              <p className="mt-1 text-sm text-ink-muted">
                Append-only truck and operations history for debugging, accountability, and workflow tracing.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadExport}
              disabled={exporting}
              className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm font-medium text-ink transition hover:bg-track disabled:opacity-60"
            >
              {exporting ? "Exporting…" : "Export JSON"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {FAMILY_FILTERS.map((option) => (
              <button
                key={option.id || "all"}
                type="button"
                onClick={() => setFamily(option.id)}
                className={clsx(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  family === option.id
                    ? "bg-blue-600 text-white"
                    : "bg-surface-2 text-ink-muted hover:text-ink-soft",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Run date</span>
              <input
                type="date"
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Truck</span>
              <input
                value={truckInput}
                onChange={(e) => setTruckInput(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 51"
                className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Summary, username, truck…"
                className="w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:w-[320px] lg:grid-cols-1">
          <div className="rounded-xl border border-hairline bg-surface/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Visible events</p>
            <p className="mt-1 text-3xl font-black text-white">{total}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {isFetching && !isLoading ? "Refreshing filters…" : "Newest first, append-only history."}
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Current page</p>
            <p className="mt-1 text-2xl font-black text-white">
              {pageStart}–{pageEnd}
            </p>
            <p className="mt-1 text-sm text-ink-muted">Shows {items.length} event(s) at a time.</p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Quick note</p>
            <p className="mt-1 text-sm text-ink-soft">
              Batch, coverage, setup, and recovery actions include structured context plus truck-state deltas when present.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {total === 0 ? "No activity matches these filters." : `Showing ${pageStart}–${pageEnd} of ${total} events`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0}
            className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink-soft transition hover:bg-track disabled:opacity-50"
          >
            Newer
          </button>
          <button
            type="button"
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={pageEnd >= total}
            className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink-soft transition hover:bg-track disabled:opacity-50"
          >
            Older
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-hairline bg-surface/70 p-6 text-sm text-ink-muted">
          Loading activity…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface/40 p-8 text-center text-sm text-ink-muted">
          No truck or operations activity has been recorded for the current filters yet.
        </div>
      ) : (
        <div className="space-y-3">
          {groupActivityEvents(items).map((item) =>
            "events" in item && item.events.length > 1 ? (
              <ActivityGroup key={item.key} group={item} compact={false} />
            ) : "events" in item ? (
              <ActivityEventCard key={item.events[0].id} event={item.events[0]} />
            ) : (
              <ActivityEventCard key={item.id} event={item} />
            )
          )}
        </div>
      )}
    </div>
  );
}
