import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { applySession, useAuth } from "../contexts/AuthContext";
import { useLogin, useGuestLogin } from "../api/hooks";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const guestLogin = useGuestLogin();
  const { setSession } = useAuth();
  const nav = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const tok = await login.mutateAsync({ username, password });
      applySession(tok, setSession);
      nav("/", { replace: true });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "Login failed");
    }
  }

  async function onGuest() {
    setError(null);
    try {
      const tok = await guestLogin.mutateAsync();
      applySession(tok, setSession);
      nav("/", { replace: true });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string }; status?: number } };
      setError(e?.response?.data?.detail ?? `Guest access unavailable (${e?.response?.status ?? "no response"})`);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
      <form onSubmit={onSubmit} className="card w-80 space-y-4">
        <h1 className="text-xl font-semibold">ReadyRoute V2 — Sign in</h1>
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-700" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-surface-1 px-3 text-xs text-slate-500">or</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onGuest}
          disabled={guestLogin.isPending}
          className="w-full rounded-lg border border-slate-700 py-2 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
        >
          {guestLogin.isPending ? "Loading…" : "Continue as Guest"}
        </button>

        <p className="text-center text-xs text-slate-500">
          API: <code>{window.location.origin}/api</code>
        </p>
      </form>
      </motion.div>
    </div>
  );
}
