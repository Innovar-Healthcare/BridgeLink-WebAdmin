/**
 * Maps a validator rejection reason to a position in the manifest JSON editor,
 * for click-to-jump.
 *
 * The validator (lib/runtime-plugins/manifest-validator.ts) produces every
 * rejection as `"<path>: <message>"` where the path is either a bare envelope
 * field (`name` / `path` / `version` — engine identity, NOT in the editor text)
 * or a manifest JSON path rooted at `manifest` (e.g.
 * `manifest.connectorPanels[0].sections[0].fields[2].type`). There is no
 * structured location, so this module parses the path string and walks the raw
 * editor text to find the offset.
 *
 * `locateJsonPath` is a single forward scan over the raw string (not JSON.parse)
 * so the returned offset is exact and the walk is resilient: text that has
 * drifted since validation, a missing segment, or an out-of-range index all
 * degrade to the deepest ancestor matched (`matchedDepth < segments.length`)
 * rather than throwing. Key-terminal segments land on the property NAME (the
 * best cursor target for a "this key is wrong" message); index-terminal segments
 * land on the element value.
 */

export type PathSegment = string | number;

export type ParsedReason =
  | { scope: "manifest"; segments: PathSegment[]; message: string }
  | { scope: "envelope"; field: "name" | "path" | "version"; message: string }
  | null;

const MANIFEST_PATH_RE = /^manifest(\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])*$/;
const SEGMENT_RE = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]/g;

/**
 * Splits a validator reason into its addressed scope and message. Returns null
 * for a bare (non-path-prefixed) message or a prefix that doesn't match the
 * validator's grammar. Splits at the FIRST ": " — a valid path contains neither
 * a space nor a colon, so any ": " inside the message stays in the message.
 */
export function parseValidationReason(reason: string): ParsedReason {
  const idx = reason.indexOf(": ");
  if (idx <= 0) return null;
  const prefix = reason.slice(0, idx);
  const message = reason.slice(idx + 2);

  if (prefix === "name" || prefix === "path" || prefix === "version") {
    return { scope: "envelope", field: prefix, message };
  }
  if (!MANIFEST_PATH_RE.test(prefix)) return null;

  const segments: PathSegment[] = [];
  SEGMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SEGMENT_RE.exec(prefix)) !== null) {
    segments.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  return { scope: "manifest", segments, message };
}

export interface JsonLocation {
  /** 1-based line (Monaco convention). */
  line: number;
  /** 1-based column (Monaco convention). */
  column: number;
  /** How many segments were resolved; `< segments.length` means best-effort ancestor. */
  matchedDepth: number;
}

/**
 * Locates the position of `segments` within a JSON `text`. `segments` = [] maps
 * to the document's first non-whitespace character. Never throws; returns null
 * only when there is no non-whitespace content at all.
 */
export function locateJsonPath(text: string, segments: PathSegment[]): JsonLocation | null {
  const n = text.length;
  let i = 0;
  let matchedDepth = 0;

  const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const skipWs = () => {
    while (i < n && isWs(text[i])) i++;
  };

  /** Consumes a JSON string at text[i] === '"'; returns the DECODED value, or null on malformation. */
  function scanString(): string | null {
    if (text[i] !== '"') return null;
    i++;
    let out = "";
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        i++;
        if (i >= n) return null;
        const e = text[i];
        if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (!(e in simple)) return null;
        out += simple[e];
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return null; // unterminated
  }

  // Guards the mutually-recursive skips against a pathologically deep sibling
  // value (e.g. a 7000-level nested array well under MAX_MANIFEST_BYTES): past
  // this depth the skip fails and the walk degrades to a best-effort ancestor
  // rather than overflowing the stack — honoring the "never throws" contract.
  const MAX_SKIP_DEPTH = 200;

  /** Skips any JSON value at text[i]; returns false on malformation or over-depth. */
  function skipValue(depth: number): boolean {
    if (depth > MAX_SKIP_DEPTH) return false;
    skipWs();
    if (i >= n) return false;
    const c = text[i];
    if (c === '"') return scanString() !== null;
    if (c === "{") return skipObject(depth);
    if (c === "[") return skipArray(depth);
    const start = i;
    while (i < n && !isWs(text[i]) && !",}]".includes(text[i])) i++;
    return i > start;
  }

  function skipObject(depth: number): boolean {
    i++; // past "{"
    skipWs();
    if (text[i] === "}") {
      i++;
      return true;
    }
    while (i < n) {
      skipWs();
      if (scanString() === null) return false;
      skipWs();
      if (text[i] !== ":") return false;
      i++;
      if (!skipValue(depth + 1)) return false;
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return true;
      }
      return false;
    }
    return false;
  }

  function skipArray(depth: number): boolean {
    i++; // past "["
    skipWs();
    if (text[i] === "]") {
      i++;
      return true;
    }
    while (i < n) {
      if (!skipValue(depth + 1)) return false;
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return true;
      }
      return false;
    }
    return false;
  }

  function offsetToLoc(offset: number): JsonLocation {
    let line = 1;
    let lastNl = -1;
    for (let k = 0; k < offset && k < n; k++) {
      if (text[k] === "\n") {
        line++;
        lastNl = k;
      }
    }
    return { line, column: offset - lastNl, matchedDepth };
  }

  skipWs();
  if (i >= n) return null; // no content
  let bestOffset = i;

  for (const seg of segments) {
    if (typeof seg === "string") {
      skipWs();
      if (text[i] !== "{") return offsetToLoc(bestOffset);
      i++; // past "{"
      let candidate: { keyStart: number; valueStart: number } | null = null;
      while (i < n) {
        skipWs();
        if (text[i] === "}") {
          i++;
          break;
        }
        const keyStart = i;
        const key = scanString();
        if (key === null) return offsetToLoc(bestOffset);
        skipWs();
        if (text[i] !== ":") return offsetToLoc(bestOffset);
        i++;
        skipWs();
        const valueStart = i;
        // Last-duplicate-wins (JSON.parse parity): keep scanning, keep the last.
        if (key === seg) candidate = { keyStart, valueStart };
        if (!skipValue(0)) return offsetToLoc(bestOffset);
        skipWs();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          break;
        }
        return offsetToLoc(bestOffset);
      }
      if (!candidate) return offsetToLoc(bestOffset);
      bestOffset = candidate.keyStart; // land on the property name
      matchedDepth++;
      i = candidate.valueStart;
    } else {
      skipWs();
      if (text[i] !== "[") return offsetToLoc(bestOffset);
      i++; // past "["
      let idx = 0;
      let landed = false;
      while (i < n) {
        skipWs();
        if (text[i] === "]") break; // ran out before reaching seg
        if (idx === seg) {
          bestOffset = i; // land on the element value
          matchedDepth++;
          landed = true;
          break;
        }
        if (!skipValue(0)) return offsetToLoc(bestOffset);
        skipWs();
        if (text[i] === ",") {
          i++;
          idx++;
          continue;
        }
        if (text[i] === "]") break;
        return offsetToLoc(bestOffset);
      }
      if (!landed) return offsetToLoc(bestOffset);
    }
  }

  return offsetToLoc(bestOffset);
}
