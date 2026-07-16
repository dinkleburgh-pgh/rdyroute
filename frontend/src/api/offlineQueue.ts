/**
 * Offline mutation queue backed by IndexedDB (via `idb`).
 *
 * When a worker loses Wi-Fi, outgoing API mutations are saved here.
 * The useOfflineSync hook drains this queue as soon as connectivity is restored.
 *
 * Schema
 * ──────
 * DB:    readyroute-offline  (version 1)
 * Store: pending-mutations
 *   key:   id (auto-generated string)
 *   value: PendingMutation
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationType = "create_shortage" | "generic";

export interface PendingMutation {
  id: string;
  type: MutationType;
  endpoint: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  payload: unknown;
  timestamp: number;
}

interface OfflineDB extends DBSchema {
  "pending-mutations": {
    key: string;
    value: PendingMutation;
  };
}

// ---------------------------------------------------------------------------
// DB initialisation
// ---------------------------------------------------------------------------

let _db: IDBPDatabase<OfflineDB> | null = null;

async function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (_db) return _db;
  _db = await openDB<OfflineDB>("readyroute-offline", 1, {
    upgrade(db) {
      db.createObjectStore("pending-mutations", { keyPath: "id" });
    },
  });
  return _db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Add a mutation to the pending queue. Returns the generated id. */
export async function enqueue(
  type: MutationType,
  endpoint: string,
  method: PendingMutation["method"],
  payload: unknown,
): Promise<string> {
  const db = await getDb();
  // Coalesce idempotent updates: a newer PUT/PATCH to the same endpoint replaces
  // any pending one, so repeated status changes to the same truck don't replay
  // stale intermediate states. (POST/DELETE are distinct — never coalesced.)
  if (method === "PUT" || method === "PATCH") {
    for (const existing of await db.getAll("pending-mutations")) {
      if (existing.endpoint === endpoint && existing.method === method) {
        await db.delete("pending-mutations", existing.id);
      }
    }
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item: PendingMutation = { id, type, endpoint, method, payload, timestamp: Date.now() };
  await db.put("pending-mutations", item);
  return id;
}

/** Retrieve all pending mutations, ordered by timestamp. */
export async function getAll(): Promise<PendingMutation[]> {
  const db = await getDb();
  const all = await db.getAll("pending-mutations");
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

/** Remove a mutation from the queue (call after successful sync). */
export async function remove(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("pending-mutations", id);
}

/** How many mutations are currently pending. */
export async function count(): Promise<number> {
  const db = await getDb();
  return db.count("pending-mutations");
}

// ---------------------------------------------------------------------------
// Helper: is this error a network connectivity failure?
// ---------------------------------------------------------------------------

export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { response?: unknown; code?: string; message?: string };
  // Axios sets `response` to undefined for network errors
  if (e.response !== undefined) return false;
  const networkCodes = ["ERR_NETWORK", "ERR_INTERNET_DISCONNECTED", "ECONNABORTED", "ECONNREFUSED"];
  return networkCodes.includes(e.code ?? "") || e.message === "Network Error";
}
