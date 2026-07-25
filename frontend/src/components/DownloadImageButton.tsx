import { useState, type RefObject } from "react";
import { toPng } from "html-to-image";
import { Download } from "lucide-react";
import clsx from "clsx";

/**
 * Renders a "Download image" button that snapshots a target DOM node to a PNG
 * and saves it — so a report can be shared without screenshotting the app.
 *
 * The capture filters out any element marked `data-download-exclude` (e.g. this
 * button itself), so the button can live inside the captured node without
 * showing up in the image.
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
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#07090d",
        filter: (el) =>
          !(el instanceof HTMLElement && el.dataset.downloadExclude !== undefined),
      });
      const safe = filename.trim().replace(/\s+/g, "-").replace(/[^\w.-]/g, "");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = safe.endsWith(".png") ? safe : `${safe}.png`;
      a.click();
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
