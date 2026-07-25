import { useState, type RefObject } from "react";
import { toPng } from "html-to-image";
import { Download } from "lucide-react";
import clsx from "clsx";

/**
 * Renders a "Download image" button that saves a target report section as a
 * PNG — so a report can be shared without screenshotting the app.
 *
 * Rather than snapshotting the on-screen node (which on mobile clips whatever
 * is scrolled out of an overflow container — e.g. the wide shortages grid), it
 * captures a fully-expanded off-screen CLONE: inner scroll regions are opened
 * up, sticky cells drop to normal flow, and the layout sizes to its content.
 * The result is the whole report at desktop width regardless of the device, not
 * a cramped phone screenshot.
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
    // Off-screen wrapper holding an expanded clone we actually capture.
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "position:fixed;left:-100000px;top:0;z-index:-1;background:#07090d;padding:20px;";
    try {
      const clone = node.cloneNode(true) as HTMLElement;
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);
      expandForCapture(clone);
      // Reflow, then keep the raster within sane bounds for very wide grids.
      const width = clone.scrollWidth || clone.offsetWidth;
      const pixelRatio = width > 2600 ? 1 : width > 1500 ? 1.5 : 2;

      const dataUrl = await toPng(clone, {
        pixelRatio,
        cacheBust: true,
        backgroundColor: "#07090d",
        width: clone.scrollWidth,
        height: clone.scrollHeight,
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
      wrapper.remove();
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

/**
 * Open up a cloned subtree so nothing is clipped in the capture: drop the
 * download button, un-scroll every overflow container, un-stick sticky cells,
 * and let tables + the root size to their natural (content) width.
 */
function expandForCapture(root: HTMLElement) {
  root.querySelectorAll("[data-download-exclude]").forEach((n) => n.remove());
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      el.style.overflow = "visible";
      el.style.maxHeight = "none";
      el.style.maxWidth = "none";
    }
    // Sticky headers / frozen first+last columns must land in normal flow so
    // they render once, in place, instead of floating over the capture.
    if (cs.position === "sticky") el.style.position = "static";
  }
  // Tables are w-full against a (now un-clipped) parent; let them take their
  // real column width so every truck column is included.
  root.querySelectorAll<HTMLElement>("table").forEach((t) => {
    t.style.width = "max-content";
  });
  root.style.width = "max-content";
  root.style.maxWidth = "none";
}
