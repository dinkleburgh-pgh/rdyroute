/**
 * Fleet-schedule dialog for the Off board (extracted from Board.tsx) — review
 * run/off days without leaving the page.
 */
import Modal from "../../components/Modal";
import { X } from "lucide-react";
import OffDaySchedulePanel from "../../components/management/OffDaySchedulePanel";

export default function OffBoardScheduleDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="xl" bodyClassName="p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">Fleet Schedule</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Review route truck run and off days without leaving the off board.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-soft"
            aria-label="Close schedule dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto">
          <OffDaySchedulePanel />
        </div>
          </Modal>
  );
}
