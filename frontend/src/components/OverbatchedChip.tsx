/**
 * Small red warning pill shown on batch cards whose wearer total exceeds the
 * configured cap. Shown even in no-cap mode — enforcement is off there, but a
 * batch over a full load is still worth flagging (same reasoning as the
 * capacity bars, which always grade against the configured cap).
 */
export default function OverbatchedChip({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-400">
      Overbatched
    </span>
  );
}
