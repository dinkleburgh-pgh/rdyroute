import { useState } from "react";
import clsx from "clsx";
import { useSpareAssignments, useAssignSpare } from "../../api/hooks";
import { todayIso } from "../../api/client";
import type { SpareAssignment } from "../../types";

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PrevDayCoveragePanel() {
  const today = todayIso();
  const [sourceDate, setSourceDate] = useState(yesterdayIso);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState<Set<number>>(new Set());

  const { data: prevAssignments = [], isLoading } = useSpareAssignments(sourceDate);
  const { data: todayAssignments = [] } = useSpareAssignments(today);
  const assignSpare = useAssignSpare();

  // Active (not returned) assignments from source date
  const active = prevAssignments.filter((a) => !a.returned);

  // Already covered today: spare_truck_number already has an active assignment
  const todayActiveSpares = new Set(
    todayAssignments.filter((a) => !a.returned).map((a) => a.spare_truck_number),
  );

  async function applyOne(assignment: SpareAssignment) {
    setApplying((s) => new Set(s).add(assignment.id));
    try {
      await assignSpare.mutateAsync({
        run_date: today,
        spare_truck_number: assignment.spare_truck_number,
        covering_route_truck: assignment.covering_route_truck,
      });
      setApplied((s) => new Set(s).add(assignment.id));
    } catch {
      // conflict (already assigned) — mark applied anyway
      setApplied((s) => new Set(s).add(assignment.id));
    } finally {
      setApplying((s) => { const n = new Set(s); n.delete(assignment.id); return n; });
    }
  }

  async function applyAll() {
    const toApply = active.filter(
      (a) => !applied.has(a.id) && !todayActiveSpares.has(a.spare_truck_number),
    );
    await Promise.all(toApply.map(applyOne));
  }

  const unappliedCount = active.filter(
    (a) => !applied.has(a.id) && !todayActiveSpares.has(a.spare_truck_number),
  ).length;

  return (
    <div className="card space-y-4">
      <div>
        <p className="text-sm text-ink-soft">
          Copy spare coverages from a previous run date onto today ({today}).
        </p>
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-3">
        <label className="label mb-0">Source date</label>
        <input
          type="date"
          value={sourceDate}
          max={yesterdayIso()}
          onChange={(e) => { setSourceDate(e.target.value); setApplied(new Set()); }}
          className="input w-40"
        />
      </div>

      {/* Assignment list */}
      {isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-ink-faint">No active spare coverages on {sourceDate}.</p>
      ) : (
        <>
          <div className="space-y-2">
            {active.map((a) => {
              const alreadyToday = todayActiveSpares.has(a.spare_truck_number);
              const isApplied = applied.has(a.id) || alreadyToday;
              const isBusy = applying.has(a.id);

              return (
                <div
                  key={a.id}
                  className={clsx(
                    "flex items-center justify-between rounded-lg px-4 py-3 border",
                    isApplied
                      ? "border-st-unloaded/30 bg-st-unloaded/10"
                      : "border-hairline bg-surface-2",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-st-spare">
                      #{a.spare_truck_number}
                    </span>
                    <span className="text-ink-muted text-xs">covers</span>
                    <span className="font-mono text-sm font-bold text-ink">
                      #{a.covering_route_truck}
                    </span>
                  </div>

                  {isApplied ? (
                    <span className="text-[11px] font-semibold text-st-unloaded">
                      {alreadyToday && !applied.has(a.id) ? "Already active" : "Applied"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => applyOne(a)}
                      className="rounded-lg border border-sky-700/40 bg-sky-950/50 px-3 py-1 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-900/50 disabled:opacity-50"
                    >
                      {isBusy ? "Applying…" : "Apply Today"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {unappliedCount > 1 && (
            <button
              type="button"
              onClick={applyAll}
              disabled={assignSpare.isPending}
              className="btn-primary w-full"
            >
              Apply All ({unappliedCount})
            </button>
          )}
        </>
      )}
    </div>
  );
}
