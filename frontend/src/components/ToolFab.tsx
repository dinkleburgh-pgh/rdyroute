import { useState, useMemo, useRef, useEffect } from "react";
import { Wrench } from "lucide-react";
import DraggableFab from "./DraggableFab";
import CalculatorFab from "./CalculatorFab";
import CalendarFab from "./CalendarFab";
import NoteCardsDrawer from "./NoteCardsDrawer";
import { useSettings } from "../api/hooks";

interface Tool {
  id: string;
  label: string;
  bg: string;
}

const TOOLS: Tool[] = [
  { id: "calculator", label: "Calc",  bg: "bg-sky-600" },
  { id: "notes",      label: "Notes", bg: "bg-violet-600" },
  { id: "calendar",   label: "Sched", bg: "bg-emerald-600" },
];

export default function ToolFab() {
  const { data: settings } = useSettings();
  const [wheelOpen, setWheelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const fabRef = useRef<HTMLDivElement>(null);
  const [fabRect, setFabRect] = useState<DOMRect | null>(null);

  const settingsMap = useMemo(
    () => settings ? new Map(settings.map((s) => [s.key, s.value])) : new Map(),
    [settings],
  );
  const calcEnabled = settingsMap.get("calculator_fab_enabled") !== false;
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

  useEffect(() => {
    if (wheelOpen && fabRef.current) {
      setFabRect(fabRef.current.getBoundingClientRect());
    }
  }, [wheelOpen]);

  if (enabledTools.length === 0) return null;

  function openPanel(id: string) {
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

      <DraggableFab storageKey="tool" defaultRight={16} defaultBottom={100}>
        <div ref={fabRef} onClick={() => setWheelOpen((o) => !o)} className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-white shadow-lg shadow-slate-900/40 ring-2 ring-slate-600/50 transition-all hover:bg-slate-700 hover:scale-110 active:scale-95 cursor-pointer">
          <Wrench className="h-6 w-6" />
        </div>
      </DraggableFab>

      {wheelOpen && (
        <>
          <div className="fixed inset-0 z-[69]" onClick={() => setWheelOpen(false)} />
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
                onClick={() => openPanel(tool.id)}
                className={`${tool.bg} fixed z-[70] flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all hover:scale-110 active:scale-95`}
                style={{
                  left: clampedX,
                  top: clampedY,
                  animation: `popIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.04}s both`,
                }}
              >
                <span className="text-[8px] font-bold uppercase leading-tight text-center">{tool.label}</span>
              </button>
            );
          })}
          <style>{`@keyframes popIn { from { opacity: 0; transform: scale(0.3); } to { opacity: 1; transform: scale(1); } }`}</style>
        </>
      )}
    </>
  );
}