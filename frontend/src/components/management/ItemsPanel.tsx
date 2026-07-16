import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useTrackedItems, useUpdateTrackedItems, type TrackedItem } from "../../api/hooks";
import ConfirmDialog from "../ConfirmDialog";
import { Plus, Trash2, Save, RotateCcw, Upload, Package, X, AlertTriangle } from "lucide-react";

const UNIT_PRESETS = ["Case", "Bag", "Bundle", "Roll", "Box", "Pack"];

/** A pack quantity is set but its unit name (Case/Bag/…) is missing. */
function needsConfig(it: TrackedItem): boolean {
  return it.pack_size != null && it.pack_size > 0 && !it.unit_label?.trim();
}

export default function ItemsPanel({ disabled }: { disabled: boolean }) {
  const { data: items, isLoading } = useTrackedItems();
  const save = useUpdateTrackedItems();
  const [draft, setDraft] = useState<TrackedItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>("__all__");
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ label: string; packSize: string; unitLabel: string }>({ label: "", packSize: "", unitLabel: "" });
  const [confirmRemoveLabel, setConfirmRemoveLabel] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ label: "", packSize: "", unitLabel: "" });
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

  const needsConfigCount = useMemo(() => draft.filter(needsConfig).length, [draft]);

  const visibleGroups = useMemo<[string, TrackedItem[]][]>(() => {
    if (activeTab === "__needscfg__") {
      return groups
        .map(([k, its]) => [k, its.filter(needsConfig)] as [string, TrackedItem[]])
        .filter(([, its]) => its.length > 0);
    }
    if (activeTab === "__all__") return groups;
    return groups.filter(([k]) => k === activeTab || (activeTab === "" && k === ""));
  }, [activeTab, groups]);

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
    setEditForm({ label: it.label, packSize: it.pack_size ? String(it.pack_size) : "", unitLabel: it.unit_label ?? "" });
  }

  function cancelEdit() {
    setEditingLabel(null);
  }

  function commitEdit() {
    if (!editingLabel) return;
    const newLabel = editForm.label.trim();
    if (!newLabel) return;
    const parsedPack = parseInt(editForm.packSize, 10);
    const packSize = editForm.packSize.trim() && !isNaN(parsedPack) && parsedPack > 0 ? parsedPack : undefined;
    const unitLabel = packSize ? (editForm.unitLabel.trim() || undefined) : undefined;
    setDraft((d) => d.map((it) =>
      it.label === editingLabel
        ? { ...it, label: newLabel, pack_size: packSize, unit_label: unitLabel }
        : it,
    ));
    setEditingLabel(null);
  }

  function togglePack(label: string) {
    setDraft((d) => d.map((it) => {
      if (it.label !== label) return it;
      if (it.pack_size) return { ...it, pack_size: undefined };
      return { ...it, pack_size: 12 };
    }));
  }

  function addItemToCategory(cat: string) {
    const label = addForm.label.trim();
    const finalCat = cat.trim();
    if (!label || draft.some((d) => d.label.toLowerCase() === label.toLowerCase())) return;
    if (!finalCat) return;
    const parsedPack = parseInt(addForm.packSize, 10);
    const packSize = addForm.packSize.trim() && !isNaN(parsedPack) && parsedPack > 0 ? parsedPack : undefined;
    const unitLabel = packSize ? (addForm.unitLabel.trim() || undefined) : undefined;
    setDraft((d) => [...d, { label, qty_default: 1, category: finalCat, pack_size: packSize, unit_label: unitLabel }]);
    setExtraCategories((current) => current.filter((category) => category !== finalCat));
    setAddForm({ label: "", packSize: "", unitLabel: "" });
    setAddingToCategory(null);
  }

  function addCategory() {
    const category = newCategoryName.trim();
    if (!category) return;
    if (categories.some((existing) => existing.toLowerCase() === category.toLowerCase())) return;
    setExtraCategories((current) => [...current, category]);
    setNewCategoryName("");
    setActiveTab(category);
    setAddingToCategory(category);
    setAddForm({ label: "", packSize: "", unitLabel: "" });
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
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Tracked Items</h3>
          <p className="text-xs text-slate-500">
            {draft.length} item{draft.length !== 1 ? "s" : ""} across {categories.length} categor{categories.length !== 1 ? "ies" : "y"}
            {needsConfigCount > 0 && (
              <button onClick={() => setActiveTab("__needscfg__")} className="ml-2 inline-flex items-center gap-1 text-amber-400 hover:underline">
                <AlertTriangle className="h-3 w-3" /> {needsConfigCount} need{needsConfigCount !== 1 ? "" : "s"} a unit
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-amber-400">{unsavedCount} unsaved</span>}
          <button className="btn-primary" disabled={disabled || !dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? "Saving…" : <><Save className="mr-1 h-3.5 w-3.5" /> Save</>}
          </button>
          <button className="btn-ghost" disabled={!dirty || save.isPending} onClick={() => { setDraft(items ?? []); setEditingLabel(null); }}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Revert
          </button>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-1.5">
        {[["__all__", `All (${draft.length})`], ...groups.map(([k, its]) => [k, `${k || "None"} (${(its as TrackedItem[]).length})`])].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx("rounded-md px-3 py-1 text-xs font-semibold transition-colors",
              activeTab === tab ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200")}>
            {label}
          </button>
        ))}
        {needsConfigCount > 0 && (
          <button onClick={() => setActiveTab("__needscfg__")}
            className={clsx("flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors",
              activeTab === "__needscfg__" ? "bg-amber-600 text-white" : "text-amber-400 hover:bg-amber-900/30")}>
            <AlertTriangle className="h-3 w-3" /> Needs unit ({needsConfigCount})
          </button>
        )}
      </div>

      {draft.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 py-10 text-center">
          <p className="text-sm text-slate-500">No tracked items yet.</p>
          <p className="mt-1 text-xs text-slate-600">Add a category first, then add items inside it.</p>
        </div>
      )}

      {/* Add category */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Add category</p>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-end">
          <div className="min-w-0 sm:min-w-[14rem] sm:flex-1">
            <label className="label">Category name</label>
            <input className="input" placeholder="New category" value={newCategoryName} disabled={disabled}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }} />
          </div>
          <button className="btn-primary w-full sm:w-auto" disabled={disabled || !newCategoryName.trim()} onClick={addCategory}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Category cards */}
      {visibleGroups.map(([cat, groupItems]) => {
        const catItems = groupItems as TrackedItem[];
        const isAdding = addingToCategory === cat;
        return (
          <div key={cat || "__none__"} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {cat || "Uncategorised"}
                <span className="ml-2 font-normal text-slate-600">{catItems.length}</span>
              </span>
              {!disabled && cat !== "" && (
                <button className="flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
                  onClick={() => { setAddingToCategory(isAdding ? null : cat); setAddForm({ label: "", packSize: "", unitLabel: "" }); }}>
                  <Plus className="h-3 w-3" /> {isAdding ? "Cancel" : "Add Item"}
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 p-3">
              {catItems.map((it) => {
                const isEditing = editingLabel === it.label;
                const hasPack = it.pack_size != null && it.pack_size > 0;
                const missingUnit = needsConfig(it);

                if (isEditing) {
                  return (
                    <div key={it.label} className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-blue-600/50 bg-slate-800/60 p-2.5">
                      <div className="min-w-0 flex-[2]">
                        <label className="label">Label</label>
                        <input className="input w-full" value={editForm.label} autoFocus
                          onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} />
                      </div>
                      <div>
                        <label className="label">Pieces / unit</label>
                        <input type="number" min={1} className="input w-20" placeholder="12" value={editForm.packSize}
                          onChange={(e) => setEditForm({ ...editForm, packSize: e.target.value })} />
                      </div>
                      {editForm.packSize.trim() && (
                        <div className="min-w-0 flex-1">
                          <label className="label">Unit name</label>
                          <input className="input w-full" placeholder="Case / Bag / Bundle" value={editForm.unitLabel} list="unit-presets"
                            onChange={(e) => setEditForm({ ...editForm, unitLabel: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} />
                        </div>
                      )}
                      <div className="flex gap-1 pb-0.5">
                        <button className="btn-primary text-xs px-2 py-1" onClick={commitEdit}><Save className="h-3 w-3" /></button>
                        <button className="btn-ghost text-xs px-2 py-1" onClick={cancelEdit}><X className="h-3 w-3" /></button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={it.label} className="group flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 pl-3 pr-1 py-1 text-sm text-slate-200 transition-colors hover:border-slate-600">
                    <button className="truncate font-medium leading-none max-w-[8rem]" disabled={disabled} onClick={() => startEdit(it)} title="Edit item">
                      {it.label}
                    </button>
                    <button
                      onClick={() => (missingUnit ? startEdit(it) : togglePack(it.label))}
                      className={clsx(
                        "ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all",
                        missingUnit
                          ? "bg-amber-900/40 text-amber-400 hover:bg-amber-900/60"
                          : hasPack
                            ? "bg-emerald-900/40 text-emerald-400"
                            : "bg-slate-700/50 text-slate-500 hover:bg-slate-700 hover:text-slate-300",
                      )}
                      title={missingUnit ? "Pack size set but no unit name — click to add (Case/Bag/…)" : hasPack ? `${it.pack_size} per ${it.unit_label}` : "Click to set pieces per pack"}
                    >
                      {missingUnit ? <AlertTriangle className="h-2.5 w-2.5" /> : <Package className="h-2.5 w-2.5" />}
                      {hasPack ? `${it.pack_size}/${it.unit_label || "?"}` : "Single"}
                    </button>
                    {!disabled && (
                      <button onClick={() => removeItem(it.label)}
                        className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-slate-600 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100" title="Remove">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add item form */}
            {isAdding && !disabled && cat !== "" && (
              <div className="border-t border-slate-800/60 bg-slate-800/20 px-4 py-3">
                <div className="grid grid-cols-1 gap-3 sm:flex sm:items-end sm:gap-2">
                  <div className="sm:min-w-[12rem] sm:flex-1">
                    <label className="label">Label</label>
                    <input className="input w-full" placeholder="Item name" value={addForm.label} autoFocus
                      onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") addItemToCategory(cat); if (e.key === "Escape") setAddingToCategory(null); }} />
                  </div>
                  <div>
                    <label className="label">Pieces / unit</label>
                    <input type="number" min={1} className="input w-20" placeholder="12" value={addForm.packSize}
                      onChange={(e) => setAddForm({ ...addForm, packSize: e.target.value })} />
                  </div>
                  {addForm.packSize.trim() && (
                    <div className="sm:min-w-[8rem]">
                      <label className="label">Unit name</label>
                      <input className="input w-full" placeholder="Case / Bag / Bundle" value={addForm.unitLabel} list="unit-presets"
                        onChange={(e) => setAddForm({ ...addForm, unitLabel: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") addItemToCategory(cat); if (e.key === "Escape") setAddingToCategory(null); }} />
                    </div>
                  )}
                  <button className="btn-primary text-xs" disabled={!addForm.label.trim()} onClick={() => addItemToCategory(cat)}>
                    <Plus className="mr-1 h-3 w-3" /> Add
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <datalist id="items-category-datalist">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      <datalist id="unit-presets">
        {UNIT_PRESETS.map((u) => <option key={u} value={u} />)}
      </datalist>

      {/* Bulk import */}
      <div className="flex items-center gap-2">
        <button className="btn-ghost text-xs" disabled={disabled} onClick={() => setImportOpen((v) => !v)}>
          <Upload className="mr-1 h-3.5 w-3.5" /> {importOpen ? "Cancel import" : "Bulk import JSON"}
        </button>
      </div>

      {importOpen && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-300">Bulk import</p>
          <p className="text-xs text-slate-500">Paste a JSON object mapping category names to arrays of item labels:</p>
          <pre className="rounded bg-slate-800/60 px-3 py-2 text-xs text-slate-400">{`{\n  "Dust Mops": ["24\"", "36\"", "46\""],\n  "Towels": ["Terry", "Glass", "Premium"]\n}`}</pre>
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