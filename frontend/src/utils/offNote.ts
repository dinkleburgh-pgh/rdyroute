/**
 * Sentinel tokens carried inside TruckState.off_note.
 *
 * off_note is shared free text (leads type into it, "Ran Special" appends to
 * it), so machine markers must be exact " | "-separated segments — never
 * substring matches — and add/remove must touch ONLY their own segment so a
 * hand-typed note survives a toggle.
 *
 * "Ran Ahead" marks a truck that already ran its route this week (holiday
 * double-loads) and therefore skips TONIGHT'S load: it still unloads normally
 * in the morning, and the marker dies at day-init with the rest of off_note.
 */
export const RAN_AHEAD = "Ran Ahead";

const SEP = " | ";

function segments(note: string | null | undefined): string[] {
  return (note ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasNoteToken(note: string | null | undefined, token: string): boolean {
  const t = token.toLowerCase();
  return segments(note).some((s) => s.toLowerCase() === t);
}

export function addNoteToken(note: string | null | undefined, token: string): string {
  if (hasNoteToken(note, token)) return (note ?? "").trim();
  const prev = (note ?? "").trim();
  return prev ? `${prev}${SEP}${token}` : token;
}

export function removeNoteToken(note: string | null | undefined, token: string): string {
  const t = token.toLowerCase();
  return segments(note)
    .filter((s) => s.toLowerCase() !== t)
    .join(SEP);
}

export const hasRanAhead = (note?: string | null) => hasNoteToken(note, RAN_AHEAD);
