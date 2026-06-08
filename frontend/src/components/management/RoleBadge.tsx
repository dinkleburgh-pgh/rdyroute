/**
 * Colored role badge pill, used across the user-management panels.
 */
import clsx from "clsx";
import type { AuthRole } from "../../types";
import { ROLE_BADGE_CLASS, ROLE_LABELS } from "../../utils/permissions";

export default function RoleBadge({
  role,
  className,
}: {
  role: AuthRole;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.guest,
        className,
      )}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

/** Initials avatar circle, seeded color from the username. */
export function UserAvatar({
  name,
  username,
  size = 36,
}: {
  name: string;
  username: string;
  size?: number;
}) {
  const initials = (name || username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  // Deterministic hue from username
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: `hsl(${hue}, 50%, 40%)`,
      }}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}
