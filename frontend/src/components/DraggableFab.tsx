import { useState, useRef, useCallback, type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  storageKey: string;
  defaultRight?: number;
  defaultBottom?: number;
  onClick: () => void;
  children: ReactNode;
}

export default function DraggableFab({ storageKey, defaultRight = 16, defaultBottom = 16, onClick, children }: Props) {
  const { user } = useAuth();
  const lsKey = `fab_pos_${storageKey}_${user?.username ?? "anon"}`;

  const [pos] = useState(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? (JSON.parse(raw) as { right: number; bottom: number }) : null;
    } catch { return null; }
  });

  const dragRef = useRef<{
    startX: number; startY: number;
    elRight: number; elBottom: number;
    dragged: boolean;
  } | null>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  const savePos = useCallback((right: number, bottom: number) => {
    try { localStorage.setItem(lsKey, JSON.stringify({ right: Math.round(right), bottom: Math.round(bottom) })); } catch { }
  }, [lsKey]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = fabRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      elRight: window.innerWidth - rect.right,
      elBottom: window.innerHeight - rect.bottom,
      dragged: false,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.dragged = true;
    const el = fabRef.current;
    if (el) {
      el.style.right = (dragRef.current.elRight - dx) + "px";
      el.style.bottom = (dragRef.current.elBottom - dy) + "px";
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !fabRef.current) return;
    const el = fabRef.current;
    const right = parseFloat(el.style.right) || drag.elRight;
    const bottom = parseFloat(el.style.bottom) || drag.elBottom;
    savePos(right, bottom);
    if (!drag.dragged) onClick();
  }, [savePos, onClick]);

  return (
    <div
      ref={fabRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="fixed z-50 touch-none select-none"
      style={{
        right: pos ? `${pos.right}px` : `${defaultRight}px`,
        bottom: pos ? `${pos.bottom}px` : `${defaultBottom}px`,
      }}
    >
      {children}
    </div>
  );
}