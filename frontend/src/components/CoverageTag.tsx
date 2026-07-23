import { ArrowLeftRight, Plus } from "lucide-react";
import clsx from "clsx";

/**
 * The app-wide coverage idiom: `#route ⇄ #truck` — the route being covered,
 * then the truck carrying its load. Same shape as the Previous Load-Day
 * Coverage banner chips; replaces the older "Cov. #N" pills so coverage reads
 * identically on every surface.
 *
 * `prev` renders the muted amber previous-day variant; default is today's
 * sky-tinted variant. `split` renders the amber `#route + #truck` SPLIT
 * variant — the route ALSO runs; the truck carries its overflow.
 */
export default function CoverageTag({
  route,
  truck,
  prev = false,
  split = false,
  className,
}: {
  route: number;
  truck: number;
  prev?: boolean;
  split?: boolean;
  className?: string;
}) {
  if (split) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-pill border border-amber-600/40 bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold",
          className,
        )}
        title={`Split load — route ${route} also runs; #${truck} carries its overflow`}
      >
        <span className="font-black text-amber-300">#{route}</span>
        <Plus className="h-3 w-3 text-amber-500/80" />
        <span className="font-black text-amber-100">#{truck}</span>
        <span className="ml-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-500">Split</span>
      </span>
    );
  }
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-0.5 text-[11px] font-bold",
        prev
          ? "border-amber-700/30 bg-amber-950/40"
          : "border-sky-700/40 bg-sky-950/40",
        className,
      )}
    >
      <span className="font-black text-red-300">#{route}</span>
      <ArrowLeftRight className={clsx("h-3 w-3", prev ? "text-amber-600/70" : "text-sky-500/70")} />
      <span className={clsx("font-black", prev ? "text-amber-200" : "text-sky-300")}>#{truck}</span>
    </span>
  );
}
