import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Maximize2, X } from "lucide-react";
import { formatRunDate } from "../../utils/dates";
import { useNextUp, useShortages } from "../../api/hooks";
import { ShortageLogger } from "../../pages/Shorts";
import { NextUpPanel, StartNextUpBanner } from "../LiveInProgress";
import CoverageCards from "../CoverageCards";
import WorkflowCard from "../WorkflowCard";
import GarmentsStrip from "./GarmentsStrip";
import InProgressHeroPanel from "./InProgressHeroPanel";
import LoadNotesPanel from "./LoadNotesPanel";
import type { LoadActions } from "../../hooks/useLoadActions";
import type { CoverageEntry } from "../../utils/truckStatus";
import type { TruckWithState } from "../../types";

const ZOOM_KEY = "load:displayZoom";
const ZOOM_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5];

/**
 * Full-screen, always-on load station.
 *
 * Unlike the Report Kiosk this is NOT a slideshow — the truck being loaded is
 * permanently on screen, and the surface is interactive: start, finish, cancel,
 * and log shortages without leaving it.
 *
 * Two structural details are load-bearing:
 *   1. It portals to document.body. Load's page body sits inside a motion.div,
 *      and a transformed ancestor turns `position: fixed` into container-
 *      relative positioning.
 *   2. It sits at z-[85] — ABOVE everything in Layout (max z-70) but BELOW
 *      ConfirmDialog (z-90) and toasts (z-100), so the confirmations it raises
 *      (and the short sheet's own delete dialog) land on top without any
 *      change to those components.
 */
export default function LoadDisplay({
  runDate,
  loadDay,
  actions,
  paceAvgSeconds,
  ready,
  unloading = [],
  nextUpTruck,
  queuedNextUp,
  coverage,
  isRecurringCoverage,
  garmentTrucks,
  loadedCount,
  loadTotal,
  onExit,
}: {
  runDate: string;
  loadDay: number;
  actions: LoadActions;
  paceAvgSeconds: number | null;
  ready: TruckWithState[];
  /** What Unload is emptying right now (0 or 1). Informational. */
  unloading?: TruckWithState[];
  nextUpTruck?: TruckWithState;
  queuedNextUp: TruckWithState | null;
  coverage: CoverageEntry[];
  isRecurringCoverage: (route: number, cover: number) => boolean;
  garmentTrucks: TruckWithState[];
  loadedCount: number;
  loadTotal: number;
  onExit: () => void;
}) {
  const { inProgress, busy, requestStart, requestFinish, cancelLoad } = actions;
  const [zoom, setZoom] = useState<number>(() => {
    const raw = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(raw) ? raw : 1.5;
  });
  const [shortSheetOpen, setShortSheetOpen] = useState(false);
  const [nextUpOpen, setNextUpOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const { data: storedNextUp } = useNextUp(runDate);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // CSS `zoom` scales pixels but does NOT move media queries, so Tailwind's
  // md:/xl: breakpoints would keep resolving against the real viewport and the
  // panels would squeeze instead of reflowing. Derive the columns ourselves.
  const effectiveWidth = viewportWidth / zoom;
  // Main working column on the left (the truck, then the ready list), a
  // narrower reference rail on the right (garments, notes, coverage). Below
  // ~1000px effective it stacks, rail after the work.
  const shellCols =
    effectiveWidth >= 1000 ? "minmax(0,2.2fr) minmax(0,1fr)" : "minmax(0,1fr)";

  const dialogOpen =
    actions.confirmLoadTruck !== null || actions.confirmGarmentTruck !== null ||
    shortSheetOpen || nextUpOpen;

  // Esc leaves the display — but never while something is layered on top.
  // ConfirmDialog registers its own Escape listener, so without this guard a
  // single press would close the dialog AND the display underneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dialogOpen) return;
      onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, onExit]);

  // Close the short sheet if its truck stops loading (finished from a phone,
  // marked OOS) — otherwise it would hang there logging against a stale truck.
  useEffect(() => {
    if (!inProgress) setShortSheetOpen(false);
  }, [inProgress]);

  function pickZoom(z: number) {
    setZoom(z);
    localStorage.setItem(ZOOM_KEY, String(z));
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Denied or unsupported (iOS Safari) — the overlay still covers the app.
    }
  }

  const readySorted = useMemo(
    () => [...ready].sort((a, b) => a.truck_number - b.truck_number),
    [ready],
  );

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col overflow-hidden bg-app pt-[env(safe-area-inset-top)]">
      {/* Bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline bg-surface/80 px-3 py-2.5 backdrop-blur sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            {formatRunDate(runDate)} · Load Day {loadDay}
          </p>
          <h2 className="truncate text-lg font-black leading-tight text-ink sm:text-2xl">Load Display</h2>
        </div>
        <span className="shrink-0 font-mono text-sm tabular-nums text-ink-muted">
          {loadedCount} / {loadTotal} loaded
        </span>
        <button
          onClick={onExit}
          title="Exit display (Esc)"
          className="shrink-0 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink sm:order-last"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <select
            value={zoom}
            onChange={(e) => pickZoom(Number(e.target.value))}
            title="Text size"
            className="input w-[4.25rem] px-1.5 py-1 text-xs sm:w-20 sm:px-2"
          >
            {ZOOM_STEPS.map((z) => (
              <option key={z} value={z}>{Math.round(z * 100)}%</option>
            ))}
          </select>
          <button
            onClick={toggleFullscreen}
            title="Toggle full screen"
            className="hidden rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink sm:block"
          >
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ zoom }} className="space-y-4 p-4 sm:p-6">
          {/* Two columns: the work on the left, reference on the right. */}
          <div className="grid items-start gap-4" style={{ gridTemplateColumns: shellCols }}>

            {/* LEFT — what you act on */}
            <div className="flex min-w-0 flex-col gap-4">
              {inProgress ? (
                <InProgressHeroPanel
                  variant="display"
                  truck={inProgress}
                  paceAvgSeconds={paceAvgSeconds}
                  busy={busy === inProgress.truck_number}
                  loadDay={loadDay}
                  nextUp={nextUpTruck}
                  onFinish={() => requestFinish(inProgress)}
                  onCancel={() => void cancelLoad(inProgress)}
                  onShortSheet={() => setShortSheetOpen(true)}
                  onChangeNextUp={() => setNextUpOpen(true)}
                />
              ) : queuedNextUp ? (
                <StartNextUpBanner
                  truck={queuedNextUp}
                  paceAvgSeconds={paceAvgSeconds}
                  busy={busy === queuedNextUp.truck_number}
                  onStart={() => requestStart(queuedNextUp)}
                  blockedReason={
                    queuedNextUp.truck_type === "Spare" &&
                    queuedNextUp.route_swap_route == null &&
                    queuedNextUp.state?.oos_spare_route == null
                      ? "This spare has no route to cover yet — assign one on the board first."
                      : null
                  }
                />
              ) : (
                <div className="card flex flex-col items-center justify-center py-10 text-center">
                  <p className="text-2xl font-bold text-st-loaded">
                    {readySorted.length > 0 ? "Nothing loading" : "All caught up"}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {readySorted.length > 0
                      ? "Tap a truck below to start it."
                      : `${loadedCount} loaded today.`}
                  </p>
                </div>
              )}

              {unloading.length > 0 && (
                <div className="card flex flex-wrap items-center gap-x-3 gap-y-1 border-amber-600/40 bg-amber-950/20 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Now unloading</span>
                  {unloading.map((t) => (
                    <span key={t.truck_number} className="font-mono text-lg font-black tabular-nums text-ink">#{t.truck_number}</span>
                  ))}
                </div>
              )}

              <div className="card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-st-unloaded">
                  Ready to load ({readySorted.length})
                </h3>
                {readySorted.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-faint">Nothing ready.</p>
                ) : (
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}
                  >
                    {readySorted.map((t) => (
                      <button
                        key={t.truck_number}
                        type="button"
                        disabled={Boolean(inProgress) || busy === t.truck_number}
                        onClick={() => requestStart(t)}
                        className={clsx(
                          "text-left transition-all",
                          inProgress ? "cursor-not-allowed opacity-50" : "active:scale-[0.98]",
                        )}
                      >
                        <WorkflowCard
                          truck={t}
                          compact
                          accent="text-st-unloaded"
                          statusLabel="Unloaded"
                          statusClassName="bg-[#16a34a] text-white"
                          interactive={!inProgress}
                          ringClassName="hover:ring-st-unloaded"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* RIGHT — reference you glance at, garments first */}
            <div className="flex min-w-0 flex-col gap-4">
              <GarmentsStrip trucks={garmentTrucks} />

              <LoadNotesPanel
                truck={inProgress}
                upcoming={readySorted}
                loadDay={loadDay}
                runDate={runDate}
              />

              <div className="card">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-400">
                  Coverage today ({coverage.length})
                </h3>
                {coverage.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-faint">No coverage today.</p>
                ) : (
                  <CoverageCards
                    entries={coverage}
                    isRecurring={isRecurringCoverage}
                    className="grid grid-cols-1 gap-2.5"
                  />
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Next-up picker. Portaled to body at z-[90] — the Load page's own
          picker is z-[80], which would render BEHIND this overlay. */}
      {nextUpOpen && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setNextUpOpen(false)}
        >
          <div
            className="flex w-full max-w-lg flex-col rounded-xl border border-hairline bg-surface shadow-card"
            style={{ maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <h3 className="text-base font-bold tracking-wide">Set Next Up</h3>
              <button
                onClick={() => setNextUpOpen(false)}
                className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <NextUpPanel
                runDate={runDate}
                nextUp={storedNextUp ?? null}
                unloaded={readySorted}
                anyInProgress={Boolean(inProgress)}
                onPick={() => setNextUpOpen(false)}
                defaultOpen
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {shortSheetOpen && inProgress && (
        <ShortSheetDrawer
          truck={inProgress}
          runDate={runDate}
          onClose={() => setShortSheetOpen(false)}
        />
      )}
    </div>,
    document.body,
  );
}

/** Short-sheet entry for the truck being loaded, as a slide-over. */
function ShortSheetDrawer({
  truck,
  runDate,
  onClose,
}: {
  truck: TruckWithState;
  runDate: string;
  onClose: () => void;
}) {
  const { data: shorts = [] } = useShortages(runDate, truck.truck_number);
  return (
    <div className="absolute inset-0 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-hairline bg-app shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <span className="font-mono text-2xl font-black tabular-nums text-ink">#{truck.truck_number}</span>
          <span className="text-sm text-ink-muted">Short sheet</span>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ShortageLogger inline truck={truck} shorts={shorts} runDate={runDate} onBack={onClose} />
        </div>
      </div>
    </div>
  );
}
