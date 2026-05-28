import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  useAddTruck,
  useAuditEntries,
  useAuthRequests,
  useBoard,
  useBulkUpdateStatus,
  useResetWorkday,
  useSelectiveReset,
  useCensorWords,
  useLoadDayOverride,
  useSetLoadDayOverride,
  useUnloadsDayOverride,
  useSetUnloadsDayOverride,

  useChangePassword,
  useCreateNotice,
  useCreateUser,
  useDeleteNotice,
  useDeleteUser,
  useFleet,
  useNotices,
  usePaceAverage,
  usePurgeAbnormalDurations,
  useRecordLoadDuration,
  useRemoveTruck,
  useResolveAuthRequest,
  useSettings,
  useTrackedItems,
  useUpdateCensorWords,
  useUpdateNotice,
  useUpdateTrackedItems,
  useUpdateTruck,
  useUpdateUser,
  useUpsertSetting,
  useUpsertTruckState,
  useUsers,
} from "../api/hooks";
import type { TrackedItem } from "../api/hooks";
import { todayIso } from "../api/client";
import { workdayNumbers } from "../components/Clock";
import { useAuth } from "../contexts/AuthContext";
import type { AppSetting, AuthRole, NoticeSeverity, Truck, TruckStatus, TruckType, TruckWithState } from "../types";

/**
 * Structured settings UI — surfaces well-known V1 keys as proper form
 * controls and keeps a raw key/value editor under "Advanced" for everything
 * else (parity with V1 settings panel groupings).
 */

type Category =
  | "general"
  | "pace"
  | "colors"
  | "workflows"
  | "communications"
  | "users"
  | "fleet_mgmt"
  | "advanced"
  | "development"
  | "recovery"
  | "resets"
  | "requests"
  | "notices"
  | "items"
  | "roles"
  | "export_import"
  | "pdf_reports";

// Two-level navigation: Cards (groups) → Tabs (sub-categories)
type GroupId = "app" | "users" | "content" | "fleet" | "comms" | "ops" | "advanced" | "data";

interface CardGroup {
  id: GroupId;
  label: string;
  desc: string;
  accent: string;
  adminOnly?: true;
  tabs: { id: Category; label: string }[];
}

const CARD_GROUPS: CardGroup[] = [
  {
    id: "app",
    label: "App Settings",
    desc: "General, pace, and badge colors",
    accent: "border-sky-500",
    tabs: [
      { id: "general",   label: "General" },
      { id: "pace",      label: "Pace" },
      { id: "colors",    label: "Badge Colors" },
    ],
  },
  {
    id: "users",
    label: "Users & Access",
    desc: "Manage users, pending requests, and role reference",
    accent: "border-indigo-500",
    adminOnly: true,
    tabs: [
      { id: "users",    label: "Users" },
      { id: "requests", label: "Requests" },
      { id: "roles",    label: "Role Access" },
    ],
  },
  {
    id: "content",
    label: "Notices & Items",
    desc: "Team notices and audit checklist catalog",
    accent: "border-yellow-500",
    adminOnly: true,
    tabs: [
      { id: "notices", label: "Notices" },
      { id: "items",   label: "Tracked Items" },
    ],
  },
  {
    id: "fleet",
    label: "Fleet",
    desc: "Add, remove, and configure trucks in the fleet",
    accent: "border-teal-500",
    adminOnly: true,
    tabs: [{ id: "fleet_mgmt", label: "Fleet" }],
  },
  {
    id: "comms",
    label: "Communications",
    desc: "Manage censored words for the messaging system",
    accent: "border-pink-500",
    adminOnly: true,
    tabs: [{ id: "communications", label: "Censor Words" }],
  },
  {
    id: "ops",
    label: "Operations",
    desc: "Workflows, force-finish loads, bulk status changes, and workday resets",
    accent: "border-orange-500",
    tabs: [
      { id: "workflows", label: "Workflows" },
      { id: "recovery",  label: "Recovery" },
      { id: "resets",    label: "Resets" },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    desc: "Raw key/value settings editor",
    accent: "border-red-500",
    adminOnly: true,
    tabs: [
      { id: "advanced",    label: "Advanced" },
      { id: "development", label: "Development" },
    ],
  },
  {
    id: "data",
    label: "Data & Reports",
    desc: "Export / import backups, PDF day reports",
    accent: "border-emerald-500",
    adminOnly: true,
    tabs: [
      { id: "export_import", label: "Export & Import" },
      { id: "pdf_reports",   label: "PDF Reports" },
    ],
  },
];

const ALL_ROLES: AuthRole[] = [
  "admin", "fleet", "atl", "supervisor", "lead", "loader", "unloader", "guest",
];

const SEVERITIES: NoticeSeverity[] = ["info", "warn", "critical"];

const PAGE_ACCESS: { label: string; roles: Set<AuthRole> }[] = [
  { label: "Unload",       roles: new Set(["admin","fleet","atl","supervisor","lead","unloader"]) },
  { label: "Load",         roles: new Set(["admin","fleet","atl","supervisor","lead","loader"]) },
  { label: "Fleet",        roles: new Set(["admin","fleet","atl","supervisor","lead"]) },
  { label: "Communications", roles: new Set(["admin","fleet","atl","supervisor","lead","loader","unloader"]) },
  { label: "Short Sheet",  roles: new Set(["admin","fleet","atl","supervisor","lead"]) },
  { label: "Trends",       roles: new Set(["admin","fleet","atl","supervisor","lead"]) },
  { label: "Audit",        roles: new Set(["admin","fleet","atl","supervisor","lead","loader"]) },
  { label: "Management",   roles: new Set(["admin","fleet","atl","supervisor","lead"]) },
];

const RECOVERY_STATUS_OPTIONS: TruckStatus[] = [
  "dirty", "shop", "in_progress", "unloaded", "loaded", "off", "oos", "spare",
];

const RECOVERY_STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty", shop: "Shop", in_progress: "In Progress",
  unloaded: "Unloaded", loaded: "Loaded", off: "Off", oos: "OOS", spare: "Spare",
};

function formatRecoveryDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

const DEFAULT_BADGE_COLORS: Record<TruckStatus, string> = {
  dirty: "#dc2626",
  shop: "#7400ff",
  in_progress: "#f59e0b",
  unloaded: "#16a34a",
  loaded: "#2563eb",
  off: "#6b7280",
  oos: "#475569",
  spare: "#a855f7",
};

const STATUS_LABELS: Record<TruckStatus, string> = {
  dirty: "Dirty",
  shop: "Shop",
  in_progress: "In Progress",
  unloaded: "Unloaded",
  loaded: "Loaded",
  off: "Off",
  oos: "OOS",
  spare: "Spare",
};

const WELL_KNOWN_KEYS = new Set([
  "timezone_key",
  "ui_theme",
  "warn_seconds",
  "rollover_prompt_hour",
  "rollover_snooze_minutes",
  "auto_refresh_ms",
  "pace_avg_override_enabled",
  "pace_avg_override_seconds",
  "pace_buffer_base_seconds",
  "pace_buffer_per_truck_seconds",
  "pace_buffer_percent",
  "pace_loader_baseline_count",
  "pace_loader_active_count",
  "status_badge_colors",
  "skip_batching_disabled",
  "batching_disabled",
  "communications_censor_words",
]);

const HIDDEN_KEYS = new Set(["communications_censor_words"]);

export default function Management() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor";
  const isPrivileged = isAdmin || user?.role === "lead" || user?.role === "atl";
  const [activeGroup, setActiveGroup] = useState<GroupId | null>(null);
  const [activeTab, setActiveTab] = useState<Category>("general");
  const { data, isLoading } = useSettings();

  const map = useMemo(() => {
    const m = new Map<string, unknown>();
    (data ?? []).forEach((s) => m.set(s.key, s.value));
    return m;
  }, [data]);

  if (!isPrivileged) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-semibold">Management</h2>
        <p className="mt-4 text-sm text-slate-400">
          Access is restricted to Fleet / Supervisor / Lead / ATL roles.
        </p>
      </div>
    );
  }

  const visibleGroups = isAdmin
    ? CARD_GROUPS
    : CARD_GROUPS.filter((g) => !g.adminOnly);

  const activeGroupDef = activeGroup
    ? CARD_GROUPS.find((g) => g.id === activeGroup) ?? null
    : null;

  function renderPanel() {
    if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
    switch (activeTab) {
      case "general":        return <GeneralPanel map={map} />;
      case "pace":           return <PacePanel map={map} />;
      case "colors":         return <ColorsPanel map={map} />;
      case "workflows":      return <WorkflowsPanel map={map} />;
      case "advanced":       return <AdvancedPanel settings={data ?? []} />;
      case "development":    return <DevelopmentPanel />;
      case "communications": return <CommunicationsPanel />;
      case "users":          return <UsersPanel />;
      case "requests":       return <RequestsPanel disabled={!isAdmin} />;
      case "notices":        return <NoticesPanel disabled={!isAdmin} />;
      case "items":          return <ItemsPanel disabled={!isAdmin} />;
      case "roles":          return <RoleAccessPanel />;
      case "recovery":       return <RecoveryPanel />;
      case "resets":         return <ResetsPanel />;
      case "fleet_mgmt":     return <FleetManagementPanel />;
      case "export_import":  return <ExportImportPanel />;
      case "pdf_reports":    return <PDFReportsPanel />;
      default:               return null;
    }
  }

  return (
    <div className="space-y-4 p-3 md:p-6">
      <h2 className="text-2xl font-semibold">Management</h2>

      {/* Card group grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {visibleGroups.map((group) => {
          const isActive = activeGroup === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => {
                if (isActive) {
                  setActiveGroup(null);
                } else {
                  setActiveGroup(group.id);
                  setActiveTab(group.tabs[0].id);
                }
              }}
              className={clsx(
                "rounded-lg border border-slate-700 border-l-4 bg-slate-900 p-4 text-left transition hover:bg-slate-800",
                group.accent,
                isActive && "ring-1 ring-slate-400",
              )}
            >
              <p className="font-semibold text-slate-100">{group.label}</p>
              <p className="mt-1 text-xs text-slate-400">{group.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Sub-tab bar + panel (shown when a card is active) */}
      {activeGroupDef && (
        <div>
          <div className="flex gap-1 border-b border-slate-800">
            {activeGroupDef.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "border-b-2 border-blue-500 text-blue-300"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mt-4">{renderPanel()}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function asString(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-slate-800 py-3 sm:grid-cols-[260px_1fr] sm:items-center">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SaveButton({
  dirty,
  saving,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="mt-4 flex gap-2">
      <button className="btn-primary" disabled={!dirty || saving} onClick={onSave}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button className="btn-ghost" disabled={!dirty || saving} onClick={onRevert}>
        Revert
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function GeneralPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      timezone_key: asString(map.get("timezone_key"), "America/Chicago"),
      ui_theme: asString(map.get("ui_theme"), "dark"),
      warn_seconds: asNumber(map.get("warn_seconds"), 900),
      rollover_prompt_hour: asNumber(map.get("rollover_prompt_hour"), 6),
      rollover_snooze_minutes: asNumber(map.get("rollover_snooze_minutes"), 60),
      auto_refresh_ms: asNumber(map.get("auto_refresh_ms"), 120000),
      live_truck_styling: asBool(map.get("live_truck_styling"), true),
    }),
    [map],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    const tasks: Promise<unknown>[] = [];
    for (const [k, v] of Object.entries(form)) {
      if ((initial as Record<string, unknown>)[k] !== v) {
        tasks.push(upsert.mutateAsync({ key: k, value: v }));
      }
    }
    await Promise.all(tasks);
  }

  return (
    <div className="card">
      <FieldRow label="Timezone" hint="IANA name, e.g. America/Chicago">
        <input
          className="input"
          value={form.timezone_key}
          onChange={(e) => setForm({ ...form, timezone_key: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="UI theme">
        <select
          className="input"
          value={form.ui_theme}
          onChange={(e) => setForm({ ...form, ui_theme: e.target.value })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </FieldRow>
      <FieldRow
        label="Load warning threshold (minutes)"
        hint="When elapsed exceeds this, the in-progress card turns red."
      >
        <input
          type="number"
          min={1}
          className="input"
          value={Math.round(form.warn_seconds / 60)}
          onChange={(e) =>
            setForm({
              ...form,
              warn_seconds: Math.max(1, parseInt(e.target.value || "0", 10)) * 60,
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Rollover prompt hour"
        hint="0–23. When the shift opens past this hour the rollover prompt appears."
      >
        <input
          type="number"
          min={0}
          max={23}
          className="input"
          value={form.rollover_prompt_hour}
          onChange={(e) =>
            setForm({
              ...form,
              rollover_prompt_hour: Math.min(
                23,
                Math.max(0, parseInt(e.target.value || "0", 10)),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Rollover snooze (minutes)">
        <input
          type="number"
          min={1}
          className="input"
          value={form.rollover_snooze_minutes}
          onChange={(e) =>
            setForm({
              ...form,
              rollover_snooze_minutes: Math.max(1, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Auto refresh (ms)"
        hint="Default polling interval for board/status views."
      >
        <input
          type="number"
          min={500}
          step={500}
          className="input"
          value={form.auto_refresh_ms}
          onChange={(e) =>
            setForm({
              ...form,
              auto_refresh_ms: Math.max(500, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Enable live truck button styling"
        hint="Apply status-based colors to truck tiles and buttons on the board."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.live_truck_styling}
            onChange={(e) => setForm({ ...form, live_truck_styling: e.target.checked })}
          />
          Enabled
        </label>
      </FieldRow>
      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

function PacePanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      pace_avg_override_enabled: asBool(map.get("pace_avg_override_enabled"), false),
      pace_avg_override_seconds: asNumber(map.get("pace_avg_override_seconds"), 600),
      pace_buffer_base_seconds: asNumber(map.get("pace_buffer_base_seconds"), 180),
      pace_buffer_per_truck_seconds: asNumber(
        map.get("pace_buffer_per_truck_seconds"),
        25,
      ),
      pace_buffer_percent: asNumber(map.get("pace_buffer_percent"), 0.08),
      pace_loader_baseline_count: asNumber(map.get("pace_loader_baseline_count"), 2),
      pace_loader_active_count: asNumber(map.get("pace_loader_active_count"), 2),
    }),
    [map],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    const tasks: Promise<unknown>[] = [];
    for (const [k, v] of Object.entries(form)) {
      if ((initial as Record<string, unknown>)[k] !== v) {
        tasks.push(upsert.mutateAsync({ key: k, value: v }));
      }
    }
    await Promise.all(tasks);
  }

  return (
    <div className="card">
      <FieldRow
        label="Override rolling pace average"
        hint="When enabled, the override seconds value is used instead of the 30-day rolling average from load history."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.pace_avg_override_enabled}
            onChange={(e) =>
              setForm({ ...form, pace_avg_override_enabled: e.target.checked })
            }
          />
          Enabled
        </label>
      </FieldRow>
      <FieldRow label="Override seconds">
        <input
          type="number"
          min={30}
          max={7200}
          className="input"
          disabled={!form.pace_avg_override_enabled}
          value={form.pace_avg_override_seconds}
          onChange={(e) =>
            setForm({
              ...form,
              pace_avg_override_seconds: Math.max(
                30,
                parseInt(e.target.value || "0", 10),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Buffer — base seconds"
        hint="Fixed seconds added to every truck's estimated finish time."
      >
        <input
          type="number"
          min={0}
          className="input"
          value={form.pace_buffer_base_seconds}
          onChange={(e) =>
            setForm({
              ...form,
              pace_buffer_base_seconds: Math.max(0, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Buffer — per-truck seconds">
        <input
          type="number"
          min={0}
          className="input"
          value={form.pace_buffer_per_truck_seconds}
          onChange={(e) =>
            setForm({
              ...form,
              pace_buffer_per_truck_seconds: Math.max(
                0,
                parseInt(e.target.value || "0", 10),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Buffer — percent (0.0–1.0)">
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          className="input"
          value={form.pace_buffer_percent}
          onChange={(e) =>
            setForm({
              ...form,
              pace_buffer_percent: Math.max(
                0,
                Math.min(1, parseFloat(e.target.value || "0")),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Baseline loader count"
        hint="The crew size the historic pace average is normalised against."
      >
        <input
          type="number"
          min={1}
          className="input"
          value={form.pace_loader_baseline_count}
          onChange={(e) =>
            setForm({
              ...form,
              pace_loader_baseline_count: Math.max(
                1,
                parseInt(e.target.value || "0", 10),
              ),
            })
          }
        />
      </FieldRow>
      <FieldRow
        label="Active loader count"
        hint="Crew size on the floor right now; used to scale the estimate."
      >
        <input
          type="number"
          min={1}
          className="input"
          value={form.pace_loader_active_count}
          onChange={(e) =>
            setForm({
              ...form,
              pace_loader_active_count: Math.max(1, parseInt(e.target.value || "0", 10)),
            })
          }
        />
      </FieldRow>
      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge colors
// ---------------------------------------------------------------------------

function ColorsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const raw = map.get("status_badge_colors");
  const initial = useMemo<Record<TruckStatus, string>>(() => {
    const out: Record<TruckStatus, string> = { ...DEFAULT_BADGE_COLORS };
    if (raw && typeof raw === "object") {
      for (const k of Object.keys(out) as TruckStatus[]) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim())) {
          out[k] = v.trim();
        }
      }
    }
    return out;
  }, [raw]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    await upsert.mutateAsync({ key: "status_badge_colors", value: form });
  }

  return (
    <div className="card">
      {(Object.keys(STATUS_LABELS) as TruckStatus[]).map((k) => (
        <FieldRow key={k} label={STATUS_LABELS[k]}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              className="h-9 w-14 cursor-pointer rounded border border-slate-700 bg-slate-900"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
            <input
              className="input w-36 font-mono text-xs"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
            <span
              className="ml-2 rounded px-2 py-0.5 text-xs font-semibold text-white"
              style={{ background: form[k] }}
            >
              sample
            </span>
          </div>
        </FieldRow>
      ))}
      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

function WorkflowsPanel({ map }: { map: Map<string, unknown> }) {
  const upsert = useUpsertSetting();
  const initial = useMemo(
    () => ({
      batching_disabled: asBool(map.get("batching_disabled"), false),
      skip_batching_disabled: asBool(map.get("skip_batching_disabled"), false),
      batch_no_cap: asBool(map.get("batch_no_cap"), false),
    }),
    [map],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    const tasks: Promise<unknown>[] = [];
    for (const [k, v] of Object.entries(form)) {
      if ((initial as Record<string, unknown>)[k] !== v) {
        tasks.push(upsert.mutateAsync({ key: k, value: v }));
      }
    }
    await Promise.all(tasks);
  }

  return (
    <div className="card">
      <FieldRow
        label="Batching disabled"
        hint="Hide the Batches workflow entirely (mirrors V1 batching_disabled)."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.batching_disabled}
            onChange={(e) => setForm({ ...form, batching_disabled: e.target.checked })}
          />
          Hide Batches
        </label>
      </FieldRow>
      <FieldRow
        label="Skip batching disabled"
        hint="When set, loaders cannot bypass batch assignment before finishing a load."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.skip_batching_disabled}
            onChange={(e) =>
              setForm({ ...form, skip_batching_disabled: e.target.checked })
            }
          />
          Require batch
        </label>
      </FieldRow>
      <FieldRow
        label="No wearer cap"
        hint="Remove the 400-wearer batch capacity limit. Useful for holiday or overflow loads."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.batch_no_cap}
            onChange={(e) => setForm({ ...form, batch_no_cap: e.target.checked })}
          />
          No limit
        </label>
      </FieldRow>
      <SaveButton
        dirty={dirty}
        saving={upsert.isPending}
        onSave={save}
        onRevert={() => setForm(initial)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced — raw key/value editor (covers anything not surfaced above)
// ---------------------------------------------------------------------------

function AdvancedPanel({ settings }: { settings: AppSetting[] }) {
  const upsert = useUpsertSetting();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  async function save() {
    if (!key) return;
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // keep as raw string
    }
    await upsert.mutateAsync({ key, value: parsed });
    setKey("");
    setValue("");
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Upsert raw setting</h3>
        <p className="text-xs text-slate-500">
          For keys not surfaced on the other tabs. Value is parsed as JSON if possible,
          otherwise stored as a raw string.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Key</label>
            <input
              className="input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Value</label>
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>
        <button className="btn-primary" disabled={upsert.isPending || !key} onClick={save}>
          Save
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {settings.filter((s) => !HIDDEN_KEYS.has(s.key)).map((s) => (
              <tr
                key={s.key}
                className={clsx(
                  "border-t border-slate-800",
                  WELL_KNOWN_KEYS.has(s.key) && "opacity-60",
                )}
              >
                <td className="px-3 py-2 font-mono text-xs">{s.key}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">
                  {JSON.stringify(s.value)}
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {new Date(s.updated_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {settings.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={3}>
                  No settings stored.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">
          Dimmed rows are managed by the other tabs.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Development tools (holiday day-number override)
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri" };

function DevelopmentPanel() {
  const [runDate, setRunDate] = useState(todayIso());

  const { data: loadOverride = null }    = useLoadDayOverride(runDate);
  const { data: unloadsOverride = null } = useUnloadsDayOverride(runDate);
  const setLoadOverride    = useSetLoadDayOverride();
  const setUnloadsOverride = useSetUnloadsDayOverride();

  const [draftLoad, setDraftLoad]       = useState("");
  const [draftUnloads, setDraftUnloads] = useState("");

  // Sync drafts when fetched data or runDate changes
  useEffect(() => {
    setDraftLoad(loadOverride    != null ? String(loadOverride)    : "");
    setDraftUnloads(unloadsOverride != null ? String(unloadsOverride) : "");
  }, [loadOverride, unloadsOverride, runDate]);

  // Compute what the system would normally calculate for this date (midday avoids DST edge)
  const [yr, mo, dy] = runDate.split("-").map(Number);
  const computedNums = workdayNumbers(new Date(yr, mo - 1, dy, 12));

  const isPending = setLoadOverride.isPending || setUnloadsOverride.isPending;

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

  const hasActive = loadOverride != null || unloadsOverride != null;

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
          <input
            type="date"
            className="input"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
          />
        </FieldRow>

        <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-800/50 p-3 text-sm">
          <div>
            <p className="mb-1 text-xs text-slate-500">Computed load day</p>
            <p className="font-semibold text-white">
              {DAY_NAMES[computedNums.loadDay]} ({computedNums.loadDay})
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Computed unloads day</p>
            <p className="font-semibold text-white">
              {DAY_NAMES[computedNums.unloadsDay]} ({computedNums.unloadsDay})
            </p>
          </div>
        </div>

        {hasActive && (
          <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-3 py-2 text-xs text-amber-300">
            Overrides active for {runDate}
            {loadOverride    != null && ` · Load → ${DAY_NAMES[loadOverride]} (${loadOverride})`}
            {unloadsOverride != null && ` · Unloads → ${DAY_NAMES[unloadsOverride]} (${unloadsOverride})`}
          </div>
        )}

        <FieldRow label="Override load day">
          <select
            className="input"
            value={draftLoad}
            onChange={(e) => setDraftLoad(e.target.value)}
          >
            <option value="">— no override —</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{DAY_NAMES[n]} ({n})</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Override unloads day">
          <select
            className="input"
            value={draftUnloads}
            onChange={(e) => setDraftUnloads(e.target.value)}
          >
            <option value="">— no override —</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{DAY_NAMES[n]} ({n})</option>
            ))}
          </select>
        </FieldRow>

        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={isPending || (draftLoad === "" && draftUnloads === "")}
            onClick={apply}
          >
            {isPending ? "Saving…" : "Apply overrides"}
          </button>
          <button
            className="btn-ghost"
            disabled={isPending || !hasActive}
            onClick={clearAll}
          >
            Clear overrides
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

function CommunicationsPanel() {
  const { data: words = [], isLoading } = useCensorWords();
  const update = useUpdateCensorWords();
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);

  function addWord() {
    const w = input.trim().toLowerCase();
    if (!w || words.includes(w)) return;
    update.mutate([...words, w]);
    setInput("");
  }

  function removeWord(w: string) {
    update.mutate(words.filter((x) => x !== w));
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-300">Censor words</p>
          <p className="text-xs text-slate-500">
            Words in this list are replaced with asterisks in all outgoing messages.
            {!editing && words.length > 0 && (
              <span className="ml-1 text-slate-600">({words.length} configured)</span>
            )}
          </p>
        </div>
        <button
          className={editing ? "btn-ghost text-xs" : "btn-primary text-xs"}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add word…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWord()}
            />
            <button
              className="btn-primary"
              disabled={!input.trim() || update.isPending}
              onClick={addWord}
            >
              Add
            </button>
          </div>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : words.length === 0 ? (
            <p className="text-sm text-slate-500">No censor words configured.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {words.map((w) => (
                <span
                  key={w}
                  className="flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-200"
                >
                  {w}
                  <button
                    className="ml-1 text-slate-400 hover:text-red-400"
                    disabled={update.isPending}
                    onClick={() => removeWord(w)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Management
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: AuthRole[] = ["fleet", "supervisor", "lead", "atl", "loader", "unloader", "guest"];

function UsersPanel() {
  const { user: me } = useAuth();
  const { data: users = [], isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const changePassword = useChangePassword();

  const [createForm, setCreateForm] = useState({ username: "", password: "", role: "loader" as AuthRole, display_name: "" });
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<AuthRole>("loader");
  const [editEnabled, setEditEnabled] = useState(true);
  const [pwUser, setPwUser] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");

  function startEdit(u: { username: string; role: AuthRole; is_enabled: boolean }) {
    setEditingUser(u.username);
    setEditRole(u.role);
    setEditEnabled(u.is_enabled);
  }

  return (
    <div className="space-y-4">
      {/* User table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-slate-500">Loading…</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.username} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono font-semibold">{u.username}</td>
                <td className="px-3 py-2">
                  {editingUser === u.username ? (
                    <select
                      className="input py-0.5 text-xs"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as AuthRole)}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{u.role}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editingUser === u.username ? (
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={editEnabled}
                        onChange={(e) => setEditEnabled(e.target.checked)}
                      />
                      Enabled
                    </label>
                  ) : (
                    <span className={u.is_enabled ? "text-emerald-400" : "text-slate-500"}>
                      {u.is_enabled ? "Active" : "Disabled"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {editingUser === u.username ? (
                    <>
                      <button
                        className="btn-primary mr-1 text-xs"
                        disabled={updateUser.isPending}
                        onClick={() => {
                          updateUser.mutate({ username: u.username, role: editRole, is_enabled: editEnabled });
                          setEditingUser(null);
                        }}
                      >
                        Save
                      </button>
                      <button className="btn-ghost text-xs" onClick={() => setEditingUser(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-ghost mr-1 text-xs" onClick={() => startEdit(u)}>Edit</button>
                      <button
                        className="btn-ghost mr-1 text-xs"
                        onClick={() => { setPwUser(u.username); setNewPw(""); }}
                      >
                        Pw
                      </button>
                      {u.username !== me?.username && (
                        <button
                          className="text-xs text-red-400 hover:text-red-300"
                          onClick={() => {
                            if (confirm(`Delete user "${u.username}"?`))
                              deleteUser.mutate(u.username);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Change password inline form */}
      {pwUser && (
        <div className="card flex flex-wrap items-end gap-3">
          <p className="w-full text-sm font-medium text-slate-300">
            Change password for <span className="font-mono">{pwUser}</span>
          </p>
          <input
            className="input flex-1"
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={!newPw || changePassword.isPending}
            onClick={() => {
              changePassword.mutate({ username: pwUser, new_password: newPw });
              setPwUser(null);
              setNewPw("");
            }}
          >
            Set password
          </button>
          <button className="btn-ghost" onClick={() => setPwUser(null)}>Cancel</button>
        </div>
      )}

      {/* Create user form */}
      <div className="card space-y-3">
        <p className="text-sm font-semibold text-slate-300">Create new user</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select
              className="input"
              value={createForm.role}
              onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as AuthRole })}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Display name</label>
            <input
              className="input"
              value={createForm.display_name}
              onChange={(e) => setCreateForm({ ...createForm, display_name: e.target.value })}
            />
          </div>
        </div>
        <button
          className="btn-primary"
          disabled={!createForm.username || !createForm.password || createUser.isPending}
          onClick={() => {
            createUser.mutate({ ...createForm, display_name: createForm.display_name || createForm.username });
            setCreateForm({ username: "", password: "", role: "loader", display_name: "" });
          }}
        >
          {createUser.isPending ? "Creating…" : "Create user"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recovery & Admin
// ---------------------------------------------------------------------------

function RecoveryPanel() {
  const { user } = useAuth();
  const runDate = todayIso();
  const { data: board, isLoading } = useBoard(runDate);
  const { data: pace } = usePaceAverage(30);
  const upsert = useUpsertTruckState();
  const recordDuration = useRecordLoadDuration();
  const bulk = useBulkUpdateStatus();

  const isPrivileged =
    user?.role === "admin" ||
    user?.role === "fleet" ||
    user?.role === "supervisor" ||
    user?.role === "lead" ||
    user?.role === "atl";

  const stuck = useMemo(
    () => (board ?? []).filter((t) => t.state?.status === "in_progress"),
    [board],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (board ?? []).forEach((t) => {
      const s = t.state?.status ?? "dirty";
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [board]);

  const [fromStatus, setFromStatus] = useState<TruckStatus>("loaded");
  const [toStatus, setToStatus] = useState<TruckStatus>("dirty");
  const candidates = useMemo(
    () => (board ?? []).filter((t) => (t.state?.status ?? "dirty") === fromStatus),
    [board, fromStatus],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <p className="text-xs text-slate-400">
          Force-finish stuck loads and perform bulk status changes for today.
        </p>
      </div>

      {!isPrivileged && (
        <p className="text-xs text-amber-400">
          Bulk and force actions are admin/supervisor/lead only.
        </p>
      )}

      {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}

      {/* Stuck trucks */}
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Stuck loads ({stuck.length})
        </h3>
        {stuck.length === 0 ? (
          <p className="text-sm text-slate-500">No trucks currently in progress.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Truck</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Elapsed</th>
                <th className="px-3 py-2">vs pace</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {stuck.map((t) => (
                <StuckRow
                  key={t.truck_number}
                  truck={t}
                  runDate={runDate}
                  paceSeconds={pace?.avg_seconds ?? null}
                  disabled={!isPrivileged}
                  onForceFinish={async () => {
                    const startTs = t.state?.load_start_time ?? null;
                    const dur = startTs ? Math.round(Date.now() / 1000 - startTs) : 0;
                    await upsert.mutateAsync({
                      truck_number: t.truck_number,
                      run_date: runDate,
                      status: "loaded",
                      load_finish_time: Date.now() / 1000,
                      load_duration_seconds: dur > 0 ? dur : undefined,
                    });
                    if (dur >= 30 && dur <= 7200) {
                      try {
                        await recordDuration.mutateAsync({
                          truck_number: t.truck_number,
                          run_date: runDate,
                          duration_seconds: dur,
                        });
                      } catch {
                        /* ignore */
                      }
                    }
                  }}
                  onCancel={() =>
                    upsert.mutate({
                      truck_number: t.truck_number,
                      run_date: runDate,
                      status: "unloaded",
                      load_start_time: null,
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Bulk action */}
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Bulk status change
        </h3>
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
          <div>
            <label className="label">From status</label>
            <select
              className="input"
              value={fromStatus}
              onChange={(e) => setFromStatus(e.target.value as TruckStatus)}
            >
              {RECOVERY_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {RECOVERY_STATUS_LABELS[s]} ({counts[s] ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">To status</label>
            <select
              className="input"
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value as TruckStatus)}
            >
              {RECOVERY_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {RECOVERY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm text-slate-400">
            {candidates.length} truck{candidates.length === 1 ? "" : "s"} will be updated.
          </div>
          <div>
            <button
              className="btn-primary w-full"
              disabled={
                !isPrivileged ||
                bulk.isPending ||
                candidates.length === 0 ||
                fromStatus === toStatus
              }
              onClick={() => {
                if (!candidates.length) return;
                if (
                  !confirm(
                    `Change ${candidates.length} truck(s) from ${RECOVERY_STATUS_LABELS[fromStatus]} to ${RECOVERY_STATUS_LABELS[toStatus]}?`,
                  )
                )
                  return;
                bulk.mutate({
                  run_date: runDate,
                  truck_numbers: candidates.map((t) => t.truck_number),
                  new_status: toStatus,
                });
              }}
            >
              {bulk.isPending ? "Applying…" : "Apply bulk change"}
            </button>
          </div>
        </div>
        {candidates.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Trucks: {candidates.map((t) => `#${t.truck_number}`).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resets
// ---------------------------------------------------------------------------

const SELECTIVE_ITEMS = [
  { key: "truck_states", label: "Truck states", desc: "Clears status, load times, wearers and garments for all trucks" },
  { key: "batches",      label: "Batch assignments", desc: "Removes all truck → batch assignments" },
  { key: "route_swaps",  label: "Route swaps", desc: "Deletes all route swap records" },
  { key: "day_flags",    label: "Day flags", desc: "Resets wizard, holiday load/unload, and holiday mode flags" },
] as const;
type SelectiveKey = typeof SELECTIVE_ITEMS[number]["key"];

function SelectiveResetCard({ runDate, isPrivileged }: { runDate: string; isPrivileged: boolean }) {
  const selective = useSelectiveReset();
  const [checked, setChecked] = useState<Set<SelectiveKey>>(new Set());
  const [result, setResult] = useState<string | null>(null);

  function toggle(key: SelectiveKey) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setResult(null);
  }

  async function run() {
    if (checked.size === 0) return;
    const labels = SELECTIVE_ITEMS.filter((i) => checked.has(i.key)).map((i) => i.label).join(", ");
    if (!confirm(`Selectively reset [${labels}] for ${runDate}? This cannot be undone.`)) return;
    const args: Parameters<ReturnType<typeof useSelectiveReset>["mutateAsync"]>[0] = { runDate };
    for (const key of checked) (args as Record<string, unknown>)[key] = true;
    const r = await selective.mutateAsync(args);
    const cleared = (r.cleared as string[]).map((c: string) => c.replace(/_/g, " ")).join(", ");
    setResult(`Done — cleared: ${cleared || "nothing"}.`);
    setChecked(new Set());
  }

  return (
    <div className="border-t border-slate-800 pt-4 space-y-3">
      <p className="text-sm font-medium text-slate-200">Selective reset</p>
      <p className="text-xs text-slate-500">Choose exactly which components to clear for the selected date.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SELECTIVE_ITEMS.map((item) => (
          <label
            key={item.key}
            className={clsx(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              checked.has(item.key)
                ? "border-red-600/60 bg-red-950/30"
                : "border-slate-700 bg-slate-900 hover:border-slate-600",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-red-500"
              checked={checked.has(item.key)}
              onChange={() => toggle(item.key)}
            />
            <div>
              <p className="text-xs font-semibold text-slate-200">{item.label}</p>
              <p className="text-[11px] text-slate-500">{item.desc}</p>
            </div>
          </label>
        ))}
      </div>
      {result && <p className="text-xs text-emerald-400">{result}</p>}
      <button
        className="rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
        disabled={!isPrivileged || checked.size === 0 || selective.isPending}
        onClick={run}
      >
        {selective.isPending ? "Resetting…" : `Reset selected (${checked.size})`}
      </button>
    </div>
  );
}

function ResetsPanel() {
  const { user } = useAuth();
  const [runDate, setRunDate] = useState(todayIso());
  const reset = useResetWorkday();
  const purge = usePurgeAbnormalDurations();
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);

  const isPrivileged =
    user?.role === "admin" ||
    user?.role === "fleet" ||
    user?.role === "atl" ||
    user?.role === "supervisor" ||
    user?.role === "lead";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <p className="text-xs text-slate-400">
          Destructive operations for the selected run date.
        </p>
        <div>
          <label className="label">Run date</label>
          <input
            className="input"
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
          />
        </div>
      </div>

      <div className="card space-y-4">
        {/* Remove abnormal load times */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Remove abnormal load times</p>
            <p className="text-xs text-slate-500">
              Deletes statistical outliers from load-time history used for pace averaging.
            </p>
            {purgeResult && <p className="mt-1 text-xs text-emerald-400">{purgeResult}</p>}
          </div>
          <button
            className="shrink-0 rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
            disabled={!isPrivileged || purge.isPending}
            onClick={() => {
              purge.mutate(undefined, {
                onSuccess: (r) =>
                  setPurgeResult(`Removed ${r.removed} record(s). ${r.remaining} remaining.`),
              });
            }}
          >
            {purge.isPending ? "Running…" : "Run now"}
          </button>
        </div>

        {/* Reset workday */}
        <div className="flex items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Reset workday</p>
            <p className="text-xs text-slate-500">
              Clears all truck states, batch assignments, route swaps, and day flags
              (holiday, wizard) for the selected date. Cannot be undone.
            </p>
            {resetResult && <p className="mt-1 text-xs text-emerald-400">{resetResult}</p>}
          </div>
          <button
            className="shrink-0 rounded bg-red-900 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800 disabled:opacity-50"
            disabled={!isPrivileged || reset.isPending}
            onClick={() => {
              if (!confirm(`Full reset for ${runDate}? This clears all truck states, batches, route swaps, and day flags. Cannot be undone.`))
                return;
              reset.mutate(runDate, {
                onSuccess: (r) =>
                  setResetResult(`Reset complete — ${r.states_cleared} truck state(s) cleared.`),
              });
            }}
          >
            {reset.isPending ? "Resetting…" : "Reset workday"}
          </button>
        </div>

        <SelectiveResetCard runDate={runDate} isPrivileged={isPrivileged} />
      </div>
    </div>
  );
}

function StuckRow({
  truck,
  paceSeconds,
  disabled,
  onForceFinish,
  onCancel,
}: {
  truck: TruckWithState;
  runDate: string;
  paceSeconds: number | null;
  disabled: boolean;
  onForceFinish: () => void;
  onCancel: () => void;
}) {
  const startTs = truck.state?.load_start_time ?? null;
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = startTs ? now - startTs : 0;
  const vsPace =
    paceSeconds && startTs
      ? elapsed > paceSeconds
        ? `+${formatRecoveryDuration(elapsed - paceSeconds)} over`
        : `${formatRecoveryDuration(paceSeconds - elapsed)} under`
      : "—";
  const startedLabel = startTs ? new Date(startTs * 1000).toLocaleTimeString() : "—";

  return (
    <tr className="border-t border-slate-800">
      <td className="px-3 py-2 font-semibold">#{truck.truck_number}</td>
      <td className="px-3 py-2 text-slate-300">{startedLabel}</td>
      <td className="px-3 py-2 font-mono">{formatRecoveryDuration(elapsed)}</td>
      <td
        className={
          "px-3 py-2 " +
          (paceSeconds && elapsed > paceSeconds ? "text-amber-400" : "text-emerald-400")
        }
      >
        {vsPace}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          className="btn-primary mr-2 text-xs"
          disabled={disabled}
          onClick={onForceFinish}
        >
          Force Finish
        </button>
        <button className="btn-ghost text-xs" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Fleet Management
// ---------------------------------------------------------------------------

function FleetManagementPanel() {
  const { data: trucks, isLoading } = useFleet(true);
  const update = useUpdateTruck();
  const remove = useRemoveTruck();
  const add = useAddTruck();
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [newNum, setNewNum] = useState("");
  const [newType, setNewType] = useState<TruckType>("Uniform");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sorted = useMemo(
    () => [...(trucks ?? [])].sort((a, b) => a.truck_number - b.truck_number),
    [trucks],
  );

  const selected = useMemo(
    () => sorted.find((t) => t.truck_number === selectedNum) ?? null,
    [sorted, selectedNum],
  );

  // If the selected truck was just removed, clear selection
  useEffect(() => {
    if (selectedNum !== null && !sorted.find((t) => t.truck_number === selectedNum)) {
      setSelectedNum(null);
    }
  }, [sorted, selectedNum]);

  function handleAdd() {
    const num = parseInt(newNum, 10);
    if (!num || num < 1 || num > 9999) return;
    add.mutate(
      { truck_number: num, truck_type: newType },
      { onSuccess: () => { setNewNum(""); setNewType("Uniform"); } },
    );
  }

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="card space-y-5">
      {/* Truck selector */}
      <FieldRow label="Select truck">
        <select
          className="input"
          value={selectedNum ?? ""}
          onChange={(e) => {
            setSelectedNum(e.target.value ? parseInt(e.target.value, 10) : null);
            setConfirmDelete(false);
          }}
        >
          <option value="">— choose a truck —</option>
          {sorted.map((t) => (
            <option key={t.truck_number} value={t.truck_number}>
              #{t.truck_number}{!t.is_active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </FieldRow>

      {/* Per-truck settings */}
      {selected && (
        <>
          <FieldRow label="Truck type">
            <select
              className="input"
              value={selected.truck_type}
              disabled={update.isPending}
              onChange={(e) =>
                update.mutate({ truck_number: selected.truck_number, truck_type: e.target.value as TruckType })
              }
            >
              <option value="Uniform">Uniform</option>
              <option value="Dust">Dust</option>
              <option value="Spare">Spare</option>
            </select>
          </FieldRow>
          <FieldRow label="Active" hint="Inactive trucks are hidden from the board and fleet views.">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.is_active}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({ truck_number: selected.truck_number, is_active: e.target.checked })
                }
              />
              Active
            </label>
          </FieldRow>
          <div className="border-t border-slate-800 pt-3">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="text-sm text-red-400">Remove truck #{selected.truck_number} permanently?</p>
                <button
                  className="rounded bg-red-800 px-3 py-1 text-sm text-red-100 hover:bg-red-700"
                  onClick={() => {
                    remove.mutate(selected.truck_number);
                    setConfirmDelete(false);
                  }}
                >
                  Confirm
                </button>
                <button
                  className="rounded bg-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-600"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-400 hover:bg-slate-700 hover:text-red-400"
                onClick={() => setConfirmDelete(true)}
              >
                Remove truck
              </button>
            )}
          </div>
        </>
      )}

      {/* Add truck */}
      <div className="border-t border-slate-700 pt-4">
        <p className="mb-3 text-sm font-medium text-slate-300">Add truck</p>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            max={9999}
            placeholder="Truck #"
            className="input w-28"
            value={newNum}
            onChange={(e) => setNewNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <select
            className="input flex-1"
            value={newType}
            onChange={(e) => setNewType(e.target.value as TruckType)}
          >
            <option value="Uniform">Uniform</option>
            <option value="Dust">Dust</option>
            <option value="Spare">Spare</option>
          </select>
          <button
            className="btn-primary"
            disabled={!newNum || add.isPending}
            onClick={handleAdd}
          >
            {add.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Requests
// ---------------------------------------------------------------------------

function RequestsPanel({ disabled }: { disabled: boolean }) {
  const { user } = useAuth();
  const { data: requests, isLoading, error } = useAuthRequests(true);
  const resolve = useResolveAuthRequest();

  if (error)
    return <p className="text-sm text-amber-400">Cannot load requests (admin-only endpoint).</p>;

  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
        Pending account requests
      </h3>
      {isLoading && <p className="text-slate-400">Loading…</p>}
      {!isLoading && (requests ?? []).length === 0 && (
        <p className="text-sm text-slate-500">No pending requests.</p>
      )}
      <ul className="divide-y divide-slate-800">
        {(requests ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium">
                {r.username}{" "}
                <span className="text-xs text-slate-400">wants {r.requested_role}</span>
              </p>
              <p className="text-xs text-slate-500">
                Requested {new Date(r.requested_at).toLocaleString()}
              </p>
            </div>
            <div className="space-x-2">
              <button
                className="btn-primary"
                disabled={disabled || resolve.isPending}
                onClick={() =>
                  resolve.mutate({ id: r.id, status: "approved", resolved_by: user?.username ?? "admin" })
                }
              >
                Approve
              </button>
              <button
                className="btn-ghost text-red-400"
                disabled={disabled || resolve.isPending}
                onClick={() =>
                  resolve.mutate({ id: r.id, status: "denied", resolved_by: user?.username ?? "admin" })
                }
              >
                Deny
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

function NoticesPanel({ disabled }: { disabled: boolean }) {
  const { data: notices, isLoading } = useNotices(false);
  const create = useCreateNotice();
  const update = useUpdateNotice();
  const del = useDeleteNotice();
  const [form, setForm] = useState({ title: "", body: "", severity: "info" as NoticeSeverity });

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Post a new notice
        </h3>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled) return;
            create.mutate(form, { onSuccess: () => setForm({ title: "", body: "", severity: "info" }) });
          }}
        >
          <input
            className="input w-full"
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <textarea
            className="input w-full"
            placeholder="Body (optional)"
            rows={3}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <select
              className="input"
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as NoticeSeverity })}
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn-primary" disabled={disabled || create.isPending}>
              Post notice
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          All notices
        </h3>
        {isLoading && <p className="text-slate-400">Loading…</p>}
        {!isLoading && (notices ?? []).length === 0 && (
          <p className="text-sm text-slate-500">No notices yet.</p>
        )}
        <ul className="divide-y divide-slate-800">
          {(notices ?? []).map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-3">
              <div className="flex-1">
                <p className="font-semibold">
                  <span className="mr-2 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase">
                    {n.severity}
                  </span>
                  {n.title}
                </p>
                {n.body && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-400">{n.body}</p>
                )}
                <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                  {n.created_by} · {new Date(n.created_at).toLocaleString()} ·{" "}
                  {n.is_active ? "Active" : "Hidden"}
                </p>
              </div>
              <div className="space-x-2 text-right">
                <button
                  className="btn-ghost"
                  disabled={disabled}
                  onClick={() => update.mutate({ id: n.id, is_active: !n.is_active })}
                >
                  {n.is_active ? "Hide" : "Show"}
                </button>
                <button
                  className="btn-ghost text-red-400"
                  disabled={disabled}
                  onClick={() => { if (confirm(`Delete notice "${n.title}"?`)) del.mutate(n.id); }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tracked Items  (with category support — mirrors V1 "Reporting > Tracked Items")
// ---------------------------------------------------------------------------

function ItemsPanel({ disabled }: { disabled: boolean }) {
  const { data: items, isLoading } = useTrackedItems();
  const save = useUpdateTrackedItems();
  const [draft, setDraft] = useState<TrackedItem[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryIsNew, setNewCategoryIsNew] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("__all__");
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { if (items) setDraft(items); }, [items]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(items ?? []);

  // All unique categories in the current draft
  const categories = useMemo(() => {
    const s = new Set(draft.map((d) => d.category ?? "").filter(Boolean));
    return Array.from(s).sort();
  }, [draft]);

  const visibleItems = filterCategory === "__all__"
    ? draft
    : draft.filter((d) => (d.category ?? "") === filterCategory);

  function addItem() {
    const label = newLabel.trim();
    if (!label || draft.some((d) => d.label.toLowerCase() === label.toLowerCase())) return;
    setDraft([
      ...draft,
      {
        label,
        qty_default: Math.max(1, parseInt(newQty || "1", 10)),
        category: newCategory.trim() || undefined,
      },
    ]);
    setNewLabel("");
    setNewQty("1");
    setNewCategory("");
    setNewCategoryIsNew(false);
  }

  function updateRow(idx: number, patch: Partial<TrackedItem>) {
    // idx is relative to visibleItems; find the real draft index
    const target = visibleItems[idx];
    const realIdx = draft.findIndex((d) => d === target);
    if (realIdx === -1) return;
    setDraft(draft.map((d, i) => (i === realIdx ? { ...d, ...patch } : d)));
  }

  function removeRow(idx: number) {
    const target = visibleItems[idx];
    setDraft(draft.filter((d) => d !== target));
  }

  /** Bulk import from a JSON like { "Category": ["item1", "item2", ...], ... } */
  function applyBulkImport() {
    let parsed: unknown;
    try { parsed = JSON.parse(importText); } catch { return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const incoming: TrackedItem[] = [];
    for (const [cat, rawItems] of Object.entries(parsed as Record<string, unknown>)) {
      const itemList = Array.isArray(rawItems) ? rawItems : [rawItems];
      for (const raw of itemList) {
        const label = typeof raw === "string" ? raw.trim() : String(raw).trim();
        if (!label) continue;
        if (draft.some((d) => d.label.toLowerCase() === label.toLowerCase())) continue;
        if (incoming.some((d) => d.label.toLowerCase() === label.toLowerCase())) continue;
        incoming.push({ label, qty_default: 1, category: cat.trim() || undefined });
      }
    }
    if (incoming.length) setDraft([...draft, ...incoming]);
    setImportText("");
    setImportOpen(false);
  }

  return (
    <div className="space-y-4">
      {/* Category filter */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Tracked items
          </h3>
          <select
            className="input ml-auto w-auto"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="__all__">All categories</option>
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Items appear as buttons in the Audit form, grouped by category.
        </p>

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2 w-36">Category</th>
                  <th className="px-3 py-2 w-28">Default qty</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={4}>
                      {draft.length === 0 ? "No tracked items yet." : "No items in this category."}
                    </td>
                  </tr>
                )}
                {visibleItems.map((it, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-3 py-2">
                      <input
                        className="input"
                        value={it.label}
                        disabled={disabled}
                        onChange={(e) => updateRow(i, { label: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="input"
                        list="category-datalist"
                        placeholder="None"
                        value={it.category ?? ""}
                        disabled={disabled}
                        onChange={(e) =>
                          updateRow(i, { category: e.target.value.trim() || undefined })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        className="input"
                        value={it.qty_default}
                        disabled={disabled}
                        onChange={(e) =>
                          updateRow(i, { qty_default: Math.max(1, parseInt(e.target.value || "1", 10)) })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="btn-ghost text-xs"
                        disabled={disabled}
                        onClick={() => removeRow(i)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* datalist for existing-row category inputs */}
        <datalist id="category-datalist">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>

        {/* Add new item row */}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-32"
            placeholder="New item label"
            value={newLabel}
            disabled={disabled}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          />
          {newCategoryIsNew ? (
            <input
              className="input w-36"
              placeholder="New category name"
              autoFocus
              value={newCategory}
              disabled={disabled}
              onChange={(e) => setNewCategory(e.target.value)}
              onBlur={() => { if (!newCategory.trim()) setNewCategoryIsNew(false); }}
            />
          ) : (
            <select
              className="input w-36"
              value={newCategory}
              disabled={disabled}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setNewCategory("");
                  setNewCategoryIsNew(true);
                } else {
                  setNewCategory(e.target.value);
                }
              }}
            >
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__new__">+ New category…</option>
            </select>
          )}
          <input
            type="number"
            min={1}
            className="input w-24"
            value={newQty}
            disabled={disabled}
            onChange={(e) => setNewQty(e.target.value)}
          />
          <button className="btn-ghost" disabled={disabled || !newLabel.trim()} onClick={addItem}>
            Add
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            className="btn-primary"
            disabled={disabled || !dirty || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button
            className="btn-ghost"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(items ?? [])}
          >
            Revert
          </button>
          <button
            className="btn-ghost ml-auto"
            disabled={disabled}
            onClick={() => setImportOpen((v) => !v)}
          >
            {importOpen ? "Cancel import" : "Bulk import JSON…"}
          </button>
        </div>

        {/* Bulk JSON import */}
        {importOpen && (
          <div className="mt-4 space-y-2 border-t border-slate-700 pt-4">
            <p className="text-xs text-slate-400">
              Paste a JSON object mapping category names to arrays of item labels:
            </p>
            <pre className="rounded bg-slate-800 px-3 py-2 text-xs text-slate-400">
{`{
  "Dust Mops": ["24\\"", "36\\"", "46\\""],
  "Towels": ["Terry", "Glass", "Premium"]
}`}
            </pre>
            <textarea
              className="input w-full font-mono text-xs"
              rows={6}
              placeholder='{ "Category": ["item1", "item2"] }'
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={!importText.trim()}
                onClick={applyBulkImport}
              >
                Apply import
              </button>
              <button className="btn-ghost" onClick={() => { setImportOpen(false); setImportText(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role Access (read-only reference table)
// ---------------------------------------------------------------------------

function RoleAccessPanel() {
  return (
    <div className="card space-y-3">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Role Access</h3>
        <p className="text-xs text-slate-500">Which pages each role can navigate to.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                Page
              </th>
              {ALL_ROLES.map((r) => (
                <th key={r} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400 capitalize">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGE_ACCESS.map(({ label, roles }) => (
              <tr key={label} className="border-b border-slate-800 last:border-0">
                <td className="py-2 pr-4 font-medium text-slate-300">{label}</td>
                {ALL_ROLES.map((r) => (
                  <td key={r} className="px-2 py-2 text-center">
                    {roles.has(r) ? (
                      <span className="text-emerald-400">✓</span>
                    ) : (
                      <span className="text-slate-700">–</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export & Import
// ---------------------------------------------------------------------------

function ExportImportPanel() {
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  function downloadFile(path: string) {
    const a = document.createElement("a");
    a.href = `/api${path}`;
    a.click();
  }

  async function handleImport(endpoint: string, file: File) {
    setImporting(true);
    setImportStatus(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api${endpoint}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setImportStatus(`Error: ${err.detail ?? res.statusText}`);
      } else {
        const result = await res.json();
        const parts = Object.entries(result as Record<string, number>).map(
          ([k, v]) => `${v} ${k.replace(/_/g, " ")} imported`,
        );
        setImportStatus(parts.length ? parts.join(", ") : "Done");
      }
    } catch (e) {
      setImportStatus(`Network error: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Quick exports */}
      <div className="card">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Quick exports
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Download individual data tables as JSON files.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-ghost text-sm"
            onClick={() => downloadFile("/exports/load-durations.json")}
          >
            Download load durations JSON
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={() => downloadFile("/exports/truck-states.json")}
          >
            Download current-day state JSON
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={() => downloadFile("/exports/audit-entries.json")}
          >
            Download audit_entries.json
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={() => downloadFile("/exports/shortages.json")}
          >
            Download shortages.json
          </button>
        </div>
      </div>

      {/* Backup package */}
      <div className="card">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Backup package
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          A single ZIP archive containing all tables — load durations, truck
          states, audit entries, shortages, and batches.
        </p>
        <button
          className="btn-primary"
          onClick={() => downloadFile("/exports/backup.zip")}
        >
          Download history backup package
        </button>
      </div>

      {/* Import tools */}
      <div className="card space-y-3">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Import tools
        </h3>
        {importStatus && (
          <p
            className={`rounded px-3 py-2 text-sm ${
              importStatus.startsWith("Error")
                ? "bg-red-900/40 text-red-300"
                : "bg-emerald-900/40 text-emerald-300"
            }`}
          >
            {importStatus}
          </p>
        )}
        <FieldRow label="Open backup package import" hint="Upload a readyroute_backup_*.zip file">
          <label className="btn-ghost cursor-pointer text-sm">
            {importing ? "Importing…" : "Choose backup ZIP…"}
            <input
              type="file"
              className="sr-only"
              accept=".zip"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport("/exports/import/backup", f);
                e.target.value = "";
              }}
            />
          </label>
        </FieldRow>
        <FieldRow
          label="Open direct JSON imports"
          hint="Upload a load_durations.json file exported from this system"
        >
          <label className="btn-ghost cursor-pointer text-sm">
            {importing ? "Importing…" : "Choose load durations JSON…"}
            <input
              type="file"
              className="sr-only"
              accept=".json"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport("/exports/import/load-durations", f);
                e.target.value = "";
              }}
            />
          </label>
        </FieldRow>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF Reports
// ---------------------------------------------------------------------------

function PDFReportsPanel() {
  const { data: board } = useBoard(todayIso());
  const { data: entries } = useAuditEntries(todayIso());

  function openReportDownloads() {
    const today = todayIso();
    const rows = (board ?? [])
      .slice()
      .sort((a, b) => a.truck_number - b.truck_number)
      .map((t) => {
        const s = t.state?.status ?? "dirty";
        const label = s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const duration = t.state?.load_duration_seconds
          ? `${Math.floor(t.state.load_duration_seconds / 60)}m ${(t.state.load_duration_seconds % 60).toString().padStart(2, "0")}s`
          : "—";
        return `<tr>
          <td>${t.truck_number}</td>
          <td>${t.truck_type ?? ""}</td>
          <td>${label}</td>
          <td>${t.state?.wearers ?? 0}</td>
          <td>${duration}</td>
        </tr>`;
      })
      .join("");

    const auditRows = (entries ?? [])
      .slice()
      .sort((a, b) => a.truck_number - b.truck_number)
      .map(
        (e) =>
          `<tr>
          <td>#${e.truck_number}</td>
          <td>${e.item_label}</td>
          <td>${e.quantity}</td>
          <td>${e.note ?? ""}</td>
        </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ReadyRoute Day Report — ${today}</title>
  <style>
    body { font-family: sans-serif; font-size: 12px; color: #111; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-top: 24px; margin-bottom: 4px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
    p.sub { color: #555; font-size: 11px; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>ReadyRoute V2 — Day Report</h1>
  <p class="sub">Run date: ${today} &nbsp;·&nbsp; Generated: ${new Date().toLocaleString()}</p>

  <h2>Truck States</h2>
  <table>
    <thead><tr><th>#</th><th>Type</th><th>Status</th><th>Wearers</th><th>Load Time</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='5'>No trucks</td></tr>"}</tbody>
  </table>

  <h2>Audit Entries</h2>
  <table>
    <thead><tr><th>Truck</th><th>Item</th><th>Qty</th><th>Note</th></tr></thead>
    <tbody>${auditRows || "<tr><td colspan='4'>No entries</td></tr>"}</tbody>
  </table>
  <script>window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 200); });<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      URL.revokeObjectURL(url);
      alert("Pop-up blocked — please allow pop-ups for this site.");
      return;
    }
    // Revoke the object URL after the window has had time to load it
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
        Download PDFs
      </h3>
      <p className="text-xs text-slate-500">
        Generate a print-ready day report. After clicking, use your browser&apos;s
        Print dialog (Ctrl+P / Cmd+P) and choose &ldquo;Save as PDF&rdquo; to
        download.
      </p>
      <button className="btn-primary" onClick={openReportDownloads}>
        Open report downloads
      </button>
      <p className="text-[11px] text-slate-600">
        Includes truck states and audit entries for today&apos;s run date.
      </p>
    </div>
  );
}
