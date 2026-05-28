import clsx from "clsx";
import type { OfflineSyncState } from "../api/useOfflineSync";

/**
 * Slim status bar shown at the top of the app when the device is offline,
 * when queued mutations are being flushed, or when the WebSocket is down.
 *
 * States (in priority order):
 *  • Offline + pending items  → red   "Offline — N item(s) saved locally"
 *  • Offline + no pending     → red   "Offline"
 *  • Online  + flushing       → amber "Syncing N item(s)…"
 *  • Online  + WS disconnected→ amber "Live updates paused — reconnecting…"
 *  • Online  + all synced     → nothing rendered
 */
export function OfflineIndicator({
  isOnline,
  pendingCount,
  isFlushing,
  isWsConnected,
}: OfflineSyncState & { isWsConnected: boolean }) {
  const visible = !isOnline || pendingCount > 0 || (isOnline && !isWsConnected);
  if (!visible) return null;

  const isWsOnly = isOnline && isWsConnected === false && pendingCount === 0 && !isFlushing;

  const label = (() => {
    if (!isOnline && pendingCount > 0)
      return `Offline — ${pendingCount} item${pendingCount !== 1 ? "s" : ""} saved locally`;
    if (!isOnline)
      return "Offline";
    if (isFlushing)
      return `Syncing ${pendingCount} item${pendingCount !== 1 ? "s" : ""}…`;
    if (isWsOnly)
      return "Live updates paused — reconnecting…";
    return `${pendingCount} item${pendingCount !== 1 ? "s" : ""} pending sync`;
  })();

  const isAmber = isOnline && (isFlushing || pendingCount > 0 || isWsOnly);

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold",
        isAmber
          ? "bg-amber-900/80 text-amber-200"
          : "bg-red-900/80 text-red-200",
      )}
    >
      {/* Pulsing dot */}
      <span
        className={clsx(
          "inline-block h-2 w-2 rounded-full",
          isAmber ? "animate-pulse bg-amber-400" : "bg-red-400",
        )}
      />
      {label}
    </div>
  );
}
