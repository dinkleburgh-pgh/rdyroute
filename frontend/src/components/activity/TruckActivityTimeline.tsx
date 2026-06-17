import { useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import clsx from "clsx";
import { useActivityEvents } from "../../api/hooks";
import ActivityEventCard from "./ActivityEventCard";
import { UserAvatar } from "../management/RoleBadge";
import { STATUS_BG, STATUS_LABELS, STATUS_TEXT } from "../../constants/truckStatus";
import type { ActivityEvent, TruckStatus } from "../../types";

// Group consecutive events by the same human actor.
// System events (actor_type === "system" or no username) break groups.
export interface EventGroup {
  key: string;
  actor_username: string;
  actor_display_name: string | null;
  actor_role: string | null;
  events: ActivityEvent[];
}

export function groupActivityEvents(events: ActivityEvent[]): (ActivityEvent | EventGroup)[] {
  const result: (ActivityEvent | EventGroup)[] = [];
  let current: EventGroup | null = null;

  for (const ev of events) {
    const isHuman = ev.actor_type !== "system" && !!ev.actor_username;
    if (!isHuman) {
      if (current) { result.push(current); current = null; }
      result.push(ev);
      continue;
    }
    if (current && current.actor_username === ev.actor_username) {
      current.events.push(ev);
    } else {
      if (current) result.push(current);
      current = {
        key: `group-${ev.id}`,
        actor_username: ev.actor_username!,
        actor_display_name: ev.actor_display_name,
        actor_role: ev.actor_role,
        events: [ev],
      };
    }
  }
  if (current) result.push(current);
  return result;
}

function isGroup(item: ActivityEvent | EventGroup): item is EventGroup {
  return "events" in item;
}

function StatusArrow({ before, after }: { before: string | null; after: string | null }) {
  const isStatus = (v: string | null): v is TruckStatus => !!v && v in STATUS_LABELS;
  if (!before && !after) return null;
  return (
    <span className="flex items-center gap-1">
      {before && (
        <span className={clsx("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          isStatus(before) ? clsx(STATUS_BG[before], STATUS_TEXT[before]) : "bg-slate-700 text-slate-200")}>
          {isStatus(before) ? STATUS_LABELS[before] : before}
        </span>
      )}
      {before && after && <span className="text-slate-600 text-[10px]">→</span>}
      {after && (
        <span className={clsx("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          isStatus(after) ? clsx(STATUS_BG[after], STATUS_TEXT[after]) : "bg-slate-700 text-slate-200")}>
          {isStatus(after) ? STATUS_LABELS[after] : after}
        </span>
      )}
    </span>
  );
}

export function ActivityGroup({ group, compact }: { group: EventGroup; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const first = group.events[0];
  const last = group.events[group.events.length - 1];
  const timeSpan = group.events.length > 1
    ? `${format(parseISO(last.occurred_at), "p")} – ${format(parseISO(first.occurred_at), "p")}`
    : format(parseISO(first.occurred_at), compact ? "Pp" : "PPpp");

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-slate-800/40 rounded-xl"
      >
        <UserAvatar
          name={group.actor_display_name || group.actor_username}
          username={group.actor_username}
          size={compact ? 34 : 38}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {group.actor_display_name || group.actor_username}
            </span>
            <span className="rounded bg-slate-700/70 px-1.5 py-0.5 text-xs font-semibold text-slate-300">
              {group.events.length} actions
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{timeSpan}</p>
          {/* Quick summary of the group when collapsed */}
          {!open && (
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {group.events.map((e) => e.summary).join(" · ")}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs font-semibold text-blue-400 ml-2">
          {open ? "Hide ▲" : "Show ▼"}
        </span>
      </button>

      {/* Expanded events */}
      {open && (
        <div className="border-t border-slate-800 space-y-0 divide-y divide-slate-800/60 px-3 pb-2">
          {group.events.map((ev) => (
            <div key={ev.id} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-200">{ev.summary}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500">
                    {format(parseISO(ev.occurred_at), "p")}
                  </span>
                  <StatusArrow before={ev.status_before} after={ev.status_after} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TruckActivityTimeline({
  truckNumber,
  limit = 20,
}: {
  truckNumber: number;
  limit?: number;
}) {
  const { data, isLoading } = useActivityEvents({ truckNumber, limit, offset: 0 });
  const items = data?.items ?? [];
  const grouped = groupActivityEvents(items);

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
          {grouped.map((item) =>
            isGroup(item) && item.events.length > 1 ? (
              <ActivityGroup key={item.key} group={item} compact />
            ) : isGroup(item) ? (
              <ActivityEventCard key={item.events[0].id} event={item.events[0]} compact />
            ) : (
              <ActivityEventCard key={item.id} event={item} compact />
            )
          )}
        </div>
      )}
    </section>
  );
}
