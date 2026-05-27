import axios, { AxiosError, AxiosRequestConfig } from "axios";

// All requests go through the Vite dev-server proxy at /api → http://127.0.0.1:8000
export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("readyroutev2_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, try once to mint a fresh JWT using the long-lived session cookie.
// Only wipe localStorage and bounce to /login if that refresh also fails.
type RetryConfig = AxiosRequestConfig & { _retried?: boolean };

let refreshInflight: Promise<string | null> | null = null;

function clearSession() {
  localStorage.removeItem("readyroutev2_token");
  localStorage.removeItem("readyroutev2_user");
}

async function tryRefresh(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    try {
      // Bypass `api` so this request itself can't recurse through the interceptor.
      const res = await axios.post(
        "/api/auth/refresh",
        {},
        { withCredentials: true },
      );
      const token: string | undefined = res.data?.access_token;
      const user = res.data
        ? { username: res.data.username, role: res.data.role }
        : null;
      if (token) {
        localStorage.setItem("readyroutev2_token", token);
        if (user) localStorage.setItem("readyroutev2_user", JSON.stringify(user));
        return token;
      }
      return null;
    } catch {
      return null;
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
      const newToken = await tryRefresh();
      if (newToken) {
        cfg.headers = { ...(cfg.headers ?? {}), Authorization: `Bearer ${newToken}` };
        return api.request(cfg);
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
