import clsx from "clsx";
import { useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import type { TruckStatus, TruckWithState } from "../../types";
import {
  useAssignSpare,
  useBoard,
  usePrevOperatingDay,
  useUpdateTruck,
  useUpsertTruckState,
} from "../../api/hooks";
import { fmtCountdown } from "./useOutsideTimer";
import { STATUS_BADGE_TEXT, STATUS_BG, STATUS_LABELS, STATUS_TEXT, statusStampFields } from "./constants";
import CoverageTag from "../../components/CoverageTag";
import { getCoverageRouteNumber } from "../../utils/truckStatus";
import { truckTypeLabel } from "../../utils/truckType";
import { errorDetail } from "../../api/errors";

/** Uppercase micro-label that opens each block of the sheet. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{children}</p>
  );
}

/** A named flag with its own one-line explanation and a switch. */
function FlagRow({
  label,
  hint,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-left transition-colors hover:bg-slate-800 disabled:opacity-50"
    >
      {/* Label over hint, and the hint WRAPS. On one line the hint truncated
          mid-word on every phone ("Keep on dock after u…"), which read as a
          rendering bug rather than a description. */}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-tight text-slate-100">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{hint}</span>
      </span>
      <span
        className={clsx(
          "ml-auto flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
          on ? "bg-emerald-600" : "bg-slate-600",
        )}
      >
        <span
          className={clsx(
            "h-5 w-5 rounded-full bg-white transition-transform",
            on && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

const TIMER_TONES = {
  emerald: { idle: "border-emerald-700/50 text-emerald-300", on: "border-emerald-500 bg-emerald-950/50 text-emerald-200" },
  sky:     { idle: "border-sky-700/50 text-sky-300",         on: "border-sky-500 bg-sky-950/50 text-sky-200" },
  purple:  { idle: "border-purple-700/50 text-purple-300",   on: "border-purple-500 bg-purple-950/50 text-purple-200" },
} as const;

/**
 * One timer/stamp. Running ones show their remaining time and cancel on tap,
 * so a single control covers both directions rather than a second row of
 * "Cancel" chips appearing beside it.
 */
function TimerButton({
  tone,
  title,
  hint,
  active,
  disabled,
  onClick,
}: {
  tone: keyof typeof TIMER_TONES;
  title: string;
  hint: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "rounded-xl border px-2 py-3 text-center transition-colors disabled:opacity-40",
        active ? TIMER_TONES[tone].on : TIMER_TONES[tone].idle,
        !active && "bg-slate-800/30 hover:bg-slate-800",
      )}
    >
      <div className="text-[15px] font-bold">{title}</div>
      <div className="mt-0.5 text-[12px] font-semibold opacity-70">
        {active ? `${hint} · tap to clear` : hint}
      </div>
    </button>
  );
}

const STATUS_ACTIONS: TruckStatus[] = [
  "dirty",
  "unfinished",
  "shop",
  "unloaded",
  "in_progress",
  "loaded",
  "oos",
];
// Spares also get their idle status back — without it, one mis-tap on an
// idle spare was unrecoverable from this sheet. Slotted before OOS so the
// grid stays two even rows of four.
const SPARE_STATUS_ACTIONS: TruckStatus[] = [
  ...STATUS_ACTIONS.slice(0, -1),
  "spare",
  "oos",
];

export default function FleetMobileActionSheet({
  truck,
  runDate,
  onClose,
  onManageTruck,
  arrivedEnabled,
  arrivedAt,
  needsChecked,
  outsideEnabled,
  outsideActive,
  outsideMinutes,
  outsideRemainingSeconds,
  paperBayEnabled,
  paperBayActive,
  paperBayMinutes,
  paperBayRemainingSeconds,
  onOutside,
  onCancelOutside,
  onPaperBay,
  onCancelPaperBay,
  onArrived,
  onClearArrived,
}: {
  truck: TruckWithState;
  runDate: string;
  onClose: () => void;
  onManageTruck: () => void;
  arrivedEnabled: boolean;
  arrivedAt?: number | null;
  needsChecked: boolean;
  outsideEnabled: boolean;
  outsideActive: boolean;
  outsideMinutes: number;
  outsideRemainingSeconds?: number;
  paperBayEnabled: boolean;
  paperBayActive: boolean;
  paperBayMinutes: number;
  paperBayRemainingSeconds?: number;
  onOutside: () => void;
  onCancelOutside: () => void;
  onPaperBay: () => void;
  onCancelPaperBay: () => void;
  onArrived: () => void;
  onClearArrived: () => void;
}) {
  const upsert = useUpsertTruckState();
  const setOos = useUpdateTruck();
  // For the crossload destination picker. Reads the board cache the Fleet
  // page already holds — no extra fetch in practice.
  const { data: boardData } = useBoard(runDate);
  const [xloadPickerOpen, setXloadPickerOpen] = useState(false);
  const [xloadTo, setXloadTo] = useState("");
  // A spare driver's unconfirmed "I covered route N" from the QR page. Confirm
  // writes the REAL coverage through the same authenticated path a lead uses
  // for any late assignment — dated to the run the driver just finished (the
  // previous operating day), which is what feeds today's unload bucketing.
  const claimedRoute = truck.state?.driver_claimed_route ?? null;
  const { data: prevOpDay } = usePrevOperatingDay(runDate);
  const assignSpare = useAssignSpare();
  const [claimErr, setClaimErr] = useState("");

  function clearClaim() {
    upsert.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      driver_claimed_route: null,
      // The claim is what raised the flag; resolving it lowers it.
      needs_checked: false,
      wearers: truck.state?.wearers ?? 0,
    });
  }

  async function confirmClaim() {
    if (claimedRoute == null) return;
    setClaimErr("");
    try {
      await assignSpare.mutateAsync({
        run_date: prevOpDay ?? runDate,
        spare_truck_number: truck.truck_number,
        covering_route_truck: claimedRoute,
      });
      clearClaim();
      onClose();
    } catch (e) {
      const detail = errorDetail(e);
      setClaimErr(detail ?? "Couldn't record the coverage — try the coverage editor.");
    }
  }
  const ranSpecial = (truck.state?.off_note ?? "").toLowerCase().includes("ran special");
  const status = (truck.is_oos ? "oos" : (truck.state?.status ?? "dirty")) as TruckStatus;
  const isHold = truck.state?.priority_hold === true;
  const arrivedActive = typeof arrivedAt === "number" && Number.isFinite(arrivedAt);
  const canStartOutside = outsideEnabled && !outsideActive && !paperBayActive;
  const canStartPaperBay = paperBayEnabled && !paperBayActive && !outsideActive;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* A true bottom sheet on phones — full width, docked to the bottom
          edge, squared bottom corners — and a centred dialog from sm: up.
          Floating a rounded box mid-screen on a phone is what made this
          window feel oddly sized. */}
      <div className="relative w-full max-w-md overflow-hidden overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 shadow-xl max-h-[92svh] sm:rounded-2xl sm:max-h-[90vh]">
        {/* The truck's status, stated before anything else — the rule and the
            numeral carry it, so you know what you tapped without reading. */}
        <div className={clsx("h-[3px] w-full", STATUS_BG[status])} />
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
          <span className={clsx("font-mono text-[44px] font-black leading-none tabular-nums", STATUS_TEXT[status])}>
            {truck.truck_number}
          </span>
          <span className={clsx("badge shrink-0", STATUS_BG[status], STATUS_BADGE_TEXT[status])}>
            {STATUS_LABELS[status]}
          </span>
          <span className="min-w-0 truncate text-sm text-slate-400">
            {truckTypeLabel(truck.truck_type)}
            {truck.truck_type === "Uniform" && truck.uniform_size != null ? ` · ${truck.uniform_size}ft` : ""}
          </span>
          {(() => {
            const cr = getCoverageRouteNumber(truck);
            return cr != null ? <CoverageTag route={cr} truck={truck.truck_number} className="shrink-0" /> : null;
          })()}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Bottom-docked sheets sit flush on the system gesture/nav bar, so
            the last control (Manage truck) needs the safe-area inset or the
            phone's own bar covers it. */}
        <div className="space-y-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {claimedRoute != null && (
            <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/40 p-3">
              <p className="text-sm font-semibold text-cyan-200">
                Driver reported: covered <span className="font-black">Route {claimedRoute}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-cyan-300/70">
                From the truck&apos;s QR page. Confirming records the coverage for{" "}
                {prevOpDay ?? "the last run day"}.
              </p>
              {claimErr && (
                <p className="mt-1 text-xs font-semibold text-amber-300">{claimErr}</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={assignSpare.isPending || upsert.isPending}
                  onClick={() => void confirmClaim()}
                  className="flex-1 rounded-md bg-cyan-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-cyan-600 disabled:opacity-50"
                >
                  {assignSpare.isPending ? "Recording…" : "Confirm coverage"}
                </button>
                <button
                  type="button"
                  disabled={assignSpare.isPending || upsert.isPending}
                  onClick={() => {
                    clearClaim();
                    onClose();
                  }}
                  className="rounded-md border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          <div>
            <SectionLabel>Set status</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {(truck.truck_type === "Spare" ? SPARE_STATUS_ACTIONS : STATUS_ACTIONS).map((s) => {
                const isCurrent = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={upsert.isPending || isCurrent}
                    onClick={() => {
                      if (s === "oos") {
                        // Mark it OOS right here — both writes the Manage-truck
                        // editor makes, so the fleet record and today's status
                        // agree. (This used to bounce to Manage truck.)
                        setOos.mutate({ truck_number: truck.truck_number, is_oos: true });
                        upsert.mutate({
                          truck_number: truck.truck_number,
                          run_date: runDate,
                          status: "oos",
                          wearers: truck.state?.wearers ?? 0,
                        });
                        onClose();
                        return;
                      }
                      // Leaving OOS must clear the fleet-level flag too, or
                      // effectiveStatus keeps showing OOS and the tap reads as
                      // a no-op — the mirror of the OOS tile setting both.
                      if (truck.is_oos) {
                        setOos.mutate({ truck_number: truck.truck_number, is_oos: false });
                      }
                      upsert.mutate({
                        truck_number: truck.truck_number,
                        run_date: runDate,
                        status: s,
                        wearers: truck.state?.wearers ?? 0,
                        ...statusStampFields(s),
                      });
                      onClose();
                    }}
                    className={clsx(
                      "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 text-[13px] font-bold transition-colors",
                      isCurrent
                        ? "border-slate-600 bg-slate-800 text-slate-500"
                        : "border-slate-700/60 bg-slate-800/40 text-slate-100 hover:bg-slate-700/60",
                    )}
                  >
                    <span className={clsx("h-2.5 w-2.5 rounded-full", STATUS_BG[s])} />
                    <span>{STATUS_LABELS[s]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Flags</SectionLabel>
            <div className="flex flex-col gap-2">
              {/* Flags are switches now, and flipping one keeps the sheet open:
                  they're settings on the truck, not decisions that end the
                  visit, and a lead usually sets two at once. */}
              <FlagRow
                label="Unload &amp; hold"
                hint="Keep on dock after unload"
                on={isHold}
                disabled={upsert.isPending}
                onToggle={() =>
                  upsert.mutate({
                    truck_number: truck.truck_number,
                    run_date: runDate,
                    priority_hold: !isHold,
                    wearers: truck.state?.wearers ?? 0,
                  })
                }
              />
              <FlagRow
                label="Needs checked"
                hint="Flag for a look-over"
                on={needsChecked}
                disabled={upsert.isPending}
                onToggle={() =>
                  upsert.mutate({
                    truck_number: truck.truck_number,
                    run_date: runDate,
                    needs_checked: !needsChecked,
                    wearers: truck.state?.wearers ?? 0,
                  })
                }
              />
              {/* The need, not the destination. A loaded truck sent OOS gets
                  this raised for it automatically; the truck it goes onto is
                  chosen later, in Route Swaps. */}
              <FlagRow
                label="Needs crossloaded"
                hint={
                  truck.state?.crossload_to_truck != null
                    ? `Going onto #${truck.state.crossload_to_truck}`
                    : "Freight moves to another truck"
                }
                on={truck.state?.needs_crossload === true || truck.state?.crossload_to_truck != null}
                disabled={upsert.isPending}
                onToggle={() => {
                  const on = truck.state?.needs_crossload === true || truck.state?.crossload_to_truck != null;
                  if (!on) {
                    // Don't write yet — ask "assign a truck now, or later?"
                    // first. The flag lands either way; only the destination
                    // is in question.
                    setXloadPickerOpen((v) => !v);
                    return;
                  }
                  setXloadPickerOpen(false);
                  upsert.mutate({
                    truck_number: truck.truck_number,
                    run_date: runDate,
                    needs_crossload: false,
                    // Turning it off drops the destination with it — a truck
                    // that isn't being crossloaded can't be going anywhere.
                    crossload_to_truck: null,
                    wearers: truck.state?.wearers ?? 0,
                  });
                }}
              />
              {xloadPickerOpen && (
                <div className="rounded-xl border border-fuchsia-800/50 bg-fuchsia-950/25 p-3">
                  <p className="text-[13px] font-bold text-fuchsia-200">Where is the freight going?</p>
                  <p className="mt-0.5 text-[11px] text-fuchsia-300/70">
                    Pick the receiving truck now, or just flag it and choose in Route Swaps later.
                  </p>
                  <select
                    className="input mt-2 w-full text-sm"
                    value={xloadTo}
                    onChange={(e) => setXloadTo(e.target.value)}
                  >
                    <option value="">— select truck —</option>
                    {(boardData ?? [])
                      .filter((t) => t.truck_number !== truck.truck_number && t.is_active)
                      .sort((a, b) =>
                        // Spares first — they're the usual receivers.
                        (a.truck_type === "Spare" ? 0 : 1) - (b.truck_type === "Spare" ? 0 : 1) ||
                        a.truck_number - b.truck_number)
                      .map((t) => (
                        <option key={t.truck_number} value={t.truck_number}>
                          #{t.truck_number}{t.truck_type === "Spare" ? " · Spare" : ""}
                        </option>
                      ))}
                  </select>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={upsert.isPending || xloadTo === ""}
                      onClick={() => {
                        upsert.mutate({
                          truck_number: truck.truck_number,
                          run_date: runDate,
                          needs_crossload: true,
                          crossload_to_truck: parseInt(xloadTo, 10),
                          wearers: truck.state?.wearers ?? 0,
                        });
                        setXloadPickerOpen(false);
                        setXloadTo("");
                      }}
                      className="flex-1 rounded-md bg-fuchsia-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-fuchsia-600 disabled:opacity-40"
                    >
                      Assign truck
                    </button>
                    <button
                      type="button"
                      disabled={upsert.isPending}
                      onClick={() => {
                        upsert.mutate({
                          truck_number: truck.truck_number,
                          run_date: runDate,
                          needs_crossload: true,
                          wearers: truck.state?.wearers ?? 0,
                        });
                        setXloadPickerOpen(false);
                        setXloadTo("");
                      }}
                      className="flex-1 rounded-md border border-fuchsia-700/60 bg-fuchsia-900/30 px-3 py-2 text-xs font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-900/60 disabled:opacity-40"
                    >
                      Assign later
                    </button>
                  </div>
                </div>
              )}
              {/* Ran Special — the lead-side twin of the driver QR report:
                  the spare ran an errand and is back DIRTY with the note on.
                  Spares only, except a truck already carrying the note (the
                  off-truck loaded flow can tag any type) so it can still be
                  cleared here. Clearing wipes off_note + needs_checked whole,
                  matching the board chip's ✕. */}
              {(truck.truck_type === "Spare" || ranSpecial) && (
                <FlagRow
                  label="Ran Special"
                  hint="Ran an errand; back dirty for unload"
                  on={ranSpecial}
                  disabled={upsert.isPending}
                  onToggle={() => {
                    if (ranSpecial) {
                      upsert.mutate({
                        truck_number: truck.truck_number,
                        run_date: runDate,
                        off_note: "",
                        needs_checked: false,
                        wearers: truck.state?.wearers ?? 0,
                      });
                    } else {
                      const prev = (truck.state?.off_note ?? "").trim();
                      upsert.mutate({
                        truck_number: truck.truck_number,
                        run_date: runDate,
                        // Same status rule as the driver endpoint: only a truck
                        // that hasn't started real work flips to dirty.
                        ...(["unloaded", "off", "spare"].includes(status) ? { status: "dirty" as const } : {}),
                        off_note: prev ? `${prev} | Ran Special` : "Ran Special",
                        wearers: truck.state?.wearers ?? 0,
                      });
                    }
                  }}
                />
              )}
              {/* Garments are set in Setup Day, but they turn up after it — an
                  F.S. truck comes back carrying them and nobody wants to re-run
                  the wizard for one flag. F.S. only: the badge, the Load strip
                  and the finish-load prompt all gate on that type. */}
              {truck.truck_type === "Dust" && (
                <FlagRow
                  label="Has garments"
                  hint="Came back carrying F.S. garments"
                  on={truck.state?.has_dust_garment === true}
                  disabled={upsert.isPending}
                  onToggle={() =>
                    upsert.mutate({
                      truck_number: truck.truck_number,
                      run_date: runDate,
                      has_dust_garment: !truck.state?.has_dust_garment,
                      wearers: truck.state?.wearers ?? 0,
                    })
                  }
                />
              )}
            </div>
          </div>

          {(arrivedEnabled || outsideEnabled || outsideActive || paperBayEnabled || paperBayActive) && (
            <div>
              <SectionLabel>Timers &amp; arrival</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {arrivedEnabled && (
                  <TimerButton
                    tone="emerald"
                    title={arrivedActive ? "Arrived" : "Arrived"}
                    hint={
                      arrivedActive
                        ? new Date(arrivedAt! * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "Stamp now"
                    }
                    active={arrivedActive}
                    onClick={() => {
                      if (arrivedActive) onClearArrived();
                      else onArrived();
                      onClose();
                    }}
                  />
                )}
                {(outsideActive || outsideEnabled) && (
                  <TimerButton
                    tone="sky"
                    title="Outside"
                    hint={
                      outsideActive && typeof outsideRemainingSeconds === "number"
                        ? fmtCountdown(outsideRemainingSeconds)
                        : `${outsideMinutes} min timer`
                    }
                    active={outsideActive}
                    disabled={!outsideActive && !canStartOutside}
                    onClick={() => {
                      if (outsideActive) onCancelOutside();
                      else onOutside();
                      onClose();
                    }}
                  />
                )}
                {(paperBayActive || paperBayEnabled) && (
                  <TimerButton
                    tone="purple"
                    title="Paper bay"
                    hint={
                      paperBayActive && typeof paperBayRemainingSeconds === "number"
                        ? fmtCountdown(paperBayRemainingSeconds)
                        : `${paperBayMinutes} min timer`
                    }
                    active={paperBayActive}
                    disabled={!paperBayActive && !canStartPaperBay}
                    onClick={() => {
                      if (paperBayActive) onCancelPaperBay();
                      else onPaperBay();
                      onClose();
                    }}
                  />
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onManageTruck}
            className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white transition-colors hover:bg-blue-500"
          >
            Manage truck
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
