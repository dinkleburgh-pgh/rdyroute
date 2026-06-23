import { X } from "lucide-react";
import OffDaySchedulePanel from "./management/OffDaySchedulePanel";

export default function CalendarFab({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-xl bg-slate-900 shadow-2xl md:max-h-[85svh] md:min-w-[32rem] md:max-w-3xl"
        style={{ width: "calc(100vw - 2rem)", margin: "0.5rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">Fleet Schedule</span>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <div className="overflow-x-auto p-4 scrollbar-thin">
            <OffDaySchedulePanel compact />
          </div>
          {/* Bouncing right-edge indicator */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-900/80 to-transparent animate-bounce-edge md:hidden" />
        </div>
      </div>
      <style>{`@keyframes bounce-edge { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.9; } } .animate-bounce-edge { animation: bounce-edge 1.5s ease-in-out 4; } .scrollbar-thin::-webkit-scrollbar { height: 4px; } .scrollbar-thin::-webkit-scrollbar-track { background: transparent; } .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.3); border-radius: 2px; }`}</style>
    </div>
  );
}