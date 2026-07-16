/**
 * Board-specific shared constants and helpers.
 *
 * Extracted from Board.tsx so the page and its sub-components (RouteCardPanel,
 * StartLoadModal, TruckDetailPanel, TruckDetailModal, FleetTruckEditor,
 * StatusEditor) can share them without duplication.
 */
import type { TruckStatus } from "../../types";
import { STATUS_COLORS } from "../../constants/truckStatus";
import { needsDarkText } from "../../utils/color";

// Re-export the canonical presentation maps so board files import from one place.
export {
  STATUS_LABELS,
  STATUS_BG,
  STATUS_TEXT,
  STATUS_COLORS,
} from "../../constants/truckStatus";
export { DustGarmentIcon } from "../../components/icons";

/**
 * For statuses whose background is light (amber/pastels), force black badge text.
 * Computed from luminance so it stays correct if colors change.
 */
export const STATUS_BADGE_TEXT: Partial<Record<TruckStatus, string>> = Object.fromEntries(
  (Object.entries(STATUS_COLORS) as [TruckStatus, string][])
    .filter(([, hex]) => needsDarkText(hex))
    .map(([s]) => [s, "!text-black"]),
);

// 'spare' is a truck *type* set via the truck detail panel — not offered as a status here.
// 'off' is schedule-managed; 'in_progress' is managed by load workflow.
export const STATUS_OPTIONS: TruckStatus[] = [
  "dirty",
  "unfinished",
  "shop",
  "unloaded",
  "loaded",
  "oos",
];

export const FLEET_STATUS_OPTIONS: TruckStatus[] = [
  "dirty",
  "unfinished",
  "shop",
  "unloaded",
  "loaded",
  "oos",
];

// All statuses shown in the fleet filter rail (ordered for display).
export const FLEET_RAIL_STATUSES: TruckStatus[] = [
  "dirty",
  "unfinished",
  "unloaded",
  "in_progress",
  "loaded",
  "spare",
  "off",
  "oos",
];

// Truck-TYPE filters offered in the fleet filter dropdown alongside the statuses
// (filter the board to just Uniform or just Dust route trucks).
export const FLEET_TYPE_FILTERS = ["Uniform", "Dust"] as const;
export type FleetTypeFilter = (typeof FLEET_TYPE_FILTERS)[number];
export const FLEET_TYPE_FILTER_BG: Record<FleetTypeFilter, string> = {
  Uniform: "bg-indigo-500",
  Dust: "bg-amber-500",
};

// A fleet filter value is "all", a truck status, or a truck-type filter.
export type FleetFilterValue = TruckStatus | "all" | FleetTypeFilter;

export const DAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
};
