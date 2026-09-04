/**
 * The stacking contract, as code. It used to live only as prose in
 * LoadDisplay's docstring while 19 hand-picked z values (z-[65], z-[66], …)
 * accumulated across the app. Every overlay takes its layer from here.
 *
 *   chrome   — sidebar / top bar / bottom nav (Layout)
 *   overlay  — page-level overlays that sit above chrome (action sheets,
 *              detail modals, drill-down panels)
 *   display  — the full-screen Load Display / report kiosk
 *   dialog   — confirm dialogs and anything that must beat the display
 *   toast    — always on top
 */
export const Z = {
  chrome: 30,
  overlay: 50,
  display: 85,
  dialog: 90,
  toast: 100,
} as const;

export type ZLayer = keyof typeof Z;
