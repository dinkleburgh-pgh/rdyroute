/**
 * Color helpers shared across the app.
 *
 * Extracted from App.tsx (`_badgeTextColor`) and Board.tsx (`_needsDarkText`)
 * which previously each declared their own copy of the same luminance math.
 */

export const STATUS_META: Record<string, { label: string; color: string }> = {
  dirty:       { label: "Dirty",       color: "#ef4444" },
  unfinished:  { label: "Unfinished",  color: "#d946ef" },
  shop:        { label: "Shop",        color: "#8b5cf6" },
  in_progress: { label: "In Progress", color: "#f59e0b" },
  unloaded:    { label: "Unloaded",    color: "#22c55e" },
  loaded:      { label: "Loaded",      color: "#3b82f6" },
  off:         { label: "Off",         color: "#64748b" },
  oos:         { label: "OOS",         color: "#6b7a90" },
  spare:       { label: "Spare",       color: "#06b6d4" },
};

export type TruckStatus = keyof typeof STATUS_META;

function rgbParts(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

export function hexA(hex: string, a: number): string {
  const [r, g, b] = rgbParts(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function lighten(hex: string, t: number): string {
  let [r, g, b] = rgbParts(hex);
  r = Math.round(r + (255 - r) * t);
  g = Math.round(g + (255 - g) * t);
  b = Math.round(b + (255 - b) * t);
  return `rgb(${r},${g},${b})`;
}

export function statusBadge(status: string) {
  const c = STATUS_META[status]?.color ?? "#64748b";
  return {
    background: hexA(c, 0.13),
    border: `1px solid ${hexA(c, 0.30)}`,
    color: lighten(c, 0.32),
  };
}

/**
 * Returns true when a given hex color is light enough that dark text reads
 * better on top of it. Uses WCAG relative-luminance.
 *
 * Threshold of 0.35 means only genuinely light colors (pastels, amber) force
 * dark text; reds/purples/blues keep white.
 */
export function needsDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.35;
}

/** Returns "#000000" or "#ffffff" — whichever contrasts better with `hex`. */
export function badgeTextColor(hex: string): string {
  return needsDarkText(hex) ? "#000000" : "#ffffff";
}

/**
 * Deterministically maps a string (e.g. a username) to a pleasant HSL color.
 * Used for avatar background tinting so each user has a stable color.
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
