/**
 * Unload-style quiet tile for the live-status drill pages (extracted from
 * Board.tsx): mono number carrying the status colour, matching dot, one sub
 * line, the ROUTE → TRUCK pair face for coverage; the OOS drill's assign
 * machinery rides in the tile's `extra` slot.
 */
import { QuietTile } from "../../components/workflow/QuietTile";
import { DustGarmentIcon, STATUS_LABELS } from "./constants";
import { effectiveWorkflowStatus, garmentHex, getCoverageRouteNumber, isScheduledOff } from "../../utils/truckStatus";
import type { TruckStatus, TruckWithState } from "../../types";
import { truckTypeLabel } from "../../utils/truckType";
import { hasRanAhead } from "../../utils/offNote";

export interface StatusTileProps {
  truck: TruckWithState;
  filter: string;
  runDayNum: number;
  runUnloadsDay: number;
  holidayLoad: boolean;
  holidayUnload: boolean;
  unloadsDay2: number;
  loadDay2: number;
  loadNextDay: number;
  coveringRouteByTruckNum: Map<number, number>;
  coveringTruckByRoute: Map<number, { num: number }>;
  highlightTruck: number | null;
  isReadOnly: boolean;
  onClick: (truck: TruckWithState) => void;
  oosAssignBlock: (truck: TruckWithState) => React.ReactNode;
}

export default function StatusTile({
  truck,
  filter,
  runDayNum,
  runUnloadsDay,
  holidayLoad,
  holidayUnload,
  unloadsDay2,
  loadDay2,
  loadNextDay,
  coveringRouteByTruckNum,
  coveringTruckByRoute,
  highlightTruck,
  isReadOnly,
  onClick,
  oosAssignBlock,
}: StatusTileProps) {

    const status = effectiveWorkflowStatus(truck, runDayNum, holidayLoad, runUnloadsDay, holidayUnload);
    const displayStatus: TruckStatus =
      filter === "oos" && truck.truck_type !== "Spare" && truck.is_oos ? "oos" : status;
    // Off pages colour by the UNDERLYING day status (an off truck that
    // is already unloaded reads green), matching the old cards.
    const toneStatus: TruckStatus =
      displayStatus === "off" && (truck.state?.status === "dirty" || truck.state?.status === "unloaded")
        ? (truck.state.status as TruckStatus)
        : displayStatus;
    const TONES: Partial<Record<TruckStatus, [string, string]>> = {
      dirty: ["text-st-dirty", "bg-st-dirty"],
      unfinished: ["text-st-unfinished", "bg-st-unfinished"],
      unloaded: ["text-st-unloaded", "bg-st-unloaded"],
      in_progress: ["text-st-inprogress", "bg-st-inprogress"],
      loaded: ["text-st-loaded", "bg-st-loaded"],
      spare: ["text-st-spare", "bg-st-spare"],
      shop: ["text-st-shop", "bg-st-shop"],
      off: ["text-st-off", "bg-st-off"],
      oos: ["text-st-oos", "bg-st-oos"],
    };
    const [numberClass, dotClass] = TONES[toneStatus] ?? ["text-ink", "bg-st-off"];
    const coverageRoute = getCoverageRouteNumber(truck) ?? coveringRouteByTruckNum.get(truck.truck_number) ?? null;
    const splitRoute = coverageRoute == null ? (truck.route_split_route ?? null) : null;
    const pair =
      coverageRoute != null ? { route: coverageRoute }
      : splitRoute != null ? { route: splitRoute, split: true }
      : null;
    // On the live OOS page the extra block shows coverage; on a
    // read-only date that block is suppressed, so the sub line takes
    // over — the historical fallback exists exactly for this display.
    const coveredBy = coverageRoute == null && (filter !== "oos" || isReadOnly) ? coveringTruckByRoute.get(truck.truck_number) : undefined;
    // Holiday day chip — same rule the big cards used.
    let dayNote: string | null = null;
    if (filter === "dirty" && holidayUnload && !(truck.truck_type === "Spare" && coverageRoute == null)) {
      const d = isScheduledOff(truck, runUnloadsDay) ? unloadsDay2 : runUnloadsDay;
      dayNote = `Unload Day ${d}`;
    } else if (filter === "unloaded" && holidayLoad && !(truck.truck_type === "Spare" && coverageRoute == null)) {
      const d = (isScheduledOff(truck, runDayNum) || isScheduledOff(truck, loadNextDay)) ? loadDay2 : runDayNum;
      dayNote = `Load Day ${d}`;
    }
    const uOff = !holidayUnload && truck.truck_type !== "Spare" && isScheduledOff(truck, runUnloadsDay) && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked;
    const lOff = !holidayLoad && truck.truck_type !== "Spare" && isScheduledOff(truck, runDayNum) && displayStatus !== "off" && !getCoverageRouteNumber(truck) && !truck.state?.needs_checked;
    const hold = truck.state?.priority_hold === true;
    // Independent flags stay independent — a held truck that also
    // needs checking shows both, joined, not just the louder one.
    const tagParts: string[] = [];
    if (hold) tagParts.push(filter === "dirty" ? "Request" : "Hold");
    if (truck.state?.needs_checked) tagParts.push("Needs check");
    if (hasRanAhead(truck.state?.off_note)) tagParts.push("Ran ahead");
    if (truck.state?.has_nogs) tagParts.push("NOGs");
    if (!hold && !truck.state?.needs_checked && displayStatus === "unfinished") tagParts.push("Unfinished");
    const tag = tagParts.length > 0 ? tagParts.join(" · ") : null;
    const tagClass = hold
      ? (filter === "dirty" ? "text-st-inprogress" : "text-st-dirty")
      : truck.state?.needs_checked
      ? "text-st-inprogress"
      : "text-st-unfinished";
    const offNote = filter === "off" ? (truck.state?.off_note ?? "").trim() : "";
    const subBits: React.ReactNode[] = [];
    // An off truck's WORDS say its underlying state (Dirty/Unloaded),
    // exactly like the old status chip — "Off" rides along as context.
    subBits.push(<span key="st">{STATUS_LABELS[toneStatus]}</span>);
    if (displayStatus === "off" && toneStatus !== "off") subBits.push(<span key="offctx" className="text-ink-faint">Off</span>);
    if (filter === "unloaded" && truck.truck_type !== "Uniform") subBits.push(<span key="ty" className="text-ink-faint">{truckTypeLabel(truck.truck_type)}</span>);
    if (truck.state?.batch_id != null) subBits.push(<span key="b" className="text-ink-faint">Batch {truck.state.batch_id}</span>);
    if (coveredBy != null) subBits.push(<span key="cb" className="text-sky-300">Covered by #{coveredBy.num}</span>);
    if (uOff) subBits.push(<span key="uo" className="text-ink-faint">U Off</span>);
    if (lOff) subBits.push(<span key="lo" className="text-ink-faint">L Off</span>);
    if (dayNote) subBits.push(<span key="dn" className="text-amber-300">{dayNote}</span>);
    if (offNote) subBits.push(<span key="on" className="text-ink-faint">{offNote.length > 34 ? offNote.slice(0, 33) + "…" : offNote}</span>);
    if (truck.truck_type === "Dust" && truck.state?.has_dust_garment) {
      subBits.push(
        <DustGarmentIcon key="g" className="h-3 w-3 shrink-0" style={{ color: garmentHex(truck) }} />,
      );
    }
    return (
      <QuietTile
        key={truck.truck_number}
        id={`truck-card-${truck.truck_number}`}
        truck={truck}
        highlight={highlightTruck === truck.truck_number}
        numberClass={numberClass}
        dotClass={dotClass}
        pair={pair}
        tag={tag ?? undefined}
        tagClass={tagClass}
        onClick={isReadOnly && filter === "oos" ? undefined : () => onClick(truck)}
        sub={<>{subBits}</>}
        extra={
          filter === "oos" && displayStatus === "oos" && !isReadOnly ? (
            <div className="text-ink-soft">{oosAssignBlock(truck)}</div>
          ) : undefined
        }
      />
    );
  }
