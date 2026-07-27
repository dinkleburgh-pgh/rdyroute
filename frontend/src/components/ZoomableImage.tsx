import { useEffect, useRef } from "react";

/**
 * An <img> with gesture-driven zoom/pan, for the inline document viewer.
 * Because the viewer is a fixed full-screen overlay inside an installed PWA,
 * the browser's native pinch-to-zoom doesn't apply to it — so we handle the
 * gestures ourselves via pointer events:
 *   • pinch (two fingers) to zoom around the pinch centre, panning as it moves
 *   • one-finger drag to pan while zoomed in
 *   • double-tap / double-click to toggle between fit and ~2.5×
 *   • mouse wheel to zoom around the cursor (desktop)
 * The transform is applied imperatively (no re-render per frame).
 */

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30; // px between taps to still count as a double-tap
const ZOOM_IN_SCALE = 2.5;

type XY = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function ZoomableImage({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Live transform (kept in a ref so gestures don't trigger React re-renders).
  const tf = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef<Map<number, XY>>(new Map());
  const pinch = useRef<{ dist: number; scale: number; x: number; y: number; mid: XY } | null>(null);
  const pan = useRef<{ start: XY; orig: XY } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const moved = useRef(false);

  const apply = () => {
    const el = imgRef.current;
    if (!el) return;
    const s = tf.current;
    el.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
  };

  const reset = () => {
    tf.current = { scale: 1, x: 0, y: 0 };
    apply();
  };

  // Keep the (scaled) image box covering the frame so it can't be lost off-screen.
  const clampTranslate = () => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const s = tf.current;
    s.x = clamp(s.x, width * (1 - s.scale), 0);
    s.y = clamp(s.y, height * (1 - s.scale), 0);
  };

  const rectPoint = (clientX: number, clientY: number): XY => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  // Zoom to `newScale` while keeping the content under `focal` stationary.
  const zoomAt = (focal: XY, newScale: number) => {
    const s = tf.current;
    const ns = clamp(newScale, MIN_SCALE, MAX_SCALE);
    const cx = (focal.x - s.x) / s.scale;
    const cy = (focal.y - s.y) / s.scale;
    s.scale = ns;
    s.x = focal.x - ns * cx;
    s.y = focal.y - ns * cy;
    clampTranslate();
    apply();
  };

  const toggleZoom = (focal: XY) => {
    if (tf.current.scale > 1.05) reset();
    else zoomAt(focal, ZOOM_IN_SCALE);
  };

  // Reset zoom whenever the source changes (e.g. original -> preview fallback,
  // or a different document opened into the same viewer).
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Wheel zoom needs a non-passive listener to call preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(rectPoint(e.clientX, e.clientY), tf.current.scale * Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = rectPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = tf.current;
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: s.scale, x: s.x, y: s.y, mid };
      pan.current = null;
    } else if (pointers.current.size === 1 && tf.current.scale > 1) {
      pan.current = { start: { x: e.clientX, y: e.clientY }, orig: { x: tf.current.x, y: tf.current.y } };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const curMid = rectPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const g = pinch.current;
      const ns = clamp(g.scale * (dist / g.dist), MIN_SCALE, MAX_SCALE);
      // Content point that was under the gesture's starting midpoint.
      const cx = (g.mid.x - g.x) / g.scale;
      const cy = (g.mid.y - g.y) / g.scale;
      const s = tf.current;
      s.scale = ns;
      s.x = curMid.x - ns * cx; // follow the fingers so a two-finger drag pans too
      s.y = curMid.y - ns * cy;
      clampTranslate();
      apply();
      moved.current = true;
      return;
    }

    if (pan.current) {
      const s = tf.current;
      s.x = pan.current.orig.x + (e.clientX - pan.current.start.x);
      s.y = pan.current.orig.y + (e.clientY - pan.current.start.y);
      clampTranslate();
      apply();
      moved.current = true;
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    if (pointers.current.size === 1) {
      // Hand the remaining finger a pan session so pinch -> pan is seamless.
      const pos = [...pointers.current.values()][0];
      pan.current = tf.current.scale > 1 ? { start: { ...pos }, orig: { x: tf.current.x, y: tf.current.y } } : null;
      return;
    }

    if (pointers.current.size === 0) {
      pan.current = null;
      // Double-tap to toggle zoom (touch/pen only — mouse uses onDoubleClick).
      if (!moved.current && e.pointerType !== "mouse") {
        const p = rectPoint(e.clientX, e.clientY);
        const prev = lastTap.current;
        if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) < DOUBLE_TAP_SLOP) {
          toggleZoom(p);
          lastTap.current = null;
        } else {
          lastTap.current = { t: e.timeStamp, x: p.x, y: p.y };
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      // Swallow clicks so gestures never close the viewer's backdrop.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        toggleZoom(rectPoint(e.clientX, e.clientY));
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      className="relative h-full w-full overflow-hidden"
      style={{ touchAction: "none" }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onError={onError}
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-contain"
        style={{ transformOrigin: "0 0", willChange: "transform" }}
      />
    </div>
  );
}
