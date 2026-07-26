/**
 * Colour bands for a batch's wearer load vs the configured cap, shared by every
 * batch card (Unload, Batches, the Report, and the report PDF) so they never
 * drift. RED only once the batch is AT or OVER cap; amber approaching; emerald
 * below. Graded against the cap even in no-cap mode so the bar still shows how
 * full the batch is.
 */
export function capacityColor(total: number, _noCap: boolean, cap: number): { bar: string; text: string } {
  if (total >= cap) return { bar: "bg-red-500", text: "text-red-400" };
  if (total >= cap * 0.7) return { bar: "bg-amber-500", text: "text-amber-400" };
  return { bar: "bg-emerald-500", text: "text-emerald-400" };
}

/** Bar fill %, 0-100, proportional to the cap (empty batch → 0). */
export function capacityPct(total: number, cap: number): number {
  return Math.min(100, Math.round((total / Math.max(cap, 1)) * 100));
}
