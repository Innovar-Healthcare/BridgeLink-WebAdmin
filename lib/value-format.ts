/**
 * Shared helpers for displaying arbitrary string values in a Monaco viewer:
 * detecting a language for syntax highlighting and pretty-printing JSON.
 * Used by the message-browser mappings viewer and the events attribute dialog
 * (both via ValueDetailDialog).
 */

/** Detect the language of content for Monaco syntax highlighting. */
export function detectLanguage(text: string): string {
  if (!text || typeof text !== "string") return "plaintext";
  const trimmed = text.trim();
  if (!trimmed) return "plaintext";
  const firstChar = trimmed.charAt(0);
  if (firstChar === "{" || firstChar === "[") {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Could be malformed JSON — still try to highlight as JSON
      return trimmed.length > 2 ? "json" : "plaintext";
    }
  }
  if (firstChar === "<") return "xml";
  // HL7v2 messages start with "MSH|"
  if (trimmed.startsWith("MSH|")) return "hl7v2";
  return "plaintext";
}

/**
 * Map a BridgeLink data-type ID to a Monaco language id. The input is the
 * DataType plugin ID as persisted/serialized by the server — the value of
 * `sourceConnector.transformer.inboundDataType` and a message's `raw.dataType`
 * — NOT the human display name. The IDs are the `DataTypeDelegate.getName()`
 * literals: `HL7V2`, `XML`, `JSON`, `HL7V3`, `DICOM`, `EDI/X12`, `NCPDP`,
 * `DELIMITED`, `RAW`. (The display name "HL7 v2.x" is never the wire format.)
 *
 * Mirrors the Java client's `EditMessageDialog.setCorrectDocument`, which looks
 * up the data type's `TokenMarker` via `getDataTypePlugins().get(dataType)` — a
 * map keyed by the same ID. Narrowed to the languages the Web UI can highlight:
 * hl7v2 (via `lib/monaco-hl7v2`) plus the Monaco built-ins xml/json. The other
 * BridgeLink data types (HL7V3, DICOM, EDI/X12, NCPDP, DELIMITED, RAW) fall back
 * to plaintext — faithful to Java, where their TokenMarker is also null (X12/NCPDP
 * have markers, but Monaco has no equivalent and we register none).
 */
export function dataTypeToLanguage(dataType: string | undefined | null): string {
  switch ((dataType ?? "").trim().toLowerCase()) {
    case "hl7v2":
      return "hl7v2";
    case "xml":
      return "xml";
    case "json":
      return "json";
    default:
      return "plaintext";
  }
}

/**
 * Max characters rendered in a table cell for an arbitrary value. The visible
 * area of a value column is only ~80 chars, so this is far beyond what shows;
 * it exists to keep the cell's DOM text node small. WebKit lays out the entire
 * single-line `white-space: nowrap` run before clipping, so an unbounded
 * hundreds-of-KB value (e.g. a CCD clinical document) renders blank / beachballs
 * in Safari.
 */
export const CELL_PREVIEW_CHARS = 500;

/**
 * Values larger than this open as plain text in ValueDetailDialog — pretty-print
 * and language detection are skipped so Monaco doesn't synchronously tokenize a
 * huge document, which wedges WebKit.
 */
export const LARGE_VALUE_CHARS = 50_000;

/** Truncate a string to `max` characters, appending an ellipsis when clipped. */
export function truncate(val: string, max: number): string {
  return val.length > max ? val.slice(0, max) + "…" : val;
}

/** Try to pretty-print a value string (JSON objects get indented). */
export function prettyPrintValue(val: string): string {
  const trimmed = val.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 2) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return val;
    }
  }
  return val;
}
