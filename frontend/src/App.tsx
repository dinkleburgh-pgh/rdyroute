import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import ToastContainer from "./components/ToastContainer";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import { useSettings } from "./api/hooks";
import { badgeTextColor } from "./utils/color";
import useWakeLock from "./hooks/useWakeLock";
import Login from "./pages/Login";
import RunDay from "./pages/RunDay";
import Board from "./pages/Board";
import Unload from "./pages/Unload";
import Load from "./pages/Load";
import Batches from "./pages/Batches";
import Shorts from "./pages/Shorts";
import Audit from "./pages/Audit";
import Trends from "./pages/Trends";
import Management from "./pages/Settings";
import Communications from "./pages/Communications";
import Supervisor from "./pages/Supervisor";
import NotesBoard from "./pages/Notes";
import DriverNotes from "./pages/DriverNotes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
    mutations: {
      onError: (err) => {
        // Default fallback: log errors from mutations that don't have their
        // own onError handler. Call sites can override with a toast as needed.
        console.error("[mutation error]", err);
      },
    },
  },
});

const router = createBrowserRouter([
  { path: "/login", element: <Login />, errorElement: <ErrorBoundary /> },
  { path: "/driver/:token", element: <DriverNotes />, errorElement: <ErrorBoundary /> },
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
      { path: "batches", element: <Batches /> },
      { path: "fleet", element: <Board fleetMode /> },
      { path: "shorts", element: <Shorts /> },
      { path: "audit", element: <Audit /> },
      { path: "trends", element: <Trends /> },
      { path: "management", element: <Management /> },
      { path: "communications", element: <Communications /> },
      { path: "notes", element: <NotesBoard /> },
      { path: "supervisor", element: <Navigate to="/management" replace /> },
      { path: "settings", element: <Navigate to="/management" replace /> },
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
  const { data: settings } = useSettings();
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
