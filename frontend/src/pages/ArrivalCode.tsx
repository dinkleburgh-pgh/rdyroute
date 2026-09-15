/**
 * Arrival-code kiosk — a full-screen rotating dock code for any signed-in
 * tablet pointed at the driver entrance. The code is the proof-of-presence
 * behind the driver QR page's "I'm Back": it only exists on plant screens
 * and rotates every minute, so a current code can't be phoned in from the
 * road. The Load Display shows the same code in its corner; this page is for
 * a dedicated screen where that station isn't visible from the driver door.
 */
import { useEffect, useState } from "react";
import { useArrivalCode } from "../api/hooks";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function ArrivalCode() {
  useDocumentTitle("Arrival Code");
  const { data, dataUpdatedAt, isError } = useArrivalCode();

  // Local ticking countdown between polls; the server's seconds_left is the
  // truth and every refetch re-anchors it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const secondsLeft = data
    ? Math.max(0, data.seconds_left - Math.floor((now - dataUpdatedAt) / 1000))
    : null;
  // A code older than two rotations is worse than none: a driver would type
  // digits the server already rejects. Take the screen over instead.
  const stale = isError || (data != null && now - dataUpdatedAt > 120_000);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.3em] text-ink-muted">
        Driver arrival code
      </p>
      {stale ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 px-6 py-8">
          <p className="text-2xl font-black text-red-300">Code unavailable</p>
          <p className="mt-2 text-sm text-red-200/80">
            Can't reach the server — drivers should see a lead to be marked arrived.
          </p>
        </div>
      ) : data == null ? (
        <p className="text-lg text-ink-muted">Loading…</p>
      ) : (
        <>
          <p className="font-mono text-[clamp(72px,18vw,220px)] font-black leading-none tracking-[0.08em] tabular-nums text-ink">
            {data.code}
          </p>
          <div className="w-full max-w-md">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear"
                style={{ width: `${((secondsLeft ?? 0) / 60) * 100}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-xs text-ink-muted">
              new code in {secondsLeft ?? "—"}s
            </p>
          </div>
          <p className="max-w-md text-sm text-ink-muted">
            Type these 6 digits into <b className="text-ink-soft">I'm Back</b> on your truck's QR
            page to mark your arrival.
          </p>
          {!data.required && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-2 text-sm text-amber-200">
              The arrival code isn't currently required — drivers can mark arrival without it.
              Turn it on in Management → Operations → Workflows.
            </p>
          )}
        </>
      )}
    </div>
  );
}
