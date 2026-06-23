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
        className="flex flex-col rounded-xl border-2 border-sky-500/50 bg-slate-900 shadow-2xl shadow-sky-500/20 animate-pulse-border md:max-h-[85svh] md:min-w-[32rem] md:max-w-3xl"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "calc(100vw - 2rem)", margin: "0.5rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">Fleet Schedule</span>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <OffDaySchedulePanel />
        </div>
      </div>
      <style>{`@keyframes pulse-border { 0%, 100% { border-color: rgba(56,189,248,0.3); box-shadow: 0 0 15px rgba(56,189,248,0.1); } 50% { border-color: rgba(56,189,248,0.7); box-shadow: 0 0 25px rgba(56,189,248,0.25); } } .animate-pulse-border { animation: pulse-border 2s ease-in-out 3; }`}</style>
    </div>
  );
}