/**
 * Drift detection for a restored Config Search.
 *
 * Restoring results on return means they can be older than the server. The
 * common case is the reason you left in the first place: you opened a match,
 * edited that channel, and came back. Comparing the channel revisions captured
 * at index time against the live cache catches exactly that, with no fetch.
 *
 * Known limitation, deliberately not fixed here: code templates, global scripts
 * and the configuration map are not revisioned in `lib/cache-store.ts`, so drift
 * in those three is undetectable. The always-visible "searched at ..." timestamp
 * and the ever-present Search button are the backstop; building revision
 * tracking for the other three belongs in whatever ticket needs it.
 */

import type { Channel } from "@/lib/types";
import type { SearchScope } from "./search-types";

export interface SearchStaleness {
  stale: boolean;
  /** Channels present in both, with a different revision. */
  changed: number;
  /** Channels that exist now but did not at index time. */
  added: number;
  /** Channels that existed at index time but are gone now. */
  removed: number;
}

const FRESH: SearchStaleness = { stale: false, changed: 0, added: 0, removed: 0 };

/** Capture id -> revision for every channel currently in the cache. */
export function snapshotChannelRevisions(channels: Map<string, Channel>): Map<string, number> {
  const snapshot = new Map<string, number>();
  for (const [id, channel] of channels) snapshot.set(id, channel.revision);
  return snapshot;
}

/**
 * Compare an index-time revision snapshot against the live channel cache.
 * Returns a zeroed result when channels were not in scope for that search —
 * there is nothing to be stale about.
 */
export function computeSearchStaleness(
  snapshot: Map<string, number>,
  current: Map<string, Channel>,
  scope: SearchScope
): SearchStaleness {
  if (!scope.channels || snapshot.size === 0) return FRESH;

  let changed = 0;
  let removed = 0;
  for (const [id, revision] of snapshot) {
    const live = current.get(id);
    if (!live) removed++;
    else if (live.revision !== revision) changed++;
  }

  let added = 0;
  for (const id of current.keys()) {
    if (!snapshot.has(id)) added++;
  }

  return { stale: changed + added + removed > 0, changed, added, removed };
}

/** Whether two scope selections are the same set of checkboxes. */
export function scopesEqual(a: SearchScope, b: SearchScope): boolean {
  return (
    a.channels === b.channels &&
    a.codeTemplates === b.codeTemplates &&
    a.globalScripts === b.globalScripts &&
    a.configMap === b.configMap
  );
}

/** One-line human summary of what drifted, e.g. "3 channels changed, 1 added". */
export function describeStaleness(s: SearchStaleness): string {
  const parts: string[] = [];
  if (s.changed > 0) parts.push(`${s.changed} channel${s.changed === 1 ? "" : "s"} changed`);
  if (s.added > 0) parts.push(`${s.added} added`);
  if (s.removed > 0) parts.push(`${s.removed} removed`);
  return parts.join(", ");
}
