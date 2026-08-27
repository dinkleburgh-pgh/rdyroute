/**
 * RouteSwapModal — standalone route swap management dialog.
 *
 * Shows all current swaps for today with one-click delete,
 * and an add-swap form with smart truck grouping.
 *
 * Accessible from the sidebar "Route Swap" button.
 */
import { useState, useMemo } from "react";
import clsx from "clsx";
import { todayIso } from "../api/client";
import { useBoard, useSpareAssignments, useAssignSpare, useDeleteSpare, useHolidayLoad, useLoadDayOverride, useRouteSwapLog, useRouteSwaps, useCreateRouteSwap, useDeleteRouteSwap, useSettings, useUpsertSetting, useUpsertTruckState } from "../api/hooks";
import { workdayNumbers } from "./Clock";
import { effectiveStatus, isScheduledOff } from "../utils/truckStatus";
import { formatRunDate } from "../utils/dates";
import type { TruckWithState, SpareAssignment, RecurringRouteSwap } from "../types";

const DAY_ABBR = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];

// ---- component -------------------------------------------------------------

interface Props {
  onClose: () => void;
  /** Accordion section to open on mount — the crossload notice bar lands
   *  straight on its pending list instead of the default Add swap form. */
  initialSection?: "add" | "crossload" | "recurring";
}

export default function RouteSwapModal({ onClose, initialSection = "add" }: Props) {
  const runDate = todayIso();
  const { data: board = [] } = useBoard(runDate);
  const { data: allSpareAssignments = [], isLoading: swapsLoading } = useSpareAssignments(runDate);
  const swaps = useMemo(() => allSpareAssignments.filter((s) => !s.returned), [allSpareAssignments]);
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const { loadDay: computedLoadDay } = workdayNumbers();
  const { data: loadDayOverride } = useLoadDayOverride(runDate);
  const loadDay = loadDayOverride ?? computedLoadDay;

  const assignSpare = useAssignSpare();
  const deleteSpare = useDeleteSpare();
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const { data: routeSwapRows = [] } = useRouteSwaps(runDate);
  // Active SPLIT loads — the route also runs; the helper carries overflow.
  const splitRows = useMemo(() => routeSwapRows.filter((r) => r.is_split), [routeSwapRows]);
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
  const [splitMode, setSplitMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oosLoadOns, setOosLoadOns] = useState<Record<number, string>>({});

  // Accordion: only one of Add swap / Recurring rules is open at a time.
  const [openSection, setOpenSection] = useState<"add" | "crossload" | "recurring" | null>(initialSection);
  const toggleSection = (s: "add" | "crossload" | "recurring") =>
    setOpenSection((prev) => (prev === s ? null : s));

  // ---- Crossload ---------------------------------------------------------
  // Two ways to resolve one: FLAG it (the freight still has to be moved by
  // hand, so the truck carries a "Needs crossloaded to #N" marker until it is)
  // or DO it now (hand the route straight to the other truck, same path the
  // Add-swap form uses). Both are per-run-date, like every other marker.
  const upsertState = useUpsertTruckState();
  const [xFrom, setXFrom] = useState("");
  const [xTo, setXTo] = useState("");
  /** What the emptied truck becomes once its freight has been moved off. */
  const [xFromStatus, setXFromStatus] = useState<"unloaded" | "oos" | "shop">("unloaded");
  const [xBusy, setXBusy] = useState(false);
  const [xError, setXError] = useState<string | null>(null);
  // Includes trucks flagged WITHOUT a destination — a loaded truck sent OOS
  // raises the need automatically, and this list is where someone comes to
  // decide which truck it rides.
  const flaggedCrossloads = useMemo(
    () => board.filter((t) => t.state?.crossload_to_truck != null || t.state?.needs_crossload)
                .sort((a, b) => a.truck_number - b.truck_number),
    [board],
  );

  async function setCrossloadFlag(truckNumber: number, target: number | null) {
    await upsertState.mutateAsync({
      truck_number: truckNumber,
      run_date: runDate,
      crossload_to_truck: target,
      // The need travels with the destination: naming one raises the flag,
      // clearing it drops the flag too — a truck that isn't being crossloaded
      // can't be going anywhere.
      needs_crossload: target != null,
    });
  }

  /**
   * Actually move the freight. One path, used by both the form's "Crossload
   * now" and a pending row's "Move now", so the two can't drift.
   *
   * The physical move has to be reflected in both trucks' statuses:
   *   - `to` receives the route (coverage) AND is now carrying it, so it ends
   *     up LOADED.
   *   - `from` has been emptied, so it ends up unloaded — or OOS/shop, which
   *     is usually why the freight had to move in the first place.
   *
   * assignSpare runs first because it carries the guards (duplicate cover,
   * self-cover) and already transfers load timings when the source truck was
   * mid-workflow; the explicit statuses below then cover the case where it
   * wasn't (a dirty or unloaded source still leaves `to` loaded).
   */
  async function performCrossload(from: number, to: number, fromStatus: "unloaded" | "oos" | "shop") {
    await assignSpare.mutateAsync({
      run_date: runDate,
      spare_truck_number: to,
      covering_route_truck: from,
    });
    await upsertState.mutateAsync({
      truck_number: to,
      run_date: runDate,
      status: "loaded",
    });
    await upsertState.mutateAsync({
      truck_number: from,
      run_date: runDate,
      status: fromStatus,
      crossload_to_truck: null,
      needs_crossload: false,
    });
  }

  async function handleCrossload(immediate: boolean) {
    const from = parseInt(xFrom);
    const to = parseInt(xTo);
    if (isNaN(from) || isNaN(to)) { setXError("Pick both trucks."); return; }
    if (from === to) { setXError("Pick two different trucks."); return; }
    setXError(null);
    setXBusy(true);
    try {
      if (immediate) {
        await performCrossload(from, to, xFromStatus);
      } else {
        await setCrossloadFlag(from, to);
      }
      setXFrom("");
      setXTo("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setXError(e?.response?.data?.detail ?? "Couldn't save the crossload.");
    } finally {
      setXBusy(false);
    }
  }

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

  async function saveRules(next: RecurringRouteSwap[]): Promise<boolean> {
    setRuleError(null);
    try {
      await upsertSetting.mutateAsync({ key: "recurring_route_swaps", value: next });
      return true;
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      setRuleError(
        err?.response?.status === 403
          ? "No permission to change recurring rules — needs an admin / fleet / supervisor account. NOT saved."
          : (err?.response?.data?.detail ?? "Couldn't save recurring rules — they were not persisted. Try again."),
      );
      return false;
    }
  }
  function toggleRuleDay(d: number) {
    setRuleDays((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d); else n.add(d);
      return n;
    });
  }
  async function addRule() {
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
    // Only clear the form once the rule is actually persisted — otherwise a
    // failed save would silently lose the entry ("getting removed").
    if (await saveRules(next)) {
      setRuleRoute(""); setRuleLoadOn(""); setRuleDays(new Set());
    }
  }
  function removeRule(idx: number) {
    void saveRules(recurringRules.filter((_, i) => i !== idx));
  }

  // Sets for quick lookups
  const swapRouteSet = new Set(swaps.map((s) => s.covering_route_truck));
  const swapLoadOnSet = new Set(swaps.map((s) => s.spare_truck_number));

  // OOS trucks with no swap yet — shown as prefill rows.
  // Only include trucks that actually run on the load day (not scheduled off).
  const unswappedOos = [...board]
    .filter((t) =>
      t.truck_type !== "Spare" &&
      (t.is_oos || effectiveStatus(t, loadDay, holidayLoad) === "oos") &&
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

  // Load On options: all trucks (grouped), including OOS trucks.
  // "Off today" is SCHEDULE-based (isScheduledOff on the load day), not the
  // board's display status — a scheduled-off truck that ran coverage or is
  // sitting mid-workflow (needs-check, loaded, …) is still free to carry a
  // route tomorrow, but effectiveStatus stops calling it "off" (#64, day 4).
  const spares        = sorted.filter((t) => t.truck_type === "Spare");
  const offTrucks     = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "oos" && !holidayLoad && isScheduledOff(t, loadDay));
  // OOS trucks whose route is already covered are especially good candidates
  const oosRouteless  = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && swapRouteSet.has(t.truck_number));
  const oosUncovered  = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) === "oos" && !swapRouteSet.has(t.truck_number));
  const otherTrucks   = sorted.filter((t) => t.truck_type !== "Spare" && effectiveStatus(t, loadDay, holidayLoad) !== "oos" && (holidayLoad || !isScheduledOff(t, loadDay)));

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
    if (eff === "oos") return `${prefix}#${truckNum} — OOS${swapRouteSet.has(truckNum) ? " / route covered" : ""}`;
    if (!holidayLoad && isScheduledOff(t, loadDay)) return `${prefix}#${truckNum} — Off`;
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
      if (splitMode) {
        // SPLIT: route rt ALSO runs — lo carries the overflow as an extra load.
        await createSwap.mutateAsync({ run_date: runDate, route_truck: rt, load_on_truck: lo, split: true });
      } else {
        await assignSpare.mutateAsync({ run_date: runDate, spare_truck_number: lo, covering_route_truck: rt });
      }
      setRouteTruck("");
      setLoadOnTruck("");
      setSplitMode(false);
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
            <p className="text-xs text-slate-400">{formatRunDate(runDate)}</p>
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
          {/* Needs Assignment — OOS routes with no covering truck yet */}
          {unswappedOos.length > 0 && (
            <section className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Needs Assignment</p>
                <span className="rounded-full bg-amber-700/50 px-2 py-0.5 text-[10px] font-bold text-amber-300">{unswappedOos.length}</span>
              </div>
              {unswappedOos.map((t) => (
                <div key={t.truck_number} className="flex items-center gap-2 rounded-md border border-amber-700/40 bg-slate-900/60 px-3 py-2">
                  <span className="whitespace-nowrap text-sm font-black text-amber-300">
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
                    <option value="">— Assign truck —</option>
                    <LoadOnOptions forRoute={t.truck_number} />
                  </select>
                </div>
              ))}
            </section>
          )}

          {/* Current swaps */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Active swaps {swaps.length > 0 && <span className="ml-1 rounded-full bg-blue-800/60 px-2 py-0.5 text-blue-300">{swaps.length}</span>}
            </p>

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

          {/* Active split loads */}
          {splitRows.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
                Split loads <span className="ml-1 rounded-full bg-amber-800/60 px-2 py-0.5 text-amber-300">{splitRows.length}</span>
              </p>
              <div className="space-y-2">
                {splitRows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="text-xl font-black text-amber-300">#{r.route_truck}</span>
                      <span className="text-base font-bold text-slate-500">+</span>
                      <span className="text-xl font-black text-blue-300">#{r.load_on_truck}</span>
                      <span className="text-xs text-slate-500">route runs on both trucks</span>
                    </div>
                    <button
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-slate-700 hover:text-red-300 disabled:opacity-40"
                      disabled={deleteSwap.isPending}
                      onClick={() => deleteSwap.mutate({ id: r.id, runDate })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Add swap form */}
          <section className="overflow-hidden rounded-lg border border-sky-800/50 bg-sky-950/20">
            <button
              type="button"
              onClick={() => toggleSection("add")}
              aria-expanded={openSection === "add"}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-sky-900/20"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-sky-300">Add swap</span>
              <span className={clsx("text-sky-400/70 transition-transform", openSection === "add" && "rotate-90")}>▸</span>
            </button>
            {openSection === "add" && (
            <div className="space-y-3 px-4 pb-4">
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

            <label className="flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={splitMode}
                onChange={(e) => { setSplitMode(e.target.checked); setError(null); }}
              />
              <span className="text-xs text-amber-200">
                <span className="font-semibold">Split load</span> — the route truck STILL runs its route;
                the second truck carries the overflow as an extra load. Very rare (oversized routes).
              </span>
            </label>

            {error && (
              <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <button
              className={clsx("w-full", splitMode ? "rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40" : "btn-primary")}
              disabled={!routeTruck || !loadOnTruck || assignSpare.isPending || createSwap.isPending}
              onClick={handleAdd}
            >
              {assignSpare.isPending || createSwap.isPending ? "Saving…" : splitMode ? "Add Split Load" : "Add Swap"}
            </button>
            </div>
            )}
          </section>

          {/* Crossload */}
          <section className="overflow-hidden rounded-lg border border-fuchsia-800/50 bg-fuchsia-950/20">
            <button
              type="button"
              onClick={() => toggleSection("crossload")}
              aria-expanded={openSection === "crossload"}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-fuchsia-900/20"
            >
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Crossload</span>
                {flaggedCrossloads.length > 0 && (
                  <span className="rounded-full bg-fuchsia-700/50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-200">
                    {flaggedCrossloads.length}
                  </span>
                )}
              </span>
              <span className={clsx("text-fuchsia-400/70 transition-transform", openSection === "crossload" && "rotate-90")}>&#9656;</span>
            </button>
            {openSection === "crossload" && (
              <div className="space-y-3 px-4 pb-4">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Flag a truck whose freight has to be moved onto another truck, or move the
                  route across right now.
                </p>

                {/* Pending crossloads */}
                {flaggedCrossloads.length > 0 && (
                  <div className="space-y-1.5">
                    {flaggedCrossloads.map((t) => (
                      <div
                        key={t.truck_number}
                        className="flex items-center gap-2 rounded-lg border border-fuchsia-800/40 bg-fuchsia-950/30 px-3 py-2"
                      >
                        <span className="font-mono text-sm font-bold text-slate-100">#{t.truck_number}</span>
                        <span className="text-fuchsia-400">&#8594;</span>
                        <span className="font-mono text-sm font-bold text-fuchsia-200">
                          #{t.state?.crossload_to_truck}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            className="rounded-md border border-fuchsia-700/50 px-2 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-900/40 disabled:opacity-40"
                            disabled={xBusy}
                            onClick={async () => {
                              setXBusy(true);
                              try {
                                await performCrossload(
                                  t.truck_number,
                                  t.state!.crossload_to_truck as number,
                                  xFromStatus,
                                );
                              } catch (err: unknown) {
                                const e = err as { response?: { data?: { detail?: string } } };
                                setXError(e?.response?.data?.detail ?? "Couldn't move the route.");
                              } finally {
                                setXBusy(false);
                              }
                            }}
                          >
                            Move now
                          </button>
                          <button
                            type="button"
                            className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:text-slate-200 disabled:opacity-40"
                            disabled={xBusy}
                            onClick={() => void setCrossloadFlag(t.truck_number, null)}
                          >
                            Clear
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 items-end gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fuchsia-400/80">
                      From truck
                    </label>
                    <select
                      className="input w-full text-sm"
                      value={xFrom}
                      onChange={(e) => { setXFrom(e.target.value); setXError(null); }}
                    >
                      <option value="">&mdash; select &mdash;</option>
                      {board.filter((t) => t.truck_type !== "Spare")
                            .sort((a, b) => a.truck_number - b.truck_number)
                            .map((t) => (
                              <option key={t.truck_number} value={t.truck_number}>#{t.truck_number}</option>
                            ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fuchsia-400/80">
                      Onto truck
                    </label>
                    <select
                      className="input w-full text-sm"
                      value={xTo}
                      onChange={(e) => { setXTo(e.target.value); setXError(null); }}
                    >
                      <option value="">&mdash; select &mdash;</option>
                      <LoadOnOptions />
                    </select>
                  </div>
                </div>

                {/* What the emptied truck becomes. The receiving truck always
                    ends up Loaded — it is physically carrying the route now. */}
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fuchsia-400/80">
                    After the move, set the emptied truck to
                  </label>
                  <div className="flex gap-1.5">
                    {(["unloaded", "oos", "shop"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setXFromStatus(v)}
                        className={clsx(
                          "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors",
                          xFromStatus === v
                            ? "border-fuchsia-500 bg-fuchsia-600/30 text-fuchsia-100"
                            : "border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200",
                        )}
                      >
                        {v === "oos" ? "OOS" : v}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    The receiving truck is set to Loaded and takes the route&rsquo;s coverage.
                  </p>
                </div>

                {xError && (
                  <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                    {xError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-fuchsia-700/60 bg-fuchsia-950/40 px-4 py-2 text-sm font-semibold text-fuchsia-200 hover:bg-fuchsia-900/40 disabled:opacity-40"
                    disabled={!xFrom || !xTo || xBusy}
                    onClick={() => void handleCrossload(false)}
                  >
                    {xBusy ? "Saving…" : "Flag as needs crossload"}
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-40"
                    disabled={!xFrom || !xTo || xBusy}
                    onClick={() => void handleCrossload(true)}
                  >
                    {xBusy ? "Moving…" : "Crossload now"}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Recurring rules */}
          <section className="overflow-hidden rounded-lg border border-violet-800/50 bg-violet-950/20">
            <button
              type="button"
              onClick={() => toggleSection("recurring")}
              aria-expanded={openSection === "recurring"}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-violet-900/20"
            >
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-violet-300">Recurring rules</span>
                {recurringRules.length > 0 && (
                  <span className="rounded-full bg-violet-700/50 px-2 py-0.5 text-[10px] font-bold text-violet-200">{recurringRules.length}</span>
                )}
              </span>
              <span className={clsx("text-violet-400/70 transition-transform", openSection === "recurring" && "rotate-90")}>▸</span>
            </button>
            {openSection === "recurring" && (
            <div className="space-y-3 px-4 pb-4">
            <p className="text-[11px] text-slate-500">Applied automatically when the board is set up for a matching load day.</p>

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
            </div>
            )}
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
