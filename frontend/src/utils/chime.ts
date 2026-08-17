/**
 * A tiny synthesized chime — no audio asset, no library.
 *
 * Browsers refuse to start audio until the page has seen a user gesture, so
 * Layout calls primeAudio() from one-time pointer/key listeners. On a wall
 * display the crew taps "Mark Unloaded" all night, so in practice the context
 * is always unlocked; the accepted gap is a freshly reloaded, untouched tab,
 * where the first arrival is silent (the toast still shows).
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Create/resume the context inside a user gesture. Safe to call repeatedly. */
export function primeAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

/**
 * Two ascending sine notes, ~0.35s total, gentle level. Silent (not an error)
 * when the context is missing or still locked.
 */
export function playChime(): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime;
  for (const [freq, start] of [
    [880, 0],
    [1174.66, 0.12],
  ] as const) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + start);
    gain.gain.linearRampToValueAtTime(0.18, t0 + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + 0.3);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + 0.32);
  }
}
