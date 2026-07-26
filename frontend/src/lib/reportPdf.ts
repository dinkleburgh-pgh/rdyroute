import { exportFile } from "./exportFile";

/**
 * What the report page POSTs to POST /api/reports/pdf: a base64 PNG per report
 * section (captured client-side, exactly what the screen shows) plus a title/
 * subtitle for the first-page header. The server wraps the images one-per-page
 * into a landscape PDF, so the file matches the screen — colour, bars, chips.
 * Mirrors the Pydantic `ReportImagesRequest` in schemas.py.
 */
export interface ReportPdfRequest {
  run_date: string; // YYYY-MM-DD — names the downloaded file
  title?: string;
  subtitle?: string;
  images: string[]; // base64 PNGs (no data: prefix), one per section
}

/**
 * Render the captured sections to a PDF on the server and hand the file to the
 * OS. Uses a raw fetch (not the axios client, whose offline interceptor would
 * queue a POST and not return the PDF blob). Cookie auth flows via
 * credentials:"include".
 */
export async function downloadReportPdf(req: ReportPdfRequest): Promise<void> {
  const res = await fetch("/api/reports/pdf", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`Report PDF request failed (${res.status})`);
  }
  const blob = await res.blob();
  await exportFile(blob, `ReadyRoute-Report-${req.run_date}.pdf`, "application/pdf");
}
