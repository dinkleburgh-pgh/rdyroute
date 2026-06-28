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

interface Saved {
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
    if (saved && Date.now() - saved.ts < MAX_AGE_MS) {
      hydrate(qc, saved.state);
    }
  } catch (err) {
    console.warn("[queryPersist] load failed", err);
  }
}

/** Begin saving the cache (debounced) on every change and on page hide. */
export function startPersisting(qc: QueryClient): void {
  let timer: number | undefined;
  const save = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(async () => {
      timer = undefined;
      try {
        const db = await getDb();
        await db.put(STORE, { ts: Date.now(), state: dump(qc) } satisfies Saved, KEY);
      } catch (err) {
        console.warn("[queryPersist] save failed", err);
      }
    }, 1000);
  };

  qc.getQueryCache().subscribe(save);

  // Best-effort flush when the tab is hidden/closed so the latest data persists.
  window.addEventListener("pagehide", () => {
    void getDb().then((db) => db.put(STORE, { ts: Date.now(), state: dump(qc) }, KEY)).catch(() => {});
  });
}
