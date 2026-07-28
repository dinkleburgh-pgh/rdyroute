/**
 * Display labels for truck types.
 *
 * The stored/wire value for a Facility Services truck is still "Dust" — it is
 * the TruckType enum value in models.py, the Postgres enum label in the
 * truck_type column, the JSON value on every board response, AND the literal
 * written into backup archives. Renaming it would break restores of existing
 * backups. So the value stays "Dust" everywhere behind the glass and only the
 * label the user reads changes here.
 *
 * Render truck types through truckTypeLabel() rather than printing
 * truck.truck_type directly, or the raw "Dust" leaks back into the UI.
 */
import type { TruckType } from "../types";

export const TRUCK_TYPE_LABEL: Record<TruckType, string> = {
  Uniform: "Uniform",
  Dust: "F.S.",
  Spare: "Spare",
};

/** Spelled-out form, for headings and prose where the abbreviation is cryptic. */
export const TRUCK_TYPE_LONG_LABEL: Record<TruckType, string> = {
  Uniform: "Uniform",
  Dust: "Facility Services",
  Spare: "Spare",
};

/** Single-letter tag used where space is tight (e.g. the off-day schedule grid). */
export const TRUCK_TYPE_SHORT_LABEL: Record<TruckType, string> = {
  Uniform: "(U)",
  Dust: "(F)",
  Spare: "(S)",
};

export function truckTypeLabel(t: TruckType | string | null | undefined): string {
  if (!t) return "";
  return TRUCK_TYPE_LABEL[t as TruckType] ?? String(t);
}

export function truckTypeLongLabel(t: TruckType | string | null | undefined): string {
  if (!t) return "";
  return TRUCK_TYPE_LONG_LABEL[t as TruckType] ?? String(t);
}
