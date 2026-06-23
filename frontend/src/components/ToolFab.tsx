import { useState, useMemo } from "react";
import { Wrench } from "lucide-react";
import DraggableFab from "./DraggableFab";
import CalculatorFab from "./CalculatorFab";
import CalendarFab from "./CalendarFab";
import NoteCardsDrawer from "./NoteCardsDrawer";
import { useSettings } from "../api/hooks";

interface Tool {
  id: string;
  label: string;
  color: string;
  bg: string;
}

const TOOLS: Tool[] = [
  { id: "calculator", label: "Calc",  color: "text-sky-400", bg: "bg-sky-600" },
  { id: "notes",      label: "Notes", color: "text-violet-400", bg: "bg-violet-600" },
  { id: "calendar",   label: "Sched", color: "text-emerald-400", bg: "bg-emerald-600" },
];

export default function ToolFab() {
  const { data: settings } = useSettings();
  const [wheelOpen, setWheelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);

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

  if (enabledTools.length === 0) return null;

  function openPanel(id: string) {
    setWheelOpen(false);
    setActivePanel(id);
  }

  function closePanel() {
    setActivePanel(null);
  }

  return (
    <>
      <CalculatorFab open={activePanel === "calculator"} onClose={closePanel} />
      <CalendarFab open={activePanel === "calendar"} onClose={closePanel} />
      <NoteCardsDrawer open={activePanel === "notes"} onClose={closePanel} />

      <DraggableFab storageKey="tool" defaultRight={16} defaultBottom={100} onClick={() => setWheelOpen((o) => !o)}>
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-white shadow-lg shadow-slate-900/40 ring-2 ring-slate-600/50 transition-all hover:bg-slate-700 hover:scale-110 active:scale-95">
          <Wrench className="h-6 w-6" />
        </div>
      </DraggableFab>

      {wheelOpen && (
        <>
          <div className="fixed inset-0 z-[69]" onClick={() => setWheelOpen(false)} />
          <div className="fixed bottom-36 right-4 z-[70] flex flex-col-reverse items-center gap-3">
            {enabledTools.map((tool, i) => (
              <button
                key={tool.id}
                onClick={() => openPanel(tool.id)}
                className={`${tool.bg} flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all hover:scale-110 active:scale-95`}
                style={{ animation: `fadeIn 0.2s ease-out ${i * 0.05}s both` }}
              >
                <span className="text-[8px] font-bold uppercase leading-tight text-center">{tool.label}</span>
              </button>
            ))}
          </div>
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px) scale(0.8); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
        </>
      )}
    </>
  );
}