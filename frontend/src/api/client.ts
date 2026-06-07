import axios, { AxiosError, AxiosRequestConfig } from "axios";

// All requests go through the Vite dev-server proxy at /api → http://127.0.0.1:8000
export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,  // required for httpOnly JWT + session cookies
});

/**
 * Base URL for public-facing links (e.g. QR codes).
 * In production this is just window.location.origin (e.g. https://rdyroute.app).
 * For LAN testing from a phone, set VITE_PUBLIC_URL in frontend/.env.local,
 * e.g.  VITE_PUBLIC_URL=http://192.168.1.42:5180
 */
export function publicBase(): string {
  return import.meta.env.VITE_PUBLIC_URL || (typeof window !== "undefined" ? window.location.origin : "");
}

// JWT is now stored in an httpOnly cookie set by the backend — the browser
// sends it automatically. No Authorization header needed from the client.
// We keep this interceptor only so legacy API clients using the old
// Bearer token (e.g. OpenAPI docs, scripts) still work transparently.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("readyroutev2_token");
  if (token && !config.headers?.Authorization) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, try once to mint a fresh JWT using the long-lived session cookie.
// Only wipe the cached user and bounce to /login if that refresh also fails.
type RetryConfig = AxiosRequestConfig & { _retried?: boolean };

let refreshInflight: Promise<boolean> | null = null;

function clearSession() {
  // The JWT lives in an httpOnly cookie — the backend clears it on /auth/logout.
  // We only clear the non-sensitive display info from localStorage here.
  localStorage.removeItem("readyroutev2_user");
  // Also clear any legacy token from before the httpOnly cookie migration.
  localStorage.removeItem("readyroutev2_token");
}

async function tryRefresh(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    try {
      // Bypass `api` so this request itself can't recurse through the interceptor.
      const res = await axios.post(
        "/api/auth/refresh",
        {},
        { withCredentials: true },
      );
      // Backend sets a fresh httpOnly JWT cookie. Update localStorage display info.
      const user = res.data
        ? { username: res.data.username, role: res.data.role }
        : null;
      if (user) localStorage.setItem("readyroutev2_user", JSON.stringify(user));
      // Keep legacy token in localStorage for any old Bearer-header fallback.
      if (res.data?.access_token) {
        localStorage.setItem("readyroutev2_token", res.data.access_token);
      }
      return true;
    } catch {
      return false;
    } finally {
      refreshInflight = null;
    }
  })();
  return refreshInflight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error?.response?.status;
    const cfg = error?.config as RetryConfig | undefined;
    const url = (cfg?.url ?? "") as string;

    // Never try to refresh for the auth endpoints themselves — they'd loop.
    const isAuthEndpoint =
      url.includes("/auth/refresh") ||
      url.includes("/auth/login") ||
      url.includes("/auth/token");

    if (status === 401 && cfg && !cfg._retried && !isAuthEndpoint) {
      cfg._retried = true;
      const refreshed = await tryRefresh();
      if (refreshed) {
        // Retry without the old Bearer header so the httpOnly cookie takes over.
        const retryCfg = { ...cfg };
        if (retryCfg.headers) delete (retryCfg.headers as Record<string, unknown>).Authorization;
        return api.request(retryCfg);
      }
      clearSession();
    } else if (status === 401) {
      clearSession();
    }
    return Promise.reject(error);
  },
);

export function todayIso(): string {
  const now = new Date();
  // Before 6am we're still in the previous calendar day's 3rd shift
  const d = now.getHours() < 6
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
