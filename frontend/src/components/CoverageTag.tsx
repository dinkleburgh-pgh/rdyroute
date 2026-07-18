import { ArrowLeftRight } from "lucide-react";
import clsx from "clsx";

/**
 * The app-wide coverage idiom: `#route ⇄ #truck` — the route being covered,
 * then the truck carrying its load. Same shape as the Previous Load-Day
 * Coverage banner chips; replaces the older "Cov. #N" pills so coverage reads
 * identically on every surface.
 *
 * `prev` renders the muted amber previous-day variant; default is today's
 * sky-tinted variant.
 */
export default function CoverageTag({
  route,
  truck,
  prev = false,
  className,
}: {
  route: number;
  truck: number;
  prev?: boolean;
  className?: string;
}) {
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
