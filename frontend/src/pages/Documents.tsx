import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { File as FileIcon, FileText, Image as ImageIcon, Download, Trash2, Pencil, X, Save, Search, Link2, Plus, UploadCloud } from "lucide-react";
import {
  useDocuments,
  useUploadDocument,
  useUpdateDocument,
  useDeleteDocument,
  useAddDocumentLink,
  useRemoveDocumentLink,
  documentFileUrl,
  documentPreviewUrl,
  type DocumentItem,
} from "../api/hooks";
import PageHeader from "../components/PageHeader";
import ConfirmDialog from "../components/ConfirmDialog";
import DocumentViewer from "../components/DocumentViewer";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (m: string) => m.startsWith("image/");
const isPdf = (m: string) => m === "application/pdf";

// ---------------------------------------------------------------------------
// Upload panel
// ---------------------------------------------------------------------------
function UploadPanel({ categories }: { categories: string[] }) {
  const upload = useUploadDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [pct, setPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function doUpload() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      for (const file of files) {
        setPct(0);
        await upload.mutateAsync({
          file,
          // A typed title only makes sense for a single file; otherwise use the filename.
          title: files.length === 1 ? title.trim() || file.name : file.name,
          category: category.trim(),
          tags: tagList,
          onProgress: setPct,
        });
      }
      setFiles([]);
      setTitle("");
      setTags("");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
      setPct(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add documents</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">File(s) — any type, up to 25 MB each</label>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-500"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">{files.length} file{files.length !== 1 ? "s" : ""} selected</p>
          )}
        </div>
        <div>
          <label className="label">Title {files.length > 1 && <span className="text-slate-600">(filenames used for multiple)</span>}</label>
          <input className="input w-full" placeholder="Optional — defaults to filename" value={title} disabled={files.length > 1}
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Category</label>
          <input className="input w-full" placeholder="e.g. Manifests" value={category} list="doc-categories"
            onChange={(e) => setCategory(e.target.value)} />
          <datalist id="doc-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Tags (comma-separated)</label>
          <input className="input w-full" placeholder="e.g. safety, 2026, route-12" value={tags}
            onChange={(e) => setTags(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={files.length === 0 || busy} onClick={doUpload}>
          <UploadCloud className="mr-1 h-4 w-4" /> {busy ? "Uploading…" : `Upload${files.length > 1 ? ` ${files.length}` : ""}`}
        </button>
        {pct != null && (
          <div className="h-2 flex-1 max-w-xs overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview thumbnail
// ---------------------------------------------------------------------------
function Thumb({ doc, onOpen }: { doc: DocumentItem; onOpen: (d: DocumentItem) => void }) {
  // Server renders a JPEG preview for images (incl. HEIC) and PDFs (first page);
  // if it isn't previewable / generation failed, fall back to a type icon.
  const [imgErr, setImgErr] = useState(false);
  const image = isImage(doc.mime_type);
  const pdf = isPdf(doc.mime_type);
  const previewable = image || pdf;
  const ext = (doc.file_name.split(".").pop() || "file").toLowerCase();

  if (previewable && !imgErr) {
    return (
      <button type="button" onClick={() => onOpen(doc)} className="block" title="View">
        <img src={documentPreviewUrl(doc.id)} alt={doc.title} loading="lazy" onError={() => setImgErr(true)}
          className="h-32 w-full rounded-lg object-cover ring-1 ring-slate-700 transition hover:ring-blue-500" />
      </button>
    );
  }
  const Icon = pdf ? FileText : image ? ImageIcon : FileIcon;
  return (
    <button type="button" onClick={() => onOpen(doc)} title="View"
      className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg bg-slate-800/60 ring-1 ring-slate-700 transition hover:ring-blue-500">
      <Icon className={clsx("h-10 w-10", pdf ? "text-red-400" : image ? "text-blue-400" : "text-slate-400")} />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {pdf ? "PDF" : ext}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Document card
// ---------------------------------------------------------------------------
function DocCard({ doc, onOpen }: { doc: DocumentItem; onOpen: (d: DocumentItem) => void }) {
  const update = useUpdateDocument();
  const del = useDeleteDocument();
  const addLink = useAddDocumentLink();
  const removeLink = useRemoveDocumentLink();
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [form, setForm] = useState({ title: doc.title, category: doc.category, tags: doc.tags.join(", ") });
  const [linkTruck, setLinkTruck] = useState("");

  function saveEdit() {
    update.mutate({
      id: doc.id,
      title: form.title.trim() || doc.file_name,
      category: form.category.trim(),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setEditing(false);
  }

  const linkLabel = (t: string, k: string) => (t === "truck" ? `🚚 #${k}` : t === "run_date" ? `📅 ${k}` : `${t}:${k}`);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <Thumb doc={doc} onOpen={onOpen} />

      {editing ? (
        <div className="space-y-2">
          <input className="input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" autoFocus />
          <input className="input w-full" value={form.category} list="doc-categories" onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
          <input className="input w-full" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="tags, comma, separated" />
          <div className="flex gap-1">
            <button className="btn-primary text-xs px-2 py-1" onClick={saveEdit}><Save className="h-3 w-3" /></button>
            <button className="btn-ghost text-xs px-2 py-1" onClick={() => { setEditing(false); setForm({ title: doc.title, category: doc.category, tags: doc.tags.join(", ") }); }}><X className="h-3 w-3" /></button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={() => onOpen(doc)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-200 hover:text-blue-300" title={doc.title}>{doc.title}</button>
            <div className="flex shrink-0 gap-1">
              <button className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" title="Edit" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></button>
              <a className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" title="Download" href={documentFileUrl(doc.id)} download={doc.file_name}><Download className="h-3.5 w-3.5" /></a>
              <button className="rounded p-1 text-slate-500 hover:bg-red-900/50 hover:text-red-300" title="Delete" onClick={() => setConfirmDel(true)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {doc.category && <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">{doc.category}</span>}
            {doc.tags.map((t) => <span key={t} className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{t}</span>)}
          </div>
          <p className="text-[10px] text-slate-500">
            {isImage(doc.mime_type) ? "Image" : isPdf(doc.mime_type) ? "PDF" : (doc.file_name.split(".").pop() || "file")} · {fmtSize(doc.size_bytes)} · {doc.uploaded_by || "—"}
          </p>

          {/* Links — referenced-in-context */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800 pt-2">
            <Link2 className="h-3 w-3 text-slate-600" />
            {doc.links.length === 0 && <span className="text-[10px] italic text-slate-600">not linked</span>}
            {doc.links.map((lk) => (
              <span key={lk.id} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                {linkLabel(lk.target_type, lk.target_key)}
                <button className="text-slate-500 hover:text-red-400" title="Unlink" onClick={() => removeLink.mutate({ documentId: doc.id, linkId: lk.id })}><X className="h-2.5 w-2.5" /></button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input className="input h-7 w-20 text-xs" type="number" min={1} placeholder="Truck #" value={linkTruck} onChange={(e) => setLinkTruck(e.target.value)} />
            <button className="btn-ghost text-xs px-2 py-1" disabled={!linkTruck.trim()}
              onClick={() => { addLink.mutate({ documentId: doc.id, targetType: "truck", targetKey: linkTruck.trim() }); setLinkTruck(""); }}>
              <Plus className="h-3 w-3" /> Link truck
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmDel}
        title={`Delete "${doc.title}"?`}
        description="This permanently removes the file and its links. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { del.mutate(doc.id); setConfirmDel(false); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Documents() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [viewerDoc, setViewerDoc] = useState<DocumentItem | null>(null);
  const { data: docs = [], isLoading } = useDocuments({ q: q || undefined, category: category || undefined, tag: tag || undefined });
  // Fetch the full set (unfiltered) once for building filter option lists.
  const { data: allDocs = [] } = useDocuments();

  const categories = useMemo(
    () => Array.from(new Set(allDocs.map((d) => d.category).filter(Boolean))).sort(),
    [allDocs],
  );
  const allTags = useMemo(
    () => Array.from(new Set(allDocs.flatMap((d) => d.tags))).sort(),
    [allDocs],
  );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Workflow" title="Documents" subtitle="Store and reference files and photos of documents. Leads & admins only." />

      <UploadPanel categories={categories} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input w-full pl-8" placeholder="Search title, description, filename…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-12 text-center">
          <p className="text-sm text-slate-500">{allDocs.length === 0 ? "No documents yet — upload one above." : "No documents match your filters."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {docs.map((doc) => <DocCard key={doc.id} doc={doc} onOpen={setViewerDoc} />)}
        </div>
      )}

      <DocumentViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />
    </div>
  );
}
