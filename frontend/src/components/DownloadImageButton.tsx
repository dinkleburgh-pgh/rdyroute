import { useState, type RefObject } from "react";
import { toBlob } from "html-to-image";
import { Download } from "lucide-react";
import clsx from "clsx";
import { exportFile } from "../lib/exportFile";

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
      const blob = await captureNode(node);
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
    // <base> so any relative url() inside the CSS still resolves to the app.
    idoc.write(`<!doctype html><html><head><base href="${location.origin}/"></head><body></body></html>`);
    idoc.close();
    // Carry over theme classes so the app's utilities resolve inside the frame.
    idoc.documentElement.className = document.documentElement.className;
    idoc.documentElement.style.background = CAPTURE_BG;
    idoc.body.className = document.body.className;
    idoc.body.style.cssText = `margin:0;padding:20px;background:${CAPTURE_BG};width:max-content`;

    // Inject the app's CSS as TEXT read from the live stylesheets, rather than
    // cloning <link>/<style> nodes. A cloned <link> loads asynchronously inside
    // the frame and can race the capture — prod ships one /assets/*.css LINK
    // (dev uses inline <style>), so on prod the frame captured before styles
    // applied and fell back to the narrow mobile layout. Text is synchronous.
    const styleEl = idoc.createElement("style");
    styleEl.textContent = collectCssText();
    idoc.head.appendChild(styleEl);

    const clone = node.cloneNode(true) as HTMLElement;
    idoc.body.appendChild(clone);
    // Let layout settle before capture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    return await toPngBlob(clone);
  } finally {
    iframe.remove();
  }
}

/** Concatenate the text of every readable (same-origin) stylesheet so it can be
 *  injected into the capture frame synchronously. Cross-origin sheets throw on
 *  .cssRules and are skipped — the app's own CSS is same-origin. */
function collectCssText(): string {
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = undefined;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) css += rule.cssText + "\n";
  }
  return css;
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
