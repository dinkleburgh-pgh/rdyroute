import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import type { AuthRole, TokenResponse } from "../types";

interface StoredUser {
  username: string;
  role: AuthRole;
  display_role?: string | null;
  display_name?: string;
}

interface AuthContextValue {
  /** Non-null when the user is authenticated. Null when logged out or session check pending. */
  user: StoredUser | null;
  /** True while the initial /auth/me session check is in flight. Hide the app until false. */
  loading: boolean;
  setSession: (user: StoredUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Non-sensitive display fields persisted in localStorage for instant startup rendering. */
const LS_USER_KEY = "readyroutev2_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seed from localStorage so returning users don't flash a blank screen.
  // The /auth/me check below validates that the httpOnly JWT cookie is still
  // valid and replaces or clears the cached user accordingly.
  const [user, setUser] = useState<StoredUser | null>(() => {
    try {
      const raw = localStorage.getItem(LS_USER_KEY);
      return raw ? (JSON.parse(raw) as StoredUser) : null;
    } catch {
      return null;
    }
  });
  // true until the first /auth/me resolves — ProtectedRoute blocks render
  const [loading, setLoading] = useState(true);

  const setSession = useCallback((u: StoredUser) => {
    localStorage.setItem(LS_USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    api.post("/auth/logout").catch(() => {}).finally(() => {
      localStorage.removeItem(LS_USER_KEY);
      setUser(null);
    });
  }, []);

  // On every mount, verify the httpOnly JWT cookie is still valid by calling
  // /auth/me. This is the single source of auth truth — no localStorage token.
  // Also keeps the cached role/display_name in sync with DB changes.
  useEffect(() => {
    let cancelled = false;
    api.get("/auth/me").then((res) => {
      if (cancelled) return;
      const fresh: StoredUser = {
        username: res.data.username,
        role: res.data.role,
        display_role: res.data.display_role ?? null,
        display_name: res.data.display_name,
      };
      localStorage.setItem(LS_USER_KEY, JSON.stringify(fresh));
      setUser(fresh);
    }).catch(() => {
      if (cancelled) return;
      // 401 = no valid session → clear cached user
      localStorage.removeItem(LS_USER_KEY);
      setUser(null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Cross-tab sync: if another tab logs out (clears LS_USER_KEY), mirror it here.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === LS_USER_KEY && !e.newValue) {
        setUser(null);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const value = useMemo(
    () => ({ user, loading, setSession, logout }),
    [user, loading, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export function applySession(
  tok: TokenResponse,
  setSession: AuthContextValue["setSession"],
) {
  setSession({
    username: tok.username,
    role: tok.role,
    display_name: (tok as unknown as { display_name?: string }).display_name ?? tok.username,
    display_role: (tok as unknown as { display_role?: string | null }).display_role ?? null,
  });
}
