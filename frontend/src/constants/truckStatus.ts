/**
 * Shared truck-status presentation constants.
 *
 * Extracted from Board.tsx and RunDay.tsx which previously each declared their
 * own near-identical copies. Keep pure (no React) so it can be imported anywhere.
 *
 * Note: the two pages historically used different labels for `in_progress`
 * ("In Progress" on the Board, "Loading" on RunDay). Both are exported so each
 * call site can keep its original wording.
 */

import type { TruckStatus } from "../types";

/** Default status labels (Board-style wording). */
export const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  unfinished: "Unfinished",
  shop: "Shop",
  in_progress: "In Progress",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};

/** RunDay-style labels (uses "Loading" for in_progress). */
export const STATUS_LABELS_RUNDAY: Record<TruckStatus, string> = {
  ...STATUS_LABELS,
  in_progress: "Loading",
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
  dirty: "#dc2626",
  unfinished: "#c026d3",
  shop: "#7400ff",
  in_progress: "#f59e0b",
  unloaded: "#16a34a",
  loaded: "#2563eb",
  off: "#6b7280",
  oos: "#475569",
  spare: "#0e7490",
};
