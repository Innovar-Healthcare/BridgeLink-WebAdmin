/**
 * Shared mutable cache state for the repo-changes subsystem.
 *
 * Split into its own file so plugin index modules (server-side registration
 * code) can import clearRepoChangesCache() without pulling in the React hooks
 * from use-repo-changes.ts — which would break Next.js App Route builds.
 */

import type { RepoChangesSummary } from "@/lib/plugin-registry";

export const CACHE_TTL = 30_000; // 30 seconds

export const repoChangesState = {
  cache: null as RepoChangesSummary | null,
  cacheTime: 0,
  promise: null as Promise<RepoChangesSummary | null> | null,
  subscribers: new Set<() => void>(),
};

/**
 * Clears the cached result and notifies all mounted hook instances to re-fetch.
 * Call this after any save operation that may change the uncommitted-changes set.
 */
export function clearRepoChangesCache(): void {
  repoChangesState.cache = null;
  repoChangesState.cacheTime = 0;
  repoChangesState.promise = null;
  repoChangesState.subscribers.forEach((cb) => cb());
}
