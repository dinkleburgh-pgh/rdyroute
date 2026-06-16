import { Link } from "react-router-dom";
import { useActivityEvents } from "../../api/hooks";
import ActivityEventCard from "./ActivityEventCard";

export default function TruckActivityTimeline({
  truckNumber,
  limit = 12,
}: {
  truckNumber: number;
  limit?: number;
}) {
  const { data, isLoading } = useActivityEvents({
    truckNumber,
    limit,
    offset: 0,
  });
  const items = data?.items ?? [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Recent activity ({items.length})
        </h4>
        <Link
          to={`/management?group=data&tab=history_activity&truck=${truckNumber}`}
          className="text-xs font-semibold text-blue-300 hover:text-blue-200"
        >
          View full history
        </Link>
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Loading history…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No tracked activity yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((event) => (
            <ActivityEventCard key={event.id} event={event} compact />
          ))}
        </div>
      )}
    </section>
  );
}
