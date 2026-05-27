import { useEffect, useRef } from "react";

/**
 * Holds a Screen Wake Lock while the app is mounted and the page is visible.
 * Prevents the host device (the one displaying the dashboard) from sleeping.
 * Silently no-ops on browsers that don't support the API.
 */
export default function useWakeLock(enabled = true) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;
    if (!("wakeLock" in navigator)) return;

    let cancelled = false;

    const request = async () => {
      try {
        const sentinel: WakeLockSentinel = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          sentinelRef.current = null;
        });
      } catch {
        // Permission denied, low battery, etc. — ignore.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        request();
      }
    };

    request();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [enabled]);
}

// Minimal types so this compiles without DOM lib updates.
interface WakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}
