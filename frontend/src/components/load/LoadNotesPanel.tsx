import clsx from "clsx";
import { AlertTriangleIcon } from "../icons";
import { todayIso } from "../../api/client";
import {
  useActiveWarnings,
  useActiveWorkflowNotes,
  useDailyNotes,
  useNotices,
  useSettings,
  useTruckNotes,
} from "../../api/hooks";
import type { TruckNote, TruckWithState } from "../../types";

/**
 * Everything the loader needs to know right now, loudest first.
 *
 * The pieces existed but were scattered: audit load-warnings had an endpoint
 * built for exactly this and no UI at all; notices only ever appeared as a
 * transient toast; truck notes lived on the /notes board and inside the board's
 * in-progress hero. This gathers them against the truck actually being loaded.
 *
 * Includes the LOAD workflow's standing notes (persistent + this load day),
 * edited on the Notes page. Deliberately NOT included: the per-unload-day sheet
 * notes, which are keyed to the UNLOAD day and are about batching — the wrong
 * dimension for a load.
 */

const NOTE_STYLE: Record<TruckNote["note_type"], { border: string; bg: string; chip: string; label: string }> = {
  // "Always" rather than "Constant" — the Notes page has always called this
  // type Always, and two names for one thing is a needless translation.
  constant: { border: "border-st-loaded/30", bg: "bg-st-loaded/10", chip: "bg-st-loaded/25 text-st-loaded", label: "Always" },
  workday: { border: "border-st-shop/30", bg: "bg-st-shop/10", chip: "bg-st-shop/25 text-st-shop", label: "Workday" },
  one_off: { border: "border-st-inprogress/30", bg: "bg-st-inprogress/10", chip: "bg-st-inprogress/25 text-st-inprogress", label: "One-off" },
};

/** A truck note that actually applies to this load, right now. */
function applies(n: TruckNote, loadDayNum: number | null): boolean {
  if (n.note_type === "constant") return true;
  if (n.note_type === "workday") return n.workday_num === loadDayNum;
  // Re-check expiry against the LOCAL date: the server compares against UTC,
  // which has already rolled over during a 3rd shift, so a note that expired
  // "yesterday" can still come back.
  if (n.note_type === "one_off") return n.expires_on == null || n.expires_on >= todayIso();
  return false;
}

export default function LoadNotesPanel({
  truck,
  upcoming = [],
  loadDay,
  runDate,
  className,
}: {
  /** The truck being loaded — null when nothing is in progress. */
  truck: TruckWithState | null | undefined;
  /** Trucks waiting to load. Their notes show in a secondary section, so a
   *  constraint is read BEFORE the truck is started, not after. */
  upcoming?: TruckWithState[];
  loadDay: number;
  runDate: string;
  className?: string;
}) {
  // The truck is loaded FOR a particular day, which isn't always today's
  // default — prefer its own stamp.
  const dayNum = truck?.state?.load_day_num ?? loadDay;
  const truckNumber = truck?.truck_number;

  const { data: warningsByTruck = {} } = useActiveWarnings(runDate);
  const { data: notices = [] } = useNotices(true);
  // Passing loadDay lets the server drop non-matching workday notes for us —
  // supported since the notes router shipped, never used until now.
  // One query for the whole fleet rather than one per truck — the endpoint
  // returns every truck's notes when truck_number is omitted.
  const { data: notes = [] } = useTruckNotes({ loadDay: dayNum, activeOnly: true });
  const { data: settings = [] } = useSettings();
  const shiftNotesEnabled = settings.find((s) => s.key === "shift_notes_enabled")?.value !== false;
  const { data: dailyNotes = "" } = useDailyNotes(runDate);
  // Standing load-workflow notes: the persistent set plus this load day's.
  const workflowNotes = useActiveWorkflowNotes("load", dayNum);

  const warnings = truckNumber != null ? warningsByTruck[String(truckNumber)] ?? [] : [];
  const truckNotes =
    truckNumber != null
      ? notes.filter((n) => n.truck_number === truckNumber && applies(n, dayNum))
      : [];
  // Notes and warnings on the trucks queued behind this one.
  const upcomingNotes = upcoming
    .filter((t) => t.truck_number !== truckNumber)
    .map((t) => ({
      truck: t,
      notes: notes.filter((n) => n.truck_number === t.truck_number && applies(n, dayNum)),
      warnings: warningsByTruck[String(t.truck_number)] ?? [],
    }))
    .filter((g) => g.notes.length > 0 || g.warnings.length > 0);
  const loudNotices = notices.filter((n) => n.severity !== "info");
  const offNote = truck?.state?.off_note?.trim() ?? "";
  const shopNote = truck?.state?.shop_note?.trim() ?? "";
  const shiftNote = shiftNotesEnabled ? dailyNotes.trim() : "";

  const upcomingCount = upcomingNotes.reduce((n, g) => n + g.notes.length + g.warnings.length, 0);
  const workflowLines = [...workflowNotes.persistent, ...workflowNotes.day];
  const count =
    warnings.length + truckNotes.length + loudNotices.length + upcomingCount +
    workflowLines.length + (offNote ? 1 : 0) + (shopNote ? 1 : 0) + (shiftNote ? 1 : 0);

  return (
    <div className={clsx("card flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Notes</h3>
        {count > 0 && (
          <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-ink-muted">{count}</span>
        )}
        {truckNumber != null && (
          <span className="ml-auto font-mono text-xs text-ink-faint">#{truckNumber}</span>
        )}
      </div>

      {/* Always render something — collapsing to null would reflow the whole
          panel row every time the truck changes. */}
      {count === 0 && (
        <p className="py-4 text-center text-sm text-ink-faint">
          {truckNumber != null ? "Nothing flagged for this truck." : "Nothing flagged."}
        </p>
      )}

      {/* 1 — audit load warnings: the loudest thing on this surface */}
      {warnings.map((w) => (
        <div key={w.id} className="rounded-xl border border-st-dirty/50 bg-st-dirty/10 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-st-dirty" />
            <div className="min-w-0">
              <p className="text-base font-bold text-st-dirty">
                Load warning · {w.item_label} ×{w.quantity}
              </p>
              {w.note && <p className="mt-0.5 text-xl font-bold leading-snug text-ink">{w.note}</p>}
            </div>
          </div>
        </div>
      ))}

      {/* 2 — fleet notices that demand attention */}
      {loudNotices.map((n) => (
        <div
          key={n.id}
          className={clsx(
            "rounded-xl border px-3 py-2",
            n.severity === "critical"
              ? "border-st-dirty/50 bg-st-dirty/10"
              : "border-st-inprogress/40 bg-st-inprogress/10",
          )}
        >
          <p className={clsx("text-base font-bold", n.severity === "critical" ? "text-st-dirty" : "text-st-inprogress")}>
            {n.title}
          </p>
          {n.body && <p className="mt-0.5 text-xl font-bold leading-snug text-ink">{n.body}</p>}
        </div>
      ))}

      {/* 3 — notes on the truck itself. Grouped under their own heading: these
              belong to ONE truck, where the block below applies to the whole
              shift, and on a wall display the two were indistinguishable. */}
      {truckNotes.length > 0 && (
        <div className="rounded-xl border border-violet-700/40 bg-violet-950/20 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-300">
            Truck{truckNumber != null ? ` #${truckNumber}` : ""} notes
          </p>
          <div className="mt-1.5 space-y-1.5">
            {truckNotes.map((n) => {
              const s = NOTE_STYLE[n.note_type];
              const fromDriver = n.created_by === "driver";
              return (
                <div key={n.id} className={clsx("rounded-lg border px-3 py-2", s.border, s.bg)}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className={clsx("rounded-pill px-1.5 py-0.5 text-[10px] font-semibold", s.chip)}>
                      {n.note_type === "workday" ? `Day ${n.workday_num}` : s.label}
                    </span>
                    {fromDriver && (
                      <span className="rounded-pill bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                        Driver
                      </span>
                    )}
                  </div>
                  {/* Big and bold: this panel is read off a wall, not a desk. */}
                  <p className="text-xl font-bold leading-snug text-ink">{n.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3b — standing load-workflow notes. Apply to the whole shift rather
              than one truck, so they sit below the truck's own notes. */}
      {workflowLines.length > 0 && (
        <div className="rounded-xl border border-sky-700/40 bg-sky-950/20 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-sky-400">
            Daily · Load day {dayNum}
          </p>
          <ul className="mt-1 space-y-1">
            {workflowLines.map((l, i) => (
              <li key={i} className="flex gap-1.5 text-xl font-bold leading-snug text-ink">
                <span className="shrink-0 text-sky-500">•</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4 — per-day state notes carried on the board payload */}
      {offNote && (
        <div className="rounded-xl border border-hairline bg-surface-2 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Off note</p>
          <p className="text-sm leading-snug text-ink-soft">{offNote}</p>
        </div>
      )}
      {shopNote && (
        <div className="rounded-xl border border-hairline bg-surface-2 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Shop note</p>
          <p className="text-sm leading-snug text-ink-soft">{shopNote}</p>
        </div>
      )}

      {/* 4b — what's flagged on the trucks coming up */}
      {upcomingNotes.length > 0 && (
        <div className="space-y-1.5 border-t border-hairline pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Coming up</p>
          {upcomingNotes.map((g) => (
            <div key={g.truck.truck_number} className="rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5">
              <p className="font-mono text-xs font-bold tabular-nums text-ink-soft">#{g.truck.truck_number}</p>
              {g.warnings.map((w) => (
                <p key={w.id} className="mt-0.5 flex gap-1.5 text-xs leading-snug text-st-dirty">
                  <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{w.item_label} ×{w.quantity}{w.note ? ` — ${w.note}` : ""}</span>
                </p>
              ))}
              {g.notes.map((n) => (
                <p key={n.id} className="mt-0.5 text-xs leading-snug text-ink-muted">
                  {n.created_by === "driver" ? "Driver: " : ""}{n.body}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 5 — the shift's own notes, quietest */}
      {shiftNote && (
        <div className="mt-auto border-t border-hairline pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Shift notes</p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">{shiftNote}</p>
        </div>
      )}
    </div>
  );
}
