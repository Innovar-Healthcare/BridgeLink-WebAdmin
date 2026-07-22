/**
 * RFC 4180 CSV parser/writer for lookup-value import/export.
 *
 * Mirrors the Java Swing client (ValuePanel.java): two-column "key,value" with
 * a header row. Quoting follows RFC 4180 — fields containing commas, quotes,
 * CR, or LF are wrapped in double quotes; embedded quotes are doubled.
 * Empty keys and empty values are skipped (matches CsvLineParser behavior).
 * Duplicate keys keep the first occurrence.
 */

const QUOTE = '"';
const COMMA = ",";

export function parseLookupCsv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let i = 0;
  let headerSkipped = false;
  while (i < text.length) {
    const { row, next } = readRow(text, i);
    i = next;
    if (row === null) continue;
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    if (row.length < 2) continue;
    const key = row[0];
    const value = row[1];
    if (!key || !value) continue;
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key] = value;
  }
  return out;
}

function readRow(text: string, start: number): { row: string[] | null; next: number } {
  const fields: string[] = [];
  let i = start;
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  while (i < text.length) {
    const c = text[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (c === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE;
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === QUOTE) {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === COMMA) {
      fields.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      fields.push(field);
      return { row: fields, next: i + 1 };
    }
    if (c === "\n") {
      fields.push(field);
      return { row: fields, next: i + 1 };
    }
    field += c;
    i++;
  }

  if (!sawAnyChar) return { row: null, next: i };
  fields.push(field);
  return { row: fields, next: i };
}

export function toLookupCsv(values: Record<string, string>): string {
  const lines: string[] = ["key,value"];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${csvEscape(key)},${csvEscape(value)}`);
  }
  return lines.join("\n") + "\n";
}

function csvEscape(input: string): string {
  if (
    input.includes(COMMA) ||
    input.includes(QUOTE) ||
    input.includes("\n") ||
    input.includes("\r")
  ) {
    return QUOTE + input.replace(/"/g, '""') + QUOTE;
  }
  return input;
}

/** Java Swing's filename pattern: all_values_yyyy_MM_dd_HH_mm.csv */
export function lookupCsvFilename(prefix = "all_values", at: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp =
    `${at.getFullYear()}_${pad(at.getMonth() + 1)}_${pad(at.getDate())}` +
    `_${pad(at.getHours())}_${pad(at.getMinutes())}`;
  return `${prefix}_${stamp}.csv`;
}
