import { Capacitor } from "@capacitor/core";

/**
 * Save a generated file so it lands somewhere the user can use it. Delivery
 * differs by platform because the primitives differ:
 *
 *   - Installed app (Capacitor native): `<a download>` is a no-op in the
 *     plugin-less WebView, so write the blob to the cache and hand it to the
 *     OS share sheet via @capacitor/share (email / text / Save).
 *   - Any browser (desktop OR tablet/phone): a plain blob-URL download. This
 *     used to open the Web Share sheet on coarse-pointer devices, but the
 *     crew's tablets want the FILE in Downloads, not a share dialog — and
 *     modern mobile browsers handle `<a download>` on blob URLs fine.
 *
 * Always ends in *something*; never a silent no-op.
 */
export async function exportFile(blob: Blob, filename: string, _mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await nativeShare(blob, filename);
      return;
    } catch (e) {
      // Fall through to the web path if the native bridge/plugin is missing
      // (e.g. an old APK loading new web code during rollout).
      console.error("exportFile: native share failed, falling back", e);
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
  // Revoke LATE. Chrome only starts writing the file after the user answers
  // any "Save as" dialog — revoking the blob URL while that dialog sits open
  // (the old 15s timer) strands the download as a dead .pdf.crdownload.
  // Holding a few-MB blob for 10 minutes costs nothing, and leaving the page
  // frees it regardless.
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
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
