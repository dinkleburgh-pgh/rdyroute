/**
 * RouteSwapModal — standalone route swap management dialog.
 *
 * Shows all current swaps for today with one-click delete,
 * and an add-swap form with smart truck grouping.
 *
 * Accessible from the sidebar "Route Swap" button.
 */
import { useState, useMemo } from "react";
import { todayIso } from "../api/client";
import { useBoard, useSpareAssignments, useAssignSpare, useDeleteSpare, useHolidayLoad, useRouteSwapLog, useSettings, useUpsertSetting } from "../api/hooks";
import { workdayNumbers } from "./Clock";
import { effectiveStatus, isScheduledOff } from "../utils/truckStatus";
import type { TruckWithState, SpareAssignment, RecurringRouteSwap } from "../types";

const DAY_ABBR = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];

// ---- component -------------------------------------------------------------

interface Props {
  onClose: () => void;
}

export default function RouteSwapModal({ onClose }: Props) {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: allSpareAssignments = [], isLoading: swapsLoading } = useSpareAssignments(runDate);
  const swaps = useMemo(() => allSpareAssignments.filter((s) => !s.returned), [allSpareAssignments]);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { loadDay } = workdayNumbers();

  const assignSpare = useAssignSpare();
  const deleteSpare = useDeleteSpare();
  const { data: swapLog = [] } = useRouteSwapLog(60);

  // Per route_truck: ordered list of the last 2 distinct load_on_truck values used historically
  const recentCoverageFor = useMemo(() => {
    const map = new Map<number, number[]>();
    // log is newest-first from API; iterate to collect up to 2 distinct per route
    const sorted = [...swapLog].sort(
      (a, b) => new Date(b.run_date).getTime() - new Date(a.run_date).getTime(),
    );
    for (const entry of sorted) {
      const list = map.get(entry.route_truck) ?? [];
      if (!list.includes(entry.load_on_truck)) {
        list.push(entry.load_on_truck);
        map.set(entry.route_truck, list);
      }
    }
    // Trim to max 2
    map.forEach((v, k) => map.set(k, v.slice(0, 2)));
    return map;
  }, [swapLog]);

  const [routeTruck, setRouteTruck] = useState("");
  const [loadOnTruck, setLoadOnTruck] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [oosLoadOns, setOosLoadOns] = useState<Record<number, string>>({});

  // Recurring rules — stored in the `recurring_route_swaps` app setting.
  const { data: settings = [] } = useSettings();
  const upsertSetting = useUpsertSetting();
  const recurringRules = useMemo<RecurringRouteSwap[]>(() => {
    const row = settings.find((s) => s.key === "recurring_route_swaps");
    return Array.isArray(row?.value) ? (row!.value as RecurringRouteSwap[]) : [];
  }, [settings]);
  const [ruleRoute, setRuleRoute] = useState("");
  const [ruleLoadOn, setRuleLoadOn] = useState("");
  const [ruleDays, setRuleDays] = useState<Set<number>>(new Set());
  const [ruleError, setRuleError] = useState<string | null>(null);

  function saveRules(next: RecurringRouteSwap[]) {
    upsertSetting.mutate({ key: "recurring_route_swaps", value: next });
  }
  function toggleRuleDay(d: number) {
    setRuleDays((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d); else n.add(d);
      return n;
    });
  }
  function addRule() {
    const rt = parseInt(ruleRoute, 10);
    const lo = parseInt(ruleLoadOn, 10);
    if (isNaN(rt) || isNaN(lo)) { setRuleError("Select both trucks."); return; }
    if (rt === lo) { setRuleError("Route and Load On must be different."); return; }
    if (ruleDays.size === 0) { setRuleError("Pick at least one day."); return; }
    setRuleError(null);
    const days = [...ruleDays].sort((a, b) => a - b);
    // One rule per route truck — replace any existing rule for the same route.
    const next = [
      ...recurringRules.filter((r) => r.route_truck !== rt),
      { route_truck: rt, load_on_truck: lo, days },
    ];
    saveRules(next);
    setRuleRoute(""); setRuleLoadOn(""); setRuleDays(new Set());
  }
  function removeRule(idx: number) {
    saveRules(recurringRules.filter((_, i) => i !== idx));
  }

  // Sets for quick lookups
  const swapRouteSet = new Set(swaps.map((s) => s.covering_route_truck));
  const swapLoadOnSet = new Set(swaps.map((s) => s.spare_truck_number));

  // OOS trucks with no swap yet — shown as prefill rows.
  // Only include trucks that actually run on the load day (not scheduled off).
  const unswappedOos = [...board]
    .filter((t) =>
      t.truck_type !== "Spare" &&
      effectiveStatus(t, loadDay, holidayLoad) === "oos" &&
      !swapRouteSet.has(t.truck_number) &&
      (holidayLoad || !isScheduledOff(t, loadDay)),
    )
    .sort((a, b) => a.truck_number - b.truck_number);

  async function addOosSwap(routeTruckNum: number, loadOnTruckNum: number) {
    try {
      await assignSpare.mutateAsync({ run_date: runDate, spare_truck_number: loadOnTruckNum, covering_route_truck: routeTruckNum });
      setOosLoadOns((prev) => { const n = { ...prev }; delete n[routeTruckNum]; return n; });
    } catch (err: unknown) {
      console.error("OOS swap save failed", err);
    }
  }

  // Sorted truck lists
  const sorted = [...board].sort((a, b) => a.truck_number - b.truck_number);

  // Route Truck options: non-spare trucks that run on the load day
  const routeOptions = sorted.filter(
    (t) =>
      t.truck_type !== "Spare" &&
      (holidayLoad || !isScheduledOff(t, loadDay)),
  );

  // Load On options: all trucks (grouped), including OOS trucks
  const spares        = sorted.filter((t) => t.truck_type === "Spare");
  const offTrucks     = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "off");
  // OOS trucks whose route is already covered are especially good candidates
  const oosRouteless  = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swapRouteSet.has(t.truck_number));
  const oosUncovered  = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swapRouteSet.has(t.truck_number));
  const otherTrucks   = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "off" && effectiveStatus(t, loadDay, holidayLoad) !== "oos");

  // Board truck map for quick label lookup
  const boardByNum = useMemo(() => new Map(board.map((t) => [t.truck_number, t])), [board]);

  function loadOnLabel(truckNum: number, forRouteTruck?: number): string {
    const t = boardByNum.get(truckNum);
    const alreadyCovering = swapLoadOnSet.has(truckNum);
    const isSuggested = forRouteTruck !== undefined && (recentCoverageFor.get(forRouteTruck) ?? []).includes(truckNum);
    const prefix = isSuggested ? "★ " : alreadyCovering ? "⚠ " : "";
    if (!t) return `${prefix}#${truckNum}`;
    if (t.truck_type === "Spare") return `${prefix}#${truckNum} — Spare`;
    const eff = effectiveStatus(t, loadDay, holidayLoad);
    if (eff === "off") return `${prefix}#${truckNum} — Off`;
    if (eff === "oos") return `${prefix}#${truckNum} — OOS${swapRouteSet.has(truckNum) ? " / route covered" : ""}`;
    if (alreadyCovering) return `${prefix}#${truckNum} — already covering a route`;
    return `${prefix}#${truckNum}`;
  }

  /** Render a full Load On <select> body for a given context route truck */
  function LoadOnOptions({ forRoute }: { forRoute?: number }) {
    const suggestions = forRoute ? (recentCoverageFor.get(forRoute) ?? []) : [];
    const suggestedTrucks = suggestions
      .map((n) => boardByNum.get(n))
      .filter((t): t is typeof board[0] => t !== undefined);
    return (
      <>
        {suggestedTrucks.length > 0 && (
          <optgroup label="★ Recently used for this route">
            {suggestedTrucks.map((t) => (
              <option key={t.truck_number} value={t.truck_number}>
                {loadOnLabel(t.truck_number, forRoute)}
              </option>
            ))}
          </optgroup>
        )}
        {spares.length > 0 && (
          <optgroup label="Spare trucks">
            {spares.map((t) => (
              <option key={t.truck_number} value={t.truck_number}>
                {loadOnLabel(t.truck_number, forRoute)}
              </option>
            ))}
          </optgroup>
        )}
        {offTrucks.length > 0 && (
          <optgroup label="Off today">
            {offTrucks.map((t) => (
              <option key={t.truck_number} value={t.truck_number}>
                {loadOnLabel(t.truck_number, forRoute)}
              </option>
            ))}
          </optgroup>
        )}
        {oosRouteless.length > 0 && (
          <optgroup label="OOS — route covered (available)">
            {oosRouteless.map((t) => (
              <option key={t.truck_number} value={t.truck_number}>
                {loadOnLabel(t.truck_number, forRoute)}
              </option>
            ))}
          </optgroup>
        )}
        {oosUncovered.length > 0 && (
          <optgroup label="OOS — route uncovered">
            {oosUncovered.map((t) => (
              <option key={t.truck_number} value={t.truck_number}>
                {loadOnLabel(t.truck_number, forRoute)}
              </option>
            ))}
          </optgroup>
        )}
        {otherTrucks.length > 0 && (
          <optgroup label="Route trucks">
            {otherTrucks.map((t) => (
              <option key={t.truck_number} value={t.truck_number}>
                {loadOnLabel(t.truck_number, forRoute)}
              </option>
            ))}
          </optgroup>
        )}
      </>
    );
  }

  async function handleAdd() {
    const rt = parseInt(routeTruck);
    const lo = parseInt(loadOnTruck);
    if (isNaN(rt) || isNaN(lo)) { setError("Select both trucks."); return; }
    if (rt === lo) { setError("Route truck and load-on truck must be different."); return; }
    setError(null);
    try {
      await assignSpare.mutateAsync({ run_date: runDate, spare_truck_number: lo, covering_route_truck: rt });
      setRouteTruck("");
      setLoadOnTruck("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "Failed to save swap.");
    }
  }

  function handleDelete(s: SpareAssignment) {
    deleteSpare.mutate(s.id);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">Route Swaps</h2>
            <p className="text-xs text-slate-400">{runDate}</p>
          </div>
          <button
            className="rounded p-1 text-slate-500 hover:text-slate-200"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Current swaps */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Active swaps {swaps.length > 0 && <span className="ml-1 rounded-full bg-blue-800/60 px-2 py-0.5 text-blue-300">{swaps.length}</span>}
            </p>

            {/* OOS prefill rows */}
            {unswappedOos.length > 0 && (
              <div className="mb-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                  OOS — Select covering truck
                </p>
                {unswappedOos.map((t) => (
                  <div key={t.truck_number} className="flex items-center gap-2 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-2">
                    <span className="whitespace-nowrap text-sm font-bold text-amber-300">
                      #{t.truck_number} <span className="text-[10px] font-semibold text-amber-500">OOS</span>
                    </span>
                    <span className="text-sm text-slate-500">→</span>
                    <select
                      className="input flex-1 text-sm"
                      value={oosLoadOns[t.truck_number] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOosLoadOns((prev) => ({ ...prev, [t.truck_number]: val }));
                        if (val) addOosSwap(t.truck_number, parseInt(val));
                      }}
                    >
                      <option value="">— Load on —</option>
                      <LoadOnOptions forRoute={t.truck_number} />
                    </select>
                  </div>
                ))}
              </div>
            )}
            {swapsLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : swaps.length === 0 ? (
              <p className="rounded-md border border-slate-700 bg-slate-800/50 px-4 py-3 text-center text-sm text-slate-500">
                No swaps set for today.
              </p>
            ) : (
              <div className="space-y-2">
                {swaps.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="text-xl font-black text-red-400">#{s.covering_route_truck}</span>
                      <span className="text-base font-bold text-slate-500">→</span>
                      <span className="text-xl font-black text-blue-300">#{s.spare_truck_number}</span>
                      <span className="text-xs text-slate-500">covers route</span>
                    </div>
                    <button
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                      disabled={deleteSpare.isPending}
                      onClick={() => handleDelete(s)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Add swap form */}
          <section className="rounded-lg border border-sky-800/50 bg-sky-950/20 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">Add swap</p>

            <div className="grid grid-cols-2 items-end gap-3">
              {/* Route Truck selector */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-sky-400/80">
                  Route Truck
                  <span className="ml-1 hidden normal-case font-normal text-slate-500 sm:inline">(whose route?)</span>
                </label>
                <select
                  className="input w-full text-sm"
                  value={routeTruck}
                  onChange={(e) => { setRouteTruck(e.target.value); setError(null); }}
                >
                  <option value="">— select —</option>
                  {/* OOS trucks first */}
                  {routeOptions.filter((t) => effectiveStatus(t, loadDay, holidayLoad) === "oos").length > 0 && (
                    <optgroup label="OOS — needs covering">
                      {routeOptions
                        .filter((t) => effectiveStatus(t, loadDay, holidayLoad) === "oos")
                        .map((t) => (
                          <option key={t.truck_number} value={t.truck_number}>
                            #{t.truck_number} — OOS
                          </option>
                        ))}
                    </optgroup>
                  )}
                  <optgroup label="Route trucks">
                    {routeOptions
                      .filter((t) => effectiveStatus(t, loadDay, holidayLoad) !== "oos")
                      .map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number}{swapRouteSet.has(t.truck_number) ? " ✓ covered" : ""}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>

              {/* Load On selector */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-sky-400/80">
                  Load On
                  <span className="ml-1 hidden normal-case font-normal text-slate-500 sm:inline">(who loads it?)</span>
                </label>
                <select
                  className="input w-full text-sm"
                  value={loadOnTruck}
                  onChange={(e) => { setLoadOnTruck(e.target.value); setError(null); }}
                >
                  <option value="">— select —</option>
                  <LoadOnOptions forRoute={routeTruck ? parseInt(routeTruck) : undefined} />
                </select>
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <button
              className="btn-primary w-full"
              disabled={!routeTruck || !loadOnTruck || assignSpare.isPending}
              onClick={handleAdd}
            >
              {assignSpare.isPending ? "Saving…" : "Add Swap"}
            </button>
          </section>

          {/* Recurring rules */}
          <section className="rounded-lg border border-violet-800/50 bg-violet-950/20 p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Recurring rules</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Applied automatically when the board is set up for a matching load day.</p>
            </div>

            {recurringRules.length > 0 ? (
              <div className="space-y-1.5">
                {recurringRules.map((rule, idx) => (
                  <div key={`${rule.route_truck}-${idx}`} className="flex items-center gap-2 rounded-lg border border-violet-800/40 bg-slate-900/60 px-3 py-2">
                    <span className="text-base font-black text-violet-300">{rule.route_truck}</span>
                    <span className="text-sm font-bold text-slate-500">→</span>
                    <span className="text-base font-black text-slate-100">{rule.load_on_truck}</span>
                    <span className="ml-2 flex flex-wrap gap-1">
                      {[1, 2, 3, 4, 5].map((d) => (
                        <span
                          key={d}
                          className={
                            rule.days.includes(d)
                              ? "rounded bg-violet-500 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                              : "px-1.5 py-0.5 text-[10px] text-slate-600"
                          }
                        >
                          {DAY_ABBR[d][0]}
                        </span>
                      ))}
                    </span>
                    <button
                      className="ml-auto rounded px-2 py-1 text-xs text-red-500 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                      disabled={upsertSetting.isPending}
                      onClick={() => removeRule(idx)}
                      aria-label="Remove rule"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-violet-800/30 bg-slate-800/50 px-4 py-3 text-center text-xs text-slate-500">
                No recurring rules.
              </p>
            )}

            {/* Add rule form */}
            <div className="space-y-2 rounded-lg border border-violet-800/30 bg-slate-900/40 p-3">
              <div className="grid grid-cols-2 items-end gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-violet-400/80">Route</label>
                  <select className="input w-full text-sm" value={ruleRoute} onChange={(e) => { setRuleRoute(e.target.value); setRuleError(null); }}>
                    <option value="">— select —</option>
                    {sorted.filter((t) => t.truck_type !== "Spare").map((t) => (
                      <option key={t.truck_number} value={t.truck_number}>#{t.truck_number}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-violet-400/80">Load On</label>
                  <select className="input w-full text-sm" value={ruleLoadOn} onChange={(e) => { setRuleLoadOn(e.target.value); setRuleError(null); }}>
                    <option value="">— select —</option>
                    {sorted.map((t) => (
                      <option key={t.truck_number} value={t.truck_number}>#{t.truck_number}{t.truck_type === "Spare" ? " — Spare" : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] text-slate-500">Days:</span>
                {[1, 2, 3, 4, 5].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleRuleDay(d)}
                    className={
                      ruleDays.has(d)
                        ? "rounded-md bg-violet-500 px-2.5 py-1 text-xs font-semibold text-white"
                        : "rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    }
                  >
                    {DAY_ABBR[d]}
                  </button>
                ))}
              </div>
              {ruleError && (
                <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{ruleError}</p>
              )}
              <button
                className="w-full rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-600 disabled:opacity-40"
                disabled={!ruleRoute || !ruleLoadOn || ruleDays.size === 0 || upsertSetting.isPending}
                onClick={addRule}
              >
                {upsertSetting.isPending ? "Saving…" : "Add rule"}
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-5 py-3">
          <button className="btn-ghost w-full text-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
