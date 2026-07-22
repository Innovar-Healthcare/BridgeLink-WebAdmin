/**
 * Java-style .properties parsing/serialization for the Configuration Map tab's
 * Import/Export actions. Mirrors Java's SettingsPanelMap, which round-trips the map
 * through an Apache Commons Configuration2 `PropertiesConfiguration`
 * (SettingsPanelMap.java:168-262). Commons-configuration2 escapes and unescapes
 * symmetrically per the standard Java `.properties` grammar, so this module implements
 * the java.util.Properties `loadConvert` / `saveConvert` algorithm.
 *
 * Supported grammar:
 * - `key=value` / `key:value` / `key value` (first unescaped `=`, `:`, or whitespace is
 *   the separator); bare keys (no separator) parse with an empty value.
 * - `#` / `!` comment lines (attached to the entry that follows).
 * - Line continuations: a logical line continues when it ends with an ODD number of
 *   backslashes; the trailing continuation backslash is dropped and leading whitespace of
 *   the continuation line is stripped.
 * - Escapes (both key and value): `\n`→LF, `\r`→CR, `\t`→TAB, `\f`→FF, `\uXXXX`→code unit,
 *   `\\`→`\`, and any other `\x`→`x` (so `\=`, `\:`, `\ `, `\#` are literal).
 * - Export escapes control chars and any non-ASCII char (`>0x7e`) as `\uXXXX`, because the
 *   Swing client reads properties as ISO-8859-1 by default — raw UTF-8 would mojibake there.
 *
 * Duplicate keys: FIRST occurrence wins and yields a single entry, matching
 * commons-configuration2's default `DisabledListDelimiterHandler` (`getString` returns the
 * first value, `getKeys` lists the key once). Case-insensitive duplicate keys are
 * intentionally NOT collapsed — Java's `TreeMap(CASE_INSENSITIVE_ORDER)` collapse
 * (SettingsPanelMap.java:232) is lossy; preserving distinct-case keys here is safer (L21).
 *
 * Known limitation (L22): a value containing a bare CR that survives import is normalized
 * to LF when saved — `setConfigurationMap` sends JSON that the server converts to XML
 * (Staxon → XStream), and XML text-node parsing normalizes a bare CR to LF. Emitting
 * `&#xd;` would require reworking the save path to XML and is out of scope here.
 */

import type { ConfigurationMapEntry } from "./api/api-settings";

/** Count trailing `\` characters on a string (used for continuation-line parity). */
function countTrailingBackslashes(s: string): number {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) n++;
  return n;
}

/**
 * Unescape a Java-.properties token (key or value). Implements java.util.Properties'
 * `loadConvert`: `\n \r \t \f` control chars, `\uXXXX` unicode, `\\`→`\`, other `\x`→`x`.
 */
function unescapeProperties(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    // Trailing lone backslash: emit nothing (matches java.util.Properties dropping it).
    if (i + 1 >= s.length) break;
    const next = s[++i];
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = s.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          // Not a valid \uXXXX escape — treat the `u` literally (lenient).
          out += "u";
        }
        break;
      }
      default:
        out += next;
        break;
    }
  }
  return out;
}

/** Parse Java-style .properties text into config-map entries (key / value / comment). */
export function parsePropertiesText(text: string): ConfigurationMapEntry[] {
  const entries: ConfigurationMapEntry[] = [];
  const seenKeys = new Set<string>();
  // Split on any of the three line terminators java.util.Properties recognizes: LF, CRLF,
  // and a lone CR (classic-Mac / hand-edited files). A bare `\r` is a break, not data.
  const lines = text.split(/\r\n|\r|\n/);
  let pendingComment = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Comment line (first non-whitespace char is # or !) — attach to the next entry.
    // Whitespace here is Java's set {space, \t, \f}, NOT JS `\s` (which also matches NBSP,
    // vertical tab, etc.); Java treats those as ordinary key characters, so a line starting
    // with e.g. NBSP is a data line, not a comment.
    if (/^[ \t\f]*[#!]/.test(line)) {
      const commentText = line.replace(/^[ \t\f]*[#!][ \t\f]?/, "");
      pendingComment += (pendingComment ? "\n" : "") + commentText;
      continue;
    }

    // Blank line resets a pending comment.
    if (/^[ \t\f]*$/.test(line)) {
      pendingComment = "";
      continue;
    }

    // Assemble the logical line across continuations (odd trailing-backslash count).
    let logical = line;
    while (countTrailingBackslashes(logical) % 2 === 1 && i + 1 < lines.length) {
      logical = logical.slice(0, -1); // drop the single continuation backslash
      i++;
      logical += lines[i].replace(/^[ \t\f]+/, ""); // strip leading whitespace of the continuation
    }

    // Skip leading whitespace, then find the first UNESCAPED separator (=, :, or whitespace).
    let p = 0;
    while (p < logical.length && /[ \t\f]/.test(logical[p])) p++;

    let keyEnd = logical.length;
    let sep = -1; // index of an explicit '='/':' separator, if any
    for (let j = p; j < logical.length; j++) {
      const ch = logical[j];
      if (ch === "\\") {
        j++; // escaped char is part of the key
        continue;
      }
      if (ch === "=" || ch === ":") {
        keyEnd = j;
        sep = j;
        break;
      }
      if (ch === " " || ch === "\t" || ch === "\f") {
        keyEnd = j;
        break;
      }
    }

    const keyRaw = logical.slice(p, keyEnd);

    // After the key, skip whitespace; if the next char is '=' or ':', consume it (and any
    // following whitespace). This handles `key = value`, `key: value`, and `key value`.
    let v = sep >= 0 ? sep + 1 : keyEnd;
    if (sep < 0) {
      while (v < logical.length && /[ \t\f]/.test(logical[v])) v++;
      if (logical[v] === "=" || logical[v] === ":") v++;
    }
    while (v < logical.length && /[ \t\f]/.test(logical[v])) v++;
    const valueRaw = logical.slice(v);

    const key = unescapeProperties(keyRaw);
    if (!key || seenKeys.has(key)) {
      // Java (commons-configuration2, first-wins): later duplicates are ignored; a blank
      // key cannot be produced by a non-blank logical line but guard anyway.
      pendingComment = "";
      continue;
    }
    seenKeys.add(key);
    entries.push({ key, value: unescapeProperties(valueRaw), comment: pendingComment });
    pendingComment = "";
  }

  return entries;
}

/**
 * Escape a string per java.util.Properties `saveConvert`. Escapes `\`, control chars
 * (`\t \n \r \f`), the separator/comment chars (`= : # !`), spaces (all when `escapeSpace`,
 * else only a leading space), and any char below 0x20 or above 0x7e as lowercase `\uXXXX`
 * (iterated per UTF-16 code unit, so surrogate pairs round-trip as two escapes).
 */
function saveConvert(s: string, escapeSpace: boolean): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    switch (c) {
      case " ":
        out += i === 0 || escapeSpace ? "\\ " : " ";
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\f":
        out += "\\f";
        break;
      case "=":
      case ":":
      case "#":
      case "!":
        out += "\\" + c;
        break;
      default:
        if (code < 0x20 || code > 0x7e) {
          out += "\\u" + code.toString(16).padStart(4, "0");
        } else {
          out += c;
        }
        break;
    }
  }
  return out;
}

/** Escape a properties key (all spaces escaped). */
function escapePropertiesKey(k: string): string {
  return saveConvert(k, true);
}

/** Escape a properties value (only a leading space escaped). */
function escapePropertiesValue(v: string): string {
  return saveConvert(v, false);
}

/**
 * Serialize config-map entries into Java-style .properties text, sorted by key
 * (case-insensitive, matching Java's export). Blank keys are skipped.
 */
export function serializeProperties(entries: ConfigurationMapEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.key.localeCompare(b.key, undefined, { sensitivity: "base" })
  );

  const lines: string[] = [];
  for (const row of sorted) {
    if (!row.key.trim()) continue;
    if (row.comment) {
      for (const cl of row.comment.split("\n")) {
        lines.push(`# ${cl}`);
      }
    }
    lines.push(`${escapePropertiesKey(row.key)}=${escapePropertiesValue(row.value)}`);
    lines.push("");
  }
  return lines.join("\n");
}
