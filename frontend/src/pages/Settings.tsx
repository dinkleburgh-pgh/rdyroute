import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
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
import OffDaySchedulePanel from "../components/management/OffDaySchedulePanel";
import NoticesPanel from "../components/management/NoticesPanel";
import ItemsPanel from "../components/management/ItemsPanel";
import ExportImportPanel from "../components/management/ExportImportPanel";
import PDFReportsPanel from "../components/management/PDFReportsPanel";
import DriverQRPanel from "../components/management/DriverQRPanel";
import TruckOpsActivityPanel from "../components/management/TruckOpsActivityPanel";
import PageHeader from "../components/PageHeader";
import { ShortsWorkspace } from "./Shorts";

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
  | "off_day_schedule"
  | "bulk_status"
  | "advanced"
  | "updates"
  | "development"
  | "recovery"
  | "resets"
  | "requests"
  | "notices"
  | "configure_items"
  | "roles"
  | "activity"
  | "history_activity"
  | "export_import"
  | "pdf_reports"
  | "driver_qr"
  | "connections"
  | "short_imports";

// Two-level navigation: Cards (groups) → Tabs (sub-categories)
type GroupId = "app" | "users" | "items" | "fleet" | "comms" | "ops" | "advanced" | "data" | "shortages";

interface CardGroup {
  id: GroupId;
  label: string;
  desc: string;
  mobileDesc: string;
  /** Left border color class, e.g. "border-l-sky-500" */
  borderColor: string;
  /** Subtle background tint class, e.g. "bg-sky-950/30" */
  bgTint: string;
  adminOnly?: true;
  tabs: { id: Category; label: string; adminOnly?: true }[];
}

const CARD_GROUPS: CardGroup[] = [
  {
    id: "app",
    label: "App Settings",
    desc: "Status badge colors",
    mobileDesc: "Badge colors",
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
    mobileDesc: "Users, requests, roles",
    borderColor: "border-l-indigo-500",
    bgTint: "bg-indigo-950/35",
    adminOnly: true,
    tabs: [
      { id: "users",    label: "Users" },
      { id: "requests", label: "Requests" },
      { id: "roles",    label: "Role Access" },
      { id: "activity", label: "Access Activity" },
    ],
  },
  {
    id: "items",
    label: "Items",
    desc: "Configure item catalog, pack sizes, and unit types",
    mobileDesc: "Item catalog",
    borderColor: "border-l-yellow-500",
    bgTint: "bg-yellow-950/35",
    adminOnly: true,
    tabs: [
      { id: "configure_items", label: "Configure Items" },
    ],
  },
  {
    id: "shortages",
    label: "Shortages",
    desc: "Short sheet photo imports and review queue",
    mobileDesc: "Sheet imports",
    borderColor: "border-l-cyan-500",
    bgTint: "bg-cyan-950/35",
    tabs: [{ id: "short_imports", label: "Sheet Imports" }],
  },
  {
    id: "fleet",
    label: "Fleet",
    desc: "Add, remove, and configure trucks in the fleet",
    mobileDesc: "Trucks and QR codes",
    borderColor: "border-l-teal-500",
    bgTint: "bg-teal-950/35",
    adminOnly: true,
    tabs: [
      { id: "fleet_mgmt",       label: "Fleet" },
      { id: "off_day_schedule", label: "Off Day Schedule" },
      { id: "bulk_status",      label: "Bulk Status" },
      { id: "driver_qr",        label: "Driver QR Codes" },
    ],
  },
  {
    id: "comms",
    label: "Communications",
    desc: "Team notices and profanity filter settings",
    mobileDesc: "Notices and censor words",
    borderColor: "border-l-pink-500",
    bgTint: "bg-pink-950/35",
    adminOnly: true,
    tabs: [
      { id: "notices",        label: "Notices" },
      { id: "communications", label: "Censor Words" },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    desc: "Workflows, force-finish loads, bulk status changes, and workday resets",
    mobileDesc: "Workflows and resets",
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
    mobileDesc: "Raw settings editor",
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
    mobileDesc: "Import and reports",
    borderColor: "border-l-emerald-500",
    bgTint: "bg-emerald-950/35",
    tabs: [
      { id: "history_activity", label: "History & Activity" },
      { id: "export_import", label: "Export & Import", adminOnly: true },
      { id: "pdf_reports",   label: "PDF Reports", adminOnly: true },
    ],
  },
];

export default function Management() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const isAdmin = user?.role === "admin" || user?.role === "fleet" || user?.role === "supervisor";
  const isPrivileged = isAdmin || user?.role === "lead" || user?.role === "atl";
  const [activeGroup, setActiveGroup] = useState<GroupId | null>(null);
  const [activeTab, setActiveTab] = useState<Category>("colors");
  const { data, isLoading } = useSettings();
  const requestedTruckNumber = useMemo(() => {
    const raw = searchParams.get("truck");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);
  const requestedRunDate = searchParams.get("runDate");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const requestedGroup = searchParams.get("group") as GroupId | null;
    const requestedTab = searchParams.get("tab") as Category | null;
    if (!requestedGroup && !requestedTab) return;
    const groupFromTab = requestedTab
      ? CARD_GROUPS.find((group) => group.tabs.some((tab) => tab.id === requestedTab))?.id ?? null
      : null;
    const nextGroup = requestedGroup ?? groupFromTab;
    if (!nextGroup) return;
    const groupDef = CARD_GROUPS.find((group) => group.id === nextGroup);
    if (!groupDef) return;
    const visibleTabs = groupDef.tabs.filter((tab) => isAdmin || !tab.adminOnly);
    if (visibleTabs.length === 0) return;
    const nextTab = requestedTab && visibleTabs.some((tab) => tab.id === requestedTab)
      ? requestedTab
      : visibleTabs[0].id;
    setActiveGroup(nextGroup);
    setActiveTab(nextTab);
  }, [isAdmin, searchParams]);


  const map = useMemo(() => {
    const m = new Map<string, unknown>();
    (data ?? []).forEach((s) => m.set(s.key, s.value));
    return m;
  }, [data]);

  if (!isPrivileged) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex min-h-0 flex-col"
      >
        <PageHeader
          eyebrow="Admin Tools"
          title="Management"
          subtitle="Settings, reports, imports, and operational controls."
        />
        <div className="p-6">
          <p className="text-sm text-slate-400">
            Access is restricted to Fleet / Supervisor / Lead / ATL roles.
          </p>
        </div>
      </motion.div>
    );
  }

  const visibleGroups = isAdmin
    ? CARD_GROUPS
    : CARD_GROUPS.filter((g) => !g.adminOnly);

  const activeGroupDef = activeGroup
    ? CARD_GROUPS.find((g) => g.id === activeGroup) ?? null
    : null;
  const activeTabs = activeGroupDef
    ? activeGroupDef.tabs.filter((tab) => isAdmin || !tab.adminOnly)
    : [];

  useEffect(() => {
    if (activeGroupDef && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeGroupDef]);

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
      case "configure_items": return <ItemsPanel disabled={!isAdmin} />;
      case "short_imports":  return <ShortsWorkspace />;
      case "roles":          return <RoleAccessPanel />;
      case "activity":       return <ActivityPanel />;
      case "history_activity": return <TruckOpsActivityPanel initialTruckNumber={requestedTruckNumber} initialRunDate={requestedRunDate} />;
      case "recovery":       return <RecoveryPanel />;
      case "resets":         return <ResetsPanel />;
      case "fleet_mgmt":       return <FleetManagementPanel />;
      case "off_day_schedule": return <OffDaySchedulePanel />;
      case "bulk_status":      return <BulkStatusPanel />;
      case "driver_qr":      return <DriverQRPanel />;
      case "export_import":  return <ExportImportPanel />;
      case "pdf_reports":    return <PDFReportsPanel />;
      default:               return null;
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex min-h-0 flex-col"
    >
      <PageHeader
        eyebrow="Admin Tools"
        title="Management"
        subtitle="Settings, user access, reports, and workflow controls in one place."
      />
      <div className="space-y-4 p-3 md:p-6">

      {/* Card group grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {visibleGroups.map((group, i) => {
          const isActive = activeGroup === group.id;
          return (
            <motion.button
              key={group.id}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.1 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => {
                if (isActive) {
                  setActiveGroup(null);
                } else {
                  setActiveGroup(group.id);
                  const nextVisibleTabs = group.tabs.filter((tab) => isAdmin || !tab.adminOnly);
                  setActiveTab(nextVisibleTabs[0].id);
                }
              }}
              className={clsx(
                "rounded-lg border border-slate-700/60 border-l-4 p-3 text-left transition hover:brightness-110 sm:p-4",
                group.borderColor,
                group.bgTint,
                isActive ? "ring-2 ring-white/20" : "",
              )}
            >
              <p className="text-sm font-bold text-white sm:text-base">{group.label}</p>
              <p className="mt-1 text-xs leading-snug text-slate-300 sm:hidden">{group.mobileDesc}</p>
              <p className="mt-1.5 hidden truncate text-sm text-slate-300 sm:block">{group.desc}</p>
            </motion.button>
          );
        })}
      </div>

      {/* Sub-tab bar + panel (shown when a card is active) */}
      {activeGroupDef && (
        <div ref={panelRef}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeGroupDef.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <div className="-mx-3 overflow-x-auto border-b border-slate-800 px-3 sm:mx-0 sm:px-0">
                <div className="flex min-w-max gap-1">
                {activeTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                      "whitespace-nowrap rounded-t-md px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm",
                      activeTab === tab.id
                        ? "border-b-2 border-blue-500 bg-slate-900/50 text-blue-300"
                        : "text-slate-400 hover:bg-slate-900/40 hover:text-slate-200",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
                </div>
              </div>
              <div className="mt-4">{renderPanel()}</div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
      </div>
    </motion.div>
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
