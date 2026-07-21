import axios, { AxiosError, AxiosRequestConfig } from "axios";
import * as offlineQueue from "./offlineQueue";
import { logDebug } from "../utils/debugLog";

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
  const method = (config.method ?? "get").toLowerCase();
  if (method === "get" || method === "head") {
    const existingParams =
      config.params && typeof config.params === "object" && !Array.isArray(config.params)
        ? config.params as Record<string, unknown>
        : {};
    config.params = {
      ...existingParams,
      _rrts: Date.now(),
    };
  }
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

    // Debug-log every API failure (except auth churn) so floor-device issues
    // are reconstructable from Settings → Development → Debug Log.
    if (!isAuthEndpoint) {
      logDebug("api-error", `${(cfg?.method ?? "get").toUpperCase()} ${url} → ${status ?? "network"}`, {
        detail: (error?.response?.data as { detail?: string })?.detail,
      });
    }

    // Offline-first: any write that fails with a network error gets queued and
    // resolved as success, so the UI proceeds and useOfflineSync replays it on
    // reconnect (last-write-wins). Reads are left to reject → React Query serves
    // the persisted cache. Auth/update endpoints are never queued.
    const method = (cfg?.method ?? "get").toLowerCase();
    const isMutation = ["post", "put", "patch", "delete"].includes(method);
    const queueable =
      isMutation && !isAuthEndpoint && !url.includes("/auth/") && !url.includes("/updates/") && !url.includes("/exports/");
    if (cfg && queueable && offlineQueue.isNetworkError(error)) {
      let endpoint = url;
      if (cfg.params && typeof cfg.params === "object") {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(cfg.params as Record<string, unknown>)) {
          if (v != null && k !== "_rrts") qs.set(k, String(v));
        }
        const s = qs.toString();
        if (s) endpoint += (endpoint.includes("?") ? "&" : "?") + s;
      }
      let payload: unknown = cfg.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { /* leave as-is */ }
      }
      try {
        await offlineQueue.enqueue("generic", endpoint, method.toUpperCase() as "POST" | "PUT" | "PATCH" | "DELETE", payload);
      } catch (e) {
        console.warn("[offline] failed to queue mutation", e);
      }
      return {
        data: { queued: true },
        status: 202,
        statusText: "Queued (offline)",
        headers: {},
        config: cfg,
      } as unknown as ReturnType<typeof Promise.resolve>;
    }

    return Promise.reject(error);
  },
);

export function todayIso(): string {
  const now = new Date();
  // Before 6am we're still in the previous calendar day's 3rd shift.
  const d = now.getHours() < 6
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // The weekend is one continuous run period: there's no nightly rollover on
  // Sat/Sun. Map both back to the preceding Friday so the board (and all its
  // state) holds from Friday's last shift change until Monday 6am, when 1st
  // shift starts a fresh run day. Mirrors workdayNumbers()'s weekend freeze.
  const wd = d.getDay(); // 0=Sun .. 6=Sat
  if (wd === 6) d.setDate(d.getDate() - 1);       // Sat → Fri
  else if (wd === 0) d.setDate(d.getDate() - 2);  // Sun → Fri
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
