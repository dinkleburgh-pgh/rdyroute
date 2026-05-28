import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import { useSettings } from "./api/hooks";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

export default function App() {
  useWakeLock();
  return (
    <QueryClientProvider client={queryClient}>
      <StatusColorApplier />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<RunDay />} />
              <Route path="board" element={<Board />} />
              <Route path="unload" element={<Unload />} />
              <Route path="load" element={<Load />} />
              <Route path="batches" element={<Batches />} />
              <Route path="fleet" element={<Board fleetMode />} />
              <Route path="shorts" element={<Shorts />} />
              <Route path="audit" element={<Audit />} />
              <Route path="trends" element={<Trends />} />
              <Route path="management" element={<Management />} />
              <Route path="communications" element={<Communications />} />
              <Route path="notes" element={<NotesBoard />} />
              <Route path="management" element={<Management />} />
              <Route path="supervisor" element={<Navigate to="/management" replace />} />
              <Route path="settings" element={<Navigate to="/management" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function _badgeTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.35 ? "#000000" : "#ffffff";
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
