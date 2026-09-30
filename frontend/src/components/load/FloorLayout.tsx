import EmptyState from "../EmptyState";
import { QuietTile, SectionHeader } from "../workflow/QuietTile";
import DockCard from "./DockCard";
import LoadedLedger from "./LoadedLedger";
import { NotReadyChip } from "./loadUi";
import type { LoadViewProps } from "./loadView";

/**
 * FLOOR view — just what a loader acts on, one size up so it reads from
 * across the dock: the three-zone dock card at XL (the hero is sized by the
 * page), the unload question only while it is unanswered, big ready tiles,
 * Not ready as chips, Loaded folded to one line. No reference cards — the
 * Classic view is the lead's page.
 *
 * One column at every width; it never needs a second.
 */
export default function FloorLayout(p: LoadViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <DockCard
        variant="zones"
        size="xl"
        loading={p.loading}
        nextUp={p.nextUp}
        staged={p.staged}
        suggestions={p.suggestions}
        lineCount={p.inLine}
        readyCount={p.ready.length}
        busyTruck={p.busyTruck}
        canStart={p.canStart}
        pairOf={p.pairOf}
        onTruck={p.onTruck}
        onStart={p.onStart}
        onPickNextUp={p.onPickNextUp}
        onSuggest={p.onSuggest}
      />
      {p.shortages}

      {p.unloadCard && !p.unloadAnswered && p.unloadCard}

      <div className="card">
        <SectionHeader
          label="Ready to load"
          count={p.ready.length}
          hint={
            p.inLine > 0
              ? `+${p.inLine} in the dock above`
              : p.ready.length > 0
                ? "tap to start, stage, or queue"
                : undefined
          }
        />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {p.ready.map((t) => (
            <QuietTile
              key={t.truck_number}
              truck={t}
              size="lg"
              disabled={p.busyTruck === t.truck_number}
              onClick={() => p.onTruck(t)}
              title={t.state?.wearers ? `${t.state.wearers} wearers` : undefined}
              numberClass={t.truck_type === "Spare" ? "text-st-spare" : "text-st-unloaded"}
              dotClass={t.truck_type === "Spare" ? "bg-st-spare" : "bg-st-unloaded"}
              pair={p.pairOf(t)}
              sub={
                <span>
                  {t.truck_type === "Spare" ? "Spare" : "Unloaded"}
                  {t.state?.wearers ? ` · ${t.state.wearers} wearers` : ""}
                </span>
              }
            />
          ))}
          {p.ready.length === 0 && (
            <EmptyState compact className="col-span-full text-[13px] text-ink-muted">
              {p.inLine > 0 ? "Everything ready is already in the dock." : "No trucks ready to load."}
            </EmptyState>
          )}
        </div>
      </div>

      {p.held.length + p.unfinished.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {p.held.map((t) => (
            <NotReadyChip key={t.truck_number} truck={t} pair={p.pairOf(t)} tone="text-st-dirty" dot="bg-st-dirty" label="On hold · clear in Fleet" />
          ))}
          {p.unfinished.map((t) => (
            <NotReadyChip key={t.truck_number} truck={t} pair={p.pairOf(t)} tone="text-st-unfinished" dot="bg-st-unfinished" label="Unload unfinished" />
          ))}
        </div>
      )}

      <LoadedLedger key={p.runDate} loaded={p.loaded} pairOf={p.pairOf} />
    </div>
  );
}
