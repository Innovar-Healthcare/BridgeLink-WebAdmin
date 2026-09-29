/**
 * Last-search memory for the Config Search page.
 *
 * Every piece of search state on /search used to be plain `useState`, so opening
 * a match and pressing Back landed on a blank page — to check the second of
 * forty matches you re-typed the query and re-ran the whole search. This holds
 * the last committed search so the page can restore it on mount without
 * re-indexing anything.
 *
 * ── Why a module singleton and not the URL or localStorage ──
 *
 * A config-search query is user-typed free text; someone hunting a patient
 * identifier through channel config is exactly the plausible case. Putting it in
 * the URL would land it in browser history, the router cache, `Referer`, and
 * proxy access logs — and already established that this repo *strips*
 * PHI-shaped params rather than carrying them. localStorage has the same problem
 * plus persistence across sessions. (Structural values are a different matter:
 * the step path and line number in `ft-deep-link.ts` are integers and do travel
 * in the URL.)
 *
 * Cost, stated plainly: a restored search does not survive a hard reload and
 * does not exist in a new tab. That matches `channelXmlCache` and every other
 * cache in the app, so there is no expectation to violate.
 *
 * ── Why there is no subscribe API ──
 *
 * Nothing observes this store while mounted. The page reads it once in lazy
 * `useState` initializers, and the only writes during a session
 * (`markSearchResultOpened`) happen as the user navigates *away* — the effect is
 * visible on the next mount, which is exactly when it is wanted. So the visited
 * bookkeeping mutates in place and notifies nobody, rather than churning a
 * snapshot for a render that will never happen.
 */

import { registerCacheTeardown } from "@/lib/logout";
import type { SearchResult, SearchScope } from "./search-types";

export interface SearchSession {
  /** The results themselves; already carries `query` and `caseSensitive`. */
  result: SearchResult;
  /** Not part of SearchResult — restores the scope checkboxes and feeds drift detection. */
  scope: SearchScope;
  /** When the search ran, for the provenance line. */
  ranAt: number;
  /** id -> revision snapshot of the channel cache at index time. Staleness input. */
  channelRevisions: Map<string, number>;
  /** Result keys already opened, rendered dimmed so you can work through the rest. */
  visited: Set<string>;
  /** The most recently opened result key — scrolled back into view on return. */
  lastOpenedKey: string | null;
}

/** The fields a caller supplies; visited/lastOpenedKey start empty. */
export type NewSearchSession = Pick<
  SearchSession,
  "result" | "scope" | "ranAt" | "channelRevisions"
>;

let session: SearchSession | null = null;

/**
 * Stable identity for one matched line within one segment.
 * Only meaningful inside a single session — segment indices are re-derived on
 * every search, which is fine because `visited` resets with it.
 */
export function searchResultKey(
  category: string,
  sourceId: string,
  segmentIndex: number,
  lineNumber?: number
): string {
  return `${category}:${sourceId}:${segmentIndex}:${lineNumber ?? "*"}`;
}

/** Record a completed search. Resets the visited bookkeeping — it belongs to one query. */
export function saveSearchSession(next: NewSearchSession): void {
  session = { ...next, visited: new Set(), lastOpenedKey: null };
}

/**
 * Read the stored session without consuming it — unlike the take-once
 * `channel-import-store`, returning to /search repeatedly must keep working.
 */
export function getSearchSession(): SearchSession | null {
  return session;
}

/**
 * Note that the user opened a result. Mutates in place and notifies nobody; see
 * the header. No-ops when there is no session (the page cannot navigate from
 * results it does not have, but a caller should not have to prove that).
 */
export function markSearchResultOpened(key: string): void {
  if (!session) return;
  session.visited.add(key);
  session.lastOpenedKey = key;
}

/** Drop the stored session (the Clear button, and session teardown). */
export function clearSearchSession(): void {
  session = null;
}

// Holds the free-text query plus a copy of every matching line of channel
// configuration, so it must not survive into the next user's session.
registerCacheTeardown(clearSearchSession);
