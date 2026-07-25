import { useState, type RefObject } from "react";
import { toBlob } from "html-to-image";
import { Download, Share as ShareIcon, X } from "lucide-react";
import clsx from "clsx";

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
 * Delivery: `<a download>` is ignored on iOS Safari / installed PWAs, and firing
 * navigator.share() right after the async capture fails (the tap's gesture is
 * spent). So touch devices get a sheet with a "Save image" button — that fresh
 * tap opens the native share sheet (Save Image / Save to Files). Desktop just
 * downloads the file.
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
    try {
      const blob = await captureNode(node);
      const safe = filename.trim().replace(/\s+/g, "-").replace(/[^\w.-]/g, "");
      const fname = safe.endsWith(".png") ? safe : `${safe}.png`;
      const file = new File([blob], fname, { type: "image/png" });
      const coarse =
        typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

      if (coarse) {
        const canShare =
          typeof navigator.canShare === "function" &&
          typeof navigator.share === "function" &&
          navigator.canShare({ files: [file] });
        setSheet({ url: URL.createObjectURL(blob), file, canShare });
      } else {
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
      setBusy(false);
    }
  }

  async function shareFromSheet() {
    if (!sheet) return;
    try {
      await navigator.share({ files: [sheet.file], title: sheet.file.name });
      closeSheet();
    } catch (e) {
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
          <div className="flex w-full max-w-5xl items-center justify-between gap-2 text-sm text-white">
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
              className="inline-flex w-full max-w-5xl items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-base font-bold text-white active:bg-emerald-600"
            >
              <ShareIcon className="h-5 w-5" /> Save image
            </button>
          ) : (
            <p className="w-full max-w-5xl text-center text-sm text-white/80">
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

/** Capture a node to PNG. Prefer the desktop-width iframe (horizontal layout);
 *  fall back to a plain off-screen clone if the iframe path fails. */
async function captureNode(node: HTMLElement): Promise<Blob> {
  try {
    return await captureInDesktopFrame(node);
  } catch (e) {
    console.warn("DownloadImageButton: desktop-frame capture failed, falling back", e);
    return await captureInline(node);
  }
}

const CAPTURE_BG = "#07090d";
const DESKTOP_WIDTH = 1280; // ≥ Tailwind lg/xl so responsive grids go horizontal

async function toPngBlob(clone: HTMLElement): Promise<Blob> {
  expandForCapture(clone);
  const width = clone.scrollWidth || clone.offsetWidth;
  const pixelRatio = width > 2600 ? 1 : width > 1500 ? 1.5 : 2;
  const blob = await toBlob(clone, {
    pixelRatio,
    cacheBust: true,
    backgroundColor: CAPTURE_BG,
    width: clone.scrollWidth,
    height: clone.scrollHeight,
  });
  if (!blob) throw new Error("capture produced no image");
  return blob;
}

async function captureInDesktopFrame(node: HTMLElement): Promise<Blob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${DESKTOP_WIDTH}px;height:800px;border:0;visibility:hidden`;
  document.body.appendChild(iframe);
  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error("no iframe document");
    idoc.open();
    idoc.write("<!doctype html><html><head></head><body></body></html>");
    idoc.close();
    // Carry over theme classes and drop in the app's stylesheets so Tailwind
    // utilities resolve inside the frame.
    idoc.documentElement.className = document.documentElement.className;
    idoc.documentElement.style.background = CAPTURE_BG;
    idoc.body.className = document.body.className;
    idoc.body.style.cssText = `margin:0;padding:20px;background:${CAPTURE_BG};width:max-content`;

    const waits: Promise<unknown>[] = [];
    for (const s of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      const c = s.cloneNode(true) as HTMLElement;
      idoc.head.appendChild(c);
      if (c.tagName === "LINK") {
        waits.push(
          new Promise((r) => {
            c.addEventListener("load", () => r(null), { once: true });
            c.addEventListener("error", () => r(null), { once: true });
            setTimeout(() => r(null), 3000);
          }),
        );
      }
    }

    const clone = node.cloneNode(true) as HTMLElement;
    idoc.body.appendChild(clone);
    await Promise.all(waits);
    // Let styles apply + layout settle before capture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    return await toPngBlob(clone);
  } finally {
    iframe.remove();
  }
}

async function captureInline(node: HTMLElement): Promise<Blob> {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `position:fixed;left:-100000px;top:0;z-index:-1;background:${CAPTURE_BG};padding:20px;`;
  try {
    const clone = node.cloneNode(true) as HTMLElement;
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return await toPngBlob(clone);
  } finally {
    wrapper.remove();
  }
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
    if (cs.position === "sticky") el.style.position = "static";
  }
  root.querySelectorAll<HTMLElement>("table").forEach((t) => {
    t.style.width = "max-content";
  });
  root.style.width = "max-content";
  root.style.maxWidth = "none";
}
