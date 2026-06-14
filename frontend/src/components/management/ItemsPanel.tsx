/**
 * Tracked Items panel — catalog of audit/shortage items grouped by category.
 * Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useTrackedItems, useUpdateTrackedItems, type TrackedItem } from "../../api/hooks";
import ConfirmDialog from "../ConfirmDialog";

export default function ItemsPanel({ disabled }: { disabled: boolean }) {
  const { data: items, isLoading } = useTrackedItems();
  const save = useUpdateTrackedItems();
  const [draft, setDraft] = useState<TrackedItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>("__all__");
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ label: string; category: string; qty: string }>({ label: "", category: "", qty: "1" });
  const [confirmRemoveLabel, setConfirmRemoveLabel] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");

  useEffect(() => { if (items) setDraft(items); }, [items]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(items ?? []);

  const itemCategories = useMemo(() => {
    const s = new Set(draft.map((d) => d.category ?? "").filter(Boolean));
    return Array.from(s).sort();
  }, [draft]);

  const categories = useMemo(() => {
    const merged = new Set([...itemCategories, ...extraCategories.map((c) => c.trim()).filter(Boolean)]);
    return Array.from(merged).sort();
  }, [extraCategories, itemCategories]);

  const groups = useMemo(() => {
    const map = new Map<string, TrackedItem[]>();
    for (const it of draft) {
      const key = it.category?.trim() || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    const named = categories.map((category) => [category, map.get(category) ?? []] as [string, TrackedItem[]]);
    const uncategorised = map.get("") ?? [];
    return uncategorised.length > 0 ? [...named, ["", uncategorised] as [string, TrackedItem[]]] : named;
  }, [categories, draft]);

  const visibleGroups = activeTab === "__all__"
    ? groups
    : groups.filter(([k]) => k === activeTab || (activeTab === "" && k === ""));

  function removeItem(label: string) {
    setConfirmRemoveLabel(label);
  }

  function doRemove() {
    if (!confirmRemoveLabel) return;
    setDraft((d) => d.filter((it) => it.label !== confirmRemoveLabel));
    if (editingLabel === confirmRemoveLabel) setEditingLabel(null);
    setConfirmRemoveLabel(null);
  }

  function startEdit(it: TrackedItem) {
    setEditingLabel(it.label);
    setEditForm({ label: it.label, category: it.category ?? "", qty: String(it.qty_default) });
  }

  function commitEdit() {
    if (!editingLabel) return;
    const newLabel = editForm.label.trim();
    if (!newLabel) return;
    setDraft((d) => d.map((it) =>
      it.label === editingLabel
        ? { label: newLabel, qty_default: Math.max(1, parseInt(editForm.qty || "1", 10)), category: editForm.category.trim() || undefined }
        : it,
    ));
    setEditingLabel(null);
  }

  function addItemToCategory(cat: string) {
    const label = addLabel.trim();
    const finalCat = cat.trim();
    if (!label || draft.some((d) => d.label.toLowerCase() === label.toLowerCase())) return;
    if (!finalCat) return;
    setDraft((d) => [...d, { label, qty_default: Math.max(1, parseInt(addQty || "1", 10)), category: finalCat }]);
    setExtraCategories((current) => current.filter((category) => category !== finalCat));
    setAddLabel(""); setAddQty("1"); setAddingToCategory(null);
  }

  function addCategory() {
    const category = newCategoryName.trim();
    if (!category) return;
    if (categories.some((existing) => existing.toLowerCase() === category.toLowerCase())) return;
    setExtraCategories((current) => [...current, category]);
    setNewCategoryName("");
    setActiveTab(category);
    setAddingToCategory(category);
    setAddLabel("");
    setAddQty("1");
  }

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
    if (incoming.length) setDraft((d) => [...d, ...incoming]);
    setImportText(""); setImportOpen(false);
  }

  const unsavedCount = useMemo(() => {
    const a = draft; const b = items ?? [];
    if (a.length !== b.length) return Math.abs(a.length - b.length);
    return a.filter((x, i) => JSON.stringify(x) !== JSON.stringify(b[i])).length;
  }, [draft, items]);

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Tracked Items</h3>
          <p className="text-xs text-slate-500">{draft.length} item{draft.length !== 1 ? "s" : ""} across {categories.length} categor{categories.length !== 1 ? "ies" : "y"}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-amber-400">{unsavedCount} unsaved change{unsavedCount !== 1 ? "s" : ""}</span>}
          <button className="btn-primary" disabled={disabled || !dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button className="btn-ghost" disabled={!dirty || save.isPending} onClick={() => { setDraft(items ?? []); setEditingLabel(null); }}>
            Revert
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-1">
        {[["__all__", `All (${draft.length})`], ...groups.map(([k, its]) => [k, `${k || "None"} (${(its as TrackedItem[]).length})`])].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx("rounded-md px-3 py-1 text-xs font-semibold transition-colors",
              activeTab === tab ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200")}>
            {label}
          </button>
        ))}
      </div>

      {draft.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 py-10 text-center">
          <p className="text-sm text-slate-500">No tracked items yet.</p>
          <p className="mt-1 text-xs text-slate-600">Add a category first, then add items inside it.</p>
        </div>
      )}

      <div className="card p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Add category</p>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-end">
          <div className="min-w-0 sm:min-w-[14rem] sm:flex-1">
            <label className="label">Category name</label>
            <input
              className="input"
              placeholder="New category"
              value={newCategoryName}
              disabled={disabled}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
            />
          </div>
          <button className="btn-primary w-full sm:w-auto" disabled={disabled || !newCategoryName.trim()} onClick={addCategory}>
            Add category
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">New items are added from inside each category card.</p>
      </div>

      {visibleGroups.map(([cat, groupItems]) => {
        const catItems = groupItems as TrackedItem[];
        const isAdding = addingToCategory === cat;
        return (
          <div key={cat || "__none__"} className="card space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {cat || "Uncategorised"}<span className="ml-1.5 font-normal text-slate-600">({catItems.length})</span>
              </span>
              {!disabled && cat !== "" && (
                <button className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => { setAddingToCategory(isAdding ? null : cat); setAddLabel(""); setAddQty("1"); }}>
                  {isAdding ? "Cancel" : "+ Add item"}
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {catItems.map((it) => {
                const isEditing = editingLabel === it.label;
                if (isEditing) {
                  return (
                    <div key={it.label} className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-blue-600/50 bg-slate-800/60 p-2.5">
                      <div className="min-w-0 flex-1">
                        <label className="label">Label</label>
                        <input className="input" value={editForm.label} autoFocus
                          onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingLabel(null); }} />
                      </div>
                      <div className="w-40">
                        <label className="label">Category</label>
                        <input className="input" list="items-category-datalist" placeholder="None" value={editForm.category}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
                      </div>
                      <div className="w-20">
                        <label className="label">Qty</label>
                        <input type="number" min={1} className="input" value={editForm.qty}
                          onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })} />
                      </div>
                      <div className="flex gap-2 pb-0.5">
                        <button className="btn-primary text-xs" onClick={commitEdit}>Save</button>
                        <button className="btn-ghost text-xs" onClick={() => setEditingLabel(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={it.label} className="group flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 pl-3 pr-1 py-1 text-sm text-slate-200 transition-colors hover:border-slate-600">
                    <button className="min-w-0 truncate font-medium leading-none" disabled={disabled} onClick={() => startEdit(it)} title="Click to edit">
                      {it.label}
                    </button>
                    {it.qty_default !== 1 && (
                      <span className="ml-1 shrink-0 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">×{it.qty_default}</span>
                    )}
                    {!disabled && (
                      <button onClick={() => removeItem(it.label)}
                        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-red-500/20 hover:text-red-400" title="Remove">
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isAdding && !disabled && cat !== "" && (
              <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-700 bg-slate-800/40 p-2.5 sm:flex sm:flex-wrap sm:items-end">
                <div className="min-w-0 sm:min-w-[14rem] sm:flex-1">
                  <label className="label">Label</label>
                  <input className="input" placeholder="Item name" value={addLabel} autoFocus
                    onChange={(e) => setAddLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addItemToCategory(cat); if (e.key === "Escape") setAddingToCategory(null); }} />
                </div>
                <div className="w-full sm:w-20">
                  <label className="label">Qty</label>
                  <input type="number" min={1} className="input" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                </div>
                <button className="btn-primary w-full text-xs sm:w-auto sm:self-auto" disabled={!addLabel.trim()} onClick={() => addItemToCategory(cat)}>Add</button>
              </div>
            )}
          </div>
        );
      })}

      <datalist id="items-category-datalist">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      <div className="flex items-center gap-2">
        <button className="btn-ghost text-xs" disabled={disabled} onClick={() => setImportOpen((v) => !v)}>
          {importOpen ? "Cancel import" : "Bulk import JSON…"}
        </button>
      </div>

      {importOpen && (
        <div className="card space-y-2">
          <p className="text-xs font-semibold text-slate-300">Bulk import</p>
          <p className="text-xs text-slate-500">Paste a JSON object mapping category names to arrays of item labels:</p>
          <pre className="rounded bg-slate-800/60 px-3 py-2 text-xs text-slate-400">{`{\n  "Dust Mops": ["24\\"", "36\\"", "46\\""],\n  "Towels": ["Terry", "Glass", "Premium"]\n}`}</pre>
          <textarea className="input w-full font-mono text-xs" rows={5} placeholder='{ "Category": ["item1", "item2"] }'
            value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!importText.trim()} onClick={applyBulkImport}>Apply import</button>
            <button className="btn-ghost" onClick={() => { setImportOpen(false); setImportText(""); }}>Cancel</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemoveLabel !== null}
        title={`Remove "${confirmRemoveLabel}"?`}
        description="This item will be removed from the tracked items catalog. Save changes to make it permanent."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={doRemove}
        onCancel={() => setConfirmRemoveLabel(null)}
      />
    </div>
  );
}
