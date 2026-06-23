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
        className="flex h-full w-full flex-col bg-slate-900 shadow-2xl md:max-h-[85svh] md:max-w-3xl md:rounded-2xl"
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
    </div>
  );
}