import { Calendar } from "lucide-react";
import DraggableFab from "./DraggableFab";

export default function CalendarFab() {
  return (
    <DraggableFab storageKey="calendar" defaultRight={16} defaultBottom={220} onClick={() => window.open("/fleet-schedule", "_blank")}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 transition-all hover:bg-emerald-500 hover:scale-110 active:scale-95">
        <Calendar className="h-5 w-5" />
      </div>
    </DraggableFab>
  );
}