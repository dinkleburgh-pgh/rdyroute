import { X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useDocuments, useRemoveDocumentLink, documentFileUrl } from "../api/hooks";

// Documents feature is leads + admins only; don't even query for other roles.
const LEADERSHIP = new Set(["admin", "fleet", "atl", "supervisor", "lead"]);

/**
 * Linked-documents section for a truck detail. Shows the docs pinned to this
 * truck (from the Documents library) with open + unlink. Attaching is done from
 * the Documents page. Renders nothing for non-leadership viewers or when the
 * truck has no linked documents.
 */
export default function TruckDocuments({ truckNumber }: { truckNumber: number }) {
  const { user } = useAuth();
  const canSee = !!user && LEADERSHIP.has(user.role);
  const { data: docs = [] } = useDocuments({
    targetType: "truck",
    targetKey: String(truckNumber),
    enabled: canSee,
  });
  const removeLink = useRemoveDocumentLink();

  if (!canSee || docs.length === 0) return null;

  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Documents ({docs.length})
      </h4>
      <ul className="divide-y divide-slate-800 text-sm">
        {docs.map((d) => {
          const link = d.links.find((l) => l.target_type === "truck" && l.target_key === String(truckNumber));
          return (
            <li key={d.id} className="flex items-center gap-2 py-1.5">
              <a
                href={documentFileUrl(d.id)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-medium text-blue-300 hover:underline"
                title={d.title}
              >
                {d.title}
              </a>
              {d.category && (
                <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{d.category}</span>
              )}
              {link && (
                <button
                  className="shrink-0 rounded p-0.5 text-slate-500 hover:text-red-400"
                  title="Unlink from this truck"
                  onClick={() => removeLink.mutate({ documentId: d.id, linkId: link.id })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
