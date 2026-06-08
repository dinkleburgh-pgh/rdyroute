/**
 * User directory panel — search, filter, and manage users.
 *
 * Replaces the original bare-table UsersPanel from Settings.tsx. Preserves all
 * existing behavior (create/edit/delete/disable/change-password via the same
 * hooks) and adds search, role/status filters, avatars, colored role badges,
 * a slide-in add/edit drawer, themed confirm dialogs, and toasts.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { AuthRole, User } from "../../types";
import {
  useUsers,
  useDeleteUser,
  useUpdateUser,
  useChangePassword,
} from "../../api/hooks";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { ALL_ROLES, ROLE_LABELS } from "../../utils/permissions";
import ConfirmDialog from "../ConfirmDialog";
import { SearchIcon, PlusIcon, EditIcon, LockIcon, TrashIcon } from "../icons";
import RoleBadge, { UserAvatar } from "./RoleBadge";
import UserDrawer from "./UserDrawer";

type StatusFilter = "all" | "active" | "disabled";

export default function UsersPanel() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data: users = [], isLoading } = useUsers();
  const deleteUser = useDeleteUser();
  const updateUser = useUpdateUser();
  const changePassword = useChangePassword();

  // Filters
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AuthRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  // Inline password change
  const [pwUser, setPwUser] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");

  // Confirm dialogs
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<User | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.is_enabled) return false;
      if (statusFilter === "disabled" && u.is_enabled) return false;
      if (q) {
        const hay = `${u.username} ${u.display_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  function openAdd() {
    setEditUser(null);
    setDrawerOpen(true);
  }
  function openEdit(u: User) {
    setEditUser(u);
    setDrawerOpen(true);
  }

  function doDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    deleteUser.mutate(target.username, {
      onSuccess: () => toast.success(`Deleted ${target.username}`),
      onError: () => toast.error("Could not delete user"),
    });
    setConfirmDelete(null);
  }

  function doToggle() {
    if (!confirmToggle) return;
    const target = confirmToggle;
    const next = !target.is_enabled;
    updateUser.mutate(
      { username: target.username, is_enabled: next },
      {
        onSuccess: () => toast.success(next ? `Enabled ${target.username}` : `Disabled ${target.username}`),
        onError: () => toast.error("Could not update user"),
      },
    );
    setConfirmToggle(null);
  }

  function doChangePassword() {
    if (!pwUser || !newPw) return;
    const target = pwUser;
    changePassword.mutate(
      { username: target, new_password: newPw },
      {
        onSuccess: () => toast.success(`Password updated for ${target}`),
        onError: () => toast.error("Could not change password"),
      },
    );
    setPwUser(null);
    setNewPw("");
  }

  const activeCount = users.filter((u) => u.is_enabled).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="input w-56 pl-8"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Role filter */}
          <select
            className="input w-auto"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as AuthRole | "all")}
          >
            <option value="all">All roles</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {/* Status filter */}
          <select
            className="input w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        <button className="btn-primary shrink-0 gap-1.5" onClick={openAdd}>
          <PlusIcon className="h-4 w-4" />
          Add user
        </button>
      </div>

      {/* Count */}
      <p className="text-xs text-slate-500">
        {isLoading
          ? "Loading…"
          : `${filtered.length} of ${users.length} user${users.length !== 1 ? "s" : ""} · ${activeCount} active`}
      </p>

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/70 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2.5">User</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              [0, 1, 2].map((i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="px-3 py-3" colSpan={5}>
                    <div className="h-6 w-full animate-pulse rounded bg-slate-800" />
                  </td>
                </tr>
              ))}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center">
                  <p className="text-sm text-slate-400">No users match your filters.</p>
                  {users.length === 0 && (
                    <button className="btn-primary mx-auto mt-3 gap-1.5" onClick={openAdd}>
                      <PlusIcon className="h-4 w-4" />
                      Add your first user
                    </button>
                  )}
                </td>
              </tr>
            )}

            {!isLoading &&
              filtered.map((u) => {
                const isSelf = u.username === me?.username;
                return (
                  <tr
                    key={u.username}
                    className={clsx(
                      "border-t border-slate-800 transition-colors hover:bg-slate-800/40",
                      !u.is_enabled && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={u.display_name ?? u.username} username={u.username} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-100">
                            {u.display_name || u.username}
                            {isSelf && (
                              <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>
                            )}
                          </p>
                          <p className="truncate font-mono text-xs text-slate-500">{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-3 py-2.5">
                      {u.is_enabled ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/40 px-2 py-0.5 text-xs font-medium text-slate-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                          title="Edit"
                          onClick={() => openEdit(u)}
                        >
                          <EditIcon className="h-4 w-4" />
                        </button>
                        <button
                          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                          title="Change password"
                          onClick={() => {
                            setPwUser(u.username);
                            setNewPw("");
                          }}
                        >
                          <LockIcon className="h-4 w-4" />
                        </button>
                        {!isSelf && (
                          <button
                            className={clsx(
                              "rounded px-2 py-1 text-xs font-medium transition-colors",
                              u.is_enabled
                                ? "text-amber-400 hover:bg-amber-500/10"
                                : "text-emerald-400 hover:bg-emerald-500/10",
                            )}
                            onClick={() => setConfirmToggle(u)}
                          >
                            {u.is_enabled ? "Disable" : "Enable"}
                          </button>
                        )}
                        {!isSelf && (
                          <button
                            className="rounded p-1.5 text-red-400 transition-colors hover:bg-red-500/10"
                            title="Delete"
                            onClick={() => setConfirmDelete(u)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Inline change-password */}
      {pwUser && (
        <div className="card flex flex-wrap items-end gap-3">
          <p className="w-full text-sm font-medium text-slate-300">
            Change password for <span className="font-mono">{pwUser}</span>
          </p>
          <input
            className="input flex-1"
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doChangePassword();
            }}
          />
          <button
            className="btn-primary"
            disabled={!newPw || changePassword.isPending}
            onClick={doChangePassword}
          >
            Set password
          </button>
          <button className="btn-ghost" onClick={() => setPwUser(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* Add/Edit drawer */}
      <UserDrawer open={drawerOpen} editUser={editUser} onClose={() => setDrawerOpen(false)} />

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.username ?? "user"}?`}
        description="This permanently removes the account and cannot be undone."
        confirmLabel="Delete user"
        variant="danger"
        busy={deleteUser.isPending}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Confirm enable/disable */}
      <ConfirmDialog
        open={!!confirmToggle}
        title={
          confirmToggle?.is_enabled
            ? `Disable ${confirmToggle?.username}?`
            : `Enable ${confirmToggle?.username}?`
        }
        description={
          confirmToggle?.is_enabled
            ? "The user will be unable to sign in until re-enabled."
            : "The user will be able to sign in again."
        }
        confirmLabel={confirmToggle?.is_enabled ? "Disable" : "Enable"}
        variant={confirmToggle?.is_enabled ? "danger" : "default"}
        busy={updateUser.isPending}
        onConfirm={doToggle}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  );
}
