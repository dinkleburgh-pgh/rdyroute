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
  token: string | null;
  user: StoredUser | null;
  setSession: (token: string, user: StoredUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("readyroutev2_token"),
  );
  const [user, setUser] = useState<StoredUser | null>(() => {
    const raw = localStorage.getItem("readyroutev2_user");
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  });

  const setSession = useCallback((tok: string, u: StoredUser) => {
    localStorage.setItem("readyroutev2_token", tok);
    localStorage.setItem("readyroutev2_user", JSON.stringify(u));
    setToken(tok);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("readyroutev2_token");
    localStorage.removeItem("readyroutev2_user");
    setToken(null);
    setUser(null);
  }, []);

  // Listen for cross-tab logout / 401 wipes
  useEffect(() => {
    const handler = () => {
      const tok = localStorage.getItem("readyroutev2_token");
      if (!tok) {
        setToken(null);
        setUser(null);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Refresh cached user from /auth/me whenever we have a token.
  // Without this, role changes in the DB (e.g. demoting "admin" → "lead")
  // never propagate to clients that already had a session cached in
  // localStorage from before the change.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get("/auth/me").then((res) => {
      if (cancelled) return;
      const fresh: StoredUser = {
        username: res.data.username,
        role: res.data.role,
        display_role: res.data.display_role ?? null,
        display_name: res.data.display_name,
      };
      setUser((prev) => {
        if (
          prev &&
          prev.username === fresh.username &&
          prev.role === fresh.role &&
          prev.display_role === fresh.display_role &&
          prev.display_name === fresh.display_name
        ) {
          return prev;
        }
        localStorage.setItem("readyroutev2_user", JSON.stringify(fresh));
        return fresh;
      });
    }).catch(() => {
      // 401 handler in api client will clear the session
    });
    return () => { cancelled = true; };
  }, [token]);

  const value = useMemo(
    () => ({ token, user, setSession, logout }),
    [token, user, setSession, logout],
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
  setSession(tok.access_token, { username: tok.username, role: tok.role });
}
