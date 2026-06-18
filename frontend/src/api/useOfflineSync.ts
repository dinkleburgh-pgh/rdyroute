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

export function useOfflineSync(): OfflineSyncState {
  const qc = useQueryClient();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isFlushing, setIsFlushing] = useState(false);
  const flushingRef = useRef(false);

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

      const invalidatedKeys = new Set<string>();

      for (const item of items) {
        try {
          await api.request({ method: item.method, url: item.endpoint, data: item.payload });
          await offlineQueue.remove(item.id);

          // Track which query keys need invalidation
          if (item.type === "create_shortage") invalidatedKeys.add("shorts");
        } catch (err: unknown) {
          // 4xx errors are permanent client errors — discard the item and continue
          const status =
            (err as { response?: { status?: number } })?.response?.status;
          if (status !== undefined && status >= 400 && status < 500) {
            console.warn("[offlineSync] discarding permanently-rejected item", item.id, status);
            await offlineQueue.remove(item.id);
            continue;
          }
          // Network error or 5xx — stop replaying; retry on next online event
          break;
        }
      }

      // Bulk invalidate after flush
      for (const key of invalidatedKeys) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      // Also refresh the board so status counts update
      qc.invalidateQueries({ queryKey: ["board"] });
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
