import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { applySession, useAuth } from "../contexts/AuthContext";
import { useLogin } from "../api/hooks";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
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
        <p className="text-center text-xs text-slate-500">
          API: <code>{window.location.origin}/api</code>
        </p>
      </form>
    </div>
  );
}
