import EmptyState from "../EmptyState";
import { QuietTile, SectionHeader, TILE_GRID, TILE_GRID_LG } from "../workflow/QuietTile";
import DockCard from "./DockCard";
import LoadedLedger from "./LoadedLedger";
import { NotReadyChip } from "./loadUi";
import type { LoadViewProps } from "./loadView";

/**
 * CLASSIC view — the three-zone dock card (Loading now / Up next / Staged)
 * over the Ready grid and the Loaded wall, with the reference material (the
 * unload question, notes, coverage, tonight's numbers, Not ready) on the
 * right. The arrangement the page shipped with before the yard; kept as a
 * per-device choice.
 */
export default function ClassicLayout(p: LoadViewProps) {
  const notReady =
    p.held.length + p.unfinished.length > 0 ? (
      <div className="card">
        <SectionHeader label="Not ready yet" count={p.held.length + p.unfinished.length} hint="joins Ready when cleared" />
        <div className="flex flex-wrap gap-2">
          {p.held.map((t) => (
            <NotReadyChip key={t.truck_number} truck={t} pair={p.pairOf(t)} tone="text-st-dirty" dot="bg-st-dirty" label="On hold · clear in Fleet" />
          ))}
          {p.unfinished.map((t) => (
            <NotReadyChip key={t.truck_number} truck={t} pair={p.pairOf(t)} tone="text-st-unfinished" dot="bg-st-unfinished" label="Unload unfinished" />
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
      {/* ---------------- Work rail ---------------- */}
      <div className="flex flex-col gap-4">
        <DockCard
          variant="zones"
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

        {/* Phone: the unload question stays right under the dock. Desktop
            moves it to the top of the reference rail. */}
        {p.unloadCard && <div className="lg:hidden">{p.unloadCard}</div>}

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
          <div className={p.readyFocus ? TILE_GRID_LG : TILE_GRID}>
            {p.ready.map((t) => (
              <QuietTile
                key={t.truck_number}
                truck={t}
                size={p.readyFocus ? "lg" : "md"}
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

        {notReady && <div className="lg:hidden">{notReady}</div>}

        {/* Loaded lives IN the work rail: ready shrinks exactly as this grows,
            so the column holds its height all night. */}
        <LoadedLedger key={p.runDate} loaded={p.loaded} pairOf={p.pairOf} collapsible={false} />
      </div>

      {/* ---------------- Reference rail ---------------- */}
      <div className="flex flex-col gap-4">
        {p.unloadCard && <div className="hidden lg:block">{p.unloadCard}</div>}
        {p.notesCard}
        {p.coverageCard}
        {p.tonightCard}
        {notReady && <div className="hidden lg:block">{notReady}</div>}
      </div>
    </div>
  );
}
