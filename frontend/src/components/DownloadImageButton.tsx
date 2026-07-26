import { useState, type RefObject } from "react";
import { Download } from "lucide-react";
import clsx from "clsx";
import { exportFile } from "../lib/exportFile";
import { captureNodeToPngBlob } from "../lib/captureImage";

/**
 * "Download image" button that saves a target report section as a PNG.
 *
 * Layout: the report is captured inside an off-screen DESKTOP-width iframe, so
 * responsive layouts resolve to their wide/horizontal form (KPIs in a row, the
 * full grid / all batch cards) instead of the narrow phone stack. The result is
 * one landscape image that shows the whole sheet — legible when opened on a
 * phone. html-to-image reads styles via the global getComputedStyle, which does
 * reflect the iframe's viewport, so the desktop media queries apply.
 *
 * Delivery goes through the shared exportFile() helper: native share sheet in
 * the installed app, Web Share / blob download in the browser.
 */
export default function DownloadImageButton({
  targetRef,
  filename,
  label = "Download image",
  className,
}: {
  targetRef: RefObject<HTMLElement | null>;
  /** Base name (without extension); spaces become dashes. */
  filename: string;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function handleDownload() {
    const node = targetRef.current;
    if (!node || busy) return;
    setBusy(true);
    setErr(false);
    try {
      const blob = await captureNodeToPngBlob(node);
      const safe = filename.trim().replace(/\s+/g, "-").replace(/[^\w.-]/g, "");
      const fname = safe.endsWith(".png") ? safe : `${safe}.png`;
      await exportFile(blob, fname, "image/png");
    } catch (e) {
      console.error("DownloadImageButton: capture failed", e);
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-download-exclude className={clsx("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {busy ? "Generating…" : label}
      </button>
      {err && <span className="text-xs text-st-dirty">Couldn't generate image — try again.</span>}
    </div>
  );
}
