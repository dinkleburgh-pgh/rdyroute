/**
 * Client-side diagnostic logging.
 *
 * reportProgressOverflow fires when a progress-bar numerator exceeds its
 * denominator (the intermittent "N+1 of N" overflow). It logs to the console
 * AND — once per unique occurrence per session — to the server
 * (POST /debug/client-log), so an overflow that only happens on a floor device
 * is retrievable centrally, with the exact truck(s) that pushed it over.
 */
import { api } from "../api/client";

const _seen = new Set<string>();

export function reportProgressOverflow(
  label: string,
  doneTrucks: number[],
  totalTrucks: number[],
  meta?: Record<string, unknown>,
): void {
  if (doneTrucks.length <= totalTrucks.length) return;

  const totalSet = new Set(totalTrucks);
  const extra = doneTrucks.filter((n) => !totalSet.has(n));
  const detail = {
    label,
    numerator: doneTrucks.length,
    denominator: totalTrucks.length,
    extra_trucks: extra,
    counted: doneTrucks,
    routes: totalTrucks,
    ...meta,
  };

  // eslint-disable-next-line no-console
  console.warn(
    `[progress-overflow] ${label}: numerator ${doneTrucks.length} > denominator ${totalTrucks.length}; extra=[${extra.join(", ")}]`,
    detail,
  );

  // De-dupe so a persistent overflow logs to the server once per occurrence, not
  // once per render.
  const sig = `${label}|${meta?.run_date ?? ""}|${doneTrucks.length}/${totalTrucks.length}|${extra.join(",")}`;
  if (_seen.has(sig)) return;
  _seen.add(sig);
  logDebug("overflow", `${label}: ${doneTrucks.length}/${totalTrucks.length} extra=[${extra.join(",")}]`, detail);
  void api.post("/debug/client-log", { event: "progress_overflow", detail }).catch(() => {
    /* best-effort — never disrupt the UI over a debug log */
  });
}

// ---------------------------------------------------------------------------
// General debug event log — a localStorage ring buffer of the last 300 app
// events (state mutations, bulk moves, API errors, overflows). Readable in
// Settings → Development → Debug Log, so "what did the app just do?" is
// answerable on any device without devtools.
// ---------------------------------------------------------------------------
export interface DebugEntry {
  ts: number; // epoch ms
  cat: string; // "mutation" | "bulk" | "api-error" | "overflow" | ...
  msg: string;
  data?: unknown;
}

const LOG_KEY = "rr:debugLog";
const LOG_MAX = 300;

export function logDebug(cat: string, msg: string, data?: unknown): void {
  try {
    const entry: DebugEntry = { ts: Date.now(), cat, msg, ...(data !== undefined ? { data } : {}) };
    const cur: DebugEntry[] = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    cur.push(entry);
    if (cur.length > LOG_MAX) cur.splice(0, cur.length - LOG_MAX);
    localStorage.setItem(LOG_KEY, JSON.stringify(cur));
    // eslint-disable-next-line no-console
    console.debug(`[rr:${cat}] ${msg}`, data ?? "");
  } catch {
    /* storage full / privacy mode — logging must never break the app */
  }
}

export function getDebugLog(): DebugEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function clearDebugLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}
