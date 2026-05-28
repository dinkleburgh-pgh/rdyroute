import { useEffect, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import {
  useAddTruck,
  useBoard,
  useFleet,
  useRemoveTruck,
  useUpdateTruck,
  useUpsertTruckState,
} from "../api/hooks";
import { todayIso } from "../api/client";
import type { TruckStatus, TruckWithState } from "../types";

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

// Solid V1-style status colors for the grid tiles.
const STATUS_TILE: Record<TruckStatus, string> = {
  dirty: "bg-red-600 hover:bg-red-500 border-red-900",
  shop: "bg-purple-700 hover:bg-purple-600 border-purple-900",
  in_progress: "bg-amber-500 hover:bg-amber-400 border-amber-700 text-slate-900",
  unloaded: "bg-emerald-600 hover:bg-emerald-500 border-emerald-800",
  loaded: "bg-sky-600 hover:bg-sky-500 border-sky-800",
  off: "bg-slate-500 hover:bg-slate-400 border-slate-700",
  oos: "bg-slate-600 hover:bg-slate-500 border-slate-700 opacity-80",
  spare: "bg-purple-600 hover:bg-purple-500 border-purple-700",
};

const STATUS_DOT: Record<TruckStatus, string> = {
  dirty: "bg-red-500",
  shop: "bg-purple-700",
  in_progress: "bg-amber-400",
  unloaded: "bg-emerald-500",
  loaded: "bg-sky-500",
  off: "bg-slate-500",
  oos: "bg-slate-600",
  spare: "bg-purple-500",
};

// 'spare' is a truck *type* and 'off' is set elsewhere — neither is offered as a status.
const STATUS_OPTIONS: TruckStatus[] = [
  "dirty",
  "shop",
  "unloaded",
  "loaded",
  "oos",
];

// V1 DUST_GARMENT_TRUCK_OPTIONS: trucks 80-95 except 90 and 91.
function isDustGarmentEligible(n: number): boolean {
  return n >= 80 && n <= 95 && n !== 90 && n !== 91;
}

type Mode = "single" | "multi" | "addremove";

export default function Fleet() {
  const [runDate] = useState(todayIso());
  const { data: board, isLoading } = useBoard(runDate);
  const upsert = useUpsertTruckState();
  const [mode, setMode] = useState<Mode>("single");
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [multi, setMulti] = useState<Set<number>>(new Set());

  const trucks = useMemo(
    () => (board ?? []).slice().sort((a, b) => a.truck_number - b.truck_number),
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

  // Live lookup so the open action modal always reflects the latest board state.
  const selected = useMemo(
    () =>
      selectedNum == null
        ? null
        : (trucks.find((t) => t.truck_number === selectedNum) ?? null),
    [trucks, selectedNum],
  );

  function handleTileClick(t: TruckWithState) {
    if (mode === "multi") {
      setMulti((prev) => {
        const next = new Set(prev);
        if (next.has(t.truck_number)) next.delete(t.truck_number);
        else next.add(t.truck_number);
        return next;
      });
    } else {
      setSelectedNum(t.truck_number);
    }
  }

  function bulkSet(status: TruckStatus) {
    Array.from(multi).forEach((n) => {
      const t = trucks.find((x) => x.truck_number === n);
      upsert.mutate({
        truck_number: n,
        run_date: runDate,
        status,
        wearers: t?.state?.wearers ?? 0,
      });
    });
    setMulti(new Set());
  }

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Fleet</h2>
          <p className="text-xs text-slate-400">
            {trucks.length} active trucks · click a tile to act
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeButton current={mode} value="single" onClick={setMode}>
            Single
          </ModeButton>
          <ModeButton current={mode} value="multi" onClick={setMode}>
            Multi Select{multi.size > 0 ? ` · ${multi.size}` : ""}
          </ModeButton>
          <ModeButton current={mode} value="addremove" onClick={setMode}>
            Add / Remove
          </ModeButton>
        </div>
      </div>

      {/* Status overview */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((s) => (
          <div
            key={s}
            className="flex items-center gap-1.5 rounded-md border border-slate-700/60 bg-slate-900/60 px-3 py-1.5"
          >
            <span className={clsx("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
            <span className="text-xs text-slate-400">{STATUS_LABELS[s]}</span>
            <span className="text-xs font-bold text-slate-200">{counts[s] ?? 0}</span>
          </div>
        ))}
      </div>

      {mode === "multi" && multi.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm text-slate-400">Set status for {multi.size}:</span>
          {STATUS_OPTIONS.map((s) => (
            <button key={s} className="btn-ghost text-xs" onClick={() => bulkSet(s)}>
              {STATUS_LABELS[s]}
            </button>
          ))}
          <button className="btn-ghost text-xs" onClick={() => setMulti(new Set())}>
            Clear
          </button>
        </div>
      )}

      {isLoading && <p className="text-slate-500">Loading…</p>}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
        {trucks.map((t) => {
          const status = (t.state?.status ?? "dirty") as TruckStatus;
          const isSelected = mode === "multi" && multi.has(t.truck_number);
          const isOOS = status === "oos" || status === "spare";
          return (
            <button
              key={t.truck_number}
              type="button"
              onClick={() => handleTileClick(t)}
              className={clsx(
                "relative flex h-16 items-center justify-center rounded-lg border-b-4 text-2xl font-black text-white shadow transition active:translate-y-px",
                STATUS_TILE[status],
                isSelected && "ring-4 ring-yellow-300",
                status === "in_progress" && "animate-pulse ring-2 ring-amber-400",
              )}
              title={`${STATUS_LABELS[status]}${t.state?.wearers ? ` · ${t.state.wearers}w` : ""}`}
            >
              <span
                className={clsx(
                  "drop-shadow",
                  isOOS && "line-through decoration-red-500 decoration-2",
                )}
                style={{ WebkitTextStroke: "0.75px rgba(0,0,0,0.9)" }}
              >
                {t.truck_number}
              </span>
              {isOOS && (
                <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[9px] font-bold tracking-wide">
                  OOS
                </span>
              )}
              {t.state?.wearers ? (
                <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold text-white/80">
                  {t.state.wearers}w
                </span>
              ) : null}
              {t.state?.has_dust_garment && (
                <span
                  className="absolute left-1 top-1 rounded bg-yellow-300 px-1 text-[9px] font-bold text-slate-900"
                  title="Dust garment loaded"
                >
                  D
                </span>
              )}
            </button>
          );
        })}
      </div>

      {mode === "addremove" && <AddRemovePanel />}

      {selected && mode === "single" && (
        <TruckActionPanel
          truck={selected}
          runDate={runDate}
          onClose={() => setSelectedNum(null)}
        />
      )}
    </div>
  );
}

function ModeButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Mode;
  value: Mode;
  onClick: (v: Mode) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={clsx(
        "rounded-md border px-3 py-1.5 text-sm",
        current === value
          ? "border-blue-500 bg-blue-600 text-white"
          : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700",
      )}
    >
      {children}
    </button>
  );
}

function TruckActionPanel({
  truck,
  runDate,
  onClose,
}: {
  truck: TruckWithState;
  runDate: string;
  onClose: () => void;
}) {
  const upsert = useUpsertTruckState();
  const updateTruck = useUpdateTruck();
  const status = (truck.state?.status ?? "dirty") as TruckStatus;
  const [wearers, setWearers] = useState(truck.state?.wearers ?? 0);
  const [offNote, setOffNote] = useState(truck.state?.off_note ?? "");
  const [shopNote, setShopNote] = useState(truck.state?.shop_note ?? "");
  const [oosRoute, setOosRoute] = useState<string>(
    truck.state?.oos_spare_route?.toString() ?? "",
  );
  const dustEligible = isDustGarmentEligible(truck.truck_number);
  const [hasDust, setHasDust] = useState<boolean>(truck.state?.has_dust_garment ?? false);

  // Sync local state when server data refreshes (e.g. wearers updated via Batches)
  useEffect(() => { setWearers(truck.state?.wearers ?? 0); }, [truck.state?.wearers]);
  useEffect(() => { setHasDust(truck.state?.has_dust_garment ?? false); }, [truck.state?.has_dust_garment]);

  const offDays: number[] = truck.scheduled_off_days ?? [];
  const [editingOffDays, setEditingOffDays] = useState(false);
  const [pendingOffDays, setPendingOffDays] = useState<number[]>([]);

  function openOffDayEditor() {
    setPendingOffDays([...offDays]);
    setEditingOffDays(true);
  }

  function cancelOffDayEdit() {
    setEditingOffDays(false);
    setPendingOffDays([]);
  }

  function togglePendingOffDay(day: number) {
    setPendingOffDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...new Set([...prev, day])].sort((a, b) => a - b),
    );
  }

  function saveOffDays() {
    updateTruck.mutate(
      { truck_number: truck.truck_number, scheduled_off_days: pendingOffDays },
      { onSuccess: () => { setEditingOffDays(false); setPendingOffDays([]); } },
    );
  }

  function setStatus(next: TruckStatus) {
    upsert.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      status: next,
      wearers,
    });
  }

  function saveNotes() {
    upsert.mutate({
      truck_number: truck.truck_number,
      run_date: runDate,
      off_note: offNote,
      shop_note: shopNote,
      oos_spare_route: oosRoute === "" ? null : Number(oosRoute),
      wearers,
      has_dust_garment: dustEligible ? hasDust : undefined,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold">Truck #{truck.truck_number}</h3>
            <p className="text-xs text-slate-400">
              {truck.truck_type} · {STATUS_LABELS[status]}
              {truck.is_persistent_spare ? " · persistent spare" : ""}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <section>
          <p className="label">Set status</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={clsx(
                  "rounded px-3 py-1.5 text-sm font-medium",
                  status === s
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700",
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="label">Wearers</span>
            <input
              type="number"
              className="input w-full"
              value={wearers}
              onChange={(e) => setWearers(Number(e.target.value) || 0)}
            />
          </label>
          <label className="text-sm">
            <span className="label">OOS covers route</span>
            <input
              type="number"
              className="input w-full"
              placeholder="(none)"
              value={oosRoute}
              onChange={(e) => setOosRoute(e.target.value)}
            />
          </label>
        </section>

        <section className="space-y-2">
          <label className="text-sm">
            <span className="label">OFF note</span>
            <textarea
              className="input min-h-[60px] w-full"
              value={offNote}
              onChange={(e) => setOffNote(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="label">SHOP note</span>
            <textarea
              className="input min-h-[60px] w-full"
              value={shopNote}
              onChange={(e) => setShopNote(e.target.value)}
            />
          </label>
          {dustEligible && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasDust}
                onChange={(e) => setHasDust(e.target.checked)}
              />
              Dust garment loaded today
            </label>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="label">Scheduled off days</p>
            {!editingOffDays && (
              <button
                type="button"
                onClick={openOffDayEditor}
                className="rounded px-2 py-1 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
              >
                Edit schedule
              </button>
            )}
          </div>

          {editingOffDays ? (
            <>
              <div className="flex flex-wrap gap-2">
                {([1, 2, 3, 4, 5] as const).map((day) => {
                  const active = pendingOffDays.includes(day);
                  const dayLabel = ["Mon", "Tue", "Wed", "Thu", "Fri"][day - 1];
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={updateTruck.isPending}
                      onClick={() => togglePendingOffDay(day)}
                      className={clsx(
                        "flex flex-col items-center rounded-md px-3 py-1.5 text-sm font-medium transition leading-tight",
                        active
                          ? "bg-red-800 text-red-100"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                      )}
                    >
                      <span>{dayLabel}</span>
                      <span className="text-xs opacity-70">Day {day}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">
                {pendingOffDays.length === 0
                  ? "Runs every day."
                  : `Off on ${pendingOffDays.map((d) => `Day ${d} (${["Mon", "Tue", "Wed", "Thu", "Fri"][d - 1] ?? d})`).join(", ")}.`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveOffDays}
                  disabled={updateTruck.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition"
                >
                  {updateTruck.isPending ? "Saving…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={cancelOffDayEdit}
                  disabled={updateTruck.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              {offDays.length === 0
                ? "Runs every day."
                : `Off on ${offDays.map((d) => `Day ${d} (${["Mon", "Tue", "Wed", "Thu", "Fri"][d - 1] ?? d})`).join(", ")}.`}
            </p>
          )}
        </section>

        <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={saveNotes}>
            Save notes & wearers
          </button>
        </div>
      </div>
    </div>
  );
}

function AddRemovePanel() {
  const { data: all } = useFleet(true);
  const add = useAddTruck();
  const remove = useRemoveTruck();
  const update = useUpdateTruck();
  const [number, setNumber] = useState("");
  const [type, setType] = useState("Uniform");
  const [persistentSpare, setPersistentSpare] = useState(false);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!number) return;
    await add.mutateAsync({
      truck_number: Number(number),
      truck_type: type,
      is_persistent_spare: persistentSpare,
    });
    setNumber("");
    setPersistentSpare(false);
  }

  return (
    <div className="card space-y-3 p-4">
      <h3 className="text-lg font-semibold">Add / Remove trucks</h3>
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="label">Truck #</span>
          <input
            type="number"
            className="input w-24"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="label">Type</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option>Uniform</option>
            <option>Dust</option>
            <option>Spare</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={persistentSpare}
            onChange={(e) => setPersistentSpare(e.target.checked)}
          />
          Persistent spare
        </label>
        <button className="btn-primary" disabled={add.isPending}>
          Add / Reactivate
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Persistent spare</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(all ?? []).map((t) => (
              <tr key={t.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-semibold">{t.truck_number}</td>
                <td className="px-3 py-2">
                  <select
                    className="input py-0.5 text-xs"
                    value={t.truck_type}
                    onChange={(e) =>
                      update.mutate({ truck_number: t.truck_number, truck_type: e.target.value })
                    }
                  >
                    <option>Uniform</option>
                    <option>Dust</option>
                    <option>Spare</option>
                  </select>
                </td>
                <td className="px-3 py-2">{t.is_active ? "Yes" : "No"}</td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={t.is_persistent_spare}
                    onChange={(e) =>
                      update.mutate({
                        truck_number: t.truck_number,
                        is_persistent_spare: e.target.checked,
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {t.is_active ? (
                    <button
                      className="btn-ghost text-xs text-red-400"
                      onClick={() => {
                        if (confirm(`Remove truck #${t.truck_number}?`))
                          remove.mutate(t.truck_number);
                      }}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      className="btn-ghost text-xs text-emerald-400"
                      onClick={() =>
                        update.mutate({ truck_number: t.truck_number, is_active: true })
                      }
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
