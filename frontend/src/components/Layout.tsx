import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState, useEffect } from "react";
import clsx from "clsx";
import { format, parseISO } from "date-fns";
import { useAuth } from "../contexts/AuthContext";
import { useBoard, useHolidayLoad, useHolidayUnload, useWizardCompleted } from "../api/hooks";
import RouteSwapModal from "./RouteSwapModal";
import NoteCardsDrawer from "./NoteCardsDrawer";
import NotificationSettingsCard from "./NotificationSettingsCard";
import { todayIso } from "../api/client";
import { useRealtimeSync } from "../api/useRealtimeSync";
import { useOfflineSync } from "../api/useOfflineSync";
import { OfflineIndicator } from "./OfflineIndicator";
import type { AuthRole, TruckStatus, TruckWithState } from "../types";
import { buildRouteStatusCounts, effectiveStatus } from "../utils/truckStatus";
import Clock, { todayLong, workdayNumbers, shipDayNumber, currentShift } from "./Clock";
import { Menu, X } from "lucide-react";

const STATUS_LABEL: Record<TruckStatus, string> = {
  dirty: "Dirty",
  unfinished: "Unfinished",
  shop: "Shop",
  in_progress: "In Progress",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "OFF",
  oos: "OOS / HOLD",
  spare: "SPARE / COV",
};

const STATUS_DOT: Record<TruckStatus, string> = {
  dirty: "bg-status-dirty",
  unfinished: "bg-status-unfinished",
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
  "unloaded",
  "in_progress",
  "loaded",
  "spare",
  "off",
  "oos",
];

const PRIMARY_NAV = [
  { to: "/unload", label: "Unload" },
  { to: "/load", label: "Load" },
  { to: "/fleet", label: "Fleet" },
  { to: "/communications", label: "Communications" },
];

const SECONDARY_NAV = [
  { to: "/shorts", label: "Short sheet" },
  { to: "/notes", label: "Notes" },
  { to: "/trends", label: "Trends" },
  { to: "/audit", label: "Audit" },
  { to: "/management", label: "Management" },
];

// Mirrors V1 ROLE_SCREEN_ACCESS — which nav links each role can see.
const ROLE_NAV_ACCESS: Record<AuthRole, Set<string>> = {
  admin: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/management"]),
  fleet: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/management"]),
  atl: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/management"]),
  supervisor: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/management"]),
  lead: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/management"]),
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

function BuildInfo() {
  const isDev = import.meta.env.DEV;
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  const commit = typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "";
  const buildDate = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";
  const shortCommit = commit ? commit.slice(0, 7) : "";
  const dateLabel = (() => {
    if (!buildDate) return "";
    const d = parseISO(buildDate);
    if (Number.isNaN(d.getTime())) return "";
    return format(d, "PP");
  })();
  return (
    <div className="pt-2 text-center text-[10px] leading-tight text-slate-500">
      <p>
        ReadyRoute V2 · {isDev ? "dev" : version}
      </p>
      {(shortCommit || dateLabel) && !isDev && (
        <p className="text-slate-600">
          {shortCommit}
          {shortCommit && dateLabel ? " · " : ""}
          {dateLabel}
        </p>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const { data: board } = useBoard(todayIso());
  const { data: holidayLoad = false } = useHolidayLoad(todayIso());
  const { data: holidayUnload = false } = useHolidayUnload(todayIso());
  const { data: wizardDone = false } = useWizardCompleted(todayIso());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const canManageSwaps = ["admin", "fleet", "supervisor", "atl"].includes(user?.role ?? "");

  // Real-time sync: invalidates React Query caches on server-push events
  const { isWsConnected } = useRealtimeSync();

  // Offline sync: queue + flush + connectivity state
  const offlineState = useOfflineSync();

  // Close sidebar and more drawer on route change (mobile nav tap)
  useEffect(() => {
    setSidebarOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  const { loadDay, unloadsDay } = workdayNumbers();
  const loadDayNum = loadDay;

  const counts = useMemo(
    () => buildRouteStatusCounts(board ?? [], loadDayNum, holidayLoad, unloadsDay, holidayUnload),
    [board, loadDayNum, unloadsDay, holidayLoad, holidayUnload],
  );

  const holdCount = useMemo(
    () => (board ?? []).filter((t) =>
      t.state?.priority_hold === true &&
      (t.state?.status === "dirty" || t.state == null)
    ).length,
    [board],
  );

  // Load progress mirrors the Day Overview: denominator = route trucks scheduled
  // for load; a route counts as done when the route truck is loaded OR its covering spare is.
  const loadTrucksForProgress = useMemo(
    () =>
      (board ?? []).filter(
        (t) =>
          (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
          (holidayLoad || !(t.scheduled_off_days ?? []).includes(loadDay)),
      ),
    [board, loadDay, holidayLoad],
  );
  const loadedSpareRoutes = useMemo(
    () =>
      new Set(
        (board ?? [])
          .filter(
            (t) =>
              t.truck_type === "Spare" &&
              (t.route_swap_route != null || t.state?.oos_spare_route != null) &&
              effectiveStatus(t, loadDayNum, holidayLoad) === "loaded",
          )
          .map((t) => (t.route_swap_route ?? t.state!.oos_spare_route) as number),
      ),
    [board, loadDayNum, holidayLoad],
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
          (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null) &&
          (holidayUnload || !(t.scheduled_off_days ?? []).includes(unloadsDay)),
      ),
    [board, unloadsDay, holidayUnload],
  );
  const unloadedSpareRoutes = useMemo(
    () =>
      new Set(
        (board ?? [])
          .filter(
            (t) =>
              t.truck_type === "Spare" &&
              (t.route_swap_route != null || t.state?.oos_spare_route != null) &&
              ["unloaded", "loaded"].includes(effectiveStatus(t, unloadsDay, holidayUnload)),
          )
          .map((t) => (t.route_swap_route ?? t.state!.oos_spare_route) as number),
      ),
    [board, unloadsDay, holidayUnload],
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

  // Trucks still needing to be loaded — drives the Load nav badge.
  const trucksNotYetLoaded = totalScheduledLoad - loadedScheduled;

  const inProgressTruck = useMemo(
    () => (board ?? []).find((t) => t.state?.status === "in_progress"),
    [board],
  );
  const unloadedPct =
    unloadRouteTrucks.length > 0
      ? Math.round((unloadedScheduled / unloadRouteTrucks.length) * 100)
      : 0;

  const DISPLAY_ROLE_OVERRIDE: Record<string, { label: string; cls: string }> = {
    nate: { label: "Lead", cls: ROLE_BADGE.supervisor },
  };
  const roleOverride = user?.username ? DISPLAY_ROLE_OVERRIDE[user.username] : undefined;
  const roleLabel = roleOverride?.label ?? user?.display_role ?? ROLE_LABELS[(user?.role ?? "guest") as AuthRole] ?? user?.role ?? "";
  const roleBadgeCls = roleOverride?.cls ?? ROLE_BADGE[(user?.role ?? "guest") as AuthRole] ?? ROLE_BADGE.guest;
  const allowed = ROLE_NAV_ACCESS[(user?.role ?? "guest") as AuthRole] ?? new Set<string>();
  const primaryNav = PRIMARY_NAV.filter((i) => allowed.has(i.to));
  const secondaryNav = SECONDARY_NAV.filter((i) => allowed.has(i.to));
  const shiftName = currentShift().name;
  const loadBadgeText = `L${loadDay}${holidayLoad ? `+${loadDay === 5 ? 1 : loadDay + 1}` : ""}`;
  const unloadBadgeText = `U${unloadsDay}${holidayUnload ? `+${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}`;

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

          {canManageSwaps && (
            <button
              onClick={() => setSwapModalOpen(true)}
              className="block w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-center text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
            >
              Route Swaps
            </button>
          )}

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
            {primaryNav.map((item) => {
              const showLoadBadge = item.to === "/load" && trucksNotYetLoaded > 0;
              const showUnloadBadge = item.to === "/unload" && holdCount > 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "relative flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium transition-colors",
                      isActive ? "ring-2 ring-blue-500" : "hover:bg-slate-700",
                    )
                  }
                >
                  <span>{item.label}</span>
                  {showLoadBadge && (
                    <span className="absolute right-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white">
                      {trucksNotYetLoaded}
                    </span>
                  )}
                  {showUnloadBadge && (
                    <span className="absolute right-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                      {holdCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
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
                  "relative flex w-full items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                    : "border-slate-700 bg-slate-800 hover:bg-slate-700",
                )
              }
            >
              <span className="absolute left-2 h-3 w-3 rounded-full bg-cyan-400" />
              Day Overview
              <span className="absolute right-2 rounded bg-cyan-800/60 px-1.5 py-0.5 text-xs font-semibold text-cyan-300">
                {(holidayLoad || holidayUnload) ? "Holiday" : `Day ${unloadsDay}`}
              </span>
            </NavLink>
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => nav(`/board?status=${s}`)}
                className="relative flex w-full items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-700"
              >
                <span className={clsx(
                  "absolute left-2 h-3 w-3 rounded-full",
                  STATUS_DOT[s],
                  s === "in_progress" && counts[s] > 0 && "animate-pulse",
                )} />
                {STATUS_LABEL[s]}
                <span className="absolute right-2 text-slate-300">
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
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${roleBadgeCls}`}>
                {roleLabel}
              </span>
            </div>
          </div>
          <NotificationSettingsCard />
          <button
            className="btn-ghost w-full"
            onClick={() => {
              logout();
              nav("/login");
            }}
          >
            Logout
          </button>
          <BuildInfo />
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* App top bar — mobile shows hamburger + brand, all sizes show clock/shift/day badges */}
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <span className="hidden min-[380px]:inline truncate text-sm font-semibold text-slate-200 md:hidden">ReadyRoute</span>
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 text-[11px] md:hidden">
            <span className="shrink-0 font-mono tabular-nums text-[11px] text-slate-200"><Clock compact /></span>
            <span className="inline-flex shrink-0 items-center rounded-md border border-violet-800/60 bg-violet-950/50 px-1.5 py-1 font-semibold text-violet-300">
              {shiftName}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-md border border-blue-800/60 bg-blue-950/50 px-1.5 py-1 font-semibold text-blue-300">
              {loadBadgeText}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-md border border-emerald-800/60 bg-emerald-950/50 px-1.5 py-1 font-semibold text-emerald-300">
              {unloadBadgeText}
            </span>
          </div>
          <div className="ml-auto hidden items-center gap-2 text-xs md:flex">
            <span className="font-mono"><Clock compact /></span>
            <span className="inline-flex items-center gap-1 rounded-md border border-violet-800/60 bg-violet-950/50 px-2 py-1 font-semibold text-violet-300">
              <span className="text-[10px] uppercase tracking-wider text-violet-400/70">Shift</span>
              {shiftName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-blue-800/60 bg-blue-950/50 px-2 py-1 font-semibold text-blue-300">
              <span className="text-[10px] uppercase tracking-wider text-blue-400/70">Load</span>
              Day {loadDay}{holidayLoad ? `+${loadDay === 5 ? 1 : loadDay + 1}` : ""}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/50 px-2 py-1 font-semibold text-emerald-300">
              <span className="text-[10px] uppercase tracking-wider text-emerald-400/70">Unload</span>
              Day {unloadsDay}{holidayUnload ? `+${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto pb-14 md:pb-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom nav — primary workflow actions + More drawer */}
      {primaryNav.length > 0 && (
        <>
          {/* More drawer — slides up from bottom nav */}
          {moreOpen && (
            <>
              <div
                className="fixed inset-0 z-30 bg-black/50 md:hidden"
                onClick={() => setMoreOpen(false)}
              />
              <div className="fixed bottom-12 inset-x-0 z-40 rounded-t-xl border-t border-slate-800 bg-slate-900 pb-2 shadow-xl md:hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">More</p>
                  <button onClick={() => setMoreOpen(false)} className="text-slate-500 hover:text-slate-300">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1 px-3">
                  {secondaryNav.filter((i) => allowed.has(i.to)).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          "flex flex-col items-center justify-center rounded-lg px-2 py-3 text-[11px] font-semibold transition-colors",
                          isActive
                            ? "bg-blue-600/20 text-blue-400"
                            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
            ))}
            {holdCount > 0 && (
              <button
                onClick={() => nav(`/board?status=hold`)}
                className="ml-4 relative flex w-[calc(100%-1rem)] items-center justify-center rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-amber-950/40"
              >
                <span className="absolute left-2 h-3 w-3 rounded-full bg-amber-500 animate-pulse" />
                Hold
                <span className="absolute right-2 rounded bg-amber-800/60 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
                  {holdCount}
                </span>
              </button>
            )}
          </div>
              </div>
            </>
          )}

          <nav className="fixed bottom-0 inset-x-0 z-30 flex border-t border-slate-800 bg-slate-900 md:hidden">
            {primaryNav.map((item) => {
              const showLoadBadge = item.to === "/load" && trucksNotYetLoaded > 0;
              const showUnloadBadge = item.to === "/unload" && holdCount > 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors",
                      isActive ? "text-blue-400" : "text-slate-500",
                    )
                  }
                >
                  {item.label === "Communications" ? "Comms" : item.label}
                  {showLoadBadge && (
                    <span className="absolute right-1/4 top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-600 px-1 text-[9px] font-bold text-white">
                      {trucksNotYetLoaded}
                    </span>
                  )}
                  {showUnloadBadge && (
                    <span className="absolute right-1/4 top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                      {holdCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
            {/* More button — only show if user has secondary nav items */}
            {secondaryNav.some((i) => allowed.has(i.to)) && (
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className={clsx(
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors",
                  moreOpen ? "text-blue-400" : "text-slate-500",
                )}
              >
                More
                <span className={clsx(
                  "absolute top-1.5 right-1/4 h-1 w-1 rounded-full transition-opacity",
                  secondaryNav.some((i) => allowed.has(i.to) && location.pathname === i.to)
                    ? "bg-blue-400 opacity-100"
                    : "opacity-0",
                )} />
              </button>
            )}
          </nav>
        </>
      )}

      {swapModalOpen && <RouteSwapModal onClose={() => setSwapModalOpen(false)} />}
      <NoteCardsDrawer />
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
