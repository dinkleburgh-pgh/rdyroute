import { useCallback, useState } from "react";

/**
 * Which arrangement of the Load page this device shows.
 *
 *   yard    — the dock on the left (loading truck, unload question, tonight's
 *             numbers), THE YARD on the right: one numbered line (up next,
 *             then the lane), Ready, Not ready, Loaded folded.
 *   classic — the three-zone dock card (Loading now / Up next / Staged) over
 *             the Ready grid and the Loaded wall, reference rail on the right.
 *   floor   — just what a loader acts on, extra big: the three-zone dock card
 *             at XL, big ready tiles, Not ready as chips, Loaded folded, the
 *             unload question only until it is answered. No reference cards.
 *
 * Per device, like Unload's cards/list and the Fleet card size: a dock tablet
 * and a lead's phone can each keep the view that suits them. All views are
 * fed by the same derivations in Load.tsx; only the arrangement differs.
 */
export type LoadLayout = "yard" | "classic" | "floor";

const KEY = "load:layout";
const DEFAULT: LoadLayout = "yard";

export function useLoadLayout(): [LoadLayout, (next: LoadLayout) => void] {
  const [layout, setLayoutState] = useState<LoadLayout>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw === "yard" || raw === "classic" || raw === "floor" ? raw : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });
  const setLayout = useCallback((next: LoadLayout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode — the choice just doesn't persist */
    }
  }, []);
  return [layout, setLayout];
}
