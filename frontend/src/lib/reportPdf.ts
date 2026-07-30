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
  /** SPLIT load — the route runs on both trucks, so the pair joins with "+"
   *  rather than the coverage arrow. */
  split: boolean;
  /** Carrier has finished loading — drives "Loaded on" vs "Loads on". */
  loaded: boolean;
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

export interface ShortageTruckItemVM {
  label: string;
  qty: number;
}

export interface ShortageTopTruckVM {
  truck_number: number;
  total: number;
  items: ShortageTruckItemVM[];
}

export interface ShortagesSectionVM {
  kpis: ReportKpiVM[];
  top_trucks?: ShortageTopTruckVM[];
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

// Category colours for the PDF now come from the canonical palette
// (useCategoryPalette().hexOf, backed by PRESET_HEX in HierarchyPicker), so a
// category matches the screen. This file no longer owns a hue table.

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
