/**
 * Development tools — day-number override for holiday runs. Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useLoadDayOverride, useSetLoadDayOverride, useSetUnloadsDayOverride, useSyncProductionData, useUnloadsDayOverride } from "../../api/hooks";
import { todayIso } from "../../api/client";
import { formatRunDate } from "../../utils/dates";
import { workdayNumbers } from "../../components/Clock";
import ConfirmDialog from "../ConfirmDialog";
import { useToast } from "../../contexts/ToastContext";
import { FieldRow } from "./shared";

const DAY_NAMES: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" };

export default function DevelopmentPanel() {
  const toast = useToast();
  const [runDate, setRunDate] = useState(todayIso());
  const { data: loadOverride = null }    = useLoadDayOverride(runDate);
  const { data: unloadsOverride = null } = useUnloadsDayOverride(runDate);
  const setLoadOverride    = useSetLoadDayOverride();
  const setUnloadsOverride = useSetUnloadsDayOverride();
  const syncProductionData = useSyncProductionData();
  const [draftLoad, setDraftLoad]       = useState("");
  const [draftUnloads, setDraftUnloads] = useState("");
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);

  useEffect(() => {
    setDraftLoad(loadOverride    != null ? String(loadOverride)    : "");
    setDraftUnloads(unloadsOverride != null ? String(unloadsOverride) : "");
  }, [loadOverride, unloadsOverride, runDate]);

  const currentHost = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.hostname;
  }, []);
  const isLoopbackHost = useMemo(() => {
    if (currentHost === "localhost" || currentHost === "127.0.0.1" || currentHost === "::1") return true;
    // Allow private-LAN access (e.g. http://192.168.1.212:5180 from another device).
    // Public hostnames like rdyroute.app never match these ranges, so prod stays blocked.
    return (
      /^10\.(\d{1,3}\.){2}\d{1,3}$/.test(currentHost) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(currentHost) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(currentHost)
    );
  }, [currentHost]);

  const [yr, mo, dy] = runDate.split("-").map(Number);
  const computedNums = workdayNumbers(new Date(yr, mo - 1, dy, 12));
  const isPending = setLoadOverride.isPending || setUnloadsOverride.isPending;
  const hasActive = loadOverride != null || unloadsOverride != null;

  function apply() {
    const ld = parseInt(draftLoad,   10);
    const ud = parseInt(draftUnloads, 10);
    if (draftLoad    !== "" && ld >= 1 && ld <= 5) setLoadOverride.mutate({    runDate, value: ld });
    if (draftUnloads !== "" && ud >= 1 && ud <= 5) setUnloadsOverride.mutate({ runDate, value: ud });
  }

  function clearAll() {
    setLoadOverride.mutate({    runDate, value: null });
    setUnloadsOverride.mutate({ runDate, value: null });
    setDraftLoad("");
    setDraftUnloads("");
  }

  function startProductionSync() {
    syncProductionData.mutate(undefined, {
      onSuccess: (result) => {
        const runDateText = result.run_dates.length ? result.run_dates.join(", ") : "no run dates";
        toast.success(`Synced local dev data from production for ${runDateText}.`);
        if (result.warnings.length) {
          toast.info(result.warnings[0]);
        }
      },
      onError: (error: unknown) => {
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        toast.error(detail ?? "Production sync failed.");
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
        ⚠ These tools override the route-day logic used by Run Day, Load, and Unload pages.
        Only apply overrides during holiday runs when the system is computing the wrong day.
        Clear them once the holiday run is complete.
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">Day Number Override</h3>
        <p className="text-xs text-slate-500">
          Overrides the load-day and unloads-day numbers used to filter which trucks appear on the
          Run Day, Load, and Unload pages.
        </p>

        <FieldRow label="Run date">
          <input type="date" className="input" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
        </FieldRow>

        <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-800/50 p-3 text-sm">
          <div>
            <p className="mb-1 text-xs text-slate-500">Computed load day</p>
            <p className="font-semibold text-white">{DAY_NAMES[computedNums.loadDay]} ({computedNums.loadDay})</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Computed unloads day</p>
            <p className="font-semibold text-white">{DAY_NAMES[computedNums.unloadsDay]} ({computedNums.unloadsDay})</p>
          </div>
        </div>

        {hasActive && (
          <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-3 py-2 text-xs text-amber-300">
            Overrides active for {formatRunDate(runDate)}
            {loadOverride    != null && ` · Load → ${DAY_NAMES[loadOverride]} (${loadOverride})`}
            {unloadsOverride != null && ` · Unloads → ${DAY_NAMES[unloadsOverride]} (${unloadsOverride})`}
          </div>
        )}

        <FieldRow label="Override load day">
          <select className="input" value={draftLoad} onChange={(e) => setDraftLoad(e.target.value)}>
            <option value="">— no override —</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{DAY_NAMES[n]} ({n})</option>)}
          </select>
        </FieldRow>

        <FieldRow label="Override unloads day">
          <select className="input" value={draftUnloads} onChange={(e) => setDraftUnloads(e.target.value)}>
            <option value="">— no override —</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{DAY_NAMES[n]} ({n})</option>)}
          </select>
        </FieldRow>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={isPending || (draftLoad === "" && draftUnloads === "")} onClick={apply}>
            {isPending ? "Saving…" : "Apply overrides"}
          </button>
          <button className="btn-ghost" disabled={isPending || !hasActive} onClick={clearAll}>
            Clear overrides
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-300">Production Mirror Sync</h3>
          <p className="mt-1 text-xs text-slate-500">
            Pulls the live production export into this local database so the dev app can inspect the day using real data.
            This replaces the local operational snapshot and is hard-blocked unless the app is reached over loopback or a private LAN address.
          </p>
        </div>

        <div className="grid gap-3 rounded-lg bg-slate-800/50 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="mb-1 text-xs text-slate-500">Current host</p>
            <p className="font-semibold text-white">{currentHost || "unknown"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Sync allowed</p>
            <p className={`font-semibold ${isLoopbackHost ? "text-emerald-300" : "text-amber-300"}`}>
              {isLoopbackHost ? "Yes" : "No"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Source</p>
            <p className="truncate font-mono text-xs text-slate-300">
              {syncProductionData.data?.source ?? "https://rdyroute.app/api/exports"}
            </p>
          </div>
        </div>

        {!isLoopbackHost && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            Disabled because this page is not running from localhost / 127.0.0.1 / ::1 or a private LAN address.
          </div>
        )}

        {syncProductionData.data && (
          <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/20 px-3 py-3 text-xs text-emerald-200">
            <p className="font-semibold text-emerald-300">Last sync summary</p>
            <p className="mt-1">
              Run dates: {syncProductionData.data.run_dates.length ? syncProductionData.data.run_dates.join(", ") : "none"}
            </p>
            <p className="mt-1">
              Imported: {Object.entries(syncProductionData.data.summary).map(([key, value]) => `${value} ${key.replace(/_/g, " ")}`).join(", ")}
            </p>
            {syncProductionData.data.warnings.length > 0 && (
              <p className="mt-1 text-amber-300">
                Warnings: {syncProductionData.data.warnings.join(" · ")}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={!isLoopbackHost || syncProductionData.isPending}
            onClick={() => setConfirmSyncOpen(true)}
          >
            {syncProductionData.isPending ? "Syncing…" : "Sync from live production"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSyncOpen}
        title="Replace local data with the live production snapshot?"
        description="This overwrites the local operational tables used by development so you can inspect what happened in production. Production itself will not be modified."
        confirmLabel={syncProductionData.isPending ? "Syncing…" : "Sync now"}
        busy={syncProductionData.isPending}
        onConfirm={() => {
          setConfirmSyncOpen(false);
          startProductionSync();
        }}
        onCancel={() => setConfirmSyncOpen(false)}
      />
    </div>
  );
}
