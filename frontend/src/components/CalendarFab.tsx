import { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import OffDaySchedulePanel from "./management/OffDaySchedulePanel";
import { workdayNumbers } from "./Clock";
import { useFleet } from "../api/hooks";
import { isScheduledOff } from "../utils/truckStatus";

export default function CalendarFab({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { data: fleet } = useFleet(false);
  const { loadDay, unloadsDay } = workdayNumbers();

  const routeTrucks = (fleet ?? []).filter((t) => t.truck_type !== "Spare");
  const runningToday = routeTrucks.filter((t) => !isScheduledOff(t, loadDay)).length;
  const unloadingToday = routeTrucks.filter((t) => !isScheduledOff(t, unloadsDay)).length;

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

        {!expanded ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
            <div className="text-center space-y-2">
              <p className="text-2xl font-black text-blue-400">Day {loadDay}</p>
              <p className="text-sm text-slate-400">{runningToday} route trucks running today</p>
            </div>
            <div className="text-center space-y-2">
              <p className="text-2xl font-black text-emerald-400">Day {unloadsDay}</p>
              <p className="text-sm text-slate-400">{unloadingToday} route trucks unloading</p>
            </div>
            <button
              onClick={() => setExpanded(true)}
              className="mt-4 flex animate-bounce items-center gap-2 rounded-full bg-slate-800 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-700"
            >
              <ChevronDown className="h-5 w-5" />
              Tap to expand full schedule
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <OffDaySchedulePanel />
          </div>
        )}
      </div>
    </div>
  );
}