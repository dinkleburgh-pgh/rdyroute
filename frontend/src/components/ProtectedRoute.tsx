import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { applySession, useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

/**
 * Routes anyone with the link may open WITHOUT signing in. Hitting one while
 * logged out silently mints a read-only guest session instead of bouncing to
 * /login, so a shared report link just opens the report.
 *
 * Read-only by construction: the guest role is rejected by every mutating
 * endpoint (require_non_guest), so this widens visibility, never write access.
 */
const PUBLIC_PATHS = new Set(["/report"]);

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
    </div>
  );
}

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, setSession } = useAuth();
  const loc = useLocation();
  const isPublic = PUBLIC_PATHS.has(loc.pathname);
  // Tracks the auto-guest attempt so a failure falls through to /login
  // instead of spinning forever.
  const [guestTried, setGuestTried] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (loading || user || !isPublic || requested.current) return;
    requested.current = true;
    api
      .post("/auth/guest")
      .then((res) => applySession(res.data, setSession))
      .catch(() => {})
      .finally(() => setGuestTried(true));
  }, [loading, user, isPublic, setSession]);

  // Show a full-screen spinner while the /auth/me session check is in-flight.
  // Returning null here causes a blank page flash — avoid it.
  if (loading) return <Spinner />;
  // Public route, no session yet: hold the spinner through the guest handshake
  // rather than flashing the login screen.
  if (!user && isPublic && !guestTried) return <Spinner />;

  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
