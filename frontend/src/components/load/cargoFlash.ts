import type { CSSProperties } from "react";

/**
 * The flashing garments / NOGs chip (index.css .animate-cargo-chip). Apply
 * CARGO_FLASH plus one tone to the element; icons inside should inherit
 * currentColor (no inline colour of their own) so they flip with the chip.
 */
export const CARGO_FLASH = "animate-cargo-chip";

/** F.S. garments: amber fill, dark ink. */
export const GARMENT_FLASH_TONE = {
  "--cargo-fill": "#f59e0b",
  "--cargo-ink": "#1c1204",
  "--cargo-glow": "rgba(245, 158, 11, 0.55)",
} as CSSProperties;

/** NOGs: rose fill, white ink. */
export const NOGS_FLASH_TONE = {
  "--cargo-fill": "#f43f5e",
  "--cargo-ink": "#ffffff",
  "--cargo-glow": "rgba(244, 63, 94, 0.55)",
} as CSSProperties;
