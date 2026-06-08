/**
 * Centralized role/permission logic.
 *
 * Previously, access checks were scattered as inline expressions like
 * `role === "admin" || role === "fleet"`. This module makes them declarative
 * and auditable.
 *
 * Pure module (no React). For a hook, see `usePermission` in
 * `src/hooks/usePermission.ts`.
 */
import type { AuthRole } from "../types";

export type PermissionAction =
  | "manage:users"
  | "manage:fleet"
  | "manage:settings"
  | "manage:swaps"
  | "view:management"
  | "view:trends"
  | "load:trucks"
  | "unload:trucks"
  | "edit:notes"
  | "delete:messages";

/** Roles that are considered elevated "manager-level" operators. */
const MANAGER_ROLES: AuthRole[] = ["admin", "fleet", "atl", "supervisor", "lead"];

/** Roles allowed to perform each action. */
const ACTION_ROLES: Record<PermissionAction, AuthRole[]> = {
  "manage:users": ["admin"],
  "manage:fleet": MANAGER_ROLES,
  "manage:settings": MANAGER_ROLES,
  "manage:swaps": ["admin", "fleet", "supervisor", "atl"],
  "view:management": MANAGER_ROLES,
  "view:trends": MANAGER_ROLES,
  "load:trucks": ["admin", "fleet", "atl", "supervisor", "lead", "loader"],
  "unload:trucks": ["admin", "fleet", "atl", "supervisor", "lead", "unloader"],
  "edit:notes": MANAGER_ROLES,
  "delete:messages": ["admin", "fleet", "atl", "supervisor"],
};

/** Returns true if `role` is permitted to perform `action`. */
export function can(role: AuthRole | undefined | null, action: PermissionAction): boolean {
  if (!role) return false;
  return ACTION_ROLES[action].includes(role);
}

/** True for manager-level roles (admin/fleet/atl/supervisor/lead). */
export function isManager(role: AuthRole | undefined | null): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Role display metadata (badge colors + human labels)
// Mirrors the existing scheme in Layout.tsx so visuals stay consistent.
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<AuthRole, string> = {
  admin: "Admin",
  fleet: "Fleet",
  atl: "ATL",
  supervisor: "Supervisor",
  lead: "Lead",
  loader: "Loader",
  unloader: "Unloader",
  guest: "Guest",
};

/** Pill class for a role badge (dark theme, ring outline). */
export const ROLE_BADGE_CLASS: Record<AuthRole, string> = {
  admin: "bg-red-950 text-red-300 ring-1 ring-red-700/50",
  fleet: "bg-cyan-950 text-cyan-300 ring-1 ring-cyan-700/50",
  lead: "bg-blue-950 text-blue-300 ring-1 ring-blue-700/50",
  atl: "bg-orange-950 text-orange-300 ring-1 ring-orange-700/50",
  supervisor: "bg-purple-950 text-purple-300 ring-1 ring-purple-700/50",
  loader: "bg-green-950 text-green-300 ring-1 ring-green-700/50",
  unloader: "bg-teal-950 text-teal-300 ring-1 ring-teal-700/50",
  guest: "bg-slate-800 text-slate-400 ring-1 ring-slate-600/50",
};

/** Solid dot color per role, for compact indicators. */
export const ROLE_DOT_CLASS: Record<AuthRole, string> = {
  admin: "bg-red-500",
  fleet: "bg-cyan-500",
  lead: "bg-blue-500",
  atl: "bg-orange-500",
  supervisor: "bg-purple-500",
  loader: "bg-green-500",
  unloader: "bg-teal-500",
  guest: "bg-slate-500",
};

export const ALL_ROLES: AuthRole[] = [
  "admin",
  "fleet",
  "atl",
  "supervisor",
  "lead",
  "loader",
  "unloader",
  "guest",
];
