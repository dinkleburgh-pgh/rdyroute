/**
 * useOfflineSync
 *
 * Tracks online/offline state and manages the background sync loop.
 * When the browser goes back online, every queued mutation is replayed
 * against the live API in timestamp order.
 *
 * Usage: call once at the Layout level.
 * Consumers that only need {isOnline, pendingCount} can call the hook directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import * as offlineQueue from "./offlineQueue";

export interface OfflineSyncState {
  isOnline: boolean;
  pendingCount: number;
  isFlushing: boolean;
}

export interface UseOfflineSyncOptions {
  /** Called after a flush if any queued writes were rejected (4xx) and dropped. */
  onConflict?: (discardedCount: number) => void;
}

export function useOfflineSync(opts: UseOfflineSyncOptions = {}): OfflineSyncState {
  const qc = useQueryClient();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isFlushing, setIsFlushing] = useState(false);
  const flushingRef = useRef(false);
  const onConflictRef = useRef(opts.onConflict);
  onConflictRef.current = opts.onConflict;

  // Refresh the pending count from IndexedDB
  const refreshCount = useCallback(async () => {
    const n = await offlineQueue.count();
    setPendingCount(n);
  }, []);

  // Drain the queue: replay each mutation against the live API
  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setIsFlushing(true);

    try {
      const items = await offlineQueue.getAll();
      if (items.length === 0) return;

      let anyFlushed = false;
      let discarded = 0;

      for (const item of items) {
        try {
          await api.request({ method: item.method, url: item.endpoint, data: item.payload });
          await offlineQueue.remove(item.id);
          anyFlushed = true;
        } catch (err: unknown) {
          // 4xx errors are permanent client errors — discard the item and continue
          const status =
            (err as { response?: { status?: number } })?.response?.status;
          if (status !== undefined && status >= 400 && status < 500) {
            console.warn("[offlineSync] discarding permanently-rejected item", item.id, status);
            await offlineQueue.remove(item.id);
            discarded += 1;
            continue;
          }
          // Network error or 5xx — stop replaying; retry on next online event
          break;
        }
      }

      // After draining queued writes, refresh everything (last-write-wins) so the
      // UI reflects the now-synced server state.
      if (anyFlushed) {
        qc.invalidateQueries();
      }
      if (discarded > 0) onConflictRef.current?.(discarded);
    } finally {
      flushingRef.current = false;
      setIsFlushing(false);
      await refreshCount();
    }
  }, [qc, refreshCount]);

  // Listen for online/offline events
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void flush();
    };
    const onOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Check on mount in case there are already-queued items from a prior session
    void refreshCount();
    if (navigator.onLine) void flush();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flush, refreshCount]);

  // Re-read pending count whenever IndexedDB may have changed (poll lightly)
  useEffect(() => {
    const id = window.setInterval(refreshCount, 5_000);
    return () => window.clearInterval(id);
  }, [refreshCount]);

  return { isOnline, pendingCount, isFlushing };
}
