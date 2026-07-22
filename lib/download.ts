/**
 * Shared download and CSV export utilities.
 */

/**
 * Trigger a browser file download from a string or base64 content.
 */
export function downloadFile(
  content: string,
  filename: string,
  options?: { base64?: boolean; mimeType?: string }
): void {
  let blob: Blob;
  if (options?.base64) {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: options.mimeType ?? "application/octet-stream" });
  } else {
    blob = new Blob([content], { type: options?.mimeType ?? "text/plain" });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a browser file download from a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Escape a value for inclusion in a CSV cell (RFC 4180).
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build a CSV string from headers and rows.
 */
export function buildCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const headerLine = headers.map(csvEscape).join(",");
  const dataLines = rows.map((row) => row.map(csvEscape).join(","));
  return [headerLine, ...dataLines].join("\n");
}

/**
 * Format a Date as a filename-safe local timestamp: `YYYY-MM-DD_HHmmss`.
 * Local time so the value matches when the user ran the export on their machine.
 */
export function filenameTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
}

/**
 * Trigger a CSV file download with a timestamped filename.
 * @param prefix  e.g. "bridgelink-dashboard" or "bridgelink-channels"
 */
export function downloadCsv(
  prefix: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  const csv = buildCsv(headers, rows);
  downloadFile(csv, `${prefix}-${filenameTimestamp()}.csv`, { mimeType: "text/csv" });
}
