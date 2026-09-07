/**
 * Role access reference matrix — which pages each role can navigate to.
 * Read-only reference (mirrors ROLE_NAV_ACCESS in Layout.tsx).
 */
import clsx from "clsx";
import type { AuthRole } from "../../types";
import { ALL_ROLES, ROLE_DOT_CLASS, ROLE_LABELS } from "../../utils/permissions";
import { CheckIcon } from "../icons";

const PAGE_ACCESS: { label: string; roles: Set<AuthRole> }[] = [
  { label: "Unload", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead", "unloader"]) },
  { label: "Load", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead", "loader"]) },
  { label: "Fleet", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead"]) },
  {
    label: "Communications",
    roles: new Set(["admin", "fleet", "atl", "supervisor", "lead", "loader", "unloader"]),
  },
  { label: "Short Sheet", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead"]) },
  { label: "Trends", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead"]) },
  { label: "Audit", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead", "loader"]) },
  { label: "Management", roles: new Set(["admin", "fleet", "atl", "supervisor", "lead"]) },
];

export default function RoleAccessPanel() {
  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Role Access
        </h3>
        <p className="text-xs text-ink-muted">
          Which pages each role can navigate to. This is a reference view.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Page
              </th>
              {ALL_ROLES.map((r) => (
                <th key={r} className="px-2 py-2 text-center">
                  <span className="inline-flex flex-col items-center gap-1">
                    <span className={clsx("h-2 w-2 rounded-full", ROLE_DOT_CLASS[r])} />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {ROLE_LABELS[r]}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGE_ACCESS.map(({ label, roles }, idx) => (
              <tr
                key={label}
                className={clsx(
                  "border-b border-hairline last:border-0",
                  idx % 2 === 1 && "bg-surface-2/30",
                )}
              >
                <td className="py-2 pr-4 font-medium text-ink-soft">{label}</td>
                {ALL_ROLES.map((r) => (
                  <td key={r} className="px-2 py-2 text-center">
                    {roles.has(r) ? (
                      <CheckIcon className="mx-auto h-4 w-4 text-emerald-400" />
                    ) : (
                      <span className="text-ink-faint">–</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-muted">
        Note: <span className="font-medium text-ink-muted">admin</span> has full access to every
        page and all management functions.
      </p>
    </div>
  );
}
