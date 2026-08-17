import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { playChime, primeAudio } from "../../utils/chime";
import {
  TOAST_DEFAULTS,
  TOAST_KIND_LABELS,
  TOAST_SETTINGS_KEY,
  useUpsertSetting,
  type ToastKind,
  type ToastKindConfig,
} from "../../api/hooks";
import { useToast } from "../../contexts/ToastContext";
import { asBool, FieldRow, SaveButton } from "./shared";

/**
 * Pop-up alerts — the slide-in cards, one row per kind.
 *
 * They were previously a single on/off switch with durations hardcoded in
 * Layout, which is too blunt: these alerts aren't equally urgent. A chat
 * message can flick past; a truck going out of service should sit there until
 * someone acknowledges it. Each kind now carries its own dwell time, and
 * 0 seconds means it stays until dismissed.
 *
 * Saved as one `toast_settings` document plus the existing
 * `realtime_toasts_enabled` master switch, so the master keeps working for
 * anything that reads it directly.
 */

const KINDS = Object.keys(TOAST_DEFAULTS) as ToastKind[];

/** Presets covering how these are actually used, so nobody has to reason in
 *  seconds for the common cases. */
const PRESETS: { label: string; seconds: number }[] = [
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "2m", seconds: 120 },
  { label: "7m", seconds: 420 },
];

function describe(seconds: number): string {
  if (seconds <= 0) return "stays until dismissed";
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} minute${m === 1 ? "" : "s"}` : `${m}m ${s}s`;
}

export default function ToastsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const toast = useToast();

  const initial = useMemo(() => {
    const raw = map.get(TOAST_SETTINGS_KEY);
    const kinds = { ...TOAST_DEFAULTS };
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!(k in TOAST_DEFAULTS) || !v || typeof v !== "object") continue;
        const cfg = v as Partial<ToastKindConfig>;
        const secs = Number(cfg.seconds);
        kinds[k as ToastKind] = {
          enabled: cfg.enabled !== false,
          seconds: Number.isFinite(secs) && secs >= 0 ? secs : TOAST_DEFAULTS[k as ToastKind].seconds,
          sound: typeof cfg.sound === "boolean" ? cfg.sound : TOAST_DEFAULTS[k as ToastKind].sound === true,
        };
      }
    }
    return {
      enabled: asBool(map.get("realtime_toasts_enabled"), true),
      kinds,
    };
  }, [map]);

  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function setKind(kind: ToastKind, patch: Partial<ToastKindConfig>) {
    setForm((f) => ({ ...f, kinds: { ...f.kinds, [kind]: { ...f.kinds[kind], ...patch } } }));
  }

  async function save() {
    if (form.enabled !== initial.enabled) {
      await upsert.mutateAsync({ key: "realtime_toasts_enabled", value: form.enabled });
    }
    if (JSON.stringify(form.kinds) !== JSON.stringify(initial.kinds)) {
      await upsert.mutateAsync({ key: TOAST_SETTINGS_KEY, value: form.kinds });
    }
  }

  return (
    <div className="card">
      <FieldRow
        label="Pop-up alerts"
        hint="Master switch. Off means nothing pops, whatever the per-alert settings below say. The board and pages still update in real time; only the slide-in cards are affected."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Show pop-up alerts
        </label>
      </FieldRow>

      <div className={clsx("mt-2", !form.enabled && "opacity-50")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Per alert
        </p>
        <p className="mb-2 text-xs text-slate-500">
          How long each kind stays on screen. Set 0 seconds to make one stay until it's
          dismissed — use that for anything that must be acknowledged.
        </p>

        <div className="space-y-2">
          {KINDS.map((kind) => {
            const cfg = form.kinds[kind];
            const meta = TOAST_KIND_LABELS[kind];
            return (
              <div
                key={kind}
                className={clsx(
                  "rounded-lg border px-3 py-2.5 transition-colors",
                  cfg.enabled ? "border-slate-700 bg-slate-900/60" : "border-slate-800 bg-slate-900/20",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      disabled={!form.enabled}
                      onChange={(e) => setKind(kind, { enabled: e.target.checked })}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-200">{meta.label}</span>
                      <span className="block text-xs leading-snug text-slate-500">{meta.hint}</span>
                    </span>
                  </label>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      className="input w-20 py-1 text-right text-sm tabular-nums"
                      value={cfg.seconds}
                      disabled={!form.enabled || !cfg.enabled}
                      onChange={(e) => {
                        const n = Math.max(0, Math.min(3600, Number(e.target.value) || 0));
                        setKind(kind, { seconds: n });
                      }}
                    />
                    <span className="w-32 text-xs text-slate-500">{describe(cfg.seconds)}</span>
                    {/* Only kinds whose DEFAULT defines a sound offer the
                        checkbox — a chime on chat messages would be noise. */}
                    {TOAST_DEFAULTS[kind].sound !== undefined && (
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={cfg.sound === true}
                          disabled={!form.enabled || !cfg.enabled}
                          onChange={(e) => setKind(kind, { sound: e.target.checked })}
                        />
                        Sound
                      </label>
                    )}
                  </div>
                </div>

                {/* Presets + a sticky shortcut, so the common choices are one tap. */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      disabled={!form.enabled || !cfg.enabled}
                      onClick={() => setKind(kind, { seconds: p.seconds })}
                      className={clsx(
                        "rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40",
                        cfg.seconds === p.seconds
                          ? "border-blue-500 bg-blue-900/50 text-blue-100"
                          : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!form.enabled || !cfg.enabled}
                    onClick={() => setKind(kind, { seconds: 0 })}
                    className={clsx(
                      "rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40",
                      cfg.seconds === 0
                        ? "border-amber-500 bg-amber-900/50 text-amber-100"
                        : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500",
                    )}
                  >
                    Until dismissed
                  </button>
                  <button
                    type="button"
                    disabled={!form.enabled}
                    onClick={() => {
                      // The click is itself the priming gesture, so an admin
                      // can verify the chime actually plays on this device.
                      if (cfg.sound) { primeAudio(); playChime(); }
                      toast.info(`This is how a "${meta.label}" alert looks.`, {
                        title: meta.label,
                        durationMs: cfg.seconds * 1000,
                      });
                    }}
                    className="ml-auto rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] font-semibold text-slate-400 transition-colors hover:border-slate-500 disabled:opacity-40"
                  >
                    Preview
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}
