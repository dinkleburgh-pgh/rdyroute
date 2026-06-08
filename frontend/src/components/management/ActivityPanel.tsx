/**
 * Activity panel — presents account-request history as an activity feed.
 *
 * The backend currently has no dedicated audit-log endpoint, so this surfaces
 * the auth-request lifecycle (the access events that ARE recorded). A callout
 * notes that fuller audit logging requires a server-side feature.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { AuthRequestStatus } from "../../types";
import { useAuthRequests } from "../../api/hooks";
import { AlertTriangleIcon } from "../icons";
import RoleBadge, { UserAvatar } from "./RoleBadge";

type FilterValue = "all" | AuthRequestStatus;

const STATUS_CHIP: Record<AuthRequestStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-400",
  denied: "bg-red-500/10 text-red-400",
};

interface ActivityEvent {
  id: string;
  ts: string;
  username: string;
  displayName: string;
  action: string;
  status: AuthRequestStatus;
}

export default function ActivityPanel() {
  const { data: requests = [], isLoading } = useAuthRequests(false);
  const [filter, setFilter] = useState<FilterValue>("all");

  const events = useMemo<ActivityEvent[]>(() => {
    const out: ActivityEvent[] = [];
    for (const r of requests) {
      // The "request created" event
      out.push({
        id: `req-${r.id}`,
        ts: r.requested_at,
        username: r.username,
        displayName: r.display_name || r.username,
        action: `Requested ${r.requested_role} access`,
        status: "pending",
      });
      // The resolution event, if resolved
      if (r.resolved_at && r.status !== "pending") {
        out.push({
          id: `res-${r.id}`,
          ts: r.resolved_at,
          username: r.username,
          displayName: r.display_name || r.username,
          action:
            r.status === "approved"
              ? `Access approved${r.resolved_by ? ` by ${r.resolved_by}` : ""}`
              : `Access denied${r.resolved_by ? ` by ${r.resolved_by}` : ""}`,
          status: r.status,
        });
      }
    }
    // Most recent first
    out.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return out;
  }, [requests]);

  const filtered = filter === "all" ? events : events.filter((e) => e.status === filter);

  return (
    <div className="space-y-4">
      {/* Callout */}
      <div className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs text-slate-400">
          This feed shows account-access events. Full audit logging (logins, role changes,
          assignment edits, IP/device) requires a server-side audit log, which isn't implemented
          yet.
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">Filter</span>
        {(["all", "pending", "approved", "denied"] as FilterValue[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              "rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-slate-200",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="card p-0">
        {isLoading && <p className="px-3 py-4 text-sm text-slate-400">Loading…</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-slate-500">No activity recorded.</p>
        )}
        <ul className="divide-y divide-slate-800">
          {filtered.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <UserAvatar name={e.displayName} username={e.username} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">
                    <span className="font-medium text-slate-100">{e.username}</span> — {e.action}
                  </p>
                  <p className="text-xs text-slate-500">{new Date(e.ts).toLocaleString()}</p>
                </div>
              </div>
              <span
                className={clsx(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                  STATUS_CHIP[e.status],
                )}
              >
                {e.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
