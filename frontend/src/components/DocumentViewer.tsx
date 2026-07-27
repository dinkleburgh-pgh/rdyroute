import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, ExternalLink } from "lucide-react";
import { documentFileUrl, type DocumentItem } from "../api/hooks";

/**
 * Full-screen inline viewer for a document. Images render as <img>, PDFs in an
 * <iframe> (browser's built-in PDF viewer; cookie-auth works same-origin), and
 * anything else falls back to a download prompt. Close via the ✕, the backdrop,
 * or Escape. Header keeps Open-in-new-tab + Download.
 */
export default function DocumentViewer({ doc, onClose }: { doc: DocumentItem | null; onClose: () => void }) {
  const [imgErr, setImgErr] = useState(false);

  // Reset the image-error state whenever the viewed doc changes.
  useEffect(() => { setImgErr(false); }, [doc?.id]);

  // Escape to close + lock background scroll while open.
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  if (!doc) return null;
  const url = documentFileUrl(doc.id);
  const mime = doc.mime_type;
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 p-2 sm:p-4" onClick={onClose}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2 text-white" onClick={stop}>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={doc.title}>{doc.title}</p>
        <a href={url} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" title="Open in new tab">
          <ExternalLink className="h-4 w-4" />
        </a>
        <a href={url} download={doc.file_name} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" title="Download">
          <Download className="h-4 w-4" />
        </a>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" title="Close (Esc)">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body — clicking the padding closes; the content itself does not */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {isImage && !imgErr ? (
          <img
            src={url}
            alt={doc.title}
            onClick={stop}
            onError={() => setImgErr(true)}
            className="max-h-full max-w-full rounded object-contain shadow-2xl"
          />
        ) : isPdf ? (
          <iframe src={url} title={doc.title} onClick={stop} className="h-full w-full rounded bg-white" />
        ) : (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center" onClick={stop}>
            <p className="mb-1 text-sm text-slate-300">
              {isImage ? "This image can't be previewed here." : "This file type can't be previewed inline."}
            </p>
            <p className="mb-4 text-xs text-slate-500">{doc.file_name}</p>
            <div className="flex justify-center gap-2">
              <a href={url} download={doc.file_name} className="btn-primary inline-flex items-center">
                <Download className="mr-1 h-4 w-4" /> Download
              </a>
              <a href={url} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center">
                <ExternalLink className="mr-1 h-4 w-4" /> Open in new tab
              </a>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
