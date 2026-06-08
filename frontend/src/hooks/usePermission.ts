/**
 * React hook wrapper around the `can()` permission check.
 *
 *   const canManageUsers = usePermission("manage:users");
 */
import { useAuth } from "../contexts/AuthContext";
import { can, type PermissionAction } from "../utils/permissions";

export function usePermission(action: PermissionAction): boolean {
  const { user } = useAuth();
  return can(user?.role, action);
}
