/**
 * Color helpers shared across the app.
 *
 * Extracted from App.tsx (`_badgeTextColor`) and Board.tsx (`_needsDarkText`)
 * which previously each declared their own copy of the same luminance math.
 */

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
