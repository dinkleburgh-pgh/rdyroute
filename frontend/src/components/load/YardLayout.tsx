import DockCard from "./DockCard";
import YardQueue from "./YardQueue";
import LoadedLedger from "./LoadedLedger";
import type { LoadViewProps } from "./loadView";

/**
 * YARD view — the dock on the left (the loading truck, the unload dock's
 * question, tonight's numbers, coverage, notes) and the yard on the right
 * (everything not yet loading, in the order it will go, then the loaded
 * ledger folded to one line).
 *
 * One grid, two rails from lg up. Below lg the rail wrappers are `contents`,
 * so their cards interleave in the one column in the order a loader needs
 * them: dock → unload question → yard → loaded → the reference cards last.
 */
export default function YardLayout(p: LoadViewProps) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ---------------- Dock rail ---------------- */}
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        <div className="order-1 flex flex-col gap-4 lg:order-none">
          <DockCard
            variant="dock"
            loading={p.loading}
            nextUp={p.nextUp}
            lineCount={p.inLine}
            readyCount={p.ready.length}
            busyTruck={p.busyTruck}
            canStart={p.canStart}
            onStart={p.onStart}
          />
          {p.shortages}
        </div>
        {p.unloadCard && <div className="order-2 lg:order-none">{p.unloadCard}</div>}
        <div className="order-5 lg:order-none">{p.tonightCard}</div>
        <div className="order-6 lg:order-none">{p.coverageCard}</div>
        <div className="order-7 lg:order-none">{p.notesCard}</div>
      </div>

      {/* ---------------- Yard rail ---------------- */}
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        <div className="order-3 lg:order-none">
          <YardQueue
            nextUp={p.nextUp}
            staged={p.staged}
            ready={p.ready}
            held={p.held}
            unfinished={p.unfinished}
            suggestions={p.suggestions}
            busyTruck={p.busyTruck}
            canStart={p.canStart}
            readyFocus={p.readyFocus}
            pairOf={p.pairOf}
            onTruck={p.onTruck}
            onStart={p.onStart}
            onPickNextUp={p.onPickNextUp}
            onSuggest={p.onSuggest}
          />
        </div>
        <div className="order-4 lg:order-none">
          <LoadedLedger key={p.runDate} loaded={p.loaded} pairOf={p.pairOf} />
        </div>
      </div>
    </div>
  );
}
