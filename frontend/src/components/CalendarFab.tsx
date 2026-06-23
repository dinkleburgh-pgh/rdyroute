import { useState } from "react";
import { X } from "lucide-react";
import OffDaySchedulePanel from "./management/OffDaySchedulePanel";

export default function CalendarFab({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-xl bg-slate-900 shadow-2xl max-h-[85svh] md:min-w-[32rem] md:max-w-3xl"
        style={{ width: "calc(100vw - 2rem)", margin: "0.5rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">Fleet Schedule</span>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 scrollbar-thin">
          <OffDaySchedulePanel compact={!expanded} />
        </div>
        {/* Bouncing right-edge arrow — fixed in viewport */}
        <button onClick={() => setExpanded((e) => !e)} className="fixed top-1/2 z-[66] -translate-y-1/2 md:hidden right-2">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 shadow-lg border border-slate-700 transition-all ${expanded ? "opacity-0 pointer-events-none" : "animate-bounce-slide"}`}>
            <span className="text-lg font-bold text-slate-400">&rarr;</span>
          </div>
        </button>
        {expanded && (
          <button onClick={() => setExpanded(false)} className="fixed top-1/2 z-[66] -translate-y-1/2 md:hidden left-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 shadow-lg border border-slate-700 animate-bounce-slide">
              <span className="text-lg font-bold text-slate-400">&larr;</span>
            </div>
          </button>
        )}
      </div>
      <style>{`@keyframes bounce-slide { 0%, 100% { transform: translateX(0) scale(1); } 50% { transform: translateX(-8px) scale(1.15); } } .animate-bounce-slide { animation: bounce-slide 0.8s ease-in-out 5; } .scrollbar-thin::-webkit-scrollbar { width: 4px; height: 4px; } .scrollbar-thin::-webkit-scrollbar-track { background: transparent; } .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.3); border-radius: 2px; }`}</style>
    </div>
  );
}