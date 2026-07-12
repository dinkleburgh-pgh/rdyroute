import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, type ComponentType } from "react";
import { Wrench, Calculator, StickyNote, CalendarDays } from "lucide-react";
import { useLocation } from "react-router-dom";
import DraggableFab from "./DraggableFab";
import CalculatorFab from "./CalculatorFab";
import CalendarFab from "./CalendarFab";
import NoteCardsDrawer from "./NoteCardsDrawer";
import { useSettings } from "../api/hooks";

interface Tool {
  id: string;
  label: string;
  bg: string;
  Icon: ComponentType<{ className?: string }>;
}

const TOOLS: Tool[] = [
  { id: "calculator", label: "Calc",  bg: "bg-sky-600",     Icon: Calculator },
  { id: "notes",      label: "Notes", bg: "bg-violet-600",  Icon: StickyNote },
  { id: "calendar",   label: "Sched", bg: "bg-emerald-600", Icon: CalendarDays },
];

export default function ToolFab() {
  const { data: settings } = useSettings();
  const [wheelOpen, setWheelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const location = useLocation();

  // Close wheel when navigating so the fixed overlay never blocks a new page
  useEffect(() => {
    setWheelOpen(false);
  }, [location.pathname]);
  const fabRef = useRef<HTMLDivElement>(null);
  const [fabRect, setFabRect] = useState<DOMRect | null>(null);
  const fabPosRef = useRef<{ right: number; bottom: number } | null>(null);

  const updateFabRect = useCallback(() => {
    if (fabRef.current) setFabRect(fabRef.current.getBoundingClientRect());
  }, []);

  const settingsMap = useMemo(
    () => settings ? new Map(settings.map((s) => [s.key, s.value])) : new Map(),
    [settings],
  );
  // All three tools are opt-in (=== true): the FAB only appears once at least
  // one is explicitly enabled, and never during the settings-loading window.
  const calcEnabled = settingsMap.get("calculator_fab_enabled") === true;
  const notesEnabled = settingsMap.get("note_cards_enabled") === true;
  const calEnabled = settingsMap.get("calendar_fab_enabled") === true;

  const enabledTools = useMemo(
    () => TOOLS.filter((t) =>
      (t.id === "calculator" && calcEnabled) ||
      (t.id === "notes" && notesEnabled) ||
      (t.id === "calendar" && calEnabled)
    ),
    [calcEnabled, notesEnabled, calEnabled],
  );

  useLayoutEffect(() => {
    if (wheelOpen) updateFabRect();
  }, [wheelOpen, updateFabRect]);

  // Close wheel when tapping outside the FAB or orbit buttons — no backdrop so scrolling is never blocked
  useEffect(() => {
    if (!wheelOpen) return;
    const handler = (e: PointerEvent) => {
      if (fabRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest?.("[data-wheel-btn]")) return;
      setWheelOpen(false);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [wheelOpen]);

  if (enabledTools.length === 0) return null;

  function openPanel(id: string) {
    setWheelOpen(false);
    setActivePanel((prev) => prev === id ? null : id);
  }

  function closePanel() {
    setActivePanel(null);
  }

  const count = enabledTools.length;
  const arcAngle = Math.min(160, count * 50);
  const startAngle = -(arcAngle / 2);
  const r = 55;

  return (
    <>
      <CalculatorFab open={activePanel === "calculator"} onClose={closePanel} />
      <CalendarFab open={activePanel === "calendar"} onClose={closePanel} />
      <NoteCardsDrawer open={activePanel === "notes"} onClose={closePanel} />

      <DraggableFab
        storageKey="tool"
        defaultRight={16}
        defaultBottom={100}
        onMove={updateFabRect}
        onClick={() => { updateFabRect(); setWheelOpen((o) => !o); }}
      >
        <div ref={fabRef} className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-white shadow-lg shadow-slate-900/40 ring-2 ring-slate-600/50 transition-all hover:bg-slate-700 hover:scale-110 active:scale-95 cursor-pointer">
          <Wrench className="h-6 w-6" />
        </div>
      </DraggableFab>

      {wheelOpen && (
        <>
          {fabRect && enabledTools.map((tool, i) => {
            const angle = startAngle + (arcAngle * i) / (count - 1 || 1);
            const rad = (angle * Math.PI) / 180;
            const cx = fabRect.left + fabRect.width / 2;
            const cy = fabRect.top + fabRect.height / 2;
            const bx = cx + Math.sin(rad) * r - 24;
            const by = cy - Math.cos(rad) * r - 24;
            // Keep within viewport
            const clampedX = Math.max(8, Math.min(window.innerWidth - 56, bx));
            const clampedY = Math.max(8, Math.min(window.innerHeight - 56, by));
            return (
              <button
                key={tool.id}
                data-wheel-btn
                onClick={() => openPanel(tool.id)}
                className={`${tool.bg} fixed z-[70] flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all hover:scale-110 active:scale-95 ${activePanel === tool.id ? "ring-4 ring-white/50 scale-110" : ""}`}
                style={{
                  left: clampedX,
                  top: clampedY,
                  animation: `popIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.04}s both`,
                }}
              >
                <tool.Icon className="h-5 w-5" />
              </button>
            );
          })}
          <style>{`@keyframes popIn { from { opacity: 0; transform: scale(0.3); } to { opacity: 1; transform: scale(1); } }`}</style>
        </>
      )}
    </>
  );
}