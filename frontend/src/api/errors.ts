/**
 * The one way to read an axios failure. Twenty-six call sites used to hand-cast
 * `(e as { response?: { data?: { detail?: string } } })` in four incompatible
 * shapes; axios ships isAxiosError for exactly this.
 */
import { isAxiosError } from "axios";

/** The backend's `detail` string, if the failure carried one. */
export function errorDetail(e: unknown): string | null {
  if (isAxiosError(e)) {
    const d = (e.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof d === "string" && d.trim()) return d;
  }
  return null;
}

/** HTTP status of the failure, or null for network/JS errors. */
export function errorStatus(e: unknown): number | null {
  return isAxiosError(e) ? e.response?.status ?? null : null;
}

/** detail → fallback, for user-facing messages. */
export function errorMessage(e: unknown, fallback: string): string {
  return errorDetail(e) ?? fallback;
}
