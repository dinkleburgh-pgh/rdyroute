import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useSettings } from "../api/hooks";
import { useAuth } from "../contexts/AuthContext";
import type { AppSetting } from "../types";
import UsersPanel from "../components/management/UsersPanel";
import RequestsPanel from "../components/management/RequestsPanel";
import RoleAccessPanel from "../components/management/RoleAccessPanel";
import ActivityPanel from "../components/management/ActivityPanel";
import ColorsPanel from "../components/management/ColorsPanel";
import WorkflowsPanel from "../components/management/WorkflowsPanel";
import CommunicationsPanel from "../components/management/CommunicationsPanel";
import AdvancedPanel from "../components/management/AdvancedPanel";
import UpdatesPanel from "../components/management/UpdatesPanel";
import DevelopmentPanel from "../components/management/DevelopmentPanel";
import ConnectionsPanel from "../components/management/ConnectionsPanel";
import RecoveryPanel from "../components/management/RecoveryPanel";
import ResetsPanel from "../components/management/ResetsPanel";
import FleetManagementPanel from "../components/management/FleetManagementPanel";
import BulkStatusPanel from "../components/management/BulkStatusPanel";
import NoticesPanel from "../components/management/NoticesPanel";
import ItemsPanel from "../components/management/ItemsPanel";
import ExportImportPanel from "../components/management/ExportImportPanel";
import PDFReportsPanel from "../components/management/PDFReportsPanel";
import DriverQRPanel from "../components/management/DriverQRPanel";

/**
 * Structured settings UI — surfaces well-known V1 keys as proper form
 * controls and keeps a raw key/value editor under "Advanced" for everything
 * else (parity with V1 settings panel groupings).
 */

type Category =
  | "colors"
  | "workflows"
  | "communications"
  | "users"
  | "fleet_mgmt"
  | "bulk_status"
  | "advanced"
  | "updates"
  | "development"
  | "recovery"
  | "resets"
  | "requests"
  | "notices"
  | "items"
  | "roles"
  | "activity"
  | "export_import"
  | "pdf_reports"
  | "driver_qr"
  | "connections";

// Two-level navigation: Cards (groups) → Tabs (sub-categories)
type GroupId = "app" | "users" | "content" | "fleet" | "comms" | "ops" | "advanced" | "data";

interface CardGroup {
  id: GroupId;
  label: string;
  desc: string;
  /** Left border color class, e.g. "border-l-sky-500" */
  borderColor: string;
  /** Subtle background tint class, e.g. "bg-sky-950/30" */
  bgTint: string;
  adminOnly?: true;
  tabs: { id: Category; label: string }[];
}

const CARD_GROUPS: CardGroup[] = [
  {
    id: "app",
    label: "App Settings",
    desc: "Status badge colors",
    borderColor: "border-l-sky-500",
    bgTint: "bg-sky-950/35",
    tabs: [
      { id: "colors", label: "Badge Colors" },
    ],
  },
  {
    id: "users",
    label: "Users & Access",
    desc: "Manage users, pending requests, and role reference",
    borderColor: "border-l-indigo-500",
    bgTint: "bg-indigo-950/35",
    adminOnly: true,
    tabs: [
      { id: "users",    label: "Users" },
      { id: "requests", label: "Requests" },
      { id: "roles",    label: "Role Access" },
      { id: "activity", label: "Activity" },
    ],
  },
  {
    id: "content",
    label: "Notices & Items",
    desc: "Team notices and audit checklist catalog",
    borderColor: "border-l-yellow-500",
    bgTint: "bg-yellow-950/35",
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
    borderColor: "border-l-teal-500",
    bgTint: "bg-teal-950/35",
    adminOnly: true,
    tabs: [
      { id: "fleet_mgmt",  label: "Fleet" },
      { id: "bulk_status", label: "Bulk Status" },
      { id: "driver_qr",   label: "Driver QR Codes" },
    ],
  },
  {
    id: "comms",
    label: "Communications",
    desc: "Manage censored words for the messaging system",
    borderColor: "border-l-pink-500",
    bgTint: "bg-pink-950/35",
    adminOnly: true,
    tabs: [{ id: "communications", label: "Censor Words" }],
  },
  {
    id: "ops",
    label: "Operations",
    desc: "Workflows, force-finish loads, bulk status changes, and workday resets",
    borderColor: "border-l-orange-500",
    bgTint: "bg-orange-950/35",
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
    borderColor: "border-l-red-500",
    bgTint: "bg-red-950/35",
    adminOnly: true,
    tabs: [
      { id: "advanced",     label: "Advanced" },
      { id: "updates",      label: "Update" },
      { id: "development",  label: "Development" },
      { id: "connections",  label: "Connections" },
    ],
  },
  {
    id: "data",
    label: "Data & Reports",
    desc: "Export / import backups, PDF day reports",
    borderColor: "border-l-emerald-500",
    bgTint: "bg-emerald-950/35",
    adminOnly: true,
    tabs: [
      { id: "export_import", label: "Export & Import" },
      { id: "pdf_reports",   label: "PDF Reports" },
    ],
  },
];

export default function Management() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor";
  const isPrivileged = isAdmin || user?.role === "lead" || user?.role === "atl";
  const [activeGroup, setActiveGroup] = useState<GroupId | null>(null);
  const [activeTab, setActiveTab] = useState<Category>("colors");
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
      case "colors":         return <ColorsPanel map={map} />;
      case "workflows":      return <WorkflowsPanel map={map} />;
      case "advanced":       return <AdvancedPanel settings={data ?? []} />;
      case "updates":        return <UpdatesPanel map={map} />;
      case "development":    return <DevelopmentPanel />;
      case "connections":    return <ConnectionsPanel />;
      case "communications": return <CommunicationsPanel />;
      case "users":          return <UsersPanel />;
      case "requests":       return <RequestsPanel disabled={!isAdmin} />;
      case "notices":        return <NoticesPanel disabled={!isAdmin} />;
      case "items":          return <ItemsPanel disabled={!isAdmin} />;
      case "roles":          return <RoleAccessPanel />;
      case "activity":       return <ActivityPanel />;
      case "recovery":       return <RecoveryPanel />;
      case "resets":         return <ResetsPanel />;
      case "fleet_mgmt":     return <FleetManagementPanel />;
      case "bulk_status":    return <BulkStatusPanel />;
      case "driver_qr":      return <DriverQRPanel />;
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
                "rounded-lg border border-slate-700/60 border-l-4 p-4 text-left transition hover:brightness-110",
                group.borderColor,
                group.bgTint,
                isActive ? "ring-2 ring-white/20" : "",
              )}
            >
              <p className="text-base font-bold text-white">{group.label}</p>
              <p className="mt-1.5 text-sm text-slate-300">{group.desc}</p>
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

// All panels extracted to src/components/management/ � see imports at top of this file.
