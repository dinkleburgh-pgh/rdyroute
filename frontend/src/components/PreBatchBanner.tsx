import { useSettings } from "../api/hooks";

/**
 * "Pre-batch mode is on" notice.
 *
 * The mode changes what a batch assignment DOES — it stops marking the truck
 * unloaded — so leaving it on by accident quietly breaks the crew's one-tap
 * flow, and worse, a Dirty truck never appears in the Load page's "Ready to
 * load" list. That failure is invisible at the point of use: batching still
 * looks like it worked. Hence a standing banner on every surface that batches,
 * rather than a setting you have to go and check.
 *
 * Renders nothing when the mode is off, so it can be dropped in anywhere.
 */
export default function PreBatchBanner({ className }: { className?: string }) {
  const { data: settings = [] } = useSettings();
  const on = settings.some((s) => s.key === "prebatch_mode" && s.value === true);
  if (!on) return null;

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-2"
      }
    >
      <span className="rounded-pill bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
        Pre-batch mode
      </span>
      <span className="text-xs font-semibold text-amber-200">
        Batching won't mark trucks unloaded.
      </span>
      <span className="text-xs text-amber-200/70">
        Trucks stay dirty until Mark Unloaded — turn this off before the load crew starts.
      </span>
    </div>
  );
}
