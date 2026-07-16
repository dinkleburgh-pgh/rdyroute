/**
 * Persists the React Query cache to IndexedDB so reads survive a reload and are
 * available with no connection (offline-first). Uses core `dehydrate`/`hydrate`
 * (no extra dependency) + `idb`.
 *
 *  - loadPersistedCache(): hydrate the client from disk before the app renders.
 *  - startPersisting():    save the cache (debounced) on every change + page hide.
 *
 * Only queries are persisted — pending *mutations* are handled separately by the
 * offline queue (offlineQueue.ts + useOfflineSync).
 */
import { dehydrate, hydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "readyroute-cache";
const STORE = "query-cache";
const KEY = "dehydrated";
// Ignore a persisted cache older than this — stale operational data is worse
// than an empty board.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;
// Bump when the cached data shape changes so an old persisted cache is DROPPED
// rather than hydrated — hydrating a mismatched shape is the "cache
// deserialization" failure. Records without a matching version are discarded.
const CACHE_VERSION = 2;

interface Saved {
  v?: number;
  ts: number;
  state: DehydratedState;
}

let _db: IDBPDatabase | null = null;
async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
  return _db;
}

function dump(qc: QueryClient): DehydratedState {
  // Persist successful queries only; the offline queue owns pending mutations.
  return dehydrate(qc, { shouldDehydrateMutation: () => false });
}

/** Hydrate the query client from the persisted cache. Call before first render. */
export async function loadPersistedCache(qc: QueryClient): Promise<void> {
  try {
    const db = await getDb();
    const saved = (await db.get(STORE, KEY)) as Saved | undefined;
    if (saved && saved.v === CACHE_VERSION && Date.now() - saved.ts < MAX_AGE_MS) {
      hydrate(qc, saved.state);
    } else if (saved) {
      // Wrong version or too old — drop it so we start clean and never try to
      // hydrate (deserialize) a mismatched shape.
      await db.delete(STORE, KEY).catch(() => {});
    }
  } catch (err) {
    console.warn("[queryPersist] load failed", err);
  }
}

// How long to coalesce cache-change bursts before writing to IndexedDB. The
// full cache is dehydrated + structured-cloned + written on each flush, so a
// tight interval means recurring main-thread work on low-end tablets; the whole
// cache polls/refetches constantly. A long debounce is safe because the
// pagehide handler below flushes synchronously on tab close/hide.
const SAVE_DEBOUNCE_MS = 20000;

/** Begin saving the cache (debounced) on every change and on page hide. */
export function startPersisting(qc: QueryClient): void {
  let timer: number | undefined;
  const save = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(async () => {
      timer = undefined;
      try {
        const db = await getDb();
        await db.put(STORE, { v: CACHE_VERSION, ts: Date.now(), state: dump(qc) } satisfies Saved, KEY);
      } catch (err) {
        console.warn("[queryPersist] save failed", err);
      }
    }, SAVE_DEBOUNCE_MS);
  };

  qc.getQueryCache().subscribe(save);

  // Best-effort flush when the tab is hidden/closed so the latest data persists.
  window.addEventListener("pagehide", () => {
    void getDb().then((db) => db.put(STORE, { v: CACHE_VERSION, ts: Date.now(), state: dump(qc) }, KEY)).catch(() => {});
  });
}
