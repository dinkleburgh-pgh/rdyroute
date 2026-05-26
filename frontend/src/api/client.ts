import axios from "axios";

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

// On 401, wipe the token so the app falls back to the login screen
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem("readyroutev2_token");
      localStorage.removeItem("readyroutev2_user");
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
