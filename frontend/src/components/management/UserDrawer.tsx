/**
 * Slide-in drawer for creating or editing a user.
 *
 * Uses the existing useCreateUser / useUpdateUser / useChangePassword hooks.
 * On success/error, surfaces a toast.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { AuthRole, User } from "../../types";
import { useCreateUser, useUpdateUser } from "../../api/hooks";
import { useToast } from "../../contexts/ToastContext";
import { ALL_ROLES, ROLE_LABELS } from "../../utils/permissions";
import { XIcon } from "../icons";

// Roles assignable through this UI (admin is not self-assignable here).
const ASSIGNABLE_ROLES: AuthRole[] = ALL_ROLES.filter((r) => r !== "admin");

export interface UserDrawerProps {
  open: boolean;
  /** When set, the drawer is in "edit" mode for this user. */
  editUser?: User | null;
  onClose: () => void;
}

export default function UserDrawer({ open, editUser, onClose }: UserDrawerProps) {
  const toast = useToast();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const isEdit = !!editUser;

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AuthRole>("loader");
  const [enabled, setEnabled] = useState(true);

  // Reset form whenever the drawer opens or target user changes.
  useEffect(() => {
    if (!open) return;
    if (editUser) {
      setDisplayName(editUser.display_name ?? "");
      setUsername(editUser.username);
      setRole(editUser.role === "admin" ? "fleet" : editUser.role);
      setEnabled(editUser.is_enabled);
      setPassword("");
    } else {
      setDisplayName("");
      setUsername("");
      setPassword("");
      setRole("loader");
      setEnabled(true);
    }
  }, [open, editUser]);

  const busy = createUser.isPending || updateUser.isPending;
  const canSubmit = isEdit
    ? displayName.trim().length > 0
    : username.trim().length > 0 && password.length > 0;

  function handleSubmit() {
    if (isEdit && editUser) {
      updateUser.mutate(
        {
          username: editUser.username,
          role,
          display_name: displayName.trim() || editUser.username,
          is_enabled: enabled,
        },
        {
          onSuccess: () => {
            toast.success(`Updated ${editUser.username}`);
            onClose();
          },
          onError: () => toast.error("Could not update user"),
        },
      );
    } else {
      createUser.mutate(
        {
          username: username.trim(),
          password,
          role,
          display_name: displayName.trim() || username.trim(),
        },
        {
          onSuccess: () => {
            toast.success(`Created ${username.trim()}`);
            onClose();
          },
          onError: () => toast.error("Could not create user"),
        },
      );
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit user" : "Add user"}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-100">
            {isEdit ? "Edit user" : "Add user"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 transition-colors hover:text-slate-300"
            aria-label="Close"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label className="label">Display name</label>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jordan Rivera"
              autoFocus
            />
          </div>

          <div>
            <label className="label">Username</label>
            <input
              className={clsx("input", isEdit && "cursor-not-allowed opacity-60")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="login name"
              disabled={isEdit}
            />
            {isEdit && (
              <p className="mt-1 text-xs text-slate-500">Usernames cannot be changed.</p>
            )}
          </div>

          {!isEdit && (
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="initial password"
              />
            </div>
          )}

          <div>
            <label className="label">Role</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as AuthRole)}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800"
              />
              Account enabled
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit || busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create user"}
          </button>
        </div>
      </div>
    </div>
  );
}
