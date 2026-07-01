import { NavLink, Outlet, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState, useEffect } from "react";
import clsx from "clsx";
import { format, parseISO } from "date-fns";
import { useAuth } from "../contexts/AuthContext";
import { useBoard, useHolidayLoad, useHolidayUnload, useOpenSpareAssignments, useRouteSwapLog, useSettings, useWizardCompleted } from "../api/hooks";
import RouteSwapModal from "./RouteSwapModal";
import RunDayWizard from "../pages/runday/RunDayWizard";
import ToolFab from "./ToolFab";
import NotificationSettingsCard from "./NotificationSettingsCard";
import { todayIso } from "../api/client";
import { useRealtimeSync } from "../api/useRealtimeSync";
import { useOfflineSync } from "../api/useOfflineSync";
import { useToast } from "../contexts/ToastContext";
import { OfflineIndicator } from "./OfflineIndicator";
import type { AuthRole, TruckStatus, TruckWithState } from "../types";
import {
  buildHistoricalCoverageFallback,
  buildOperationalDayContext,
  buildRouteStatusCounts,
  countLoaded,
  countUnloadedFromContext,
} from "../utils/truckStatus";
import { STATUS_LABELS } from "../constants/truckStatus";
import Clock, { todayLong, workdayNumbers, shipDayNumber, currentShift } from "./Clock";
import { Menu, X } from "lucide-react";

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

const SIDEBAR_PRIMARY_NAV = [
  { to: "/unload", label: "Unload" },
  { to: "/load", label: "Load" },
  { to: "/fleet", label: "Fleet" },
  { to: "/communications", label: "Communications" },
];

const SIDEBAR_SECONDARY_NAV = [
  { to: "/shorts", label: "Short sheet" },
  { to: "/notes", label: "Notes" },
  { to: "/trends", label: "Trends" },
  { to: "/audit", label: "Audit" },
  { to: "/fleet-schedule", label: "Fleet Schedule" },
  { to: "/verify-short-sheet", label: "Verify Shorts" },
  { to: "/management", label: "Management" },
];

const MOBILE_PRIMARY_NAV = [
  { to: "/fleet-schedule", label: "Fleet Sch." },
  { to: "/audit", label: "Audit" },
  { to: "/communications", label: "Communications" },
  { to: "/shorts", label: "Short Sheet" },
];

const MOBILE_SECONDARY_NAV = [
  { to: "/unload", label: "Unload" },
  { to: "/load", label: "Load" },
  { to: "/fleet", label: "Fleet" },
  { to: "/notes", label: "Notes" },
  { to: "/trends", label: "Trends" },
  { to: "/management", label: "Management" },
];

// Mirrors V1 ROLE_SCREEN_ACCESS — which nav links each role can see.
const ROLE_NAV_ACCESS: Record<AuthRole, Set<string>> = {
  admin: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management"]),
  fleet: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management"]),
  atl: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management"]),
  supervisor: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management"]),
  lead: new Set(["/unload", "/load", "/fleet", "/communications", "/shorts", "/notes", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management"]),
  loader: new Set(["/load", "/communications", "/audit"]),
  unloader: new Set(["/unload", "/communications"]),
  guest: new Set(["/fleet-schedule"]),
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
  guest:      "bg-surface-2 text-ink-faint ring-1 ring-hairline",
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
    <div className="pt-2 text-center text-[10px] leading-tight text-ink-faint">
      <p>
        ReadyRoute V2 · {isDev ? `${version} · dev` : version}
      </p>
      {(shortCommit || dateLabel) && !isDev && (
        <p className="text-ink-faint/60">
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
  const resolvedVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // In dev show the predicted next build label (from vite.config) with a marker
  // so it's clear it isn't pushed yet; in prod show the shipped build label.
  const appVersion = import.meta.env.DEV ? `${resolvedVersion} · dev` : resolvedVersion;
  const { data: allSettings } = useSettings();
  const settingsMap = useMemo(() => allSettings ? new Map(allSettings.map((s) => [s.key, s.value])) : new Map(), [allSettings]);

  const nav = useNavigate();
  const location = useLocation();
  const { data: board } = useBoard(todayIso());
  const { data: swapLog = [] } = useRouteSwapLog(60);
  const { data: openSpareAssignments = [] } = useOpenSpareAssignments();
  const { data: holidayLoad = false } = useHolidayLoad(todayIso());
  const { data: holidayUnload = false } = useHolidayUnload(todayIso());
  const { data: wizardDone = false } = useWizardCompleted(todayIso());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open wizard when ?setup=1 appears in the URL (e.g. from an old link or redirect)
  useEffect(() => {
    if (searchParams.get("setup") === "1") {
      setWizardOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const canManageSwaps = ["admin", "fleet", "supervisor", "atl"].includes(user?.role ?? "");

  // Real-time sync: invalidates React Query caches on server-push events
  const { isWsConnected } = useRealtimeSync();

  // Offline sync: queue + flush + connectivity state
  const toast = useToast();
  const offlineState = useOfflineSync({
    onConflict: (n) =>
      toast.info(
        `${n} offline change${n === 1 ? "" : "s"} couldn't be synced — already updated on the server.`,
      ),
  });

  // Close sidebar and more drawer on route change (mobile nav tap)
  useEffect(() => {
    setSidebarOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  // Guests are read-only and locked to Day Overview
  useEffect(() => {
    if (user?.role === "guest" && location.pathname !== "/" && location.pathname !== "/fleet-schedule") {
      nav("/", { replace: true });
    }
  }, [user?.role, location.pathname, nav]);

  const { loadDay, unloadsDay } = workdayNumbers();
  const loadDayNum = loadDay;

  const historicalCoverageFallback = useMemo(
    () => buildHistoricalCoverageFallback(board ?? [], openSpareAssignments, swapLog, todayIso()),
    [board, openSpareAssignments, swapLog],
  );
  const counts = useMemo(
    () => buildRouteStatusCounts(board ?? [], loadDayNum, holidayLoad, unloadsDay, holidayUnload, historicalCoverageFallback),
    [board, loadDayNum, unloadsDay, holidayLoad, holidayUnload, historicalCoverageFallback],
  );

  // Hold count for nav badges — priority_hold trucks on the Unload page.
  const holdCount = useMemo(
    () =>
      (board ?? []).filter(
        (t) =>
          t.state?.priority_hold === true &&
          (t.state?.status === "dirty" || t.state == null),
      ).length,
    [board],
  );

  // Non-spare unloaded count for the sidebar — spares are excluded from this bucket.
  // Load progress mirrors the Day Overview: denominator = route trucks scheduled
  // for load; a route counts as done when the route truck is loaded OR its covering spare is.
  const loadContext = useMemo(
    () => buildOperationalDayContext(board ?? [], loadDayNum, holidayLoad, false),
    [board, loadDayNum, holidayLoad],
  );
  const totalScheduledLoad = loadContext.activeTrucks.length;
  // Match the board's loaded filter exactly — uses shared helper.
  const loadedScheduled = useMemo(
    () => countLoaded(board ?? [], loadDayNum, holidayLoad, unloadsDay, holidayUnload),
    [board, loadDayNum, unloadsDay, holidayLoad, holidayUnload],
  );

  // Unload denominator = routes scheduled to run today (not off, not replaced by spare).
  // Numerator = how many of THOSE same routes are unloaded — counted from the same
  // context as the denominator so a spare covering an off-day route can't push the
  // numerator above the total (was causing e.g. 29/28).
  const unloadScheduleContext = useMemo(
    () => buildOperationalDayContext(board ?? [], unloadsDay, holidayUnload, false),
    [board, unloadsDay, holidayUnload],
  );
  const totalScheduledUnload = unloadScheduleContext.activeTrucks.length;
  const unloadedScheduled = useMemo(
    () => countUnloadedFromContext(unloadScheduleContext),
    [unloadScheduleContext],
  );

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
    totalScheduledUnload > 0
      ? Math.round((unloadedScheduled / totalScheduledUnload) * 100)
      : 0;

  const DISPLAY_ROLE_OVERRIDE: Record<string, { label: string; cls: string }> = {
    nate: { label: "Lead", cls: ROLE_BADGE.supervisor },
  };
  const roleOverride = user?.username ? DISPLAY_ROLE_OVERRIDE[user.username] : undefined;
  const roleLabel = roleOverride?.label ?? user?.display_role ?? ROLE_LABELS[(user?.role ?? "guest") as AuthRole] ?? user?.role ?? "";
  const roleBadgeCls = roleOverride?.cls ?? ROLE_BADGE[(user?.role ?? "guest") as AuthRole] ?? ROLE_BADGE.guest;
  const allowed = ROLE_NAV_ACCESS[(user?.role ?? "guest") as AuthRole] ?? new Set<string>();
  const isGuest = user?.role === "guest";
  const sidebarPrimaryNav = isGuest
    ? [...SIDEBAR_PRIMARY_NAV, ...SIDEBAR_SECONDARY_NAV].filter((i) => allowed.has(i.to))
    : SIDEBAR_PRIMARY_NAV.filter((i) => allowed.has(i.to));
  const sidebarSecondaryNav = isGuest ? [] : SIDEBAR_SECONDARY_NAV.filter((i) => allowed.has(i.to));
  const mobilePrimaryNav = isGuest
    ? [...MOBILE_PRIMARY_NAV, ...MOBILE_SECONDARY_NAV].filter((i) => allowed.has(i.to))
    : MOBILE_PRIMARY_NAV.filter((i) => allowed.has(i.to));
  const mobileSecondaryNav = isGuest ? [] : MOBILE_SECONDARY_NAV.filter((i) => allowed.has(i.to));
  const shiftName = currentShift().name;
  const loadBadgeText = `L${loadDay}${holidayLoad ? `+${loadDay === 5 ? 1 : loadDay + 1}` : ""}`;
  const unloadBadgeText = `U${unloadsDay}${holidayUnload ? `+${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}`;

  return (
    <div className="flex h-screen bg-app text-ink-soft">

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
          "fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-hairline bg-[#0e1320] transition-transform duration-200 ease-in-out",
          "md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex-1 space-y-3 overflow-y-auto p-[14px] pt-safe">
          {/* Brand header */}
          <div className="flex items-center gap-3 px-1 pt-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 text-lg font-black text-white shadow-lg shadow-cyan-500/30">
              R
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-white">rdyroute.app</p>
              <p className="font-mono text-xs text-ink-faint">{appVersion}</p>
            </div>
          </div>

          {/* Setup Day button */}
          {!isGuest && (
            <button
              onClick={() => setWizardOpen(true)}
              className={clsx(
                "block w-full rounded-[10px] border px-3 py-2 text-center text-sm font-medium transition-colors",
                wizardDone
                  ? "border-hairline bg-surface text-ink-soft hover:bg-surface-2"
                  : "border-[rgba(245,158,11,0.30)] bg-[rgba(245,158,11,0.08)] text-[#fbbf5c] hover:bg-[rgba(245,158,11,0.15)]",
              )}
            >
              {wizardDone ? "Setup Day" : "Setup Day (optional override)"}
            </button>
          )}

          {canManageSwaps && (
            <button
              onClick={() => setSwapModalOpen(true)}
              className="block w-full rounded-[10px] border border-hairline bg-surface px-3 py-2 text-center text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
            >
              Route Swaps
            </button>
          )}

          {/* Workday context */}
          <div className="rounded-xl border border-hairline bg-[#121826] p-[11px] grid grid-cols-2 gap-[9px_8px]">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-faint/80">Workday</p>
              <p className="mt-0.5 text-xs font-semibold text-ink-soft">{todayLong()}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-faint/80">Shift</p>
              <p className="mt-0.5 text-xs font-semibold text-ink-soft">{currentShift().label} · {currentShift().hours}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7cc4ff]">Load</p>
              <p className="mt-0.5 font-mono text-xs font-semibold text-ink-soft">Day {loadDay}{holidayLoad ? ` + ${loadDay === 5 ? 1 : loadDay + 1}` : ""}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#5eead4]">Unload</p>
              <p className="mt-0.5 font-mono text-xs font-semibold text-ink-soft">Day {unloadsDay}{holidayUnload ? ` + ${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}</p>
            </div>
          </div>

          {/* Clock */}
          <div className="text-center">
            <Clock />
          </div>

          {/* Primary action buttons */}
          <div className="space-y-[6px] pt-2">
            {sidebarPrimaryNav.map((item) => {
              const showLoadBadge = item.to === "/load" && trucksNotYetLoaded > 0;
              const showUnloadBadge = item.to === "/unload" && holdCount > 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "relative flex items-center justify-center rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "border-[rgba(59,130,246,0.34)] bg-[rgba(59,130,246,0.14)] text-[#7cc4ff]"
                        : "border-hairline bg-surface text-[#aab4c4] hover:bg-surface-2",
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

          <hr className="border-hairline" />

          {/* Live status counters */}
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Live Status
          </p>
          <div className="space-y-[4px]">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                clsx(
                  "relative flex w-full items-center justify-center rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-[rgba(139,92,246,0.32)] bg-[rgba(139,92,246,0.14)] text-[#c4b5fd]"
                    : "border-hairline bg-surface text-[#aab4c4] hover:bg-surface-2",
                )
              }
            >
              <span className="absolute left-2 h-3 w-3 rounded-full bg-purple-400" />
              Day Overview
              <span className="absolute right-2 rounded bg-[rgba(167,139,250,0.16)] px-1.5 py-0.5 text-xs font-semibold text-[#c4b5fd]">
                {(holidayLoad || holidayUnload) ? "Holiday" : `Day ${unloadsDay}`}
              </span>
            </NavLink>
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => nav(`/board?status=${s}`)}
                className="relative flex w-full items-center justify-center rounded-[9px] border border-hairline bg-[#141a27] px-3 py-1.5 text-sm font-medium text-[#aab4c4] transition-colors hover:bg-surface-2"
              >
                <span className={clsx(
                  "absolute left-2 h-3 w-3 rounded-full",
                  STATUS_DOT[s],
                  s === "in_progress" && counts[s] > 0 && "animate-pulse",
                )} />
                {STATUS_LABELS[s]}
                <span className="absolute right-2 text-ink-muted">
                  {s === "in_progress"
                    ? inProgressTruck
                      ? <span className="font-mono text-base font-bold text-[#fbbf5c]">#{inProgressTruck.truck_number}</span>
                      : <span className="text-ink-faint">None</span>
                    : counts[s]}
                </span>
              </button>
            ))}
          </div>

          {/* Load / Unload progress */}
          <div className="flex flex-col gap-[10px] rounded-xl border border-hairline bg-[#121826] p-[11px]">
            <p className="text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5eead4]">
              Load / Unload Progress
            </p>
            <ProgressRow label="Load" current={loadedScheduled} total={totalScheduledLoad} pct={loadedPct} color="#3b82f6" />
            <ProgressRow
              label="Unload"
              current={unloadedScheduled}
              total={totalScheduledUnload}
              pct={unloadedPct}
              color="#22c55e"
            />
          </div>

          <hr className="border-hairline" />

          {/* Secondary navigation */}
          <div className="grid grid-cols-2 gap-[6px]">
            {sidebarSecondaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    "flex min-h-[36px] items-center justify-center rounded-[9px] border border-hairline px-2 py-1 text-center text-xs font-medium leading-tight transition-colors",
                    isActive
                      ? "bg-[rgba(59,130,246,0.13)] text-[#7cc4ff]"
                      : "bg-surface text-[#aab4c4] hover:bg-surface-2",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          <hr className="border-hairline" />

          {/* User block */}
          <div className="rounded-xl border border-hairline bg-[#121826] p-[10px] text-center text-xs">
            <p className="text-ink-faint">Signed in as</p>
            <p className="text-sm font-bold text-ink">{user?.username}</p>
            <div className="mt-1 flex justify-center">
              <span className={`inline-flex items-center rounded-pill px-[10px] py-[2px] text-[10px] font-bold uppercase tracking-[0.08em] ${roleBadgeCls}`}>
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
            {user?.role === "guest" ? "Login" : "Logout"}
          </button>
          <BuildInfo />
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* App top bar — mobile shows hamburger + brand, all sizes show clock/shift/day badges */}
        <header className="sticky top-0 z-10 flex min-h-[54px] items-center gap-2 border-b border-hairline bg-[rgba(13,18,28,0.7)] backdrop-blur px-[22px] pt-safe md:min-h-[68px]">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 rounded-md p-2.5 text-ink-faint hover:bg-surface hover:text-ink md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex shrink-0 items-center md:hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-teal-500 text-sm font-black text-white shadow-md shadow-cyan-500/30">
              R
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-1 md:hidden">
            <span className="shrink-0 font-mono tabular-nums text-xs text-ink-soft"><Clock compact /></span>
            <span className="inline-flex shrink-0 items-center rounded-[9px] border border-[rgba(139,92,246,0.24)] bg-[rgba(139,92,246,0.10)] px-[11px] py-[4px] text-xs font-semibold text-[#c4b5fd]">
              {shiftName}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-[9px] border border-[rgba(59,130,246,0.24)] bg-[rgba(59,130,246,0.10)] px-[11px] py-[4px] text-xs font-semibold text-[#93c5fd]">
              {loadBadgeText}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-[9px] border border-[rgba(16,185,129,0.24)] bg-[rgba(16,185,129,0.10)] px-[11px] py-[4px] text-xs font-semibold text-[#6ee7b7]">
              {unloadBadgeText}
            </span>
          </div>
          <div className="ml-auto hidden items-center gap-3 text-sm md:flex">
            <Clock compact className="font-mono text-2xl font-bold tabular-nums text-blue-400" />
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(139,92,246,0.24)] bg-[rgba(139,92,246,0.10)] px-4 py-2 font-semibold text-[#c4b5fd]">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8b6fd1]">Shift</span>
              {shiftName}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(59,130,246,0.24)] bg-[rgba(59,130,246,0.10)] px-4 py-2 font-semibold text-[#93c5fd]">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5a8fd6]">Load</span>
              Day {loadDay}{holidayLoad ? `+${loadDay === 5 ? 1 : loadDay + 1}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(16,185,129,0.24)] bg-[rgba(16,185,129,0.10)] px-4 py-2 font-semibold text-[#6ee7b7]">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#4f9e84]">Unload</span>
              Day {unloadsDay}{holidayUnload ? `+${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto pb-nav-safe md:pb-0">
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

        <ToolFab />
      </div>

      {/* Mobile bottom nav — primary workflow actions + More drawer */}
      {mobilePrimaryNav.length > 0 && (
        <>
          {/* More drawer — slides up from bottom nav */}
          {moreOpen && (
            <>
              <div
                className="fixed inset-0 z-30 bg-black/50 md:hidden"
                onClick={() => setMoreOpen(false)}
              />
              <div className="fixed inset-x-0 z-40 rounded-t-xl border-t border-hairline bg-[#0e1320] pb-2 shadow-xl md:hidden" style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom))' }}>
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">More</p>
                  <button onClick={() => setMoreOpen(false)} className="text-ink-faint hover:text-ink-soft">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1 px-3">
                  {mobileSecondaryNav.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          "flex flex-col items-center justify-center rounded-lg px-2 py-4 text-[11px] font-semibold transition-colors",
                          isActive
                            ? "bg-[rgba(59,130,246,0.20)] text-blue-400"
                            : "text-ink-faint hover:bg-surface hover:text-ink-soft",
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

          <nav className="fixed bottom-0 inset-x-0 z-30 flex border-t border-hairline bg-[#0e1320] pb-safe md:hidden">
            {mobilePrimaryNav.map((item) => {
              const showLoadBadge = item.to === "/load" && trucksNotYetLoaded > 0;
              const showUnloadBadge = item.to === "/unload" && holdCount > 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-3 text-[10px] font-semibold leading-tight transition-colors",
                      isActive ? "text-blue-400" : "text-ink-faint",
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
            {mobileSecondaryNav.length > 0 && (
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className={clsx(
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold leading-tight transition-colors",
                  moreOpen ? "text-blue-400" : "text-ink-faint",
                )}
                style={{ minHeight: '44px' }}
              >
                More
                <span className={clsx(
                  "absolute top-1.5 right-1/4 h-1 w-1 rounded-full transition-opacity",
                  mobileSecondaryNav.some((i) => location.pathname === i.to)
                    ? "bg-blue-400 opacity-100"
                    : "opacity-0",
                )} />
              </button>
            )}
          </nav>
        </>
      )}

      {swapModalOpen && <RouteSwapModal onClose={() => setSwapModalOpen(false)} />}
      {wizardOpen && (
        <RunDayWizard
          runDate={todayIso()}
          board={board ?? []}
          loadDay={loadDay}
          unloadsDay={unloadsDay}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

function ProgressRow({
  label,
  current,
  total,
  pct,
  color = "#3b82f6",
}: {
  label: string;
  current: number;
  total: number;
  pct: number;
  color?: string;
}) {
  return (
    <div>
      <div className="mb-[5px] flex items-center justify-between text-[11.5px]">
        <span className="font-semibold text-ink-soft">{label}</span>
        <span className="font-mono text-ink-muted">
          {current}/{total}
        </span>
      </div>
      <div className="mt-[4px] h-[3px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
