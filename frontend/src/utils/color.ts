/**
 * Colour-contrast helpers. This file once carried a whole parallel design
 * system (STATUS_META, its own TruckStatus type, tint/lighten helpers) that
 * shadowed constants/truckStatus.ts with drifted hexes — all dead, all gone.
 * The palette's single source of truth is constants/truckStatus.ts.
 */

/** True when `hex` is light enough (WCAG relative luminance) to need black text. */
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
