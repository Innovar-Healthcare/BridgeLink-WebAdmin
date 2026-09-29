/**
 * Deep-link grammar for a filter rule / transformer step inside the channel
 * editor.
 *
 * Config Search finds a match inside one specific step and needs to open the
 * editor on that step, at that line. The channel editor already deep-links via
 * query params (`tab`, `dest`, `sub`, `script`); this adds two more:
 *
 *   /channels/<id>/edit?tab=destination&dest=1&sub=transformer&path=2.0&line=17
 *
 *   path — dot-joined index path into the element tree, matching the editor's
 *          own selection model (`flattenElements` / `getElementAtPath`) and its
 *          `key={selectedPath?.join(".")}` convention. Dots need no encoding.
 *   line — 1-based line within that step's script.
 *
 * Both are structural integers, never message or configuration content, so
 * unlike a search *query* they are safe to put in a URL that lands in browser
 * history and proxy logs (cf..
 *
 * This module is deliberately free of React and of any import that reaches the
 * editor components, so `lib/search/**` can import it without pulling the
 * channel editor into the /search bundle.
 */

/** Deepest nesting this grammar accepts. Iterators nest, but not like this. */
const MAX_PATH_DEPTH = 8;
/** Largest element index this grammar accepts. */
const MAX_PATH_INDEX = 9999;

/** Serialize an index path for a URL: `[2, 0]` -> `"2.0"`. */
export function formatIndexPath(path: number[]): string {
  return path.join(".");
}

/**
 * Parse a `path` query param into an index path.
 * Returns null for anything malformed — a bad deep link must degrade to "no
 * preselection", never to a wrong selection or a throw.
 */
export function parseIndexPath(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length === 0 || parts.length > MAX_PATH_DEPTH) return null;
  const path: number[] = [];
  for (const part of parts) {
    // Rejects "", "-1", "1a", "1.5" and leading-plus/space forms that Number()
    // would otherwise happily accept.
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n > MAX_PATH_INDEX) return null;
    path.push(n);
  }
  return path;
}

/**
 * Parse a `line` query param into a 1-based line number.
 * Returns undefined for anything malformed or non-positive; callers clamp
 * against the real buffer length, since the index may be older than the code.
 */
export function parseLineParam(raw: string | null | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n > 0 ? n : undefined;
}
