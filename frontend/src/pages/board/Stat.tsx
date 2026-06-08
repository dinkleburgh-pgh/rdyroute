/**
 * Small stat tile used inside the truck detail modal. Extracted from Board.tsx.
 */
import type { ReactNode } from "react";

export default function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded bg-slate-950/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-medium text-slate-100">{value}</p>
    </div>
  );
}
