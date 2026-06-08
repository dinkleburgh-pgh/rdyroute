/**
 * Notices panel — post and manage team notices. Extracted from Settings.tsx.
 */
import { useState } from "react";
import { useCreateNotice, useDeleteNotice, useNotices, useUpdateNotice } from "../../api/hooks";
import type { NoticeSeverity } from "../../types";

const SEVERITIES: NoticeSeverity[] = ["info", "warn", "critical"];

export default function NoticesPanel({ disabled }: { disabled: boolean }) {
  const { data: notices, isLoading } = useNotices(false);
  const create = useCreateNotice();
  const update = useUpdateNotice();
  const del    = useDeleteNotice();
  const [form, setForm] = useState({ title: "", body: "", severity: "info" as NoticeSeverity });

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">Post a new notice</h3>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled) return;
            create.mutate(form, { onSuccess: () => setForm({ title: "", body: "", severity: "info" }) });
          }}
        >
          <input
            className="input w-full" placeholder="Title"
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required
          />
          <textarea
            className="input w-full" placeholder="Body (optional)" rows={3}
            value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <select
              className="input"
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as NoticeSeverity })}
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn-primary" disabled={disabled || create.isPending}>Post notice</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">All notices</h3>
        {isLoading && <p className="text-slate-400">Loading…</p>}
        {!isLoading && (notices ?? []).length === 0 && <p className="text-sm text-slate-500">No notices yet.</p>}
        <ul className="divide-y divide-slate-800">
          {(notices ?? []).map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-3">
              <div className="flex-1">
                <p className="font-semibold">
                  <span className="mr-2 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase">{n.severity}</span>
                  {n.title}
                </p>
                {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-400">{n.body}</p>}
                <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                  {n.created_by} · {new Date(n.created_at).toLocaleString()} · {n.is_active ? "Active" : "Hidden"}
                </p>
              </div>
              <div className="space-x-2 text-right">
                <button className="btn-ghost" disabled={disabled} onClick={() => update.mutate({ id: n.id, is_active: !n.is_active })}>
                  {n.is_active ? "Hide" : "Show"}
                </button>
                <button
                  className="btn-ghost text-red-400" disabled={disabled}
                  onClick={() => { if (confirm(`Delete notice "${n.title}"?`)) del.mutate(n.id); }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
