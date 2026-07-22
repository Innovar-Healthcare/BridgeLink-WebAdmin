/**
 * useRepoChanges — hook for consuming the version history repo changes provider.
 *
 * Returns sets of entity IDs that have uncommitted changes in the version history
 * Git repo. Used by the Channels and Code Templates pages to show per-entity
 * "uncommitted" indicators.
 *
 * Results are cached for 30 seconds at module level so multiple pages visited in
 * quick succession share a single API call. Call `clearRepoChangesCache()` after
 * a save operation to invalidate the cache and trigger an immediate re-fetch in
 * all mounted hook instances.
 *
 * Returns null sets when the version-history plugin is not installed.
 */

import { useEffect, useState } from "react";
import { type RepoChangesSummary } from "@/lib/plugin-registry";
import { getSlot } from "@/lib/plugin-slots";
import { slotSurfaceEnabled } from "@/lib/plugin-gating";
import { CACHE_TTL, repoChangesState, clearRepoChangesCache } from "./repo-changes-cache";

export { clearRepoChangesCache };

async function loadRepoChanges(): Promise<RepoChangesSummary | null> {
  const provider = getSlot("repo-changes.provider");
  if (!provider) return null;
  // Skip the repo-changes query when the owning plugin is disabled.
  // The async gate is load-accurate so a genuinely-enabled plugin is not
  // skipped due to a cold enablement cache.
  if (!(await slotSurfaceEnabled("repo-changes.provider"))) return null;

  const s = repoChangesState;
  const now = Date.now();
  if (s.cache && now - s.cacheTime < CACHE_TTL) return s.cache;

  if (s.promise) return s.promise;

  s.promise = provider()
    .then((result) => {
      s.cache = result;
      s.cacheTime = Date.now();
      return result;
    })
    .catch(() => {
      // Provider failed (e.g. plugin not installed on server) — return empty sets
      const empty: RepoChangesSummary = {
        channelIds: new Set(),
        templateIds: new Set(),
      };
      s.cache = empty;
      s.cacheTime = Date.now();
      return empty;
    })
    .finally(() => {
      s.promise = null;
    });

  return s.promise;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseRepoChangesResult {
  channelIds: Set<string> | null;
  templateIds: Set<string> | null;
  loading: boolean;
}

export function useRepoChanges(): UseRepoChangesResult {
  const [result, setResult] = useState<RepoChangesSummary | null>(null);
  const [loading, setLoading] = useState(() => getSlot("repo-changes.provider") !== null);
  // Incremented by the subscriber when clearRepoChangesCache() is called,
  // which triggers the fetch effect to re-run.
  const [version, setVersion] = useState(0);

  // Register this instance with the module-level subscriber set.
  useEffect(() => {
    const trigger = () => setVersion((v) => v + 1);
    repoChangesState.subscribers.add(trigger);
    return () => {
      repoChangesState.subscribers.delete(trigger);
    };
  }, []);

  // Re-fetch on mount and whenever clearRepoChangesCache() is called.
  useEffect(() => {
    if (!getSlot("repo-changes.provider")) return;
    void loadRepoChanges().then((data) => {
      setResult(data);
      setLoading(false);
    });
  }, [version]);

  return {
    channelIds: result?.channelIds ?? null,
    templateIds: result?.templateIds ?? null,
    loading,
  };
}
