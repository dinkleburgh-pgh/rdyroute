import { useState, type RefObject } from "react";
import { toBlob } from "html-to-image";
import { Download, X } from "lucide-react";
import clsx from "clsx";

/**
 * "Download image" button that saves a target report section as a PNG.
 *
 * Capture: rather than snapshotting the on-screen node (which on mobile clips
 * whatever is scrolled out of an overflow container — e.g. the wide shortages
 * grid), it renders a fully-expanded off-screen CLONE so the whole report is
 * captured at content width on any device.
 *
 * Delivery: `<a download>` with a data/blob URL is silently ignored by iOS
 * Safari and installed PWAs, so on touch devices we hand the file to the native
 * share sheet (Save Image / Save to Files). Desktop gets a normal download, and
 * if neither path is available we show the image inline to press-and-hold-save.
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
  // Set when we fall back to an inline preview (press-and-hold to save).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function closePreview() {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }

  async function handleDownload() {
    const node = targetRef.current;
    if (!node || busy) return;
    setBusy(true);
    setErr(false);
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

      const blob = await toBlob(clone, {
        pixelRatio,
        cacheBust: true,
        backgroundColor: "#07090d",
        width: clone.scrollWidth,
        height: clone.scrollHeight,
      });
      if (!blob) throw new Error("capture produced no image");

      const safe = filename.trim().replace(/\s+/g, "-").replace(/[^\w.-]/g, "");
      const fname = safe.endsWith(".png") ? safe : `${safe}.png`;
      await deliver(blob, fname, setPreviewUrl);
    } catch (e) {
      console.error("DownloadImageButton: capture failed", e);
      setErr(true);
    } finally {
      wrapper.remove();
      setBusy(false);
    }
  }

  return (
    <>
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

      {previewUrl && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center gap-3 overflow-auto bg-black/90 p-4"
          onClick={closePreview}
        >
          <div className="flex w-full items-center justify-between text-sm text-white">
            <span>Press &amp; hold the image to save it</span>
            <button
              type="button"
              onClick={closePreview}
              className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-1.5 font-semibold"
            >
              <X className="h-4 w-4" /> Close
            </button>
          </div>
          <img
            src={previewUrl}
            alt={filename}
            className="max-w-full rounded-lg border border-white/15"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/**
 * Hand the PNG to the OS. Touch devices get the native share sheet (the
 * reliable Save-Image path where `<a download>` is ignored); desktop gets a
 * blob download; anything left over renders inline for press-and-hold save.
 */
async function deliver(
  blob: Blob,
  fname: string,
  showPreview: (url: string) => void,
) {
  const file = new File([blob], fname, { type: "image/png" });
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  // Touch devices: <a download> is silently ignored (iOS Safari, installed
  // PWAs), so it must never be the path here — that's the "nothing happens"
  // bug. Try the native share sheet first, and whenever it's unavailable or
  // fails, show the image inline to press-and-hold save. One of the two always
  // gives the user something.
  if (coarse) {
    const canShareFile =
      typeof navigator.canShare === "function" &&
      typeof navigator.share === "function" &&
      navigator.canShare({ files: [file] });
    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: fname });
        return;
      } catch (e) {
        // User dismissed the share sheet — nothing more to do.
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Any other failure: fall through to the inline preview.
      }
    }
    showPreview(URL.createObjectURL(blob));
    return;
  }

  // Desktop: a real file download (blob URL, anchor in the DOM).
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
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
