import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api/queryClient";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import ToastContainer from "./components/ToastContainer";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import { useSettings } from "./api/hooks";
import { badgeTextColor } from "./utils/color";
import useWakeLock from "./hooks/useWakeLock";
import { useAuth } from "./contexts/AuthContext";
// Core workflow pages stay eager — they're the hot path and must paint instantly.
import Login from "./pages/Login";
import RunDay from "./pages/RunDay";
import Board from "./pages/Board";
import Unload from "./pages/Unload";
import Load from "./pages/Load";
// Heavy / infrequently-visited pages are code-split so the login screen and the
// core board don't ship chart.js, the OCR review UI, and ~20 admin panels up
// front. Each lands in its own chunk, fetched on first navigation.
const Batches = lazy(() => import("./pages/Batches"));
const Shorts = lazy(() => import("./pages/Shorts"));
const Audit = lazy(() => import("./pages/Audit"));
const Trends = lazy(() => import("./pages/Trends"));
const TrendDetail = lazy(() => import("./pages/trends/TrendDetail"));
const Management = lazy(() => import("./pages/Settings"));
const Communications = lazy(() => import("./pages/Communications"));
const NotesBoard = lazy(() => import("./pages/Notes"));
const DriverNotes = lazy(() => import("./pages/DriverNotes"));
const FleetSchedule = lazy(() => import("./pages/FleetSchedule"));
const VerifyShortSheet = lazy(() => import("./pages/VerifyShortSheet"));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">
      Loading…
    </div>
  );
}

const lazyRoute = (node: ReactNode) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>;

const router = createBrowserRouter([
  { path: "/login", element: <Login />, errorElement: <ErrorBoundary /> },
  { path: "/driver/:token", element: lazyRoute(<DriverNotes />), errorElement: <ErrorBoundary /> },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    errorElement: <ErrorBoundary />,
    children: [
      { index: true, element: <RunDay /> },
      { path: "board", element: <Board /> },
      { path: "unload", element: <Unload /> },
      { path: "load", element: <Load /> },
      { path: "batches", element: lazyRoute(<Batches />) },
      { path: "fleet", element: <Board fleetMode /> },
      { path: "shorts", element: lazyRoute(<Shorts />) },
      { path: "audit", element: lazyRoute(<Audit />) },
      { path: "trends", element: lazyRoute(<Trends />) },
      { path: "trends/:metric", element: lazyRoute(<TrendDetail />) },
      { path: "management", element: lazyRoute(<Management />) },
      { path: "communications", element: lazyRoute(<Communications />) },
      { path: "notes", element: lazyRoute(<NotesBoard />) },
      { path: "supervisor", element: <Navigate to="/management" replace /> },
      { path: "settings", element: <Navigate to="/management" replace /> },
      { path: "fleet-schedule", element: lazyRoute(<FleetSchedule />) },
      { path: "verify-short-sheet", element: lazyRoute(<VerifyShortSheet />) },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  useWakeLock();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <StatusColorApplier />
          <RouterProvider router={router} />
          <ToastContainer />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function _badgeTextColor(hex: string): string {
  return badgeTextColor(hex);
}

const STATUS_CLASS_MAP: Record<string, string> = {
  dirty:       ".bg-status-dirty",
  shop:        ".bg-status-shop",
  in_progress: ".bg-status-inprogress",
  unloaded:    ".bg-status-unloaded",
  loaded:      ".bg-status-loaded",
  off:         ".bg-status-off",
  oos:         ".bg-status-oos",
  spare:       ".bg-status-spare",
};

function StatusColorApplier() {
  const { user, loading } = useAuth();
  const { data: settings } = useSettings(!loading && !!user);
  useEffect(() => {
    const raw = settings?.find((s) => s.key === "status_badge_colors")?.value;
    if (!raw || typeof raw !== "object") return;
    const colors = raw as Record<string, unknown>;
    const rules = Object.entries(STATUS_CLASS_MAP)
      .filter(([k]) => typeof colors[k] === "string" && /^#[0-9a-fA-F]{6}$/i.test(colors[k] as string))
      .map(([k, cls]) => {
        const hex = colors[k] as string;
        return `${cls} { background-color: ${hex} !important; color: ${_badgeTextColor(hex)} !important; }`;
      })
      .join("\n");
    if (!rules) return;
    let el = document.getElementById("status-color-overrides");
    if (!el) {
      el = document.createElement("style");
      el.id = "status-color-overrides";
      document.head.appendChild(el);
    }
    el.textContent = rules;
  }, [settings]);
  return null;
}
