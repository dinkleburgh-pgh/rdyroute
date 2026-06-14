/**
 * useRealtimeSync
 *
 * Connects to the backend WebSocket at /ws and invalidates React Query
 * caches whenever a broadcast event arrives. This means every connected
 * client sees state changes immediately — no manual refresh needed.
 *
 * Event types pushed by the server:
 *   { type: "truck_state_updated", run_date: string, truck_number?: number }
 *   { type: "shortage_updated",    run_date: string }
 *
 * Reconnection: exponential back-off capped at 30 s, resets on success.
 *
 * Returns { isWsConnected } so callers can surface connectivity state in the UI.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationEvent } from "../types";

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useRealtimeSync(): { isWsConnected: boolean } {
  const qc = useQueryClient();
  const retryDelay = useRef(BASE_DELAY_MS);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isWsConnected, setIsWsConnected] = useState(false);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) {
          ws.close();
          return;
        }
        retryDelay.current = BASE_DELAY_MS; // reset back-off on success
        setIsWsConnected(true);
      };

      ws.onmessage = (ev) => {
        let event:
          | { type: string; run_date?: string; truck_number?: number }
          | { type: "notification"; event: NotificationEvent };
        try {
          event = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        if (event.type === "truck_state_updated") {
          // Skip board refetch while a state mutation is in-flight — the
          // onSuccess handler will do the final invalidation once committed.
          if (qc.isMutating({ mutationKey: ["upsertTruckState"] }) > 0) return;
          if (event.run_date) {
            qc.invalidateQueries({ queryKey: ["board", event.run_date] });
          } else {
            qc.invalidateQueries({ queryKey: ["board"] });
          }
        } else if (event.type === "shortage_updated") {
          qc.invalidateQueries({ queryKey: ["shorts"] });
        } else if (event.type === "notification" && "event" in event) {
          const notification = event.event;
          if (notification.run_date) {
            qc.invalidateQueries({ queryKey: ["board", notification.run_date] });
            qc.invalidateQueries({ queryKey: ["route-swaps", notification.run_date] });
            qc.invalidateQueries({ queryKey: ["spares", notification.run_date] });
          } else {
            qc.invalidateQueries({ queryKey: ["board"] });
            qc.invalidateQueries({ queryKey: ["route-swaps"] });
            qc.invalidateQueries({ queryKey: ["spares"] });
          }
          window.dispatchEvent(
            new CustomEvent<NotificationEvent>("readyroute:notification", {
              detail: notification,
            }),
          );
        }
      };

      ws.onclose = () => {
        setIsWsConnected(false);
        if (unmounted) return;
        // Reconnect with exponential back-off
        timeoutRef.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, MAX_DELAY_MS);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {
        ws.close(); // triggers onclose → reconnect
      };
    }

    // Defer the initial connect one tick so React.StrictMode's dev-only
    // mount/unmount rehearsal can cancel it cleanly without creating a socket
    // that immediately closes and logs a browser warning.
    connectTimerRef.current = setTimeout(connect, 0);

    return () => {
      unmounted = true;
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [qc]);

  return { isWsConnected };
}

