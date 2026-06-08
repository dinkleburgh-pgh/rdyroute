/**
 * Fleet management panel — add/edit/remove trucks. Extracted from Settings.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useAddTruck, useFleet, useRegenerateQR, useRemoveTruck, useUpdateTruck } from "../../api/hooks";
import type { TruckType } from "../../types";
import { FieldRow } from "./shared";

export default function FleetManagementPanel() {
  const { data: trucks, isLoading } = useFleet(true);
  const update = useUpdateTruck();
  const remove = useRemoveTruck();
  const add    = useAddTruck();
  const [selectedNum,    setSelectedNum]    = useState<number | null>(null);
  const [newNum,         setNewNum]         = useState("");
  const [newType,        setNewType]        = useState<TruckType>("Uniform");
  const [confirmDelete,  setConfirmDelete]  = useState(false);

  const sorted = useMemo(
    () => [...(trucks ?? [])].sort((a, b) => a.truck_number - b.truck_number),
    [trucks],
  );

  const selected = useMemo(
    () => sorted.find((t) => t.truck_number === selectedNum) ?? null,
    [sorted, selectedNum],
  );

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

      {selected && (
        <>
          <FieldRow label="Truck type">
            <select
              className="input"
              value={selected.truck_type}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ truck_number: selected.truck_number, truck_type: e.target.value as TruckType })}
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
                onChange={(e) => update.mutate({ truck_number: selected.truck_number, is_active: e.target.checked })}
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
                  onClick={() => { remove.mutate(selected.truck_number); setConfirmDelete(false); }}
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

      <div className="border-t border-slate-700 pt-4">
        <p className="mb-3 text-sm font-medium text-slate-300">Add truck</p>
        <div className="flex gap-2">
          <input
            type="number" min={1} max={9999} placeholder="Truck #"
            className="input w-28"
            value={newNum}
            onChange={(e) => setNewNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <select className="input flex-1" value={newType} onChange={(e) => setNewType(e.target.value as TruckType)}>
            <option value="Uniform">Uniform</option>
            <option value="Dust">Dust</option>
            <option value="Spare">Spare</option>
          </select>
          <button className="btn-primary" disabled={!newNum || add.isPending} onClick={handleAdd}>
            {add.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
