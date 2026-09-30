import clsx from "clsx";
import { useState } from "react";
import type { LoadPair } from "./loadUi";
import type { TruckWithState } from "../../types";

type LeftKey = "dust" | "uniform" | "spare" | "total";

/**
 * Tonight: load / unload progress, then what's left to load by truck type,
 * then (on tap) the trucks behind a count — one card instead of three. The
 * dot carries the category; the number stays ink so a big count can't read
 * as an alarm. The drill-down is compact chips, not tiles: "total left" is
 * 25-plus trucks most of the night.
 */
export default function TonightCard({
  loadDone,
  loadTotal,
  unloadDone,
  unloadTotal,
  ranAhead,
  left,
  pairOf,
}: {
  loadDone: number;
  loadTotal: number;
  unloadDone: number;
  unloadTotal: number;
  /** Trucks that ran ahead and are OUT of tonight's roster (explains the total). */
  ranAhead: number;
  /** Not-yet-loaded trucks by operational type; `total` is the union. */
  left: Record<LeftKey, TruckWithState[]>;
  pairOf: (t: TruckWithState) => LoadPair;
}) {
  const [filter, setFilter] = useState<LeftKey | null>(null);
  const loadPct = loadTotal > 0 ? Math.round((loadDone / loadTotal) * 100) : 0;
  const unloadPct = unloadTotal > 0 ? Math.round((unloadDone / unloadTotal) * 100) : 0;
  const cells: { key: LeftKey; label: string; dot: string | null }[] = [
    { key: "dust", label: "F.S. left", dot: "bg-st-dirty" },
    { key: "uniform", label: "Uniforms left", dot: "bg-st-shop" },
    { key: "spare", label: "Spares left", dot: "bg-st-spare" },
    { key: "total", label: "Total left", dot: null },
  ];
  const titles: Record<LeftKey, string> = { dust: "F.S.", uniform: "Uniforms", spare: "Spares", total: "All" };
  const statusLabel: Record<string, string> = { dirty: "Dirty", unloaded: "Unloaded", in_progress: "Loading" };

  return (
    <div className="card overflow-hidden !p-0">
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-muted">Tonight</div>
        <ProgressRow label="Load" done={loadDone} total={loadTotal} pct={loadPct} barColor="#3b82f6" />
        {ranAhead > 0 && (
          <p className="text-[11px] font-semibold text-sky-300">{ranAhead} ran ahead — not in tonight's load</p>
        )}
        <ProgressRow label="Unload" done={unloadDone} total={unloadTotal} pct={unloadPct} barColor="#22c55e" />
      </div>
      <div className="flex border-t border-hairline">
        {cells.map((cell, i) => (
          <button
            key={cell.key}
            type="button"
            aria-pressed={filter === cell.key}
            onClick={() => setFilter(filter === cell.key ? null : cell.key)}
            className={clsx(
              "flex-1 px-1 py-3 text-center transition-colors",
              i < 3 && "border-r border-hairline",
              filter === cell.key ? "bg-surface-2" : "hover:bg-surface-2/60",
            )}
          >
            <div className="font-mono text-2xl font-black tabular-nums text-ink">{left[cell.key].length}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {cell.dot && <span className={clsx("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", cell.dot)} />}
              {cell.label}
            </div>
          </button>
        ))}
      </div>

      {filter && (
        <div className="animate-slide-down space-y-2.5 border-t border-hairline px-4 py-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {titles[filter]} not yet loaded ({left[filter].length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {left[filter].map((t) => {
              const st = t.state?.status ?? "dirty";
              const pair = pairOf(t);
              const tone =
                st === "unloaded" ? "text-st-unloaded"
                : st === "in_progress" ? "text-st-inprogress"
                : "text-st-dirty";
              return (
                <span
                  key={t.truck_number}
                  className={clsx(
                    "inline-flex items-center rounded-md border border-hairline bg-surface px-2 py-1.5 font-mono text-[13px] font-bold tabular-nums",
                    tone,
                    t.state?.priority_hold && "ring-1 ring-st-dirty/60",
                  )}
                  title={`${statusLabel[st] ?? st}${pair != null ? ` · covering route ${pair.route}` : ""}${t.state?.priority_hold ? " · hold" : ""}`}
                >
                  {pair != null ? (
                    <>
                      <span className={pair.split ? "text-amber-300" : "text-sky-300"}>{pair.route}</span>
                      <span className="px-0.5 text-ink-faint">{pair.split ? "+" : "→"}</span>
                      {t.truck_number}
                    </>
                  ) : (
                    <>#{t.truck_number}</>
                  )}
                </span>
              );
            })}
            {left[filter].length === 0 && <span className="text-sm text-ink-faint">All clear!</span>}
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
            {([["bg-st-dirty", "Dirty"], ["bg-st-unloaded", "Unloaded"], ["bg-st-inprogress", "Loading"]] as const).map(([dot, label]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
                {label}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

function ProgressRow({
  label,
  done,
  total,
  pct,
  barColor,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
  barColor: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[58px] text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="w-24 text-right font-mono tabular-nums text-xs text-ink-muted">
        {done}/{total} ({pct}%)
      </span>
    </div>
  );
}
