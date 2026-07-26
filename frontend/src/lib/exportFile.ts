import { Capacitor } from "@capacitor/core";

/**
 * Save or share a generated file so it lands somewhere the user can use it —
 * email, text, or the device's files. Delivery differs by platform because the
 * primitives differ:
 *
 *   - Installed app (Capacitor native): `<a download>` and the Web Share API are
 *     no-ops in the plugin-less WebView, so write the blob to the cache and hand
 *     it to the OS share sheet via @capacitor/share (email / text / Save).
 *   - Mobile browser: the Web Share API (with a file) opens the native share
 *     sheet — the reliable way to save/share on a phone browser.
 *   - Desktop browser: a normal blob-URL download.
 *
 * Always ends in *something*; never a silent no-op.
 */
export async function exportFile(blob: Blob, filename: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await nativeShare(blob, filename);
      return;
    } catch (e) {
      // Fall through to the web paths if the native bridge/plugin is missing
      // (e.g. an old APK loading new web code during rollout).
      console.error("exportFile: native share failed, falling back", e);
    }
  }

  const file = new File([blob], filename, { type: mime });
  const coarse =
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(any-pointer: coarse)").matches || window.matchMedia("(pointer: coarse)").matches);
  if (
    coarse &&
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user dismissed
      // else fall through to a plain download
    }
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function nativeShare(blob: Blob, filename: string): Promise<void> {
  // Loaded dynamically so the plugin code only enters the bundle path used in
  // the native app.
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const base64 = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: filename, files: [uri], dialogTitle: "Share report" });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res); // strip data: prefix
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
