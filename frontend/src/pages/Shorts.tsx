import { useState, type FormEvent } from "react";
import { useCreateShortage, useShortageCategories, useShortages } from "../api/hooks";
import { todayIso } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

export default function Shorts() {
  const [runDate, setRunDate] = useState(todayIso());
  const [truck, setTruck] = useState("");
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [qty, setQty] = useState("1");
  const { user } = useAuth();

  const { data: shortages, isLoading } = useShortages(
    runDate,
    truck ? Number(truck) : undefined,
  );
  const { data: categories } = useShortageCategories();
  const create = useCreateShortage();

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!truck || !category) return;
    await create.mutateAsync({
      truck_number: Number(truck),
      run_date: runDate,
      item_category: category,
      item_detail: detail,
      quantity: Number(qty || 1),
      initials: user?.username?.slice(0, 3).toUpperCase() ?? "",
    });
    setCategory("");
    setDetail("");
    setQty("1");
  }

  const topLevel = categories ? Object.keys(categories) : [];

  return (
    <div className="space-y-4 p-3 md:p-6">
      <h2 className="text-2xl font-semibold">Shortages</h2>

      <form onSubmit={onAdd} className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32 shrink-0">
            <label className="label">Date</label>
            <input
              className="input"
              type="date"
              max={todayIso()}
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
            />
          </div>
          <div className="w-20 shrink-0">
            <label className="label">Truck #</label>
            <input
              className="input"
              type="number"
              value={truck}
              onChange={(e) => setTruck(e.target.value)}
            />
          </div>
          <div className="w-28 shrink-0">
            <label className="label">Category</label>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">— select —</option>
              {topLevel.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label className="label">Detail</label>
            <input
              className="input w-full"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </div>
          <div className="w-14 shrink-0">
            <label className="label">Qty</label>
            <input
              className="input"
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <button className="btn-primary shrink-0" disabled={create.isPending}>
            Add
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Truck</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Initials</th>
              <th className="px-3 py-2">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {(shortages ?? []).map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-semibold">#{s.truck_number}</td>
                <td className="px-3 py-2">{s.item_category}</td>
                <td className="px-3 py-2">{s.item_detail}</td>
                <td className="px-3 py-2">{s.quantity}</td>
                <td className="px-3 py-2">{s.initials}</td>
                <td className="px-3 py-2 text-slate-400">
                  {new Date(s.recorded_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {!isLoading && (shortages ?? []).length === 0 && (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={6}>
                  No shortages recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
