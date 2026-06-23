import { useState, useRef, useCallback, type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  storageKey: string;
  defaultX?: number;
  defaultY?: number;
  onClick: () => void;
  children: ReactNode;
}

export default function DraggableFab({ storageKey, defaultX = 16, defaultY = 16, onClick, children }: Props) {
  const { user } = useAuth();
  const lsKey = `fab_pos_${storageKey}_${user?.username ?? "anon"}`;

  const [pos] = useState(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
    } catch { return null; }
  });

  const dragRef = useRef<{
    startX: number; startY: number;
    elX: number; elY: number;
    dragged: boolean;
  } | null>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  const savePos = useCallback((x: number, y: number) => {
    try { localStorage.setItem(lsKey, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch { }
  }, [lsKey]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = fabRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      elX: rect.left, elY: rect.top,
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
      el.style.left = (dragRef.current.elX + dx) + "px";
      el.style.top = (dragRef.current.elY + dy) + "px";
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !fabRef.current) return;
    const el = fabRef.current;
    const x = parseFloat(el.style.left) || drag.elX;
    const y = parseFloat(el.style.top) || drag.elY;
    savePos(x, y);
    if (!drag.dragged) {
      onClick();
    }
  }, [savePos, onClick]);

  return (
    <div
      ref={fabRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="fixed z-50 touch-none select-none"
      style={{
        left: pos ? `${pos.x}px` : `${defaultX}px`,
        top: pos ? `${pos.y}px` : `${defaultY}px`,
      }}
    >
      {children}
    </div>
  );
}