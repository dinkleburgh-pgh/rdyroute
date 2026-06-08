/**
 * Updates panel — git-based update checker and deploy trigger. Extracted from Settings.tsx.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  useCheckForUpdate,
  useTriggerUpdate,
  useUpdateStatus,
  useUpsertSetting,
} from "../../api/hooks";
import { FieldRow, SaveButton } from "./shared";

const DEFAULT_COMMAND = "python3 /app/docker_resolve.py portainer_redeploy";

export default function UpdatesPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const trigger = useTriggerUpdate();
  const { data: status, isLoading: statusLoading } = useUpdateStatus();
  const { data: check, isFetching: checkFetching, refetch: recheckNow } = useCheckForUpdate();

  const savedCommand = String(map.get("update_deploy_command") ?? DEFAULT_COMMAND);
  const [command, setCommand] = useState(savedCommand);
  useEffect(() => setCommand(savedCommand), [savedCommand]);
  const commandDirty = command !== savedCommand;

  const isRunning = status?.running === true || trigger.isPending;

  function shortSha(sha: string | null | undefined) {
    return sha ? sha.slice(0, 7) : "unknown";
  }

  const updateAvailable = check?.update_available === true;
  const upToDate = check && !check.update_available && !check.check_error;

  return (
    <div className="space-y-4">
      {/* Update status banner */}
      <div className={clsx(
        "flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
        updateAvailable
          ? "border-amber-600 bg-amber-950/40 text-amber-200"
          : upToDate
            ? "border-emerald-700 bg-emerald-950/40 text-emerald-200"
            : "border-slate-700 bg-slate-800/50 text-slate-300",
      )}>
        <div className="min-w-0">
          {checkFetching ? (
            <p className="text-sm">Checking for updates…</p>
          ) : check?.check_error ? (
            <p className="text-sm">Check failed: <span className="font-mono text-xs">{check.check_error}</span></p>
          ) : updateAvailable ? (
            <div>
              <p className="font-semibold">Update available</p>
              {check.remote_message && <p className="mt-0.5 truncate text-xs opacity-80">{check.remote_message}</p>}
              <p className="mt-0.5 font-mono text-xs opacity-70">
                {shortSha(check.local_sha)} → {shortSha(check.remote_sha)}
              </p>
            </div>
          ) : upToDate ? (
            <div>
              <p className="font-semibold">Up to date</p>
              <p className="mt-0.5 font-mono text-xs opacity-70">{shortSha(check.local_sha)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Version status unknown — no GIT_SHA in image</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-ghost text-xs" disabled={checkFetching} onClick={() => recheckNow()}>
            {checkFetching ? "Checking…" : "Check Now"}
          </button>
          {updateAvailable && (
            <button className="btn-primary text-sm" disabled={isRunning} onClick={() => trigger.mutate()}>
              {isRunning ? "Updating…" : "Update"}
            </button>
          )}
        </div>
      </div>

      {/* Last run status */}
      {!statusLoading && status?.last && Object.keys(status.last).length > 0 && (
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-slate-300">Last run</h3>
          <div className="space-y-1 text-xs text-slate-400">
            <p>
              State:{" "}
              <span className={clsx("font-semibold",
                (status.last.state as string) === "ok" ? "text-emerald-400" :
                (status.last.state as string) === "running" ? "text-blue-400" :
                (status.last.state as string) === "failed" ? "text-red-400" : "text-slate-300",
              )}>
                {isRunning ? "running" : String(status.last.state ?? "idle")}
              </span>
            </p>
            {Boolean(status.last.started_at) && <p>Started: {String(status.last.started_at)}</p>}
            {Boolean(status.last.finished_at) && <p>Finished: {String(status.last.finished_at)}</p>}
            {status.last.exit_code != null && <p>Exit code: {String(status.last.exit_code)}</p>}
            {Boolean(status.last.error) && <p className="text-red-400">Error: {String(status.last.error)}</p>}
            {Boolean(status.last.stderr_tail) && (
              <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-slate-900 p-2 font-mono text-xs text-red-300">
                {String(status.last.stderr_tail)}
              </pre>
            )}
            {Boolean(status.last.stdout_tail) && (
              <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-slate-900 p-2 font-mono text-xs text-slate-300">
                {String(status.last.stdout_tail)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Deploy command config */}
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Deploy command</h3>
        <FieldRow
          label="Command"
          hint="Runs inside the backend container when Update is triggered. Uses PORTAINER_URL / PORTAINER_API_KEY / PORTAINER_STACK_ID / PORTAINER_ENDPOINT_ID env vars."
        >
          <div className="space-y-1.5">
            <input
              className="input"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={DEFAULT_COMMAND}
            />
            {command !== DEFAULT_COMMAND && (
              <button
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                onClick={() => setCommand(DEFAULT_COMMAND)}
              >
                ↩ Reset to default
              </button>
            )}
          </div>
        </FieldRow>
        <SaveButton
          dirty={commandDirty}
          saving={upsert.isPending}
          onSave={() => upsert.mutateAsync({ key: "update_deploy_command", value: command.trim() || DEFAULT_COMMAND })}
          onRevert={() => setCommand(savedCommand)}
        />
      </div>
    </div>
  );
}
