import { NavLink, Outlet, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import clsx from "clsx";
import { format, parseISO } from "date-fns";
import { useAuth } from "../contexts/AuthContext";
import { useBoard, useHolidayLoad, useHolidayUnload, useOpenSpareAssignments, usePrevDayCarriers, usePrevDaySplitHelpers, useRouteSwapLog, useSettings, useToastSettings, useWizardCompleted, type ToastKind } from "../api/hooks";
import RouteSwapModal from "./RouteSwapModal";
import RunDayWizard from "../pages/runday/RunDayWizard";
import ToolFab from "./ToolFab";
import NotificationSettingsCard from "./NotificationSettingsCard";
import { todayIso } from "../api/client";
import { useRealtimeSync } from "../api/useRealtimeSync";
import { useOfflineSync } from "../api/useOfflineSync";
import { playChime, primeAudio } from "../utils/chime";
import { useToast } from "../contexts/ToastContext";
import { OfflineIndicator } from "./OfflineIndicator";
import type { AuthRole, TruckStatus, TruckWithState } from "../types";
import {
  buildHistoricalCoverageFallback,
  buildOperationalDayContext,
  buildRouteStatusCounts,
  countLoaded,
  countUnloadedFromContext,
  loadedTruckNumbers,
  unloadedTruckNumbersFromContext,
} from "../utils/truckStatus";
import { reportProgressOverflow } from "../utils/debugLog";
import { setAppNavigator } from "../utils/navigation";
import { STATUS_BG, STATUS_LABELS } from "../constants/truckStatus";
import Clock, { todayLong, workdayNumbers, shipDayNumber, currentShift } from "./Clock";
import { Menu, X } from "lucide-react";
import { ROLE_BADGE_CLASS, ROLE_LABELS } from "../utils/permissions";


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
  { to: "/report", label: "Report" },
  { to: "/fleet-schedule", label: "Fleet Schedule" },
  { to: "/batching", label: "Batching" },
  { to: "/shorts", label: "Short sheet" },
  { to: "/audit", label: "Audit" },
  { to: "/notes", label: "Notes" },
  { to: "/documents", label: "Documents" },
  { to: "/trends", label: "Trends" },
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
  { to: "/report", label: "Report" },
  { to: "/unload", label: "Unload" },
  { to: "/load", label: "Load" },
  { to: "/fleet", label: "Fleet" },
  { to: "/batching", label: "Batching" },
  { to: "/notes", label: "Notes" },
  { to: "/documents", label: "Documents" },
  { to: "/trends", label: "Trends" },
  { to: "/management", label: "Management" },
];

// Mirrors V1 ROLE_SCREEN_ACCESS — which nav links each role can see.
const ROLE_NAV_ACCESS: Record<AuthRole, Set<string>> = {
  admin: new Set(["/unload", "/load", "/fleet", "/batching", "/communications", "/shorts", "/notes", "/documents", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management", "/report"]),
  fleet: new Set(["/unload", "/load", "/fleet", "/batching", "/communications", "/shorts", "/notes", "/documents", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management", "/report"]),
  atl: new Set(["/unload", "/load", "/fleet", "/batching", "/communications", "/shorts", "/notes", "/documents", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management", "/report"]),
  supervisor: new Set(["/unload", "/load", "/fleet", "/batching", "/communications", "/shorts", "/notes", "/documents", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management", "/report"]),
  lead: new Set(["/unload", "/load", "/fleet", "/batching", "/communications", "/shorts", "/notes", "/documents", "/trends", "/audit", "/fleet-schedule", "/verify-short-sheet", "/management", "/report"]),
  loader: new Set(["/load", "/communications", "/audit"]),
  unloader: new Set(["/unload", "/communications"]),
  guest: new Set(["/fleet-schedule", "/report"]),
};

// Role labels/badges come from utils/permissions — Layout kept private
// copies once, and they drifted (loader read "Load" here, "Loader" there).
const ROLE_BADGE = ROLE_BADGE_CLASS;

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
  // Lend routing to the toasts, which render outside the router (see
  // utils/navigation).
  useEffect(() => {
    setAppNavigator((to) => nav(to));
    return () => setAppNavigator(null);
  }, [nav]);
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
    // STICKY (durationMs 0): this is the only notice the user gets that queued
    // offline work was dropped — permanent data loss must not fade out in
    // 3.5 seconds. Copy stays cause-neutral: rejections aren't always "someone
    // else updated it" (a 400/403 lands here too).
    onConflict: (n) =>
      toast.info(
        `${n} offline change${n === 1 ? "" : "s"} couldn't be synced and ${n === 1 ? "was" : "were"} discarded. Check the board before redoing ${n === 1 ? "it" : "them"}.`,
        { durationMs: 0, title: "Offline changes dropped" },
      ),
  });

  // A driver added a note from their QR page: the notes query is already
  // refreshed by useRealtimeSync — surface a clickable toast that jumps to the
  // truck on the Notes board. Longer dwell than a normal toast since it's an
  // action, not just feedback.
  // Pop-up settings (Management → Operations → Pop-ups): a master switch plus
  // a per-kind enable and dwell time. Master off means the listeners are never
  // attached, so nothing queues up and nothing fires the moment it's turned
  // back on. Deliberately does NOT cover the offline-sync conflict toast above:
  // that reports on the user's own unsaved changes and losing it silently
  // would hide real data loss.
  const toastSettings = useToastSettings();
  const toastsEnabled = toastSettings.enabled;
  // seconds → ms, with 0 passed straight through as ToastContext's "sticky".
  const kindMs = useCallback(
    (kind: ToastKind) => toastSettings.kinds[kind].seconds * 1000,
    [toastSettings],
  );
  const kindOn = useCallback(
    (kind: ToastKind) => toastSettings.kinds[kind].enabled,
    [toastSettings],
  );
  const kindSound = useCallback(
    (kind: ToastKind) => toastSettings.kinds[kind].sound === true,
    [toastSettings],
  );

  // Unlock audio on the first real gesture. Browsers refuse to start an
  // AudioContext without one, and the arrival chime is useless if the wall
  // display's context is still locked — one tap anywhere, ever, is enough.
  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime, { once: true, capture: true });
    window.addEventListener("keydown", prime, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", prime, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", prime, { capture: true } as EventListenerOptions);
    };
  }, []);

  useEffect(() => {
    if (!toastsEnabled || !kindOn("driver_note")) return;
    const onDriverNote = (e: Event) => {
      const d = (e as CustomEvent<{ truck_number?: number; body?: string }>).detail ?? {};
      const truck = d.truck_number;
      toast.info(d.body?.trim() || "Tap to view the note.", {
        title: "New Driver Note",
        chip: truck != null ? `#${truck}` : undefined,
        durationMs: kindMs("driver_note"),
        settingsKind: "driver_note",
        onClick: () => nav(truck != null ? `/notes?truck=${truck}` : "/notes"),
      });
    };
    window.addEventListener("readyroute:driver-note", onDriverNote);
    return () => window.removeEventListener("readyroute:driver-note", onDriverNote);
  }, [toast, nav, toastsEnabled, kindOn, kindMs]);

  // Everything else that's worth interrupting someone for: chat, notices,
  // arrivals, and the server's own notifications (hold / OOS / coverage).
  // All of them skip the person who caused the event, and de-dupe by tag so a
  // burst (e.g. clearing every swap) doesn't stack a wall of toasts.
  const seenToastTags = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!toastsEnabled) return;
    const me = user?.username;
    const once = (tag: string, withinMs = 10_000): boolean => {
      const now = Date.now();
      const prev = seenToastTags.current.get(tag);
      if (prev && now - prev < withinMs) return false;
      seenToastTags.current.set(tag, now);
      return true;
    };

    const onAppEvent = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail ?? {};
      // Normally we don't toast you for your own action. "truck unloaded" is the
      // exception: it's a workflow confirmation for the Fleet/Load screens, and
      // on a small crew the same person often unloads AND loads — suppressing it
      // meant whoever did the work never saw it.
      const selfActionOk = d.type === "truck_unloaded";
      if (!selfActionOk && typeof d.actor === "string" && me && d.actor === me) return;
      const truck = typeof d.truck_number === "number" ? d.truck_number : null;

      if (d.type === "chat_message") {
        if (!kindOn("chat_message")) return;
        const who = typeof d.username === "string" ? d.username : "Someone";
        if (!once(`chat-${who}-${String(d.body ?? "")}`)) return;
        toast.info(String(d.body || "Tap to open the conversation."), {
          title: `New message · ${who}`,
          durationMs: kindMs("chat_message"),
          settingsKind: "chat_message",
          onClick: () => nav("/communications"),
        });
      } else if (d.type === "notice_created") {
        if (!kindOn("notice")) return;
        if (!once(`notice-${String(d.notice_id ?? "")}`)) return;
        toast.info(String(d.body || "Tap to read it on the Run Day board."), {
          title: `Notice · ${String(d.title ?? "")}`.trim(),
          durationMs: kindMs("notice"),
          settingsKind: "notice",
          onClick: () => nav("/"),
        });
      } else if (d.type === "truck_unloaded") {
        // Unloads happen ~30x a shift, so this one is scoped to the two pages
        // that actually care: Fleet and Load (a freshly unloaded truck is the
        // next thing to load). Everywhere else it would just be noise.
        if (!kindOn("truck_unloaded")) return;
        const onFleetOrLoad = location.pathname === "/fleet" || location.pathname === "/load";
        if (!onFleetOrLoad || truck == null || !once(`unloaded-${truck}`)) return;
        toast.info("Unloaded — ready to load.", {
          title: "Truck unloaded",
          chip: `#${truck}`,
          // Defaults to a long dwell: whoever walks up to Load should still see
          // the trucks that came ready while they were away from the screen.
          durationMs: kindMs("truck_unloaded"),
          settingsKind: "truck_unloaded",
          onClick: () => nav(`/fleet?truck=${truck}`),
        });
      } else if (d.type === "load_request") {
        // Aimed at the dock and nobody else, so it's scoped to /unload the way
        // truck_unloaded is scoped to Fleet/Load. The dedupe tag carries the
        // VALUE: a want -> skip correction inside the 10s window is a different
        // message, and swallowing it would be the worst possible bug here.
        if (!kindOn("load_request")) return;
        const req = (d as { request?: string }).request ?? null;
        if (location.pathname !== "/unload" || truck == null) return;
        if (!once(`load-req-${truck}-${req ?? "clear"}`)) return;
        if (req == null) return; // a clear needs no announcement
        if (kindSound("load_request")) playChime();
        toast.info(
          req === "want"
            ? "Load wants this one — pull it forward."
            : "Load asked to back out of this one.",
          {
            title: "Load asked",
            chip: `#${truck}`,
            durationMs: kindMs("load_request"),
            settingsKind: "load_request",
            onClick: () => nav(`/unload?truck=${truck}`),
          },
        );
      } else if (d.type === "truck_arrived") {
        if (!kindOn("truck_arrived")) return;
        if (truck == null || !once(`arrived-${truck}`)) return;
        // Audible on the wall display: the dock crew works heads-down, and the
        // chime obeys exactly the gates the toast just passed (master switch,
        // kind enable, self-suppression, dedupe).
        if (kindSound("truck_arrived")) playChime();
        toast.info("Parked in the yard — ready to unload.", {
          title: "Truck arrived",
          chip: `#${truck}`,
          durationMs: kindMs("truck_arrived"),
          settingsKind: "truck_arrived",
          onClick: () => nav(`/unload?truck=${truck}`),
        });
      }
    };

    // Server-side notifications (priority hold, OOS, coverage assigned/changed/
    // removed). These already carried a url; they were only shown as a plain,
    // unclickable toast and ONLY on push-enabled devices. Now every session
    // gets the same rich card.
    const onNotification = (e: Event) => {
      const n = (e as CustomEvent<import("../types").NotificationEvent & { actor?: string }>).detail;
      if (!n) return;
      // Arrivals are push-only on the server (send_web_push, no "notification"
      // broadcast); the in-app toast rides the dedicated truck_arrived event
      // above. If a future change routes them through dispatch_notification,
      // this stops a duplicate toast filed under the wrong ("coverage") kind.
      if (n.type === "truck_arrived") return;
      if (n.actor && me && n.actor === me) return;
      if (!once(`notif-${n.tag}`)) return;
      const chipTruck = n.truck_number ?? n.route_truck ?? null;
      // Hold and OOS default to sticky because they must be acknowledged;
      // everything else the server sends here is a coverage change. Each maps
      // to its own configurable kind.
      const kind: ToastKind =
        n.type === "truck_hold" ? "truck_hold" : n.type === "truck_oos" ? "truck_oos" : "coverage";
      if (!kindOn(kind)) return;
      const isAlert = kind === "truck_hold" || kind === "truck_oos";
      toast.push(n.body, isAlert ? "error" : "info", {
        title: n.title,
        chip: chipTruck != null ? `#${chipTruck}` : undefined,
        durationMs: kindMs(kind),
        settingsKind: kind,
        onClick: () => nav(n.url || "/fleet"),
      });
    };

    window.addEventListener("readyroute:app-event", onAppEvent);
    window.addEventListener("readyroute:notification", onNotification);
    return () => {
      window.removeEventListener("readyroute:app-event", onAppEvent);
      window.removeEventListener("readyroute:notification", onNotification);
    };
  }, [toast, nav, user?.username, location.pathname, toastsEnabled, kindOn, kindMs, kindSound]);

  // Close sidebar and more drawer on route change (mobile nav tap)
  useEffect(() => {
    setSidebarOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  // Guests are read-only and locked to the pages they're allowed to view
  // (Day Overview, Fleet Schedule, and the shareable Run Report).
  const GUEST_PATHS = ["/", "/fleet-schedule", "/report"];
  useEffect(() => {
    if (user?.role === "guest" && !GUEST_PATHS.includes(location.pathname)) {
      nav("/", { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Trucks physically back in the yard and still dirty (driver tapped "I'm
  // Back" / lead tapped Arrived). Approximate the same way holdCount is — no
  // roster context here — an exotic coverage case can be off by one.
  const inYardCount = useMemo(
    () =>
      (board ?? []).filter(
        (t) =>
          t.state?.status === "dirty" &&
          t.state?.arrived_at != null &&
          t.state?.priority_hold !== true,
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
  // Prev-day split helpers are extra unload slots (they ran carrying overflow).
  const prevSplitHelpers = usePrevDaySplitHelpers(todayIso());
  const unloadScheduleContext = useMemo(
    () => buildOperationalDayContext(board ?? [], unloadsDay, holidayUnload, false, "unload", prevSplitHelpers),
    [board, unloadsDay, holidayUnload, prevSplitHelpers],
  );
  const totalScheduledUnload = unloadScheduleContext.activeTrucks.length;
  // Prev-day carriers so a covered route counts done once its carrier is.
  const prevDayCarriers = usePrevDayCarriers(todayIso(), board ?? []);
  const unloadedScheduled = useMemo(
    () => countUnloadedFromContext(unloadScheduleContext, prevDayCarriers),
    [unloadScheduleContext, prevDayCarriers],
  );

  // Debug: capture the intermittent "N+1 of N" progress overflow with the
  // offending truck, logged server-side so a floor-device-only occurrence is
  // retrievable centrally. The load numerator (countLoaded) scans the whole
  // board, so it can exceed the route denominator; unload is a subset (defensive).
  useEffect(() => {
    reportProgressOverflow(
      "Load (sidebar)",
      loadedTruckNumbers(board ?? [], loadDayNum, holidayLoad, unloadsDay, holidayUnload),
      loadContext.activeTrucks.map((t) => t.truck_number),
      { run_date: todayIso(), loadDay: loadDayNum },
    );
    reportProgressOverflow(
      "Unload (sidebar)",
      unloadedTruckNumbersFromContext(unloadScheduleContext),
      unloadScheduleContext.activeTrucks.map((t) => t.truck_number),
      { run_date: todayIso(), unloadsDay },
    );
  }, [board, loadDayNum, unloadsDay, holidayLoad, holidayUnload, loadContext, unloadScheduleContext]);

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
  // The truck the unload crew is emptying RIGHT NOW (one at a time, enforced
  // server-side). Status-guarded exactly like Load.tsx's unloadingNow: a
  // marker left on an already-unloaded row must not keep the chip lit.
  const unloadingTruck = useMemo(
    () =>
      (board ?? []).find(
        (t) =>
          t.state?.unloading_started_at != null &&
          (t.state.status === "dirty" || t.state.status === "unfinished"),
      ),
    [board],
  );
  const unloadedPct =
    totalScheduledUnload > 0
      ? Math.round((unloadedScheduled / totalScheduledUnload) * 100)
      : 0;

  // display_role (a DB field, editable in Management → Users) is the ONLY
  // per-person label override — a hardcoded username map lived here once.
  const roleLabel = user?.display_role ?? ROLE_LABELS[(user?.role ?? "guest") as AuthRole] ?? user?.role ?? "";
  const roleBadgeCls = ROLE_BADGE[(user?.role ?? "guest") as AuthRole] ?? ROLE_BADGE.guest;
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
          "fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-hairline bg-surface-3 transition-transform duration-200 ease-in-out",
          "md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex-1 space-y-3 overflow-y-auto p-3.5 pt-safe">
          {/* Brand header */}
          <div className="flex items-center gap-3 px-1 pt-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-lg font-black text-white shadow-lg shadow-blue-500/30">
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
                "block w-full rounded-xl border px-3 py-2 text-center text-sm font-medium transition-colors",
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
              className="block w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-center text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
            >
              Route Swaps
            </button>
          )}

          {/* Workday context */}
          <div className="rounded-xl border border-hairline bg-surface-2 p-3 grid grid-cols-2 gap-2">
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
          <div className="space-y-1.5 pt-2">
            {sidebarPrimaryNav.map((item) => {
              const showLoadBadge = item.to === "/load" && trucksNotYetLoaded > 0;
              const showUnloadBadge = item.to === "/unload" && holdCount > 0;
              const showYardBadge = item.to === "/unload" && inYardCount > 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "relative flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "border-[rgba(59,130,246,0.34)] bg-[rgba(59,130,246,0.14)] text-[#7cc4ff]"
                        : "border-hairline bg-surface text-ink-soft hover:bg-surface-2",
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
                  {showYardBadge && (
                    <span className={clsx(
                      "absolute inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-500 px-1 text-[10px] font-bold text-white",
                      showUnloadBadge ? "right-8" : "right-2",
                    )}>
                      {inYardCount}
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
          <div className="space-y-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                clsx(
                  "relative flex w-full items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-[rgba(139,92,246,0.32)] bg-[rgba(139,92,246,0.14)] text-[#c4b5fd]"
                    : "border-hairline bg-surface text-ink-soft hover:bg-surface-2",
                )
              }
            >
              <span className="absolute left-2 h-3 w-3 rounded-full bg-purple-400" />
              Day Overview
              {/* Compact on purpose: the rail is ~155px and "Unload 1" ran
                  under the centred label. "U1" matches the U Off / L Off
                  shorthand the truck cards already use, and the sidebar's
                  workday card right above spells both days out in full. */}
              <span
                title={`Unload Day ${unloadsDay}`}
                className="absolute right-2 rounded bg-[rgba(167,139,250,0.16)] px-1.5 py-0.5 text-xs font-semibold text-[#c4b5fd]"
              >
                {(holidayLoad || holidayUnload) ? "Holiday" : `U${unloadsDay}`}
              </span>
            </NavLink>
            {/* One In Progress row, not a Loading row plus an Unloading row.
                What's on each dock live is already spelled out in the top
                banner; repeating it here twice more made the rail hard to
                read. */}
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => nav(`/board?status=${s}`)}
                className="relative flex w-full items-center justify-center rounded-lg border border-hairline bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
              >
                <span className={clsx(
                  "absolute left-2 h-3 w-3 rounded-full",
                  STATUS_BG[s],
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
          <div className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-surface-2 p-3">
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
                    "flex min-h-[36px] items-center justify-center rounded-lg border border-hairline px-2 py-1 text-center text-xs font-medium leading-tight transition-colors",
                    isActive
                      ? "bg-[rgba(59,130,246,0.13)] text-[#7cc4ff]"
                      : "bg-surface text-ink-soft hover:bg-surface-2",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          <hr className="border-hairline" />

          {/* User block */}
          <div className="rounded-xl border border-hairline bg-surface-2 p-2.5 text-center text-xs">
            <p className="text-ink-faint">Signed in as</p>
            <p className="text-sm font-bold text-ink">{user?.username}</p>
            <div className="mt-1 flex justify-center">
              <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${roleBadgeCls}`}>
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
        <header className="sticky top-0 z-10 flex min-h-[54px] items-center gap-2 border-b border-hairline bg-[rgba(13,18,28,0.7)] backdrop-blur px-5 pt-safe md:min-h-[68px]">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 rounded-md p-2.5 text-ink-faint hover:bg-surface hover:text-ink md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex shrink-0 items-center md:hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-black text-white shadow-md shadow-blue-500/30">
              R
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-1 md:hidden">
            <span className="shrink-0 font-mono tabular-nums text-xs text-ink-soft"><Clock compact /></span>
            <span className="inline-flex shrink-0 items-center rounded-lg border border-[rgba(139,92,246,0.24)] bg-[rgba(139,92,246,0.10)] px-3 py-1 text-xs font-semibold text-[#c4b5fd]">
              {shiftName}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-lg border border-[rgba(59,130,246,0.24)] bg-[rgba(59,130,246,0.10)] px-3 py-1 text-xs font-semibold text-[#93c5fd]">
              {loadBadgeText}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-lg border border-[rgba(16,185,129,0.24)] bg-[rgba(16,185,129,0.10)] px-3 py-1 text-xs font-semibold text-[#6ee7b7]">
              {unloadBadgeText}
            </span>
          </div>
          <div className="ml-auto hidden flex-wrap items-center justify-end gap-2 py-2 text-sm md:flex">
            <Clock compact className="whitespace-nowrap font-mono text-2xl font-bold tabular-nums text-blue-400" />
            {/* Live "happening right now" chips — visible only while a truck is
                actually on a dock, so the bar stays clean when idle. Amber =
                work in flight, matching in_progress everywhere else. */}
            {unloadingTruck && (
              <button
                type="button"
                onClick={() => nav(`/unload?truck=${unloadingTruck.truck_number}`)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[rgba(245,158,11,0.32)] bg-[rgba(245,158,11,0.12)] px-4 py-2 font-bold text-[#fcd34d] transition-colors hover:bg-[rgba(245,158,11,0.2)]"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#c89a4a]">Unloading</span>
                #{unloadingTruck.truck_number}
              </button>
            )}
            {inProgressTruck && (
              <button
                type="button"
                onClick={() => nav("/load")}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[rgba(245,158,11,0.32)] bg-[rgba(245,158,11,0.12)] px-4 py-2 font-bold text-[#fcd34d] transition-colors hover:bg-[rgba(245,158,11,0.2)]"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#c89a4a]">Loading</span>
                #{inProgressTruck.truck_number}
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[rgba(139,92,246,0.24)] bg-[rgba(139,92,246,0.10)] px-4 py-2 font-semibold text-[#c4b5fd]">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8b6fd1]">Shift</span>
              {shiftName}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[rgba(59,130,246,0.24)] bg-[rgba(59,130,246,0.10)] px-4 py-2 font-semibold text-[#93c5fd]">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5a8fd6]">Load</span>
              Day {loadDay}{holidayLoad ? `+${loadDay === 5 ? 1 : loadDay + 1}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[rgba(16,185,129,0.24)] bg-[rgba(16,185,129,0.10)] px-4 py-2 font-semibold text-[#6ee7b7]">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#4f9e84]">Unload</span>
              Day {unloadsDay}{holidayUnload ? `+${unloadsDay === 5 ? 1 : unloadsDay + 1}` : ""}
            </span>
          </div>
        </header>

        {/* Mobile live ticker — the top row has no room for more chips, so
            what's on the docks right now gets its own slim strip, shown only
            while something is actually running. */}
        {(unloadingTruck || inProgressTruck) && (
          <div className="sticky top-[54px] z-10 flex items-center justify-center gap-2 border-b border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.10)] px-3 py-1.5 backdrop-blur md:hidden">
            {unloadingTruck && (
              <button
                type="button"
                onClick={() => nav(`/unload?truck=${unloadingTruck.truck_number}`)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                UNLOADING #{unloadingTruck.truck_number}
              </button>
            )}
            {unloadingTruck && inProgressTruck && (
              <span className="text-amber-500/50">·</span>
            )}
            {inProgressTruck && (
              <button
                type="button"
                onClick={() => nav("/load")}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                LOADING #{inProgressTruck.truck_number}
              </button>
            )}
          </div>
        )}

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
              <div className="fixed inset-x-0 z-40 rounded-t-xl border-t border-hairline bg-surface-3 pb-2 shadow-xl md:hidden" style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom))' }}>
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

          <nav className="fixed bottom-0 inset-x-0 z-30 flex border-t border-hairline bg-surface-3 pb-safe md:hidden">
            {mobilePrimaryNav.map((item) => {
              const showLoadBadge = item.to === "/load" && trucksNotYetLoaded > 0;
              const showUnloadBadge = item.to === "/unload" && holdCount > 0;
              const showYardBadge = item.to === "/unload" && inYardCount > 0;
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
                  {showYardBadge && (
                    <span className="absolute left-1/4 top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-slate-500 px-1 text-[9px] font-bold text-white">
                      {inYardCount}
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
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span className="font-semibold text-ink-soft">{label}</span>
        <span className="font-mono text-ink-muted">
          {current}/{total}
        </span>
      </div>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
