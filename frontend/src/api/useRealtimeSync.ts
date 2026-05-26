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
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useRealtimeSync() {
  const qc = useQueryClient();
  const retryDelay = useRef(BASE_DELAY_MS);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay.current = BASE_DELAY_MS; // reset back-off on success
      };

      ws.onmessage = (ev) => {
        let event: { type: string; run_date?: string; truck_number?: number };
        try {
          event = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        if (event.type === "truck_state_updated") {
          if (event.run_date) {
            qc.invalidateQueries({ queryKey: ["board", event.run_date] });
          } else {
            qc.invalidateQueries({ queryKey: ["board"] });
          }
        } else if (event.type === "shortage_updated") {
          qc.invalidateQueries({ queryKey: ["shorts"] });
        }
      };

      ws.onclose = () => {
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

    connect();

    return () => {
      unmounted = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      wsRef.current?.close();
    };
  }, [qc]);
}
