import axios, { AxiosError, AxiosRequestConfig } from "axios";
import * as offlineQueue from "./offlineQueue";
import { logDebug } from "../utils/debugLog";
import { easternNow, isoDate, shiftRunDate } from "../utils/dates";

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
  // NOTE: we deliberately do NOT attach the legacy Bearer token. The backend
  // prefers the Authorization header over the httpOnly cookie, so a stale
  // localStorage token made otherwise-valid requests 401 — and each of those
  // 401s ran a refresh that ROTATES (deletes) the server-side session. If that
  // refresh then failed for any reason the user was silently logged out and
  // their write was lost. The cookie is the source of truth.
  return config;
});

// On 401, try once to mint a fresh JWT using the long-lived session cookie.
// Only wipe the cached user and bounce to /login if that refresh also fails.
type RetryConfig = AxiosRequestConfig & { _retried?: boolean };

type RefreshResult = "ok" | "rejected" | "network";
let refreshInflight: Promise<RefreshResult> | null = null;

function clearSession() {
  // The JWT lives in an httpOnly cookie — the backend clears it on /auth/logout.
  // We only clear the non-sensitive display info from localStorage here.
  localStorage.removeItem("readyroutev2_user");
  // Also clear any legacy token from before the httpOnly cookie migration.
  localStorage.removeItem("readyroutev2_token");
  // Leave a breadcrumb so the login screen can explain WHY they landed there
  // instead of bouncing them out silently.
  try { sessionStorage.setItem("readyroutev2_session_expired", "1"); } catch { /* private mode */ }
}

async function tryRefresh(): Promise<RefreshResult> {
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
      // Legacy token intentionally NOT stored — see the request interceptor.
      localStorage.removeItem("readyroutev2_token");
      return "ok";
    } catch (err) {
      // Distinguish "the server rejected us" from "we couldn't reach the
      // server". Only a real rejection means the session is gone; a network
      // blip must not log the user out mid-shift.
      const st = (err as AxiosError)?.response?.status;
      return st == null ? "network" : "rejected";
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
      if (refreshed === "ok") {
        // Retry without the old Bearer header so the httpOnly cookie takes over.
        const retryCfg = { ...cfg };
        if (retryCfg.headers) delete (retryCfg.headers as Record<string, unknown>).Authorization;
        return api.request(retryCfg);
      }
      // "network" = we never reached the server; keep the session and let the
      // request fail (mutations fall through to the offline queue below).
      if (refreshed === "rejected") clearSession();
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
    // The public driver surface must NEVER be queued. Queuing resolves the call
    // as a fake 202 so the UI proceeds as if it worked — which is fine inside
    // the app, where useOfflineSync drains the queue on reconnect. But that hook
    // is mounted once, in Layout, inside ProtectedRoute; /driver/:token is a
    // sibling of that tree and never renders it. So a driver's note was accepted
    // on screen, written to their phone's IndexedDB, and replayed by nothing,
    // ever. Better to reject honestly and let the page offer a retry.
    const isDriverSurface = url.includes("/driver/");
    // The load crew's answer about which truck the dock is on RIGHT NOW is
    // worthless four minutes later, and the server would 409 it anyway. Queuing
    // it would show a fake success on a dead tablet and then replay a stale
    // opinion on reconnect — better to fail honestly and let the page say so.
    const isLoadRequest = url.includes("/load-request");
    const queueable =
      isMutation && !isAuthEndpoint && !isDriverSurface && !isLoadRequest
      && !url.includes("/auth/") && !url.includes("/updates/") && !url.includes("/exports/");
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
  // Delegates to the ONE rollover implementation in utils/dates —
  // this function used to carry its own copy of the 6am/weekend algorithm.
  return isoDate(shiftRunDate());
}
