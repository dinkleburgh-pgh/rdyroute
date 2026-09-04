/**
 * Loading / unreachable states for a whole page's primary query.
 *
 * The four hot pages (Run Day, Load, Unload, Report) used to render a fully
 * composed FAKE EMPTY DAY while the board was still fetching — headers, zeroed
 * stat tiles, "nothing scheduled" copy — and a dead backend looked identical
 * to a genuinely empty one. Modeled on DriverNotes' guard, the one place that
 * got this right: a paused query (offline) resolves with no data, no error and
 * not loading, so "no data yet" must never be presented as fact.
 *
 * Usage: const gate = pageStatusFor(query); if (gate) return <PageStatus {...gate} />;
 */
import { RefreshCw, WifiOff } from "lucide-react";

export function pageStatusFor(q: {
  isLoading: boolean;
  isError: boolean;
  fetchStatus?: string;
  data: unknown;
  refetch: () => void;
}): { kind: "loading" } | { kind: "unreachable"; retry: () => void } | null {
  if (q.isLoading && q.data === undefined && q.fetchStatus !== "paused") return { kind: "loading" };
  const unreachable = q.isError || (q.fetchStatus === "paused" && q.data === undefined);
  if (unreachable) return { kind: "unreachable", retry: q.refetch };
  return null;
}

export default function PageStatus(props: { kind: "loading" } | { kind: "unreachable"; retry: () => void }) {
  if (props.kind === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center" role="status">
        <RefreshCw className="h-6 w-6 animate-spin text-ink-faint" aria-hidden />
        <p className="text-sm text-ink-muted">Loading the day…</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <WifiOff className="h-6 w-6 text-amber-400" aria-hidden />
      <p className="max-w-[36ch] text-sm text-ink-soft">
        Can&apos;t reach the server right now — this isn&apos;t what the day looks like, just a dead connection.
      </p>
      <button type="button" className="btn-primary min-h-[44px] px-6" onClick={props.retry}>
        Try again
      </button>
    </div>
  );
}
