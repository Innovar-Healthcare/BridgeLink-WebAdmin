/**
 * Shared mutable cache state for the repo-changes subsystem.
 *
 * Split into its own file so plugin index modules (server-side registration
 * code) can import clearRepoChangesCache() without pulling in the React hooks
 * from use-repo-changes.ts — which would break Next.js App Route builds.
 */

import type { RepoChangesSummary } from "@/lib/plugin-registry";
// Only `registerCacheTeardown` is imported from `lib/logout` — documented there (and in
// `cron-verdict-cache.ts`, as safe from any reachable path including server-side,
// which is what keeps this module importable from `plugins/version-history/index.ts`.
import { registerCacheTeardown } from "@/lib/logout";

export const CACHE_TTL = 30_000; // 30 seconds

export const repoChangesState = {
  cache: null as RepoChangesSummary | null,
  cacheTime: 0,
  promise: null as Promise<RepoChangesSummary | null> | null,
  subscribers: new Set<() => void>(),
};

/**
 * Drops the cached result **without** notifying subscribers. Session teardown only.
 */
export function resetRepoChangesCache(): void {
  repoChangesState.cache = null;
  repoChangesState.cacheTime = 0;
  repoChangesState.promise = null;
}

/**
 * Clears the cached result and notifies all mounted hook instances to re-fetch.
 * Call this after any save operation that may change the uncommitted-changes set.
 */
export function clearRepoChangesCache(): void {
  resetRepoChangesCache();
  repoChangesState.subscribers.forEach((cb) => cb());
}

// The registered teardown is deliberately the SILENT reset, not clearRepoChangesCache
//. Teardown runs while the app tree is still mounted — sidebar logout calls
// clearClientCaches() before router.replace("/login") — so notifying subscribers would
// re-run useRepoChanges()'s fetch effect against a dead session, and that 401 sends
// throwForStatus down window.location.href = "/login?returnUrl=...". Logout would hard
// reload onto a returnUrl'd login instead of a clean /login. Do not "simplify" this.
registerCacheTeardown(resetRepoChangesCache);
