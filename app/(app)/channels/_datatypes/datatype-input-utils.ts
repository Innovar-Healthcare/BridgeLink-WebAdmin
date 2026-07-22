/**
 * Validation / sanitization helpers for data-type panel inputs.
 *
 * BridgeLink deserializes data-type properties through XStream, where several
 * fields are typed (`int`, `Integer[]`, XML element names). Writing raw
 * keystrokes into those elements produces XML the server cannot deserialize —
 * a cleared or non-numeric field throws a ConversionException on the channel
 * PUT and the whole save fails.
 *
 * The Java Swing client never reaches those states: each `setProperties(...)`
 * guards the parse and keeps the previous value (or default) on empty/invalid
 * input. These helpers port those guards so the WebUI persists only values the
 * server can deserialize.
 *
 * Java refs (bridgelink-core):
 *   - DelimitedSerializationProperties.setProperties / validXMLElementName
 *   - DelimitedBatchProperties.setProperties  (batchSkipRecords)
 *   - XMLBatchProperties.setProperties        (level)
 */

/**
 * Port of Java `DelimitedSerializationProperties.validXMLElementName`.
 *
 * Simplified XML element-name rule (per the Java source comment):
 *   - must be non-empty
 *   - first character: letter, underscore or colon
 *   - remaining characters: letter, digit, period, dash, underscore or colon
 */
export function isValidXmlElementName(s: string): boolean {
  if (!s || s.length === 0) return false;

  const first = s.charCodeAt(0);
  if (!isLetter(first) && s[0] !== "_" && s[0] !== ":") return false;

  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (!isLetter(code) && !isDigit(code) && ch !== "." && ch !== "-" && ch !== "_" && ch !== ":") {
      return false;
    }
  }
  return true;
}

// Java uses Character.isLetter / Character.isDigit (Unicode-aware). The WebUI
// column-name field is ASCII in practice, but keep it Unicode-aware to match:
// a letter is anything the platform lowercases/uppercases differently OR a
// character in a Unicode letter category. `\p{L}` / `\p{Nd}` mirror Java here.
function isLetter(code: number): boolean {
  return /\p{L}/u.test(String.fromCodePoint(code));
}
function isDigit(code: number): boolean {
  return /\p{Nd}/u.test(String.fromCodePoint(code));
}

/**
 * Largest value Java `Integer.parseInt` accepts (2^31 - 1). The server stores
 * these fields as `int`, so anything above this throws a NumberFormatException
 * server-side (XStream ConversionException → channel PUT 500). Java's guards
 * catch that and keep the previous value; we must reject the same range.
 */
export const INT32_MAX = 2147483647;

/** Strip everything but ASCII digits — for single non-negative integer fields. */
export function sanitizeDigits(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

/** True when `v` is a non-negative integer the server can deserialize as a Java `int`. */
export function fitsInt32(v: string): boolean {
  return /^\d+$/.test(v) && Number(v) <= INT32_MAX;
}

/**
 * True when the comma-separated list is a valid `Integer[]` of positive column
 * widths. Empty (after trimming/dropping empty tokens) is treated as valid — it
 * means "clear the element" (Java sets `columnWidths = null`); the caller
 * decides clear-vs-keep. A non-empty list is valid only when every token is a
 * positive integer within Java's `int` range, mirroring Java's per-width
 * `Integer.parseInt` (> 0, and throws above `INT32_MAX`).
 */
export function isValidPositiveIntList(v: string): boolean {
  const parts = splitList(v);
  if (parts.length === 0) return true; // empty → clear
  return parts.every((p) => fitsInt32(p) && Number(p) > 0);
}

/**
 * True when every comma-separated column name is a valid XML element name.
 * Empty is valid (clears the element); a non-empty list is valid only when
 * every token passes `isValidXmlElementName`.
 */
export function areValidColumnNames(v: string): boolean {
  const parts = splitList(v);
  if (parts.length === 0) return true; // empty → clear
  return parts.every((p) => isValidXmlElementName(p));
}

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Faithful port of Java `StringUtil.unescape` (bridgelink-core
 * `com.mirth.connect.util.StringUtil`). Used to turn a stored, escaped
 * delimiter string into the literal characters the server-side readers
 * (DelimitedReader, EDIReader via EDISerializer, NCPDPReader) tokenize on, so
 * the WebUI Msg-Tree previews split exactly as the server does. Preview-only —
 * the stored property string round-trips verbatim.
 *
 * Handles, in order:
 *   1. null/empty → returned as-is
 *   2. double-quoted literal → quotes stripped, rest treated literally
 *   3. standard escape sequences: \b \t \n \f \r
 *   4. hex notation `0xyy` (exactly two hex digits per occurrence, anywhere
 *      in the string, e.g. `0x0a` → newline)
 */
export function unescapeDelimiters(s: string): string {
  if (!s) return s;

  // Double-quoted literal — strip the quotes and treat the rest as a literal.
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.substring(1, s.length - 1);
  }

  // Standard escape-sequence substitutions for non-printable characters.
  s = s
    .replace(/\\b/g, "\b")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\f/g, "\f")
    .replace(/\\r/g, "\r");

  // Hex sequences (e.g. 0x0a) → single character, mirroring the Java scan.
  let n = 0;
  for (;;) {
    n = s.indexOf("0x", n);
    if (n === -1 || s.length < n + 4) break;
    const hex = s.substring(n + 2, n + 4);
    const code = parseInt(hex, 16);
    if (!/^[0-9a-fA-F]{2}$/.test(hex) || Number.isNaN(code)) {
      n += 2;
      continue;
    }
    s = s.substring(0, n) + String.fromCharCode(code) + s.substring(n + 4);
    n++;
  }

  return s;
}
