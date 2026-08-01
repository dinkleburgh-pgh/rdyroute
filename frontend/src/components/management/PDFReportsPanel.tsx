/**
 * PDF day reports.
 *
 * This used to build its own report: a light-themed HTML string with two bare
 * tables (truck states, audit entries), opened in a pop-up that asked you to
 * hit Ctrl+P yourself. It shared nothing with the real report — no coverage, no
 * shortages, no batches, no load times, none of the styling.
 *
 * The real one is composed on the Report page and rendered server-side to a
 * dark, selectable PDF by WeasyPrint. That composer closes over ~44 values from
 * LiveReport, and routers/reports.py is explicit that the browser builds the
 * view-model there on purpose — so this panel hands off to it (`?pdf=1`) rather
 * than growing a second, weaker implementation.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { todayIso } from "../../api/client";
import { FieldRow } from "./shared";

export default function PDFReportsPanel() {
  const navigate = useNavigate();
  const [runDate, setRunDate] = useState(todayIso());

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Day report PDF</h3>
        <p className="mt-1 text-xs text-slate-500">
          The full run report — route coverage, shortages, the short sheet, load times, batches and
          audit — rendered as a dark, selectable PDF. Same report as the Report page.
        </p>
      </div>

      <FieldRow label="Run date" hint="Which day's report to generate.">
        <input
          type="date"
          className="input w-44"
          value={runDate}
          max={todayIso()}
          onChange={(e) => setRunDate(e.target.value)}
        />
      </FieldRow>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => navigate(`/report?run_date=${runDate}&pdf=1`)}
        >
          <FileText className="h-4 w-4" />
          Download PDF
        </button>
        <button
          className="btn-ghost"
          onClick={() => navigate(`/report?run_date=${runDate}`)}
        >
          Open report
        </button>
      </div>

      <p className="text-[11px] text-slate-600">
        Download opens the report and saves the PDF straight away. Use{" "}
        <span className="text-slate-500">Open report</span> to read it on screen or pick which
        sections to include.
      </p>
    </div>
  );
}
