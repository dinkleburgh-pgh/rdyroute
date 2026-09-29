/**
 * Run Report archive pieces: the "Saved 5:58 AM" header pill, the Saved/Live
 * strip under a past day's date bar, and the Archive list modal. Pure
 * presentation apart from the list query — the page owns the date, the view
 * and the capture mutation, and hands them in.
 */
import clsx from "clsx";
import { Archive } from "lucide-react";
import Modal from "../../components/Modal";
import EmptyState from "../../components/EmptyState";
import { useReportArchiveList, type ReportArchiveItem, type ReportArchiveSource } from "../../api/hooks";
import { APP_TIMEZONE, formatEasternTime, formatRunDate, isoDate } from "../../utils/dates";

const SOURCE_LABEL: Record<ReportArchiveSource, string> = {
  auto: "at shift end",
  "catch-up": "caught up late",
  manual: "saved by hand",
};

/** What each source means, for the saved strip. */
const SOURCE_NOTE: Record<ReportArchiveSource, string> = {
  auto: "As it stood when 3rd shift ended",
  "catch-up": "Saved late — the server was down at 5:58 AM",
  manual: "Saved by hand",
};

/** Eastern calendar date (YYYY-MM-DD) of an ISO instant. */
function easternDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

/**
 * When a snapshot was taken, as short as it can be read unambiguously: just
 * "5:58 AM" on the morning after its run date (the schedule), with the date
 * when it was taken any other day. `withDate` always includes it — for the
 * PDF, which is read away from the page.
 */
export function savedAtLabel(item: Pick<ReportArchiveItem, "run_date" | "captured_at">, withDate = false): string {
  const time = formatEasternTime(new Date(item.captured_at));
  const day = easternDay(item.captured_at);
  if (!withDate && day === dayAfter(item.run_date)) return time;
  const date = formatRunDate(day);
  // Same year as the run day reads fine without it.
  return `${day.slice(0, 4) === item.run_date.slice(0, 4) ? date.replace(/, \d{4}$/, "") : date}, ${time}`;
}

function weekdayOf(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

/** Header pill for a day shown from its snapshot — the saved twin of the LIVE pill. */
export function SavedPill({ item }: { item: ReportArchiveItem }) {
  return (
    <span
      title={`Saved ${savedAtLabel(item, true)} · ${SOURCE_LABEL[item.source]}${item.app_version ? ` · ${item.app_version}` : ""}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300"
    >
      <Archive className="h-3 w-3" aria-hidden />
      Saved {savedAtLabel(item)}
    </span>
  );
}

function CaptureButton({
  archived,
  busy,
  onCapture,
  className,
}: {
  archived: boolean;
  busy: boolean;
  onCapture: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onCapture}
      disabled={busy}
      className={clsx(
        "shrink-0 rounded-lg border border-hairline bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-soft active:scale-95 disabled:opacity-50",
        className,
      )}
    >
      {busy ? "Saving…" : archived ? "Re-save" : "Save this day now"}
    </button>
  );
}

/**
 * The strip under a PAST day's date bar: which reading of the day is on screen
 * (Saved/Live toggle when a snapshot exists, else a muted "not archived"
 * note), plus Save/Re-save for admins.
 */
export function ArchiveStrip({
  snapshot,
  lookupFailed,
  lookupPending,
  saved,
  onViewChange,
  canArchive,
  capturing,
  onCapture,
}: {
  snapshot: ReportArchiveItem | null;
  /** The archive lookup itself failed (not "no snapshot"). */
  lookupFailed: boolean;
  /** No answer yet — still asking, or paused offline. */
  lookupPending: boolean;
  saved: boolean;
  onViewChange: (view: "saved" | "live") => void;
  canArchive: boolean;
  capturing: boolean;
  onCapture: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-hairline bg-surface/40 px-3 py-1.5 md:px-6">
      {snapshot ? (
        <>
          <div role="group" aria-label="Which version of the day" className="flex shrink-0 rounded-lg border border-hairline bg-surface-2 p-0.5">
            {(["saved", "live"] as const).map((v) => {
              const on = (v === "saved") === saved;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onViewChange(v)}
                  className={clsx(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition",
                    on ? "bg-blue-600 text-white" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {v === "saved" ? "Saved" : "Live"}
                </button>
              );
            })}
          </div>
          <span className="min-w-0 text-xs text-ink-muted">
            {saved ? SOURCE_NOTE[snapshot.source] : "Live — recomputed from today's data, which may have changed since"}
          </span>
        </>
      ) : (
        <span className="min-w-0 text-xs text-ink-muted">
          {lookupFailed
            ? "Couldn't reach the archive — showing current data"
            : lookupPending
              ? "Checking the archive — showing current data"
              : "Not archived — showing current data"}
        </span>
      )}
      {canArchive && (
        <CaptureButton archived={snapshot != null} busy={capturing} onCapture={onCapture} className="ml-auto" />
      )}
    </div>
  );
}

function SummaryChip({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-pill border border-hairline bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
      <span className={clsx("font-mono font-semibold tabular-nums", tone ?? "text-ink")}>{value.toLocaleString()}</span>
      {label}
    </span>
  );
}

/**
 * Archived run days, newest first — tap one to open it saved. Mounted only
 * while open, so the list is fetched only when someone looks.
 */
export function ArchiveModal({
  onClose,
  selectedDate,
  selectedIsToday,
  selectedArchived: snapshotSaysArchived,
  selectedUnknown,
  onOpenDay,
  canArchive,
  capturing,
  onCapture,
}: {
  onClose: () => void;
  /** The day the page is on — highlighted, and the one Save/Re-save acts on. */
  selectedDate: string;
  selectedIsToday: boolean;
  /** The page's own lookup found a snapshot for the day. */
  selectedArchived: boolean;
  /** The page's lookup hasn't answered (loading, offline, failed). */
  selectedUnknown: boolean;
  onOpenDay: (runDate: string) => void;
  canArchive: boolean;
  capturing: boolean;
  /** `archived`: the list shows the day saved even if the page's lookup doesn't yet. */
  onCapture: (archived: boolean) => void;
}) {
  const list = useReportArchiveList();
  const items = list.data ?? [];
  // Either source knowing the day is archived is enough; only a lookup that
  // answered "not archived" (and a list that agrees) makes it plain "Save".
  const selectedArchived = snapshotSaysArchived || items.some((it) => it.run_date === selectedDate);
  const selectedKnown = selectedArchived || !selectedUnknown;

  return (
    <Modal open onClose={onClose} title="Archived reports" size="lg" sheet bodyClassName="">
      <p className="px-5 pt-3 text-xs text-ink-muted">
        Each run day is saved at 5:58 AM, when 3rd shift ends. Open one to read the report as it stood then.
      </p>
      {list.isLoading ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted" role="status">Loading…</p>
      ) : list.isError ? (
        <EmptyState
          className="px-5"
          action={<button type="button" className="btn-ghost" onClick={() => void list.refetch()}>Try again</button>}
        >
          Couldn&apos;t load the archive.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState className="px-5">No archived reports yet — the first is saved at 5:58 AM when 3rd shift ends.</EmptyState>
      ) : (
        <ul className="mt-2 divide-y divide-hairline border-t border-hairline">
          {items.map((it) => {
            const s = it.summary;
            return (
              <li key={it.run_date}>
                <button
                  type="button"
                  onClick={() => onOpenDay(it.run_date)}
                  aria-current={it.run_date === selectedDate ? "true" : undefined}
                  className={clsx(
                    "flex w-full flex-col gap-1.5 px-5 py-3 text-left transition-colors hover:bg-surface-2/60",
                    it.run_date === selectedDate && "bg-surface-2/60",
                  )}
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-sm font-semibold text-ink">
                      {weekdayOf(it.run_date)}, {formatRunDate(it.run_date)}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      Saved {savedAtLabel(it)} · {SOURCE_LABEL[it.source]}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <SummaryChip value={s.routes_covered} label="routes covered" />
                    <SummaryChip value={s.qty_short} label="qty short" tone={s.qty_short > 0 ? "text-red-400" : undefined} />
                    <SummaryChip value={s.trucks_loaded} label="trucks loaded" />
                    <SummaryChip value={s.trucks_timed} label="trucks timed" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canArchive && !selectedIsToday && selectedKnown && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-5 py-3">
          <span className="text-xs text-ink-muted">
            {formatRunDate(selectedDate)} {selectedArchived ? "is archived." : "isn't archived yet."}
          </span>
          <CaptureButton archived={selectedArchived} busy={capturing} onCapture={() => onCapture(selectedArchived)} />
        </div>
      )}
    </Modal>
  );
}
