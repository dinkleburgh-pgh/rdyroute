import type { ReactNode } from "react";
import type { TruckWithState } from "../../types";
import type { LoadPair } from "./loadUi";

/**
 * Everything a Load page arrangement needs, derived once in Load.tsx and
 * handed to whichever layout the device has chosen (hooks/useLoadLayout).
 * The layouts only ARRANGE: no data derivation, no writes of their own.
 */
export interface LoadViewProps {
  runDate: string;
  /** The Loading-now zone (InProgressHeroPanel), or null when the dock is free. */
  loading: ReactNode | null;
  /** The inline shortage logger while it is open, else null. */
  shortages: ReactNode | null;
  /** The truck at the unload dock + the load crew's answer, or null. */
  unloadCard: ReactNode | null;
  /** Every truck at the unload dock already has an answer (Floor hides the card then). */
  unloadAnswered: boolean;
  tonightCard: ReactNode;
  coverageCard: ReactNode;
  notesCard: ReactNode;
  /** The explicitly queued truck — never a fallback guess. */
  nextUp: TruckWithState | null;
  /** The staging lane in pull-up order, minus the Up-next truck. */
  staged: TruckWithState[];
  /** Ready trucks not already in the line. */
  ready: TruckWithState[];
  held: TruckWithState[];
  unfinished: TruckWithState[];
  loaded: TruckWithState[];
  /** "Usually next" truck numbers for the empty Up-next slot. */
  suggestions: number[];
  /** Trucks in the line (queued + staged). */
  inLine: number;
  /** Few ready trucks → big tiles. */
  readyFocus: boolean;
  busyTruck: number | null;
  /** False while a truck is loading (one at a time). */
  canStart: boolean;
  pairOf: (t: TruckWithState) => LoadPair;
  /** Tap on a truck → the chooser sheet. */
  onTruck: (t: TruckWithState) => void;
  onStart: (t: TruckWithState) => void;
  onPickNextUp: () => void;
  onSuggest: (truckNumber: number) => void;
}
