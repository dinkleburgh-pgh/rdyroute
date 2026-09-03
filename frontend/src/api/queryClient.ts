/**
 * Shared React Query client. Lives in its own module so main.tsx can hydrate it
 * from the persisted IndexedDB cache *before* the app renders (offline-first).
 *
 * - gcTime 24h: keep fetched data around long enough to serve offline.
 * - networkMode "offlineFirst": queries/mutations run even with no connection —
 *   queries return the persisted cache, mutations fall through to the offline
 *   queue (see api/client interceptor + useOfflineSync) instead of hanging.
 */
import { QueryClient } from "@tanstack/react-query";
import { errorDetail, errorStatus } from "./errors";
import { emitToast } from "../utils/toastBridge";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      networkMode: "offlineFirst",
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: "offlineFirst",
      onError: (err) => {
        // The floor of failure UX for every mutation without its own onError:
        // a write that failed must never look like a write that worked. This
        // used to be console.error only — 66 of 74 mutations failed silently.
        // Offline taps never land here (the interceptor queues them as 202s),
        // so this fires only for real server rejections and network drops.
        console.error("[mutation error]", err);
        const detail = errorDetail(err);
        const status = errorStatus(err);
        emitToast(
          detail ?? (status != null ? `That didn't save (error ${status}). Try again.` : "That didn't save — check the connection and try again."),
          "error",
          { durationMs: 6000 },
        );
      },
    },
  },
});
