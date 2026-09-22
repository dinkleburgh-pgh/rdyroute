/**
 * The big fleet/status truck card (extracted from Board.tsx). Serves fleet
 * mode and the loaded/all filters; the five status drill pages use StatusTile.
 * The page passes its state as one `ctx` bag (FleetCardContext) so the call
 * site stays a one-liner; tsc owns the contract.
 */
import clsx from "clsx";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Clock, FileText, MapPin } from "lucide-react";
import AnimateCard from "../../components/AnimateCard";
import CoverageCardBadges from "../../components/CoverageCardBadges";
import { useUpsertTruckState } from "../../api/hooks";
import { DustGarmentIcon, STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS, STATUS_TEXT } from "./constants";
import { fmtCountdown } from "./useOutsideTimer";
import {
  effectiveStatus,
  effectiveWorkflowStatus,
  garmentHex,
  garmentIsLoaded,
  getCoverageRouteNumber,
  isScheduledOff,
} from "../../utils/truckStatus";
import { truckTypeLabel } from "../../utils/truckType";
import type { TruckStatus, TruckWithState } from "../../types";
import { RAN_AHEAD, hasRanAhead, removeNoteToken } from "../../utils/offNote";

function formatArrivedAt(ts: number | null | undefined) {
  if (!ts) return "";
  return format(new Date(ts * 1000), "h:mm a");
}

export interface FleetCardContext {
  fleetMode: boolean;
  filter: string;
  runDate: string;
  runDayNum: number;
  runUnloadsDay: number;
  holidayLoad: boolean;
  holidayUnload: boolean;
  unloadsDay2: number;
  loadDay2: number;
  loadNextDay: number;
  cardSize: "s" | "m" | "l";
  isReadOnly: boolean;
  isAdmin: boolean;
  batchingDisabled: boolean;
  multiSelect: boolean;
  selectedTrucks: Set<number>;
  detailNum: number | null;
  setDetailNum: (n: number | null) => void;
  highlightTruck: number | null;
  oosAssignOpen: Set<number>;
  coveringTruckByRoute: Map<number, { num: number; status: TruckStatus | undefined }>;
  coveringRouteByTruckNum: Map<number, number>;
  data: TruckWithState[] | undefined;
  arrivedTrackingEnabled: boolean;
  outsideTimerEnabled: boolean;
  paperBayEnabled: boolean;
  outsideTimers: Map<number, number>;
  paperBayTimers: Map<number, number>;
  outsideCountdowns: Map<number, number>;
  paperBayCountdowns: Map<number, number>;
  cancelOutsideTimer: (n: number) => void;
  cancelPaperBayTimer: (n: number) => void;
  clearArrived: (t: TruckWithState) => void;
  handleTruckClick: (t: TruckWithState) => void;
  renderOosAssignBlock: (t: TruckWithState) => React.ReactNode;
}

export default function FleetCard({ truck, index, ...ctx }: { truck: TruckWithState; index: number } & FleetCardContext) {
  const upsert = useUpsertTruckState();
  const {
    fleetMode, filter, runDate, runDayNum, runUnloadsDay, holidayLoad, holidayUnload,
    unloadsDay2, loadDay2, loadNextDay, cardSize, isReadOnly, isAdmin, batchingDisabled,
    multiSelect, selectedTrucks, detailNum, setDetailNum, highlightTruck, oosAssignOpen,
    coveringTruckByRoute, coveringRouteByTruckNum, data, arrivedTrackingEnabled,
    outsideTimerEnabled, paperBayEnabled, outsideTimers, paperBayTimers,
    outsideCountdowns, paperBayCountdowns, cancelOutsideTimer, cancelPaperBayTimer,
    clearArrived, handleTruckClick, renderOosAssignBlock,
  } = ctx;


    // Fleet mode uses unloads-day status directly. Non-fleet uses
    // effectiveWorkflowStatus so that dirty trucks scheduled off for the
    // load day still show their real dirty/unloaded colour rather than
    // being greyed out — they're still active in today's unload workflow.
    const status = fleetMode
      ? effectiveStatus(truck, runUnloadsDay, holidayUnload)
      : effectiveWorkflowStatus(truck, runDayNum, holidayLoad, runUnloadsDay, holidayUnload);
    // Display status: a route truck flagged is_oos reads as OOS even
    // when its physical workflow status is still "dirty" — keeps the
    // fleet grid and the OOS board in sync with the Route Card /
    // live-status OOS counts.
    const displayStatus: TruckStatus =
      (fleetMode || filter === "oos") && truck.truck_type !== "Spare" && truck.is_oos
        ? "oos"
        : status;
    // The Unloaded board is part of the LOAD workflow (unloaded trucks
    // are ready to load), so it uses load-day chips — only the Dirty
    // board is the unload workflow.
    const isUnloadView = filter === "dirty";
    const isLoadView = filter === "loaded" || filter === "unloaded";
    let chipDay: number | undefined;
    // Which kind of day the chip is showing. The same chip renders the
    // unload day on the dirty view and the load day on the loaded /
    // unloaded views, so the number alone is unreadable.
    let chipKind: "Unload" | "Load" = "Load";
    let chipIsExtra = false;
    if (isUnloadView && holidayUnload) {
      chipDay = isScheduledOff(truck, runUnloadsDay) ? unloadsDay2 : runUnloadsDay;
      chipKind = "Unload";
      chipIsExtra = chipDay === unloadsDay2;
    } else if (isLoadView && holidayLoad) {
      chipDay = (isScheduledOff(truck, runDayNum) || isScheduledOff(truck, loadNextDay)) ? loadDay2 : runDayNum;
      chipIsExtra = chipDay === loadDay2;
    }
    // Fleet board: the big number is greyed out for trucks off the LOAD
    // day (done for tomorrow); U Off trucks (off only the unload day) keep
    // their real workflow-status colour instead of the grey "off" tint.
    const isLoadOff =
      !holidayLoad &&
      truck.truck_type !== "Spare" &&
      isScheduledOff(truck, runDayNum) &&
      status !== "off" &&
      !getCoverageRouteNumber(truck) &&
      !truck.state?.needs_checked;
    const numberColor = fleetMode
      ? displayStatus === "oos"
        ? STATUS_TEXT["oos"]
        : isLoadOff
        ? STATUS_TEXT["off"]
        : status === "loaded"
        ? "text-sky-300"
        : STATUS_TEXT[status === "off" ? ((truck.state?.status ?? "dirty") as TruckStatus) : status]
      : status === "loaded"
        ? "text-sky-300"
        : status === "off" && (filter === "off" || filter === "unloaded")
        ? STATUS_TEXT[effectiveStatus(truck, runUnloadsDay, holidayLoad)]
        : filter === "unloaded"
        ? STATUS_TEXT[status]
        : filter === "dirty" && truck.state?.priority_hold
        ? "text-amber-300"
        : "hover:text-blue-300";
    const coverageRoute = getCoverageRouteNumber(truck) ?? coveringRouteByTruckNum.get(truck.truck_number) ?? null;
    // SPLIT helper: shows the same big pair but as "route + truck" —
    // the route ALSO runs, so it's an extra load, not a takeover.
    const splitRoute = coverageRoute == null ? (truck.route_split_route ?? null) : null;
    // Fleet is the master view — show the ROUTE→TRUCK pair here too
    // (it used to be suppressed in fleet mode).
    const showCoverageBadge = coverageRoute != null || splitRoute != null;
    // Reverse lookup: this truck's own route is being covered by another
    // truck (route swap / OOS). Show it so the covered card isn't blank.
    const coveredBy = coverageRoute == null ? coveringTruckByRoute.get(truck.truck_number) : undefined;
    // In the OOS filter the "Covered by …" assignment row already shows
    // the covering truck, so suppress the duplicate ← Cov. badge there.
    const showCoveredByBadge = !fleetMode && coveredBy != null && filter !== "oos";

    return (
      <AnimateCard
        key={truck.truck_number}
        id={`truck-card-${truck.truck_number}`}
        delay={index * 0.02}
        className={clsx(
          "card cursor-pointer",
          highlightTruck === truck.truck_number && "ring-2 ring-sky-400 animate-pulse",
          fleetMode
            ? cardSize === "s"
              ? "p-2 flex flex-col gap-1 min-h-[4rem] md:min-h-[6.5rem]"
              : cardSize === "l"
              ? "p-3 flex flex-col gap-1.5 min-h-[5.5rem] md:p-5 md:gap-2.5 md:min-h-[12rem]"
              : "p-2 flex flex-col gap-1 min-h-[4.5rem] md:p-4 md:gap-2 md:min-h-[10rem]"
            : ["space-y-2 min-h-[7.5rem]", filter === "off" || filter === "dirty" || filter === "unloaded" ? "p-5" : "p-4"],
          fleetMode && displayStatus === "oos" && !selectedTrucks.has(truck.truck_number) && "opacity-50 grayscale",
          fleetMode && truck.state?.priority_hold && "animate-priority-glow border-2 border-red-500/30 bg-gradient-to-br from-slate-900 via-red-950/10 to-slate-900",
          !fleetMode && filter === "dirty" && truck.state?.priority_hold && "animate-priority-glow border-2 border-red-500/30 bg-gradient-to-br from-slate-900 via-red-950/10 to-slate-900",
          !fleetMode && (filter === "oos" ? oosAssignOpen.has(truck.truck_number) : detailNum === truck.truck_number) && "ring-2 ring-blue-500",
          "hover:ring-2 hover:ring-blue-500 transition-shadow",
          fleetMode && multiSelect && selectedTrucks.has(truck.truck_number) && "ring-2 ring-blue-400",
        )}
        onClick={() => handleTruckClick(truck)}
      >
        <div className="flex w-full flex-col gap-0.5 md:gap-1">
          {/* flex-wrap is the escape hatch for the route → truck coverage
              pair, which is wide enough that it and the badge stack
              cannot share a narrow card; badges drop BELOW rather than
              paint over the numbers. That pair only renders outside
              fleet mode, but the wrap applied everywhere — so on a fleet
              card a two-chip stack ("Unloaded" + "L Off") was wide
              enough to wrap, leaving those chips halfway down the card
              while a one-chip truck kept its chip in the corner. Fleet
              never wraps: the chips stay pinned top-right, and the
              number (2-3 digits there) yields the space instead. */}
          <div className={clsx(
            "flex w-full min-w-0 items-start justify-between gap-2",
            fleetMode ? "flex-nowrap" : "flex-wrap",
          )}>
            <div className={clsx(
              "flex min-w-0 min-h-[2.5rem] flex-col justify-between gap-0.5",
              fleetMode && cardSize === "s" ? "md:min-h-[2.5rem]" : "md:min-h-[4.5rem]",
              !fleetMode && "shrink-0",
            )}>
              {!fleetMode && (showCoverageBadge || showCoveredByBadge) ? (
                /* Canonical coverage headline: route → carrying truck.
                   Same pair whether this card IS the carrier
                   (showCoverageBadge) or the covered route
                   (showCoveredByBadge) — one style everywhere. */
                <div className="flex items-center gap-1 md:gap-1.5">
                  <span className="flex flex-col items-center leading-none">
                    <span className={clsx(
                      "text-lg font-extrabold tracking-tight tabular-nums md:text-3xl",
                      splitRoute != null ? "text-amber-300" : "text-[#7cc4ff]",
                    )}>
                      {showCoverageBadge ? (splitRoute ?? coverageRoute) : truck.truck_number}
                    </span>
                    <span className={clsx(
                      "mt-0.5 text-[9px] font-semibold uppercase tracking-wide md:text-[10px]",
                      splitRoute != null ? "text-amber-500" : "text-[#5b87b3]",
                    )}>{splitRoute != null ? "split" : "route"}</span>
                  </span>
                  <span className={clsx(
                    "text-base font-bold md:text-2xl",
                    splitRoute != null ? "text-amber-400" : "text-[#7cc4ff]",
                  )}>{splitRoute != null ? "+" : "→"}</span>
                  <span className="flex flex-col items-center leading-none">
                    <span className={clsx("text-lg font-extrabold tracking-tight tabular-nums md:text-3xl", numberColor)}>
                      {showCoverageBadge ? truck.truck_number : coveredBy!.num}
                    </span>
                    <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted md:text-[10px]">truck</span>
                  </span>
                </div>
              ) : (
                <span
                  className={clsx(
                    "font-extrabold tracking-tight tabular-nums leading-none",
                    fleetMode ? (cardSize === "s" ? "text-2xl md:text-3xl" : cardSize === "l" ? "text-3xl md:text-6xl" : "text-2xl md:text-5xl") : filter === "off" || filter === "dirty" || filter === "unloaded" ? "text-5xl" : "text-4xl",
                    numberColor,
                  )}
                >
                  {truck.truck_number}
                </span>
              )}
              {!fleetMode && !showCoverageBadge && !showCoveredByBadge && (
                <span className="min-h-[1.5rem]" />
              )}
            </div>
            <span className="ml-auto flex min-h-[1.5rem] shrink-0 flex-col items-end justify-start gap-0.5 md:min-h-[2.25rem]">
              {/* 1. Status chip — show underlying dirty/unloaded for off trucks */}
              {displayStatus === "oos" ? (
                <span className={clsx("badge", STATUS_BG["oos"], STATUS_BADGE_TEXT["oos"])}>
                  {STATUS_LABELS["oos"]}
                </span>
              ) : status === "off" && (truck.state?.status === "dirty" || truck.state?.status === "unloaded") ? (
                <span className={clsx("badge", STATUS_BG[truck.state.status as TruckStatus], STATUS_BADGE_TEXT[truck.state.status as TruckStatus])}>
                  {STATUS_LABELS[truck.state.status as TruckStatus]}
                </span>
              ) : (
                <span className={clsx("badge", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
                  {STATUS_LABELS[status]}
                </span>
              )}
              {/* 2. U Off chip — route trucks only; spares are always off unless assigned */}
              {fleetMode && status === "off" && truck.truck_type !== "Spare" && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked && (
                <span className="badge bg-track text-ink-soft">U Off</span>
              )}
              {!fleetMode && !holidayUnload && truck.truck_type !== "Spare" && isScheduledOff(truck, runUnloadsDay) && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked && (
                <span className="badge bg-track text-ink-soft">U Off</span>
              )}
              {/* 3. L Off chip — route trucks only */}
              {!holidayLoad && truck.truck_type !== "Spare" && isScheduledOff(truck, runDayNum) && status !== "off" && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked && (
                <span className="badge bg-track text-ink-soft">L Off</span>
              )}
              {/* 4. Fleet coverage/swap badges (both sides) moved to the
                  detail block below via <CoverageCardBadges>. */}
              {/* 5. Priority hold / REQUEST */}
              {!fleetMode && filter === "dirty" && truck.state?.priority_hold && (
                <motion.span
                  animate={{ opacity: [1, 0.6, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="badge bg-amber-500 font-bold text-black"
                >
                  REQUEST
                </motion.span>
              )}
              {truck.state?.priority_hold && (fleetMode || filter !== "dirty") && (
                <span className="badge bg-red-700 text-white">Hold</span>
              )}
              {/* 6. Needs Checked — badge only OUTSIDE fleet mode. The
                  fleet card already states it in the body, as a chip
                  that also clears the flag (or, on a Ran Special
                  truck, as the Ran Special chip, which clears both),
                  so showing the badge too said the same thing twice
                  on the same card. */}
              {truck.state?.needs_checked && !fleetMode && (
                <span className="badge bg-amber-700 text-white">Needs Checked</span>
              )}
              {/* 7. Dust garment */}
              {truck.truck_type === "Dust" && truck.state?.has_dust_garment && (
                <span
                  className={clsx(
                    "inline-flex items-center justify-center rounded-full border p-0.5",
                    garmentIsLoaded(truck)
                      ? "border-sky-500/60 bg-sky-950/70"
                      : "border-amber-500/60 bg-amber-950/70",
                  )}
                  title={garmentIsLoaded(truck) ? "Loaded with garments" : "Garments assigned"}
                >
                  <DustGarmentIcon className="h-3.5 w-3.5" style={{ color: garmentHex(truck) }} />
                </span>
              )}
            </span>
          </div>
          {fleetMode && (
            <div className="text-[10px] text-ink-muted space-y-0.5 md:text-xs">
              <div>
                {truckTypeLabel(truck.truck_type)}
                {truck.truck_type === "Uniform" && truck.uniform_size != null && ` · ${truck.uniform_size}ft`}
                {truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
              </div>
              <CoverageCardBadges
                truck={truck}
                board={data ?? []}
                coveringTruckByRoute={coveringTruckByRoute}
                coveringRouteByTruckNum={coveringRouteByTruckNum}
                isOos={displayStatus === "oos"}
                onNavigate={setDetailNum}
              />
              {hasRanAhead(truck.state?.off_note) && (
                isAdmin && !isReadOnly ? (
                  <button
                    type="button"
                    title="Clear Ran Ahead — truck loads tonight again"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Surgical: strip only the sentinel, keep any real note.
                      upsert.mutate({ truck_number: truck.truck_number, run_date: runDate, off_note: removeNoteToken(truck.state?.off_note, RAN_AHEAD), state_source: "workflow" });
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-sky-900/40 px-2 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-700/40 transition-colors hover:bg-red-900/50 hover:text-red-300 hover:ring-red-700/40"
                  >
                    Ran Ahead ✕
                  </button>
                ) : (
                  <span className="font-medium text-sky-300">Ran Ahead</span>
                )
              )}
              {truck.state?.off_note?.toLowerCase().includes("ran special") && (
                isAdmin && !isReadOnly ? (
                  <button
                    type="button"
                    title="Clear Ran Special flag"
                    onClick={(e) => {
                      e.stopPropagation();
                      upsert.mutate({ truck_number: truck.truck_number, run_date: runDate, off_note: "", needs_checked: false, state_source: "workflow" });
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-700/40 transition-colors hover:bg-red-900/50 hover:text-red-300 hover:ring-red-700/40"
                  >
                    Ran Special ✕
                  </button>
                ) : (
                  <span className="text-amber-300 font-medium">Ran Special</span>
                )
              )}
              {truck.state?.needs_checked && !truck.state?.off_note?.toLowerCase().includes("ran special") && (
                isAdmin && !isReadOnly ? (
                  <button
                    type="button"
                    title="Clear Needs Checked flag"
                    onClick={(e) => {
                      e.stopPropagation();
                      upsert.mutate({ truck_number: truck.truck_number, run_date: runDate, needs_checked: false, state_source: "workflow" });
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-700/40 transition-colors hover:bg-red-900/50 hover:text-red-300 hover:ring-red-700/40"
                  >
                    Needs Checked ✕
                  </button>
                ) : (
                  <span className="text-amber-300 font-medium">Needs Checked</span>
                )
              )}
              {fleetMode && arrivedTrackingEnabled && truck.state?.arrived_at && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-emerald-700/50 bg-emerald-950/70 px-2 py-0.5 text-[10px] font-bold text-emerald-300 md:hidden">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden /> Arrived {formatArrivedAt(truck.state.arrived_at)}
                </span>
              )}
              {(outsideTimers.has(truck.truck_number) || paperBayTimers.has(truck.truck_number)) && (
                <div className={clsx("flex flex-wrap gap-1 pt-1", fleetMode && "md:hidden")}>
                  {outsideTimerEnabled && outsideTimers.has(truck.truck_number) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-700/50 bg-orange-950/70 px-2 py-0.5 text-[10px] font-bold text-orange-300">
                      <Clock className="h-3 w-3 shrink-0" aria-hidden /> Outside {fmtCountdown(outsideCountdowns.get(truck.truck_number) ?? 0)}
                    </span>
                  )}
                  {paperBayEnabled && paperBayTimers.has(truck.truck_number) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-700/50 bg-violet-950/70 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                      <FileText className="h-3 w-3 shrink-0" aria-hidden /> Paper Bay {fmtCountdown(paperBayCountdowns.get(truck.truck_number) ?? 0)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {!fleetMode && filter === "dirty" && truck.state?.status !== "oos" && (
            <span className={clsx("flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors", truck.state?.priority_hold ? "bg-amber-600/20 text-amber-300" : "bg-blue-600/20 text-blue-300")}>
              {truck.state?.status === "unfinished" ? "Finish unload" : batchingDisabled ? "Mark Unloaded" : "Assign to Batch →"}
            </span>
          )}
        </div>
        {!fleetMode && filter === "unloaded" && (
          <div className="text-xs text-ink-muted">
            {truckTypeLabel(truck.truck_type)}{truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
          </div>
        )}
        {filter === "loaded" ? (
          <>
            <div className="text-xs text-ink-muted">
              {truckTypeLabel(truck.truck_type)}{truck.state?.batch_id != null ? ` · Batch ${truck.state.batch_id}` : ""}
            </div>
            {truck.state?.load_finish_time && (
              <div className="mt-auto pt-1 text-xs text-ink-muted">
                Done {format(new Date(truck.state.load_finish_time * 1000), "h:mm a")}
              </div>
            )}
          </>
        ) : truck.state?.batch_id != null && !fleetMode && filter !== "unloaded" && (
          <div className="text-xs text-ink-muted">Batch {truck.state.batch_id}</div>
        )}

        {/* Spares have no scheduled day, so a day chip only makes sense
            when they're covering a route (they run that route's day). */}
        {chipDay != null && !(truck.truck_type === "Spare" && coverageRoute == null) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                chipIsExtra ? "bg-amber-900/60 text-amber-300" : "bg-blue-900/60 text-blue-300",
              )}
            >
              {chipKind} Day {chipDay}
            </span>
          </div>
        )}

        {!fleetMode && filter === "oos" && displayStatus === "oos" && renderOosAssignBlock(truck)}

        {fleetMode && (
          <div className="mt-auto hidden md:flex md:flex-col md:gap-2">
            {outsideTimerEnabled && outsideTimers.has(truck.truck_number) && (
              <div
                className="flex items-center gap-1.5 rounded-lg border border-orange-700/50 bg-orange-950/70 px-2 py-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-300">
                  <Clock className="h-3 w-3 shrink-0" aria-hidden /> Outside {fmtCountdown(outsideCountdowns.get(truck.truck_number) ?? 0)}
                </span>
                <button
                  type="button"
                  className="ml-auto rounded px-2 py-1 text-xs font-semibold text-orange-500 transition-colors hover:text-orange-300 active:bg-orange-900/40"
                  onClick={() => cancelOutsideTimer(truck.truck_number)}
                >
                  Cancel
                </button>
              </div>
            )}
            {paperBayEnabled && paperBayTimers.has(truck.truck_number) && (
              <div
                className="flex items-center gap-1.5 rounded-lg border border-violet-700/50 bg-violet-950/70 px-2 py-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="inline-flex items-center gap-1 text-xs font-bold text-violet-300">
                  <FileText className="h-3 w-3 shrink-0" aria-hidden /> Paper Bay {fmtCountdown(paperBayCountdowns.get(truck.truck_number) ?? 0)}
                </span>
                <button
                  type="button"
                  className="ml-auto rounded px-2 py-1 text-xs font-semibold text-violet-500 transition-colors hover:text-violet-300 active:bg-violet-900/40"
                  onClick={() => cancelPaperBayTimer(truck.truck_number)}
                >
                  Cancel
                </button>
              </div>
            )}
            {arrivedTrackingEnabled && truck.state?.arrived_at && (
              cardSize === "s" ? (
                /* S cards: the time alone, no Clear — the full chip
                   dominated a shrunk card. Clearing still lives one tap
                   away on the action sheet's Arrived button. */
                <span
                  className="inline-flex items-center gap-1 self-start whitespace-nowrap rounded-xl border border-emerald-700/50 bg-emerald-950/70 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300"
                  title={`Arrived ${formatArrivedAt(truck.state.arrived_at)} — clear from the truck's action sheet`}
                >
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {formatArrivedAt(truck.state.arrived_at)}
                </span>
              ) : (
              <div
                // max-w-full + wrap: the pill used to run past the card's
                // edge and over the neighbouring card on narrow columns.
                className="flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 self-start rounded-xl border border-emerald-700/50 bg-emerald-950/70 px-2 py-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-bold text-emerald-300">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden /> Arrived {formatArrivedAt(truck.state.arrived_at)}
                </span>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500 transition-colors hover:text-emerald-200 active:bg-emerald-900/40"
                  onClick={() => clearArrived(truck)}
                >
                  Clear
                </button>
              </div>
              )
            )}
          </div>
        )}
      </AnimateCard>
    );
  }
