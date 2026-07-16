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
  void api.post("/debug/client-log", { event: "progress_overflow", detail }).catch(() => {
    /* best-effort — never disrupt the UI over a debug log */
  });
}
