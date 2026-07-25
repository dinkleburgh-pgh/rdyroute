import { useState, type RefObject } from "react";
import { toBlob } from "html-to-image";
import { Download, Share as ShareIcon, X } from "lucide-react";
import clsx from "clsx";

/**
 * "Download image" button that saves a target report section as a PNG.
 *
 * Capture: renders a fully-expanded off-screen CLONE (scroll regions opened,
 * sticky cells un-stuck, sized to content) so the whole report is captured at
 * content width on any device — not the clipped mobile viewport.
 *
 * Delivery: `<a download>` is silently ignored on iOS Safari / installed PWAs,
 * and firing `navigator.share()` right after the async capture fails because
 * iOS has already spent the tap's "user gesture". So on touch devices we pop a
 * small sheet with a "Save image" button — tapping THAT is a fresh gesture, so
 * the native share sheet (Save Image / Save to Files) opens reliably. Desktop
 * just downloads the file.
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
  // On touch devices we stage the captured image and let a fresh tap share it.
  const [sheet, setSheet] = useState<{ url: string; file: File; canShare: boolean } | null>(null);

  function closeSheet() {
    setSheet((s) => {
      if (s) URL.revokeObjectURL(s.url);
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
      const file = new File([blob], fname, { type: "image/png" });
      const coarse =
        typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

      if (coarse) {
        // Stage it — the actual save happens on a fresh tap in the sheet.
        const canShare =
          typeof navigator.canShare === "function" &&
          typeof navigator.share === "function" &&
          navigator.canShare({ files: [file] });
        setSheet({ url: URL.createObjectURL(blob), file, canShare });
      } else {
        // Desktop: a real file download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      }
    } catch (e) {
      console.error("DownloadImageButton: capture failed", e);
      setErr(true);
    } finally {
      wrapper.remove();
      setBusy(false);
    }
  }

  async function shareFromSheet() {
    if (!sheet) return;
    try {
      await navigator.share({ files: [sheet.file], title: sheet.file.name });
      closeSheet();
    } catch (e) {
      // Dismissed the share sheet — leave ours open so they can retry.
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("share failed", e);
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

      {sheet && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center gap-3 overflow-auto bg-black/90 p-4"
          onClick={closeSheet}
        >
          <div className="flex w-full max-w-3xl items-center justify-between gap-2 text-sm text-white">
            <span className="font-semibold">Report image ready</span>
            <button
              type="button"
              onClick={closeSheet}
              className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-1.5 font-semibold"
            >
              <X className="h-4 w-4" /> Close
            </button>
          </div>

          {sheet.canShare ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                shareFromSheet();
              }}
              className="inline-flex w-full max-w-3xl items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-base font-bold text-white active:bg-emerald-600"
            >
              <ShareIcon className="h-5 w-5" /> Save image
            </button>
          ) : (
            <p className="w-full max-w-3xl text-center text-sm text-white/80">
              Press &amp; hold the image, then choose <b>Save Image</b>.
            </p>
          )}

          <img
            src={sheet.url}
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
