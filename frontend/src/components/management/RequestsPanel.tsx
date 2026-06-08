/**
 * Account requests panel — approve/deny self-registration requests, with an
 * optional full-history view.
 */
import { useState } from "react";
import clsx from "clsx";
import type { AuthRequestStatus } from "../../types";
import { useAuthRequests, useResolveAuthRequest } from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import RoleBadge, { UserAvatar } from "./RoleBadge";

const STATUS_CHIP: Record<AuthRequestStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-400",
  denied: "bg-red-500/10 text-red-400",
};

export default function RequestsPanel({ disabled }: { disabled: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const { data: requests, isLoading, error } = useAuthRequests(!showAll);
  const resolve = useResolveAuthRequest();

  if (error)
    return <p className="text-sm text-amber-400">Cannot load requests (admin-only endpoint).</p>;

  function act(id: number, status: "approved" | "denied", username: string) {
    resolve.mutate(
      { id, status, resolved_by: user?.username ?? "admin" },
      {
        onSuccess: () =>
          toast.success(status === "approved" ? `Approved ${username}` : `Denied ${username}`),
        onError: () => toast.error("Could not update request"),
      },
    );
  }

  const list = requests ?? [];

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            {showAll ? "All account requests" : "Pending account requests"}
          </h3>
          <p className="text-xs text-slate-500">Self-registration access requests.</p>
        </div>
        <button
          className="text-xs font-medium text-blue-400 hover:text-blue-300"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show pending only" : "Show all history"}
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {!isLoading && list.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">
          {showAll ? "No requests on record." : "No pending requests."}
        </p>
      )}

      <ul className="divide-y divide-slate-800">
        {list.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <UserAvatar name={r.display_name || r.username} username={r.username} size={32} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate font-medium text-slate-100">
                  {r.username}
                  <span className="text-xs font-normal text-slate-500">wants</span>
                  <RoleBadge role={r.requested_role} />
                </p>
                <p className="text-xs text-slate-500">
                  Requested {new Date(r.requested_at).toLocaleString()}
                  {r.resolved_at && r.resolved_by && (
                    <>
                      {" · "}
                      {r.status} by {r.resolved_by}
                    </>
                  )}
                </p>
              </div>
            </div>

            {r.status === "pending" ? (
              <div className="flex shrink-0 gap-2">
                <button
                  className="btn-primary"
                  disabled={disabled || resolve.isPending}
                  onClick={() => act(r.id, "approved", r.username)}
                >
                  Approve
                </button>
                <button
                  className="btn-ghost text-red-400"
                  disabled={disabled || resolve.isPending}
                  onClick={() => act(r.id, "denied", r.username)}
                >
                  Deny
                </button>
              </div>
            ) : (
              <span
                className={clsx(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                  STATUS_CHIP[r.status],
                )}
              >
                {r.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
