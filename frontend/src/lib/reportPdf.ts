import { exportFile } from "./exportFile";

/**
 * View-model the report page POSTs to POST /api/reports/pdf. The server renders
 * exactly these (already display-formatted) values into a PDF, so the file
 * matches the screen without re-deriving anything. Mirrors the Pydantic
 * `ReportViewModel` family in schemas.py.
 */
export interface ReportKpiVM {
  label: string;
  value: string; // already display-formatted
  sub?: string | null;
}

export interface ReportBatchTruckVM {
  truck_number: number;
  wearers: number;
}

export interface ReportBatchCardVM {
  batch_number: number;
  total_wearers: number;
  trucks: ReportBatchTruckVM[];
}

export interface BatchesSectionVM {
  disabled: boolean;
  kpis: ReportKpiVM[];
  cap: number;
  no_cap: boolean;
  cards: ReportBatchCardVM[];
}

export interface ShortageRowVM {
  group: string;
  category: string;
  detail: string;
  label: string;
  unit?: string | null;
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

export interface ReportViewModel {
  run_date: string; // YYYY-MM-DD
  generated_at?: string | null; // ISO datetime
  load_day?: number | null;
  unload_day?: number | null;
  shift_label?: string | null;
  title?: string;
  batches?: BatchesSectionVM | null;
  shortages?: ShortagesSectionVM | null;
}

/**
 * Render the report to a PDF on the server and hand the file to the OS. Uses a
 * raw fetch (not the axios client, whose offline interceptor would queue a POST
 * and not return the PDF blob). Cookie auth flows via credentials:"include".
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
