import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import clsx from "clsx";
import { useAuth } from "../contexts/AuthContext";
import { useBoard, useHolidayLoad, useHolidayUnload, useWizardCompleted } from "../api/hooks";
import { todayIso } from "../api/client";
import { useRealtimeSync } from "../api/useRealtimeSync";
import { useOfflineSync } from "../api/useOfflineSync";
import { OfflineIndicator } from "./OfflineIndicator";
import type { AuthRole, TruckStatus, TruckWithState } from "../types";
import { buildRouteStatusCounts, effectiveStatus } from "../utils/truckStatus";
import Clock, { todayLong, workdayNumbers, shipDayNumber, currentShift } from "./Clock";

const STATUS_LABEL: Record<TruckStatus, string> = {
  dirty: "Dirty",
  shop: "Shop",
  in_progress: "In Progress",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "OFF",
  oos: "OOS",
  spare: "SPARE",
};

const STATUS_DOT: Record<TruckStatus, string> = {
  dirty: "bg-status-dirty",
  shop: "bg-status-shop",
  in_progress: "bg-status-inprogress",
  unloaded: "bg-status-unloaded",
  loaded: "bg-status-loaded",
  off: "bg-status-off",
  oos: "bg-status-oos",
  spare: "bg-status-spare",
};

// 'spare' (truck type) and 'off' (set elsewhere) are omitted from the status filter row.
const STATUS_ORDER: TruckStatus[] = [
  "dirty",
  "shop",
  "in_progress",
  "unloaded",
  "loaded",
  "oos",
  "off",
];

const PRIMARY_NAV = [
  { to: "/unload", label: "Unload" },
  { to: "/load", label: "Load" },
  { to: "/fleet", label: "Fleet" },
  { to: "/communications", label: "Communications" },
];

const SECONDARY_NAV = [
  { to: "/shorts", label: "Short sheet" },
  { to: "/trends", label: "Trends" },
  { to: "/audit", label: "Audit" },
  { to: "/management", label: "Management" },
];

// Mirrors V1 ROLE_SCREEN_ACCESS — which nav links each role can see.
const ROLE_NAV_ACCESS: Record<AuthRole, Set<string>> = {
  admin: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/trends", "/audit", "/management"]),
  fleet: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/trends", "/audit", "/management"]),
  atl: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/trends", "/audit", "/management"]),
  supervisor: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/trends", "/audit", "/management"]),
  lead: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/trends", "/audit", "/management"]),
  loader: new Set(["/load", "/communications", "/audit"]),
  unloader: new Set(["/unload", "/communications"]),
  guest: new Set<string>(),
};

const ROLE_LABELS: Record<AuthRole, string> = {
  admin: "Admin",
  fleet: "Fleet",
  atl: "ATL",
  supervisor: "Supervisor",
  lead: "Lead",
  loader: "Load",
  unloader: "Unloader",
  guest: "Guest",
};

const ROLE_BADGE: Record<AuthRole, string> = {
  admin:      "bg-red-950 text-red-300 ring-1 ring-red-700/50",
  fleet:      "bg-cyan-950 text-cyan-300 ring-1 ring-cyan-700/50",
  lead:       "bg-blue-950 text-blue-300 ring-1 ring-blue-700/50",
  atl:        "bg-orange-950 text-orange-300 ring-1 ring-orange-700/50",
  supervisor: "bg-purple-950 text-purple-300 ring-1 ring-purple-700/50",
  loader:     "bg-green-950 text-green-300 ring-1 ring-green-700/50",
  unloader:   "bg-teal-950 text-teal-300 ring-1 ring-teal-700/50",
  guest:      "bg-slate-800 text-slate-400 ring-1 ring-slate-600/50",
};

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const { data: board } = useBoard(todayIso());
  const { data: holidayLoad = false } = useHolidayLoad(todayIso());
  const { data: holidayUnload = false } = useHolidayUnload(todayIso());
  const { data: wizardDone = false } = useWizardCompleted(todayIso());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Real-time sync: invalidates React Query caches on server-push events
  const { isWsConnected } = useRealtimeSync();

  // Offline sync: queue + flush + connectivity state
  const offlineState = useOfflineSync();

  // Close sidebar on route change (mobile nav tap)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const { loadDay, unloadsDay } = workdayNumbers();
  const loadDayNum = loadDay;

  const counts = useMemo(
    () => buildRouteStatusCounts(board ?? [], loadDayNum, holidayLoad),
    [board, loadDayNum, holidayLoad],
  );

  // Load progress mirrors the Day Overview: denominator = route trucks scheduled
  // for load; a route counts as done when the route truck is loaded OR its covering spare is.
  const loadTrucksForProgress = useMemo(
    () =>
      (board ?? []).filter(
        (t) =>
          (t.truck_type !== "Spare" || t.route_swap_route != null) &&
          (holidayLoad || !(t.scheduled_off_days ?? []).includes(loadDay)),
      ),
    [board, loadDay, holidayLoad],
  );
  const loadedSpareRoutes = useMemo(
    () =>
      new Set(
        loadTrucksForProgress
          .filter(
            (t) =>
              t.truck_type === "Spare" &&
              t.route_swap_route != null &&
              effectiveStatus(t, loadDayNum, holidayLoad) === "loaded",
          )
          .map((t) => t.route_swap_route as number),
      ),
    [loadTrucksForProgress, loadDayNum, holidayLoad],
  );
  const loadRouteTrucks = useMemo(
    () => loadTrucksForProgress.filter((t) => t.truck_type !== "Spare"),
    [loadTrucksForProgress],
  );
  const totalScheduledLoad = loadRouteTrucks.length;
  const loadedScheduled = loadRouteTrucks.filter(
    (t) =>
      effectiveStatus(t, loadDayNum, holidayLoad) === "loaded" ||
      loadedSpareRoutes.has(t.truck_number),
  ).length;

  // Unload progress mirrors the Day Overview exactly.
  const unloadTrucksForProgress = useMemo(
    () =>
      (board ?? []).filter(
        (t) =>
          (t.truck_type !== "Spare" || t.route_swap_route != null) &&
          (holidayUnload || !(t.scheduled_off_days ?? []).includes(unloadsDay)),
      ),
    [board, unloadsDay, holidayUnload],
  );
  const unloadedSpareRoutes = useMemo(
    () =>
      new Set(
        unloadTrucksForProgress
          .filter(
            (t) =>
              t.truck_type === "Spare" &&
              t.route_swap_route != null &&
              ["unloaded", "loaded"].includes(effectiveStatus(t, unloadsDay, holidayUnload)),
          )
          .map((t) => t.route_swap_route as number),
      ),
    [unloadTrucksForProgress, unloadsDay, holidayUnload],
  );
  const unloadRouteTrucks = useMemo(
    () => unloadTrucksForProgress.filter((t) => t.truck_type !== "Spare"),
    [unloadTrucksForProgress],
  );
  const unloadedScheduled = unloadRouteTrucks.filter(
    (t) =>
      ["unloaded", "loaded"].includes(effectiveStatus(t, unloadsDay, holidayUnload)) ||
      unloadedSpareRoutes.has(t.truck_number),
  ).length;

  const loadedPct =
    totalScheduledLoad > 0
      ? Math.round((loadedScheduled / totalScheduledLoad) * 100)
      : 0;

  const inProgressTruck = (board ?? []).find((t) => t.state?.status === "in_progress");
  const unloadedPct =
    unloadRouteTrucks.length > 0
      ? Math.round((unloadedScheduled / unloadRouteTrucks.length) * 100)
      : 0;

  const roleLabel = user?.display_role ?? ROLE_LABELS[(user?.role ?? "guest") as AuthRole] ?? user?.role ?? "";
  const allowed = ROLE_NAV_ACCESS[(user?.role ?? "guest") as AuthRole] ?? new Set<string>();
  const primaryNav = PRIMARY_NAV.filter((i) => allowed.has(i.to));
  const secondaryNav = SECONDARY_NAV.filter((i) => allowed.has(i.to));

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">

      {/* Offline / pending-sync indicator */}
      <div className="fixed inset-x-0 top-0 z-50 md:pl-64">
        <OfflineIndicator {...offlineState} isWsConnected={isWsConnected} />
      </div>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-200 ease-in-out",
          "md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/* Setup Day button */}
          <button
            onClick={() => nav("/?setup=1")}
            className={clsx(
              "block w-full rounded-md border px-3 py-2 text-center text-sm font-semibold transition-colors",
              wizardDone
                ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                : "animate-pulse border-amber-500/80 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50",
            )}
          >
            {wizardDone ? "Setup Day" : "Setup Day — needs to run!"}
          </button>

          {/* Workday context */}
          <div className="rounded-md bg-slate-950/60 px-3 py-2 text-center text-xs leading-tight">
            <p className="font-semibold text-slate-300">Workday</p>
            <p className="text-slate-200">{todayLong()}</p>
            <p className="mt-1 font-semibold text-slate-300">Shift</p>
            <p className="text-slate-200">{currentShift().label} · {currentShift().hours}</p>
            <p className="mt-1 font-semibold text-slate-300">Load</p>
            <p className="text-slate-200">Day {loadDay}{holidayLoad ? ` + ${loadDay === 5 ? 1 : loadDay + 1}` : ""}</p>
            <p className="mt-1 font-semibold text-slate-300">Unloads</p>
            <p className="text-slate-200">Day {unloadsDay}{holidayUnload ? ` + ${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}</p>
          </div>

          {/* Clock */}
          <div className="text-center">
            <Clock />
          </div>

          {/* Primary action buttons */}
          <div className="space-y-2 pt-2">
            {primaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    "block rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-center text-sm font-medium transition-colors",
                    isActive ? "ring-2 ring-blue-500" : "hover:bg-slate-700",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          <hr className="border-slate-800" />

          {/* Live status counters */}
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
            Live status
          </p>
          <div className="space-y-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                clsx(
                  "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                    : "border-slate-700 bg-slate-800 hover:bg-slate-700",
                )
              }
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                Day Overview
              </span>
              <span className="rounded bg-cyan-800/60 px-1.5 py-0.5 text-xs font-semibold text-cyan-300">
                Today
              </span>
            </NavLink>
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => nav(`/board?status=${s}`)}
                className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-700"
              >
                <span className="flex items-center gap-2">
                  <span className={clsx(
                    "h-2 w-2 rounded-full",
                    STATUS_DOT[s],
                    s === "in_progress" && counts[s] > 0 && "animate-pulse",
                  )} />
                  {STATUS_LABEL[s]}
                </span>
                <span className="text-slate-300">
                  {s === "in_progress"
                    ? inProgressTruck
                      ? <span className="text-yellow-300 text-base font-bold">#{inProgressTruck.truck_number}</span>
                      : "None"
                    : counts[s]}
                </span>
              </button>
            ))}
          </div>

          {/* Load / Unload progress */}
          <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Load/Unload Progress
            </p>
            <ProgressRow label="Load" current={loadedScheduled} total={totalScheduledLoad} pct={loadedPct} />
            <ProgressRow
              label="Unload"
              current={unloadedScheduled}
              total={unloadRouteTrucks.length}
              pct={unloadedPct}
            />
          </div>

          <hr className="border-slate-800" />

          {/* Secondary navigation */}
          <div className="space-y-2">
            {secondaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    "block rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-center text-sm font-medium transition-colors",
                    isActive ? "ring-2 ring-blue-500" : "hover:bg-slate-700",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          <hr className="border-slate-800" />

          {/* User block */}
          <div className="rounded-md bg-slate-950/60 px-3 py-2 text-center text-xs">
            <p className="text-slate-400">Signed in as:</p>
            <p className="font-semibold text-slate-100">{user?.username}</p>
            <div className="mt-1 flex justify-center">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                ROLE_BADGE[(user?.role ?? "guest") as AuthRole] ?? ROLE_BADGE.guest
              }`}>
                {roleLabel}
              </span>
            </div>
          </div>
          <button
            className="btn-ghost w-full"
            onClick={() => {
              logout();
              nav("/login");
            }}
          >
            Logout
          </button>
          <p className="pt-2 text-center text-[10px] text-slate-500">
            ReadyRoute V2 · dev build
          </p>
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* App top bar — mobile shows hamburger + brand, all sizes show clock/shift/day badges */}
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:hidden"
          >
            {/* Hamburger */}
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-slate-200 md:hidden">ReadyRoute V2</span>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="font-mono"><Clock compact /></span>
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-slate-300">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Shift</span>
              {currentShift().name}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-blue-800/60 bg-blue-950/50 px-2 py-1 font-semibold text-blue-300">
              <span className="text-[10px] uppercase tracking-wider text-blue-400/70">Load</span>
              Day {loadDay}{holidayLoad ? `+${loadDay === 5 ? 1 : loadDay + 1}` : ""}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/50 px-2 py-1 font-semibold text-emerald-300">
              <span className="text-[10px] uppercase tracking-wider text-emerald-400/70">Unload</span>
              Day {unloadsDay}{holidayUnload ? `+${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  current,
  total,
  pct,
}: {
  label: string;
  current: number;
  total: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-200">{label}</span>
        <span className="text-slate-400">
          {current}/{total} ({pct}%)
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
