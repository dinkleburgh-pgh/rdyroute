import { useState, useMemo, type FormEvent } from "react";
import clsx from "clsx";
import {
  auditPhotoFileUrl,
  useAuditByRoute,
  useAuditEntries,
  useAuditPhotos,
  useBoard,
  useCreateAuditEntry,
  useDeleteAuditPhoto,
  useTrackedItems,
  useUploadAuditPhoto,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import type { TruckWithState } from "../types";

export default function Audit() {
  const [runDate, setRunDate] = useState(todayIso());
  const { data: board } = useBoard(runDate);
  const { data: entries } = useAuditEntries(runDate);
  const { data: trackedItems } = useTrackedItems();
  const { data: topItems } = useAuditByRoute(7);
  const create = useCreateAuditEntry();

  // Group tracked items by category for display
  const groupedItems = useMemo(() => {
    const cats = new Map<string, typeof trackedItems>();
    for (const item of trackedItems ?? []) {
      const cat = item.category ?? "General";
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat)!.push(item);
    }
    return [...cats.entries()];
  }, [trackedItems]);

  const [selectedTruck, setSelectedTruck] = useState<TruckWithState | null>(null);
  const [note, setNote] = useState("");
  const [warnNext, setWarnNext] = useState(false);
  const [routeOverride, setRouteOverride] = useState("");
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Build a set of truck numbers that have at least one entry today
  const trucksWithEntries = new Set((entries ?? []).map((e) => e.truck_number));

  // Active trucks from board, excluding OOS/spare/off
  const activeStatuses = new Set(["dirty", "in_progress", "unloaded", "loaded"]);
  const activeTrucks = (board ?? []).filter(
    (t) => t.state && activeStatuses.has(t.state.status),
  );

  // When a truck is selected, its entries for today
  const truckEntries = selectedTruck
    ? (entries ?? []).filter((e) => e.truck_number === selectedTruck.truck_number)
    : [];

  // Top 5 items by total qty across all routes last 7 days
  const topSummary = [...(topItems ?? [])]
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, 5);

  async function logItem(label: string, qtyDefault: number) {
    if (!selectedTruck) return;
    await create.mutateAsync({
      truck_number: selectedTruck.truck_number,
      run_date: runDate,
      item_label: label,
      quantity: qtyDefault,
      note,
      warn_on_next_load: warnNext,
      ...(routeOverride ? { route_override: Number(routeOverride) } : {}),
    });
    setLastAdded(label);
    setNote("");
    setWarnNext(false);
  }

  function selectTruck(t: TruckWithState) {
    setSelectedTruck(t);
    setRouteOverride(t.state?.oos_spare_route?.toString() ?? "");
    setNote("");
    setWarnNext(false);
    setLastAdded(null);
  }

  function goBack() {
    setSelectedTruck(null);
    setLastAdded(null);
  }

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">Audit</h2>
        <input
          className="input"
          type="date"
          value={runDate}
          onChange={(e) => { setRunDate(e.target.value); setSelectedTruck(null); }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        {/* Sidebar: Top Removed Items */}
        <aside className="card space-y-2 self-start">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Top Removed Items
          </p>
          <p className="text-[11px] text-slate-500">Last 7 days</p>
          {topSummary.length === 0 && (
            <p className="text-xs text-slate-500">No data.</p>
          )}
          {topSummary.map((row, i) => (
            <div key={`${row.route}-${row.item_label}`} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-[11px] font-semibold text-slate-500 w-4 shrink-0">
                #{i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-200 truncate">{row.item_label}</p>
                <p className="text-[11px] text-slate-500">Route: {row.route}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-slate-300">
                Qty {row.total_qty}
              </span>
            </div>
          ))}
        </aside>

        {/* Main area */}
        <div className="space-y-4">
          {selectedTruck === null ? (
            /* Truck Grid */
            <div className="card space-y-3">
              <p className="text-sm font-semibold text-slate-300">
                Select a truck to log items
              </p>
              {activeTrucks.length === 0 && (
                <p className="text-sm text-slate-500">No active trucks for this date.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {activeTrucks.map((t) => {
                  const hasEntries = trucksWithEntries.has(t.truck_number);
                  return (
                    <button
                      key={t.truck_number}
                      type="button"
                      onClick={() => selectTruck(t)}
                      className={clsx(
                        "flex h-14 w-16 flex-col items-center justify-center rounded-lg text-sm font-bold transition",
                        hasEntries
                          ? "bg-green-700 text-white hover:bg-green-600"
                          : "bg-slate-700 text-slate-200 hover:bg-slate-600",
                      )}
                    >
                      <span className="text-base">{t.truck_number}</span>
                      {hasEntries && (
                        <span className="text-[10px] font-normal opacity-80">
                          {(entries ?? []).filter((e) => e.truck_number === t.truck_number).length}×
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                Green = has entries today · Grey = no entries yet
              </p>
            </div>
          ) : (
            /* Truck Detail */
            <div className="card space-y-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded px-2 py-1 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
                >
                  ← Back
                </button>
                <h3 className="text-lg font-semibold">Truck #{selectedTruck.truck_number}</h3>
                {lastAdded && (
                  <span className="rounded-full bg-green-800/60 px-2 py-0.5 text-xs text-green-300">
                    ✓ {lastAdded} logged
                  </span>
                )}
              </div>

              {/* Item buttons — grouped by category */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Select item to log
                </p>
                {groupedItems.length === 0 && (
                  <p className="text-sm text-slate-500">No tracked items configured.</p>
                )}
                {groupedItems.map(([cat, items]) => (
                  <div key={cat}>
                    {groupedItems.length > 1 && (
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {cat}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {(items ?? []).map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          disabled={create.isPending}
                          onClick={() => logItem(item.label, item.qty_default)}
                          className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-600 active:scale-95 disabled:opacity-50 transition"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Entry options */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  <span className="label">Route override</span>
                  <input
                    className="input w-full"
                    type="number"
                    placeholder={`${selectedTruck.truck_number}`}
                    value={routeOverride}
                    onChange={(e) => setRouteOverride(e.target.value)}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="label">Note (optional)</span>
                  <input
                    className="input w-full"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Applies to next logged item"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={warnNext}
                  onChange={(e) => setWarnNext(e.target.checked)}
                />
                Warn on next load
              </label>

              {/* Today's entries for this truck */}
              {truckEntries.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Today's entries — Truck #{selectedTruck.truck_number}
                  </p>
                  <div className="divide-y divide-slate-800 rounded border border-slate-700">
                    {truckEntries.map((e) => (
                      <div key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-200">{e.item_label}</span>
                        <span className="text-slate-500">×{e.quantity}</span>
                        {e.route_override && (
                          <span className="text-xs text-slate-500">route {e.route_override}</span>
                        )}
                        {e.warn_on_next_load && (
                          <span className="rounded-full bg-amber-700/50 px-1.5 py-0.5 text-[10px] text-amber-300">
                            warn
                          </span>
                        )}
                        {e.note && (
                          <span className="text-xs text-slate-500 italic truncate">{e.note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* All entries table for the day */}
          <div className="card overflow-x-auto p-0">
            <div className="px-3 py-2 border-b border-slate-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                All entries · {runDate}
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Truck</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Route</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Warn</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={7}>
                      No entries for this date.
                    </td>
                  </tr>
                )}
                {(entries ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-slate-800">
                    <td className="px-3 py-2 font-semibold">#{e.truck_number}</td>
                    <td className="px-3 py-2">{e.item_label}</td>
                    <td className="px-3 py-2">{e.quantity}</td>
                    <td className="px-3 py-2 text-slate-400">{e.route_override ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-400">{e.note || "—"}</td>
                    <td className="px-3 py-2">
                      {e.warn_on_next_load ? (
                        <span className="badge bg-amber-600">warn</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {new Date(e.recorded_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PhotosPanel runDate={runDate} selectedTruck={selectedTruck?.truck_number} />
    </div>
  );
}

function PhotosPanel({
  runDate,
  selectedTruck,
}: {
  runDate: string;
  selectedTruck?: number;
}) {
  const { user } = useAuth();
  const { data: photos, isLoading } = useAuditPhotos(runDate);
  const upload = useUploadAuditPhoto();
  const del = useDeleteAuditPhoto();
  const [truck, setTruck] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill truck from the selected truck in the main view
  const effectiveTruck = truck || (selectedTruck?.toString() ?? "");

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effectiveTruck || !file) {
      setError("Truck # and file are required.");
      return;
    }
    try {
      await upload.mutateAsync({
        truck_number: Number(effectiveTruck),
        run_date: runDate,
        file,
        caption,
        uploaded_by: user?.username ?? "",
      });
      setFile(null);
      setCaption("");
      (document.getElementById("audit-photo-file") as HTMLInputElement | null)?.value &&
        ((document.getElementById("audit-photo-file") as HTMLInputElement).value = "");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Upload failed.";
      setError(msg);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-300">Audit photos · {runDate}</h3>
      <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="label">Truck #</span>
          <input
            type="number"
            className="input w-20"
            value={truck}
            placeholder={selectedTruck?.toString() ?? ""}
            onChange={(e) => setTruck(e.target.value)}
          />
        </label>
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="label">Caption</span>
          <input
            className="input w-full"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="optional"
          />
        </label>
        <label className="text-sm">
          <span className="label">File (≤10MB)</span>
          <input
            id="audit-photo-file"
            type="file"
            accept="image/*"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn-primary" disabled={upload.isPending}>
          Upload
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {isLoading && <p className="text-xs text-slate-500">Loading photos…</p>}
      {!isLoading && (photos ?? []).length === 0 && (
        <p className="text-xs text-slate-500">No photos for this day.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {(photos ?? []).map((p) => (
          <figure
            key={p.id}
            className="overflow-hidden rounded border border-slate-800 bg-slate-950"
          >
            <a href={auditPhotoFileUrl(p.id)} target="_blank" rel="noreferrer">
              <img
                src={auditPhotoFileUrl(p.id)}
                alt={p.caption || p.file_name}
                loading="lazy"
                className="h-32 w-full object-cover"
              />
            </a>
            <figcaption className="space-y-1 p-2 text-[11px] text-slate-400">
              <p className="font-semibold text-slate-200">
                #{p.truck_number}
                {p.uploaded_by ? ` · ${p.uploaded_by}` : ""}
              </p>
              {p.caption && <p className="line-clamp-2">{p.caption}</p>}
              <button
                type="button"
                className="text-red-400 hover:text-red-300"
                onClick={() => {
                  if (confirm("Delete this photo?")) del.mutate(p.id);
                }}
              >
                Delete
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

