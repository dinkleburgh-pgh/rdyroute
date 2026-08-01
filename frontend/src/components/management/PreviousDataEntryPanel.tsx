/**
 * Previous Data Entry — the end-of-shift transcription hub. Everything a
 * supervisor back-fills after the fact lives on one tab: previous-day
 * coverage corrections, batch assignments, and a jump to the Short Sheet
 * for shortage entry.
 */
import { Link } from "react-router-dom";
import { ClipboardList, Layers } from "lucide-react";
import PrevDayCoveragePanel from "./PrevDayCoveragePanel";

export default function PreviousDataEntryPanel() {
  return (
    <div className="space-y-6">
      <Link
        to="/shorts"
        className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/50 bg-amber-950/20 px-4 py-3 transition-colors hover:bg-amber-900/20"
      >
        <div className="flex min-w-0 items-center gap-3">
          <ClipboardList className="h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-300">Log shortages</p>
            <p className="text-xs text-slate-500">
              Opens the Short Sheet — the "By item" mode is built for transcribing paper sheets.
            </p>
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold text-amber-400">Open →</span>
      </Link>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Previous Day Coverage</h3>
        <PrevDayCoveragePanel />
      </section>

      {/* Batching moved to Operations → Batching, alongside the settings that
          govern it. Left as a pointer because this is the tab someone lands on
          when back-filling a previous day, and batching is part of that job. */}
      <Link
        to="/management?group=ops&tab=batching"
        className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 transition-colors hover:bg-slate-800/60"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Layers className="h-5 w-5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-300">Batching</p>
            <p className="text-xs text-slate-500">
              Assign trucks to batches for any run date — now under Operations, with its settings.
            </p>
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold text-slate-400">Open →</span>
      </Link>
    </div>
  );
}
