import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  useAssignSpare,
  useCreateRouteSwap,
  useDeleteRouteSwap,
  useDeleteSpare,
  useBoard,
  useDailyNotes,
  useHolidayLoad,
  useHolidayMode,
  useHolidayUnload,
  useNextUp,
  useNotices,
  useRouteSwaps,
  useSetDailyNotes,
  useSetHolidayLoad,
  useSetHolidayMode,
  useSetHolidayUnload,
  useSetWizardCompleted,
  useSpareAssignments,
  useWizardCompleted,
  useUpsertTruckState,
} from "../api/hooks";
import { todayIso } from "../api/client";
import { shipDayNumber, workdayNumbers } from "../components/Clock";
import { useAuth } from "../contexts/AuthContext";
import type { NoticeSeverity } from "../types";

const SEVERITY_STYLES: Record<NoticeSeverity, string> = {
  info: "border-blue-800/60 bg-blue-950/40 text-blue-100",
  warn: "border-amber-700/60 bg-amber-950/40 text-amber-100",
  critical: "border-red-700/60 bg-red-950/50 text-red-100",
};

/**
 * Run Day workflow dashboard.
 *
 * High-level day orchestration: notices, status counts, and quick links into
 * the focused workflow pages. The big "live in-progress" card and Next Up
 * controls live on the Live Status In Progress page (/board?status=in_progress).
 */
export default function RunDay() {
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const runDate = todayIso();
  const { user } = useAuth();
  const isAdmin = ["admin", "fleet", "atl", "supervisor"].includes(user?.role ?? "");

  const { data: board } = useBoard(runDate);
  const { data: spares } = useSpareAssignments(runDate, false);
  const { data: notices } = useNotices(true);
  const { data: nextUp } = useNextUp(runDate);
  const { data: holidayMode = false } = useHolidayMode(runDate);
  const { data: wizardDone = false } = useWizardCompleted(runDate);
  const activeNotices = notices ?? [];

  const { loadDay } = workdayNumbers();

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      total: 0,
      dirty: 0,
      shop: 0,
      in_progress: 0,
      unloaded: 0,
      loaded: 0,
      off: 0,
      oos: 0,
      spare: 0,
    };
    (board ?? []).forEach((t) => {
      c.total += 1;
      const raw = t.state?.status ?? "dirty";
      const s =
        !holidayMode &&
        t.truck_type !== "Spare" &&
        t.scheduled_off_days.includes(loadDay) &&
        (raw === "dirty" || raw === "unloaded")
          ? "off"
          : raw;
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [board, loadDay, holidayMode]);

  const inProgressTruck = (board ?? []).find(
    (t) => t.state?.status === "in_progress",
  );

  return (
    <div className="relative flex flex-col">
      {wizardOpen && (
        <RunDayWizard
          runDate={runDate}
          board={board ?? []}
          loadDay={loadDay}
          onClose={() => setWizardOpen(false)}
        />
      )}
      {/* Notices banner */}
      <button
        className={clsx(
          "m-4 flex items-center justify-between rounded-md border px-4 py-3 text-left transition-colors",
          activeNotices.length === 0
            ? "border-slate-800 bg-slate-900 hover:bg-slate-800"
            : "border-amber-700/60 bg-amber-950/30 hover:bg-amber-950/50",
        )}
        onClick={() => setNoticesOpen((o) => !o)}
      >
        <span className="flex-1 text-center text-sm font-semibold text-slate-100">
          {activeNotices.length === 0
            ? "Notices"
            : `Notices · ${activeNotices.length} active`}
        </span>
        <span className="text-xs text-slate-400">
          {noticesOpen ? "Collapse" : "Expand"}
        </span>
      </button>
      {noticesOpen && (
        <div className="mx-4 mb-2 space-y-2">
          {activeNotices.length === 0 ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              No active notices.
            </div>
          ) : (
            activeNotices.map((n) => (
              <div
                key={n.id}
                className={clsx(
                  "rounded-md border p-3 text-sm",
                  SEVERITY_STYLES[n.severity],
                )}
              >
                <p className="font-semibold">{n.title}</p>
                {n.body && (
                  <p className="mt-1 whitespace-pre-wrap opacity-90">{n.body}</p>
                )}
                <p className="mt-1 text-[10px] uppercase tracking-wide opacity-60">
                  Posted by {n.created_by || "system"} ·{" "}
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 pt-0 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex gap-2">
              <button
                className={clsx(
                  "flex-1 rounded-md border px-4 py-2.5 text-sm font-bold transition-colors",
                  wizardDone
                    ? "border-blue-600/60 bg-blue-950/20 text-blue-300 hover:bg-blue-950/40"
                    : "animate-pulse border-amber-500/80 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50",
                )}
                onClick={() => setWizardOpen(true)}
              >
                ▶ {wizardDone ? "Run Day Wizard" : "Run Day Wizard — needs to run!"}
              </button>
            </div>
          )}
          <section className="card">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-end gap-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Current Truck
                  </p>
                  {inProgressTruck ? (
                    <p className="text-6xl font-extrabold leading-none tabular-nums text-amber-300">
                      #{inProgressTruck.truck_number}
                    </p>
                  ) : (
                    <p className="mt-1 text-lg font-semibold text-slate-500">
                      None in progress
                    </p>
                  )}
                </div>
                {nextUp != null && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Next Up
                    </p>
                    <p className="text-4xl font-extrabold leading-none tabular-nums text-blue-300">
                      #{nextUp}
                    </p>
                  </div>
                )}
              </div>
              <Link
                to="/board?status=in_progress"
                className="btn-primary whitespace-nowrap text-sm"
              >
                Live Status →
              </Link>
            </div>
          </section>

          {/* Status overview tiles */}
          <section className="card">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Fleet status
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatusTile label="Dirty" value={counts.dirty} to="/board?status=dirty" />
              <StatusTile
                label="Unloaded"
                value={counts.unloaded}
                to="/board?status=unloaded"
              />
              <StatusTile
                label="Loaded"
                value={counts.loaded}
                to="/board?status=loaded"
              />
              <StatusTile label="Shop" value={counts.shop} to="/board?status=shop" />
              <StatusTile label="Off" value={counts.off} to="/board?status=off" />
              <StatusTile
                label="OOS"
                value={counts.oos}
                to="/board?status=oos"
              />
              <StatusTile
                label="Spare"
                value={counts.spare}
                to="/board?status=spare"
              />
              <StatusTile
                label="In Progress"
                value={counts.in_progress}
                to="/board?status=in_progress"
                accent="amber"
              />
              <StatusTile label="Total" value={counts.total} to="/board" />
            </div>
          </section>
        </div>

        {/* Right rail: Route Card */}
        <aside className="space-y-3">
          <RouteCard runDate={runDate} board={board ?? []} spares={spares ?? []} />
        </aside>
      </div>
    </div>
  );
}

function StatusTile({
  label,
  value,
  to,
  accent,
}: {
  label: string;
  value: number;
  to: string;
  accent?: "amber";
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "rounded-md border p-3 text-center transition-colors",
        accent === "amber"
          ? "border-amber-700/60 bg-amber-950/30 hover:bg-amber-950/50"
          : "border-slate-800 bg-slate-950/60 hover:bg-slate-900",
      )}
    >
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </Link>
  );
}

function WorkflowLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-slate-700"
    >
      {label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Run Day Wizard (5-step modal)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route Card component
// ---------------------------------------------------------------------------

import type { TruckWithState, SpareAssignment } from "../types";

function RunDayWizard({
  runDate,
  board,
  loadDay,
  onClose,
}: {
  runDate: string;
  board: TruckWithState[];
  loadDay: number;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const { data: holidayMode = false } = useHolidayMode(runDate);
  const setHolidayMode = useSetHolidayMode();
  const { data: holidayLoad = false } = useHolidayLoad(runDate);
  const setHolidayLoad = useSetHolidayLoad();
  const { data: holidayUnload = false } = useHolidayUnload(runDate);
  const setHolidayUnload = useSetHolidayUnload();
  // Spare trucks needing unload cleanup (used previously, now unloaded)
  const usedSpares = board.filter(
    (t) => t.truck_type === "Spare" && (t.state?.status === "unloaded" || t.state?.oos_spare_route != null),
  );
  const HOLIDAY_ROUTES = 38;
  const upsert = useUpsertTruckState();
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  const [notesText, setNotesText] = useState<string | null>(null);
  const setDailyNotes = useSetDailyNotes();
  const setWizardCompleted = useSetWizardCompleted();

  // Step 2: dust garment trucks
  const dustTrucks = board.filter((t) => t.truck_type === "Dust");
  const [dustSelected, setDustSelected] = useState<Set<number>>(
    new Set(board.filter((t) => t.state?.has_dust_garment).map((t) => t.truck_number))
  );

  // Step 3: route swaps
  const { data: swaps = [] } = useRouteSwaps(runDate);
  const createSwap = useCreateRouteSwap();
  const deleteSwap = useDeleteRouteSwap();
  const [swapRoute, setSwapRoute] = useState<string>("");
  const [swapLoadOn, setSwapLoadOn] = useState<string>("");
  const [swapError, setSwapError] = useState<string | null>(null);

  // Step 4: trucks not here
  // Spare trucks + "returning" trucks (scheduled off yesterday but not today)
  const { loadDay: todayLoad } = workdayNumbers();
  const prevDay = todayLoad === 1 ? 5 : todayLoad - 1;
  const returningTrucks = board.filter(
    (t) =>
      t.truck_type !== "Spare" &&
      t.scheduled_off_days.includes(prevDay) &&
      !t.scheduled_off_days.includes(loadDay),
  );
  const spareTrucks = board.filter((t) => t.truck_type === "Spare");
  const specialTrucks = [...returningTrucks, ...spareTrucks].filter(
    (t, i, arr) => arr.findIndex((x) => x.truck_number === t.truck_number) === i,
  );
  const [absentSelected, setAbsentSelected] = useState<Set<number>>(new Set());

  function toggleDust(num: number) {
    setDustSelected((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  function toggleAbsent(num: number) {
    setAbsentSelected((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  async function saveDustAndAdvance() {
    await Promise.all(
      dustTrucks.map((t) =>
        upsert.mutateAsync({
          truck_number: t.truck_number,
          run_date: runDate,
          has_dust_garment: dustSelected.has(t.truck_number),
        })
      )
    );
    setStep(3);
  }

  async function addSwap() {
    const rt = parseInt(swapRoute);
    const lo = parseInt(swapLoadOn);
    if (isNaN(rt) || isNaN(lo)) { setSwapError("Enter valid truck numbers."); return; }
    if (rt === lo) { setSwapError("Route truck and load-on truck must be different."); return; }
    setSwapError(null);
    try {
      await createSwap.mutateAsync({ run_date: runDate, route_truck: rt, load_on_truck: lo, two_way: false });
      setSwapRoute("");
      setSwapLoadOn("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setSwapError(e?.response?.data?.detail ?? "Failed to save swap.");
    }
  }

  async function saveAbsentAndAdvance() {
    const absentArr = [...absentSelected];
    await Promise.all(
      absentArr.map((num) =>
        upsert.mutateAsync({
          truck_number: num,
          run_date: runDate,
          status: "dirty",
        })
      )
    );
    setStep(5);
  }

  async function saveNotesAndFinish() {
    await setDailyNotes.mutateAsync({ runDate, notes: notesText ?? dailyNotes });
    await setWizardCompleted.mutateAsync(runDate);
    onClose();
  }

  const STEP_TITLES = [
    "",
    "Step 1 of 5 — Run Mode",
    "Step 2 of 5 — Dust Garments",
    "Step 3 of 5 — Route Swaps",
    "Step 4 of 5 — Trucks Not Here",
    "Step 5 of 5 — Daily Notes",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <span className="text-sm font-bold uppercase tracking-wide text-slate-400">
            Run Day Wizard
          </span>
          <span className="text-xs font-semibold text-blue-400">{STEP_TITLES[step]}</span>
          <button className="text-slate-500 hover:text-slate-300" onClick={onClose}>✕</button>
        </div>

        <div className="p-5">
          {/* ── Step 1: Run Mode ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">Choose today's run mode.</p>
              <p className="text-center text-xs text-slate-400">
                Normal keeps scheduled days off. Holiday runs all non-spare routes with no Day Off trucks.
              </p>
              <div className="space-y-2">
                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-base font-bold transition-colors",
                    !holidayMode
                      ? "border-blue-500 bg-blue-900/40 text-blue-200"
                      : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    if (holidayMode) {
                      await setHolidayMode.mutateAsync({ runDate, holiday: false });
                      await setHolidayLoad.mutateAsync({ runDate, value: false });
                      await setHolidayUnload.mutateAsync({ runDate, value: false });
                    }
                    setStep(2);
                  }}
                  disabled={setHolidayMode.isPending}
                >
                  Normal {!holidayMode && "✓"}
                </button>

                <button
                  className={clsx(
                    "w-full rounded-lg border px-4 py-3 text-base font-bold transition-colors",
                    holidayMode
                      ? "border-amber-500 bg-amber-900/40 text-amber-200"
                      : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                  )}
                  onClick={async () => {
                    if (!holidayMode) {
                      await setHolidayMode.mutateAsync({ runDate, holiday: true });
                      await setHolidayLoad.mutateAsync({ runDate, value: true });
                      await setHolidayUnload.mutateAsync({ runDate, value: true });
                    }
                  }}
                  disabled={setHolidayMode.isPending || setHolidayLoad.isPending || setHolidayUnload.isPending}
                >
                  Holiday {holidayMode && "✓"}
                </button>

                {holidayMode && (
                  <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Which operations run holiday?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={clsx(
                          "rounded-lg border px-3 py-3 text-sm font-bold transition-colors",
                          holidayLoad
                            ? "border-blue-500 bg-blue-900/40 text-blue-200"
                            : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                        )}
                        onClick={() => setHolidayLoad.mutateAsync({ runDate, value: !holidayLoad })}
                        disabled={setHolidayLoad.isPending}
                      >
                        <div className="text-base">{holidayLoad ? "✓" : "+"} Load</div>
                        <div className="mt-1 text-[11px] font-normal opacity-70">{HOLIDAY_ROUTES} routes</div>
                      </button>
                      <button
                        className={clsx(
                          "rounded-lg border px-3 py-3 text-sm font-bold transition-colors",
                          holidayUnload
                            ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                            : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                        )}
                        onClick={() => setHolidayUnload.mutateAsync({ runDate, value: !holidayUnload })}
                        disabled={setHolidayUnload.isPending}
                      >
                        <div className="text-base">{holidayUnload ? "✓" : "+"} Unload</div>
                        <div className="mt-1 text-[11px] font-normal opacity-70">
                          {HOLIDAY_ROUTES}
                          {usedSpares.length > 0 && ` + ${usedSpares.length} spare${usedSpares.length !== 1 ? "s" : ""}`}
                          {" = "}{HOLIDAY_ROUTES + usedSpares.length} total
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={onClose}>Close</button>
                <button
                  className="flex-1 btn-primary text-sm"
                  onClick={() => setStep(2)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Dust Garments ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">Select dust trucks with garments</p>
              <p className="text-center text-xs text-slate-400">Select which dust trucks have garments today.</p>
              {dustTrucks.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No dust trucks in fleet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {dustTrucks.map((t) => (
                    <button
                      key={t.truck_number}
                      className={clsx(
                        "rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors",
                        dustSelected.has(t.truck_number)
                          ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                          : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                      )}
                      onClick={() => toggleDust(t.truck_number)}
                    >
                      #{t.truck_number}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(1)}>Back</button>
                <button
                  className="flex-1 btn-primary text-sm"
                  disabled={upsert.isPending}
                  onClick={saveDustAndAdvance}
                >
                  Save & Continue
                </button>
              </div>
              <button className="w-full btn-ghost text-sm" onClick={() => setStep(3)}>Skip</button>
            </div>
          )}

          {/* ── Step 3: Route Swaps ── */}
          {step === 3 && (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              <p className="text-center text-xl font-extrabold text-slate-100">Set any route swaps.</p>
              <p className="text-center text-xs text-slate-400">
                Route swaps: one truck loads another's route today. Two-way creates both directions.
              </p>

              {/* Existing swaps list */}
              {swaps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Current Assignments
                  </p>
                  {swaps.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-blue-900/50 bg-blue-950/20 px-3 py-2"
                    >
                      <span className="text-sm font-bold text-slate-200">
                        Route <span className="text-red-400">#{s.route_truck}</span>
                        <span className="mx-1 text-slate-500">→</span>
                        Load On <span className="text-blue-300">#{s.load_on_truck}</span>
                      </span>
                      <button
                        className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-slate-700"
                        disabled={deleteSwap.isPending}
                        onClick={() => deleteSwap.mutate({ id: s.id, runDate, alsoReciprocal: false })}
                        title="Remove this assignment"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new swap */}
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-400">Add route swap</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Route Truck</label>
                    <select
                      className="input w-full text-sm"
                      value={swapRoute}
                      onChange={(e) => { setSwapRoute(e.target.value); setSwapError(null); }}
                    >
                      <option value="">— route —</option>
                      {board
                        .filter((t) => t.truck_type !== "Spare")
                        .sort((a, b) => {
                          const aOos = a.state?.status === "oos" ? 0 : 1;
                          const bOos = b.state?.status === "oos" ? 0 : 1;
                          if (aOos !== bOos) return aOos - bOos;
                          return a.truck_number - b.truck_number;
                        })
                        .map((t) => (
                          <option key={t.truck_number} value={t.truck_number}>
                            #{t.truck_number} ({t.state?.status ?? "dirty"})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Load On</label>
                    <select
                      className="input w-full text-sm"
                      value={swapLoadOn}
                      onChange={(e) => { setSwapLoadOn(e.target.value); setSwapError(null); }}
                    >
                      <option value="">— truck —</option>
                      {board
                        .sort((a, b) => a.truck_number - b.truck_number)
                        .map((t) => {
                          const raw = t.state?.status ?? "dirty";
                          const isOff =
                            !holidayMode &&
                            t.truck_type !== "Spare" &&
                            (t.scheduled_off_days ?? []).includes(loadDay) &&
                            (raw === "dirty" || raw === "unloaded");
                          return (
                            <option key={t.truck_number} value={t.truck_number}>
                              #{t.truck_number}
                              {t.truck_type === "Spare" ? " (Spare)" : isOff ? " (Off)" : ""}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                </div>
                {swapError && (
                  <p className="text-xs text-red-400">{swapError}</p>
                )}
                <button
                  className="w-full btn-primary text-sm"
                  disabled={!swapRoute || !swapLoadOn || createSwap.isPending}
                  onClick={addSwap}
                >
                  {createSwap.isPending ? "Saving…" : "Add Swap"}
                </button>
              </div>

              <div className="flex gap-2 pt-1">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(2)}>Back</button>
                <button className="flex-1 btn-primary text-sm" onClick={() => setStep(4)}>Continue</button>
              </div>
            </div>
          )}

          {/* ── Step 4: Trucks Not Here ── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">What trucks are NOT here?</p>
              <p className="text-center text-xs text-slate-400">
                Select returning or spare trucks that are absent or running special today.
              </p>
              {specialTrucks.length === 0 ? (
                <p className="text-center text-sm text-slate-500">No returning or spare trucks found.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {specialTrucks.map((t) => (
                    <button
                      key={t.truck_number}
                      className={clsx(
                        "rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors",
                        absentSelected.has(t.truck_number)
                          ? "border-red-500 bg-red-900/40 text-red-200"
                          : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700",
                      )}
                      onClick={() => toggleAbsent(t.truck_number)}
                    >
                      #{t.truck_number}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(3)}>Back</button>
                <button
                  className="flex-1 btn-primary text-sm"
                  disabled={upsert.isPending}
                  onClick={saveAbsentAndAdvance}
                >
                  Save & Continue
                </button>
              </div>
              <button className="w-full btn-ghost text-sm" onClick={() => setStep(5)}>Skip</button>
            </div>
          )}

          {/* ── Step 5: Daily Notes ── */}
          {step === 5 && (
            <div className="space-y-4">
              <p className="text-center text-xl font-extrabold text-slate-100">Add any notes about today.</p>
              <textarea
                className="input w-full resize-none text-sm"
                rows={4}
                placeholder="Enter any notes about today's run day..."
                value={notesText ?? dailyNotes}
                onChange={(e) => setNotesText(e.target.value)}
              />
              <div className="flex gap-2 pt-2">
                <button className="flex-1 btn-ghost text-sm" onClick={() => setStep(4)}>Back</button>
                <button
                  className="flex-1 btn-primary text-sm"
                  disabled={setDailyNotes.isPending}
                  onClick={saveNotesAndFinish}
                >
                  Save & Finish
                </button>
              </div>
              <button className="w-full btn-ghost text-sm" onClick={onClose}>Close without saving</button>
            </div>
          )}
        </div>

        {/* Step indicator dots */}
        <div className="flex justify-center gap-1.5 pb-4">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={clsx(
                "h-1.5 rounded-full transition-all",
                s === step ? "w-4 bg-blue-400" : s < step ? "w-1.5 bg-blue-700" : "w-1.5 bg-slate-700",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RouteCard({
  runDate,
  board,
  spares,
}: {
  runDate: string;
  board: TruckWithState[];
  spares: SpareAssignment[];
}) {
  const [open, setOpen] = useState(true);
  // Which OOS truck we're currently assigning, and the chosen spare
  const [assigningRoute, setAssigningRoute] = useState<number | null>(null);
  const [pickedSpare, setPickedSpare] = useState<string>("");
  // Which existing assignment is being changed
  const [changingId, setChangingId] = useState<number | null>(null);
  const [changePick, setChangePick] = useState<string>("");

  const assignMut = useAssignSpare();
  const deleteMut = useDeleteSpare();

  // OOS trucks that don't yet have an active spare assignment
  const assignedRoutes = new Set(spares.map((s) => s.covering_route_truck));
  const oosTrucks = board.filter((t) => t.state?.status === "oos");
  const unassigned = oosTrucks.filter(
    (t) => !assignedRoutes.has(t.truck_number),
  );

  // Active (not returned) assignments
  const active = spares.filter((s) => !s.returned);

  // Eligible spare trucks: not OOS, not already assigned as spare, sorted spare-type first
  const assignedSpares = new Set(spares.filter((s) => !s.returned).map((s) => s.spare_truck_number));
  const eligibleSpares = board
    .filter(
      (t) =>
        t.state?.status !== "oos" &&
        t.state?.status !== "shop" &&
        t.state?.status !== "loaded" &&
        !assignedSpares.has(t.truck_number),
    )
    .sort((a, b) => {
      // spare-type first, then by truck number
      if (a.truck_type === "Spare" && b.truck_type !== "Spare") return -1;
      if (a.truck_type !== "Spare" && b.truck_type === "Spare") return 1;
      return a.truck_number - b.truck_number;
    });

  async function confirmAssign(routeTruck: number) {
    if (!pickedSpare) return;
    await assignMut.mutateAsync({
      run_date: runDate,
      spare_truck_number: Number(pickedSpare),
      covering_route_truck: routeTruck,
    });
    setAssigningRoute(null);
    setPickedSpare("");
  }

  async function confirmChange(assignment: SpareAssignment) {
    if (!changePick) return;
    await deleteMut.mutateAsync(assignment.id);
    await assignMut.mutateAsync({
      run_date: runDate,
      spare_truck_number: Number(changePick),
      covering_route_truck: assignment.covering_route_truck,
    });
    setChangingId(null);
    setChangePick("");
  }

  const totalOos = oosTrucks.length;
  const unassignedCount = unassigned.length;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900">
      {/* Header */}
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-800"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <p className="text-sm font-semibold text-slate-100">Route Card</p>
          <p className="text-xs text-slate-400">
            {active.length} active assignment{active.length !== 1 ? "s" : ""}
            {unassignedCount > 0 && (
              <span className="ml-1 rounded bg-red-700 px-1 text-white">
                {unassignedCount} unassigned
              </span>
            )}
          </p>
        </div>
        <span className="text-xs text-slate-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-800 p-2">
          {/* Active assignments */}
          {active.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Active Assignments
              </p>
              {active.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border border-emerald-900/50 bg-emerald-950/30"
                >
                  {changingId === s.id ? (
                    <div className="space-y-2 p-2">
                      <p className="text-xs font-semibold text-emerald-300">
                        Change spare for #{s.covering_route_truck}
                      </p>
                      <select
                        className="input w-full text-sm"
                        value={changePick}
                        onChange={(e) => setChangePick(e.target.value)}
                        autoFocus
                      >
                        <option value="">— pick spare —</option>
                        {[
                          ...eligibleSpares,
                          ...board.filter((t) => t.truck_number === s.spare_truck_number),
                        ]
                          .filter((t, i, arr) => arr.findIndex((x) => x.truck_number === t.truck_number) === i)
                          .sort((a, b) => {
                            if (a.truck_type === "Spare" && b.truck_type !== "Spare") return -1;
                            if (a.truck_type !== "Spare" && b.truck_type === "Spare") return 1;
                            return a.truck_number - b.truck_number;
                          })
                          .map((t) => (
                            <option key={t.truck_number} value={t.truck_number}>
                              #{t.truck_number}{t.truck_type === "Spare" ? " (Spare)" : ""}{" · "}{t.state?.status ?? "dirty"}
                              {t.truck_number === s.spare_truck_number ? " ← current" : ""}
                            </option>
                          ))}
                      </select>
                      <div className="flex gap-1">
                        <button
                          className="btn-primary flex-1 text-xs"
                          disabled={!changePick || assignMut.isPending || deleteMut.isPending}
                          onClick={() => confirmChange(s)}
                        >
                          Confirm
                        </button>
                        <button
                          className="btn-ghost flex-1 text-xs"
                          onClick={() => { setChangingId(null); setChangePick(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-red-400">#{s.covering_route_truck}</span>
                        <span className="text-slate-500">→</span>
                        <span className="font-bold text-blue-300">#{s.spare_truck_number}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(s.assigned_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-700"
                          onClick={() => { setChangingId(s.id); setChangePick(""); }}
                          title="Change spare assignment"
                        >
                          Change
                        </button>
                        <button
                          className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-slate-700"
                          disabled={deleteMut.isPending}
                          onClick={() => deleteMut.mutate(s.id)}
                          title="Remove assignment"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* OOS trucks needing assignment */}
          {unassigned.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                OOS — Needs Coverage
              </p>
              {unassigned.map((t) => (
                <div key={t.truck_number} className="rounded-md border border-red-900/50 bg-red-950/20">
                  {assigningRoute === t.truck_number ? (
                    <div className="space-y-2 p-2">
                      <p className="text-xs font-semibold text-red-300">
                        Assign spare for OOS #{t.truck_number}
                      </p>
                      <select
                        className="input w-full text-sm"
                        value={pickedSpare}
                        onChange={(e) => setPickedSpare(e.target.value)}
                        autoFocus
                      >
                        <option value="">— pick spare —</option>
                        {eligibleSpares.map((s) => (
                          <option key={s.truck_number} value={s.truck_number}>
                            #{s.truck_number}
                            {s.truck_type === "Spare" ? " (Spare)" : ""}
                            {" · "}
                            {s.state?.status ?? "dirty"}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-1">
                        <button
                          className="btn-primary flex-1 text-xs"
                          disabled={!pickedSpare || assignMut.isPending}
                          onClick={() => confirmAssign(t.truck_number)}
                        >
                          Assign
                        </button>
                        <button
                          className="btn-ghost flex-1 text-xs"
                          onClick={() => { setAssigningRoute(null); setPickedSpare(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm font-bold text-red-300">#{t.truck_number} OOS</span>
                      <button
                        className="rounded bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-600"
                        onClick={() => { setAssigningRoute(t.truck_number); setPickedSpare(""); }}
                      >
                        Assign →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {active.length === 0 && unassigned.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-slate-500">
              No OOS assignments needed today.
            </p>
          )}

          <Link
            to="/board?status=oos"
            className="block rounded-md px-2 py-1 text-center text-xs text-slate-500 hover:bg-slate-800 hover:text-blue-400"
          >
            View full board →
          </Link>
        </div>
      )}
    </div>
  );
}
