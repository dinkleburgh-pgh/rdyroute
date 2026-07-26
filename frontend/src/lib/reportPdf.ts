import { exportFile } from "./exportFile";

/**
 * View-model the report page POSTs to POST /api/reports/pdf. The server renders
 * exactly these (already display-formatted) values and hex colours into a dark,
 * app-matching PDF, so the file matches the screen without re-deriving anything
 * — and stays SELECTABLE (real text, not a screenshot). Mirrors the Pydantic
 * `ReportViewModel` family in schemas.py. Each section is included only when the
 * user picks it in the section picker.
 */
export interface ReportKpiVM {
  label: string;
  value: string; // already display-formatted
  sub?: string | null;
  tone?: string | null; // hex, else default ink
}

export interface ReportBatchTruckVM {
  truck_number: number;
  wearers: number;
}

export interface ReportBatchCardVM {
  batch_number: number;
  total_wearers: number;
  cap_label: string;
  pct: number; // 0-100
  bar_hex: string;
  text_hex: string;
  overbatched: boolean;
  trucks: ReportBatchTruckVM[];
}

export interface BatchesSectionVM {
  disabled: boolean;
  kpis: ReportKpiVM[];
  cap: number;
  no_cap: boolean;
  cards: ReportBatchCardVM[];
}

export interface CoverageRowVM {
  route_truck: number;
  load_on_truck: number;
  type: string;
  recurring: boolean;
  returned: boolean;
  status_label: string;
  status_hex: string;
}

export interface CoverageSectionVM {
  rows: CoverageRowVM[];
}

export interface LoadTimeRowVM {
  truck_number: number;
  finish_label: string;
  duration_label: string;
  tone: string;
}

export interface LoadTimesSectionVM {
  kpis: ReportKpiVM[];
  rows: LoadTimeRowVM[];
}

export interface ShortageRowVM {
  group: string;
  category: string;
  detail: string;
  label: string;
  unit?: string | null;
  dot_hex: string;
  cells: (number | null)[]; // aligned to matrix.trucks
  total: number;
}

export interface ShortageMatrixVM {
  trucks: number[];
  rows: ShortageRowVM[];
  truck_totals: number[]; // aligned to trucks
  grand_total: number;
}

export interface ShortagesSectionVM {
  kpis: ReportKpiVM[];
  matrix?: ShortageMatrixVM | null;
}

export interface AuditChipVM {
  category: string;
  qty: number;
  dot_hex: string;
}

export interface AuditEntryVM {
  item_label: string;
  quantity: number;
  warn: boolean;
  warn_applied: boolean;
}

export interface AuditTruckCardVM {
  truck_number: number;
  route_override?: number | null;
  entries: AuditEntryVM[];
}

export interface AuditSectionVM {
  kpis: ReportKpiVM[];
  chips: AuditChipVM[];
  cards: AuditTruckCardVM[];
}

export interface ReportViewModel {
  run_date: string; // YYYY-MM-DD
  generated_at?: string | null; // ISO datetime
  load_day?: number | null;
  unload_day?: number | null;
  shift_label?: string | null;
  title?: string;
  batches?: BatchesSectionVM | null;
  coverage?: CoverageSectionVM | null;
  load_times?: LoadTimesSectionVM | null;
  shortages?: ShortagesSectionVM | null;
  audit?: AuditSectionVM | null;
}

/**
 * The colour each palette preset paints its category dot with — the -500 Tailwind
 * hue (stone uses -400), matching COLOR_PRESETS[*].dot in HierarchyPicker. Lets
 * the client resolve a category's palette preset to a concrete hex for the PDF.
 */
export const PRESET_HEX: Record<string, string> = {
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  emerald: "#10b981",
  orange: "#f97316",
  rose: "#f43f5e",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  amber: "#f59e0b",
  red: "#ef4444",
  green: "#22c55e",
  blue: "#3b82f6",
  indigo: "#6366f1",
  pink: "#ec4899",
  fuchsia: "#d946ef",
  lime: "#84cc16",
  stone: "#a8a29e",
};

const DOT_FALLBACK = "#64748b"; // slate-500 (audit "General" fallback)

/**
 * Resolve a Tailwind dot class ("bg-sky-500", "bg-stone-400", "bg-slate-500") —
 * as emitted by TOP_CAT_DOT / categoryDotClass — to a concrete hex for the PDF.
 */
export function dotClassToHex(cls: string): string {
  const m = /bg-([a-z]+)-\d{3}/.exec(cls);
  if (!m) return DOT_FALLBACK;
  return PRESET_HEX[m[1]] ?? DOT_FALLBACK;
}

/**
 * Render the report to a selectable PDF on the server and hand the file to the
 * OS. Uses a raw fetch (not the axios client, whose offline interceptor would
 * queue a POST and not return the PDF blob). Cookie auth flows via
 * credentials:"include".
 */
export async function downloadReportPdf(vm: ReportViewModel): Promise<void> {
  const res = await fetch("/api/reports/pdf", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vm),
  });
  if (!res.ok) {
    throw new Error(`Report PDF request failed (${res.status})`);
  }
  const blob = await res.blob();
  await exportFile(blob, `ReadyRoute-Report-${vm.run_date}.pdf`, "application/pdf");
}
