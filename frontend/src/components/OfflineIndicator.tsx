import clsx from "clsx";
import type { OfflineSyncState } from "../api/useOfflineSync";

/**
 * Slim status bar shown at the top of the app when the device is offline
 * or when queued mutations are being flushed back to the server.
 *
 * States:
 *  • Offline + pending items  → red  "Offline — N shortage(s) saved locally"
 *  • Offline + no pending     → red  "Offline"
 *  • Online  + flushing       → amber "Syncing N item(s)…"
 *  • Online  + all synced     → nothing rendered
 */
export function OfflineIndicator({ isOnline, pendingCount, isFlushing }: OfflineSyncState) {
  const visible = !isOnline || pendingCount > 0;
  if (!visible) return null;

  const label = (() => {
    if (!isOnline && pendingCount > 0)
      return `Offline — ${pendingCount} item${pendingCount !== 1 ? "s" : ""} saved locally`;
    if (!isOnline)
      return "Offline";
    if (isFlushing)
      return `Syncing ${pendingCount} item${pendingCount !== 1 ? "s" : ""}…`;
    return `${pendingCount} item${pendingCount !== 1 ? "s" : ""} pending sync`;
  })();

  const isOnlineButPending = isOnline && pendingCount > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold",
        isOnlineButPending
          ? "bg-amber-900/80 text-amber-200"
          : "bg-red-900/80 text-red-200",
      )}
    >
      {/* Pulsing dot */}
      <span
        className={clsx(
          "inline-block h-2 w-2 rounded-full",
          isOnlineButPending ? "animate-pulse bg-amber-400" : "bg-red-400",
        )}
      />
      {label}
    </div>
  );
}
