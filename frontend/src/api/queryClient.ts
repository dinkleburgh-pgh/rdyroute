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
        // Default fallback: log errors from mutations that don't have their
        // own onError handler. Call sites can override with a toast as needed.
        console.error("[mutation error]", err);
      },
    },
  },
});
