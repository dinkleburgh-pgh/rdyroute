/**
 * Shared truck-status presentation constants.
 *
 * Extracted from Board.tsx and RunDay.tsx which previously each declared their
 * own near-identical copies. Keep pure (no React) so it can be imported anywhere.
 *
 * `in_progress` reads "Loading" everywhere. The Board historically said
 * "In Progress" while RunDay said "Loading"; the live-status rail rename
 * settled it — one status, one word, every surface.
 */

import type { TruckStatus } from "../types";

/** Default status labels (Board-style wording). */
export const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  unfinished: "Unfinished",
  shop: "Shop",
  in_progress: "Loading",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};



export const STATUS_BG: Record<TruckStatus, string> = {
  dirty: "bg-status-dirty",
  unfinished: "bg-status-unfinished",
  shop: "bg-status-shop",
  in_progress: "bg-status-inprogress",
  unloaded: "bg-status-unloaded",
  loaded: "bg-status-loaded",
  off: "bg-status-off",
  oos: "bg-status-oos",
  spare: "bg-status-spare",
};

export const STATUS_TEXT: Record<TruckStatus, string> = {
  dirty: "text-status-dirty",
  unfinished: "text-status-unfinished",
  shop: "text-status-shop",
  in_progress: "text-status-inprogress",
  unloaded: "text-status-unloaded",
  loaded: "text-status-loaded",
  off: "text-status-off",
  oos: "text-status-oos",
  spare: "text-white",
};

/** Raw hex values for each status (mirrors tailwind.config.js `status` palette). */
export const STATUS_COLORS: Record<TruckStatus, string> = {
  dirty: "#ef4444",
  unfinished: "#d946ef",
  shop: "#8b5cf6",
  in_progress: "#f59e0b",
  unloaded: "#22c55e",
  loaded: "#3b82f6",
  off: "#64748b",
  oos: "#6b7a90",
  spare: "#06b6d4",
};
