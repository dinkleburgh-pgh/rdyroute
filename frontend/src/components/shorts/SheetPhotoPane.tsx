/**
 * SheetPhotoPane — the photographed shortage sheet, pinned beside the keyboard.
 *
 * Paper mode exists to transcribe a sheet, but the photo of that sheet lived in
 * the Import sheets tab, so transcribing meant flipping between tabs or reading
 * from a second device. This puts the page you are reading next to the cells you
 * are typing into.
 *
 * Photos are the ones already attached to the day's sheet-import records, so
 * nothing new is uploaded or stored here. An import created just to carry a
 * photo can sit in `needs_review` forever — it never has to be approved for the
 * photo to be useful, because the quantities are saved by the Sheet editor
 * itself, not by the import's approval path.
 *
 * Automatic extraction is deliberately not attempted. Locating cells on these
 * photos was tried at length and does not work (see tools/sheet_dewarp.py for
 * the dead ends); a human reading the page is the reliable path, so the job
 * here is only to make the page easy to read.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  shortageSheetPhotoFileUrl,
  useShortageSheetImport,
  useShortageSheetImports,
} from "../../api/hooks";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.5;

export default function SheetPhotoPane({
  runDate,
  onOpenImports,
  className,
}: {
  runDate: string;
  onOpenImports?: () => void;
  className?: string;
}) {
  const { data: imports = [], isLoading } = useShortageSheetImports({ runDate });

  // Only imports that actually carry a photo are worth offering as a source.
  const withPhotos = useMemo(
    () => imports.filter((imp) => imp.photo_count > 0),
    [imports],
  );

  const [importId, setImportId] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState(true);

  // Default to the newest import with a photo, and follow the date.
  useEffect(() => {
    setImportId((current) =>
      current && withPhotos.some((imp) => imp.id === current) ? current : withPhotos[0]?.id ?? null,
    );
  }, [withPhotos]);

  const detail = useShortageSheetImport(importId);
  const photos = detail.data?.photos ?? [];

  // A different import (or date) means a different page set; start at its first.
  useEffect(() => {
    setPhotoIdx(0);
    setZoom(1);
  }, [importId]);

  const photo = photos[Math.min(photoIdx, Math.max(0, photos.length - 1))];

  // Drag-to-pan. At zoom 1 the image fits the width and there is nothing to pan,
  // so the handlers simply do nothing rather than being conditionally attached.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const start = drag.current;
    if (!el || !start) return;
    el.scrollLeft = start.left - (e.clientX - start.x);
    el.scrollTop = start.top - (e.clientY - start.y);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    scrollRef.current?.releasePointerCapture(e.pointerId);
  };

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
      >
        <span className={clsx("transition", open ? "rotate-90" : "rotate-0")}>▸</span>
        Sheet photo
      </button>
      {open && photos.length > 1 && (
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            disabled={photoIdx <= 0}
            onClick={() => setPhotoIdx((i) => Math.max(0, i - 1))}
          >
            ‹
          </button>
          <span className="tabular-nums">
            {photoIdx + 1}/{photos.length}
          </span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            disabled={photoIdx >= photos.length - 1}
            onClick={() => setPhotoIdx((i) => Math.min(photos.length - 1, i + 1))}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className={clsx("overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60", className)}>
      {header}

      {!open ? null : isLoading || (importId && detail.isLoading) ? (
        <p className="px-3 py-6 text-sm text-slate-500">Loading the day's sheet photo…</p>
      ) : !photo ? (
        <div className="space-y-2 px-3 py-6">
          <p className="text-sm text-slate-500">No sheet photo uploaded for {runDate}.</p>
          {onOpenImports && (
            <button
              type="button"
              onClick={onOpenImports}
              className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500"
            >
              Upload one in Import sheets
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              >
                −
              </button>
              <span className="w-12 text-center text-xs tabular-nums text-slate-400">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              >
                +
              </button>
              {zoom > MIN_ZOOM && (
                <button
                  type="button"
                  className="ml-1 rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
                  onClick={() => setZoom(MIN_ZOOM)}
                >
                  Fit
                </button>
              )}
            </div>
            <a
              href={shortageSheetPhotoFileUrl(photo.id)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Full size ↗
            </a>
          </div>

          {withPhotos.length > 1 && (
            <div className="border-b border-hairline px-3 py-1.5">
              <select
                className="input w-full py-1 text-xs"
                value={importId ?? ""}
                onChange={(e) => setImportId(e.target.value || null)}
              >
                {withPhotos.map((imp) => (
                  <option key={imp.id} value={imp.id}>
                    {imp.photo_count} photo{imp.photo_count === 1 ? "" : "s"} · uploaded by{" "}
                    {imp.uploaded_by_username || "unknown"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            ref={scrollRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={clsx(
              "max-h-[70vh] overflow-auto bg-slate-950/60",
              zoom > MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "",
            )}
          >
            <img
              src={shortageSheetPhotoFileUrl(photo.id)}
              alt={photo.file_name}
              draggable={false}
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              className="block select-none"
            />
          </div>
          <p className="truncate border-t border-hairline px-3 py-1.5 text-[11px] text-slate-500">
            {photo.file_name}
          </p>
        </>
      )}
    </div>
  );
}
