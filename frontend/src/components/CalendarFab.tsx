import { useState } from "react";
import { Calendar, X } from "lucide-react";
import DraggableFab from "./DraggableFab";
import OffDaySchedulePanel from "./management/OffDaySchedulePanel";

export default function CalendarFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50 md:items-center md:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85svh] w-full flex-col rounded-t-2xl bg-slate-900 shadow-2xl md:max-w-3xl md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
              <span className="text-sm font-semibold text-slate-100">Fleet Schedule</span>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-500 hover:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <OffDaySchedulePanel />
            </div>
          </div>
        </div>
      )}

      <DraggableFab storageKey="calendar" defaultRight={16} defaultBottom={220} onClick={() => setOpen((o) => !o)}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 transition-all hover:bg-emerald-500 hover:scale-110 active:scale-95">
          <Calendar className="h-5 w-5" />
        </div>
      </DraggableFab>
    </>
  );
}