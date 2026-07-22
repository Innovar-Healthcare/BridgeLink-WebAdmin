"use client";

import { useEffect, useState, useCallback, useMemo, useRef, startTransition } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
import {
  getCache,
  subscribe,
  updateDashboard,
  mergeChannelSummaries,
  mergeChannelMetadataOnly,
  updateConfigMap,
  type CacheStore,
} from "../cache-store";
import {
  getDashboardStatuses,
  getChannelIdsAndNames,
  getChannelSummary,
  getChannelGroups,
  getChannelMetadata,
  getChannelDependencies,
  getChannelTags,
  ApiError,
} from "../api-client";
import { getConnectorStates } from "../api/api-dashboard";
import { getConfigurationMap } from "../api/api-settings";
import { getCodeTemplatesCached, getCodeTemplateLibrariesCached } from "../api/api-code-templates";
import type { ChannelHeader, ChannelTag } from "../types";

/**
 * Build a `.catch` handler for the optional channel data (metadata/tags/dependencies).
 * A 403 means the user genuinely lacks permission for this data — fall back to `empty`.
 * Any other (transient) error — 502, timeout — keeps the prior cached value so a brief
 * blip doesn't blank out Last Modified / tag chips / dependencies until the next refresh.
 */
function keepOnTransient<T>(prev: T, empty: T) {
  return (err: unknown): T => (err instanceof ApiError && err.status === 403 ? empty : prev);
}

/** Returns the current cache snapshot, re-rendering on every cache update. */
export function useCache(): CacheStore {
  const [, rerender] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => rerender((n) => n + 1));
    return () => {
      unsub();
    };
  }, []);
  return getCache() as CacheStore;
}

// Stable snapshot getter for useSyncExternalStore. The store early-returns
// without reassigning on a no-op tick (see lib/cache-store.ts), so this returns
// the same reference and no subscriber wakes up.
const getSnapshot = (): CacheStore => getCache() as CacheStore;

/**
 * Subscribe to a slice of the cache store. The component only re-renders when the
 * selected value changes (compared with `isEqual`, default `Object.is`). Combined
 * with the store's structural sharing, an idle poll that returns
 * unchanged data produces no re-render of the consuming component at all.
 */
export function useCacheSelector<T>(
  selector: (s: CacheStore) => T,
  isEqual?: (a: T, b: T) => boolean
): T {
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, isEqual);
}

/** Hook that loads and caches Dashboard data, returning loading/error state. */
export function useDashboard() {
  const statuses = useCacheSelector((s) => s.dashboardStatuses);
  const connectorStates = useCacheSelector((s) => s.connectorStates);
  const refreshedAt = useCacheSelector((s) => s.dashboardRefreshedAt);

  // `loading` (initialLoading) gates the full skeleton — true only until the first
  // successful load. `refreshing` flips on every refresh (including the background
  // poll) and drives the toolbar spinner, matching the old `loading` behavior.
  const [initialLoading, setInitialLoading] = useState(
    () => getCache().dashboardRefreshedAt === null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Skip a tick while a refresh is still pending so slow refreshes can't stack.
  const inFlightRef = useRef(false);
  // Monotonic request id: only the newest request is allowed to write to the
  // cache, so a slow response that resolves out of order can't overwrite newer
  // data (updateDashboard is last-write-wins and also stamps dashboardRefreshedAt).
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const mySeq = ++seqRef.current;
    setRefreshing(true);
    setError("");
    try {
      // Mirror the Java dashboard refresh (Frame.doRefreshStatuses), which also
      // re-fetches groups/dependencies/tags every tick so group/tag/dependency
      // changes made in another session show up within one interval. These three
      // are lightweight standalone endpoints — NOT the heavy _getSummary channel
      // delta — so we fetch them alongside statuses and merge via the metadata-only
      // path (see mergeChannelMetadataOnly). Optional data falls back to the prior
      // cache on a transient error and to empty on a 403 (no permission).
      const cache = getCache();
      const [statuses, connectorStates, groups, dependencies, tags] = await Promise.all([
        getDashboardStatuses(),
        getConnectorStates(),
        getChannelGroups().catch(keepOnTransient(cache.channelGroups, [])),
        getChannelDependencies().catch(keepOnTransient(cache.channelDependencies, [])),
        getChannelTags().catch(keepOnTransient(cache.channelTags, [])),
      ]);
      if (mySeq === seqRef.current) {
        updateDashboard(statuses ?? [], connectorStates ?? {});
        mergeChannelMetadataOnly(groups ?? [], dependencies ?? [], tags ?? []);
      }
    } catch (err) {
      if (mySeq === seqRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      }
    } finally {
      inFlightRef.current = false;
      if (mySeq === seqRef.current) {
        setRefreshing(false);
        // Cleared on error too: a failed FIRST load must exit the skeleton state
        // and show the error/empty state, not spin forever (the old single
        // `loading` flag cleared in finally, and pages gate skeletons on it).
        setInitialLoading(false);
      }
    }
  }, []);

  // Always refresh on mount so navigating to the page picks up latest data.
  // Runs silently in the background — cached data is shown immediately.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    statuses,
    connectorStates,
    refreshedAt,
    loading: initialLoading,
    refreshing,
    error,
    refresh,
  };
}

/** Hook that loads and caches Channel list data, returning loading/error state. */
export function useChannels() {
  const channels = useCacheSelector((s) => s.channels);
  const channelGroups = useCacheSelector((s) => s.channelGroups);
  const channelMetadata = useCacheSelector((s) => s.channelMetadata);
  const channelRevisionDeltas = useCacheSelector((s) => s.channelRevisionDeltas);
  const channelCodeTemplatesChanged = useCacheSelector((s) => s.channelCodeTemplatesChanged);
  const channelLocalIds = useCacheSelector((s) => s.channelLocalIds);
  const channelDependencies = useCacheSelector((s) => s.channelDependencies);
  const channelTags = useCacheSelector((s) => s.channelTags);
  const refreshedAt = useCacheSelector((s) => s.channelsRefreshedAt);

  const [initialLoading, setInitialLoading] = useState(
    () => getCache().channelsRefreshedAt === null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Monotonic request id: only the newest request may write to the cache, so a
  // slow response resolving out of order can't overwrite newer data. Unlike
  // useDashboard there is deliberately NO in-flight early-return here: channel
  // operations `await refresh()` after mutations (deploy/enable/delete) and must
  // always get a real fetch, not a dropped call.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const mySeq = ++seqRef.current;
    setRefreshing(true);
    setError("");
    try {
      // Mirrors Java client's retrieveChannels():
      //   1. getChannelIdsAndNames()  — lightweight ID→name map
      //   2. getChannelSummary(headers) — delta fetch: full Channel only for changed ones
      //
      // Build ChannelHeader map from current cache so the server can diff.
      // On first load channelMap is empty → cachedHeaders = {} → server returns ALL channels.
      //
      // ChannelHeader field names must exactly match the Java class:
      //   { int revision, Calendar deployedDate, boolean codeTemplatesChanged }
      // The server uses XStream JSON (XML→JSON via Staxon). Calendar serializes as
      //   {"time": <epochMillis>, "timezone": "<tz>"} via XStream's GregorianCalendarConverter.
      // Send null when the channel has not been deployed.
      const cache = getCache();
      const cachedHeaders: Record<string, ChannelHeader> = {};
      for (const [id, ch] of cache.channelMap) {
        const deployedIso = cache.channelDeployedDates.get(id);
        // Omit deployedDate entirely when null — sending JSON null causes Staxon to emit
        // an empty XML element that XStream's GregorianCalendarConverter cannot deserialize,
        // resulting in a 500 from _getSummary. Absent field == not deployed on the server side.
        cachedHeaders[id] = {
          revision: ch.revision,
          ...(deployedIso
            ? { deployedDate: { time: new Date(deployedIso).getTime(), timezone: "UTC" } }
            : {}),
          // Send the real cached value, not a hardcoded false — otherwise the server
          // (DefaultChannelController) returns a full summary for every ctc-changed
          // channel on every refresh, defeating the delta contract.
          codeTemplatesChanged: cache.channelCodeTemplatesChanged.get(id) ?? false,
        };
      }

      const [, summaries, groups, metadata, dependencies, tags] = await Promise.all([
        getChannelIdsAndNames(), // gives us name coverage (incl. undeployed)
        getChannelSummary(cachedHeaders), // delta Channel objects
        getChannelGroups(),
        // Optional data: empty on 403 (no permission), prior cache on transient errors.
        getChannelMetadata().catch(keepOnTransient(cache.channelMetadata, {})),
        getChannelDependencies().catch(keepOnTransient(cache.channelDependencies, [])),
        getChannelTags().catch(keepOnTransient(cache.channelTags, [])),
      ]);

      // Merge summaries into cache — deleted channels removed, changed channels updated,
      // unchanged channels left as-is (delta pattern, mirrors Java updateChannelStatuses())
      if (mySeq === seqRef.current) {
        mergeChannelSummaries(
          summaries ?? [],
          groups ?? [],
          metadata ?? {},
          dependencies ?? [],
          tags ?? []
        );
      }
    } catch (err) {
      if (mySeq === seqRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load channels");
      }
    } finally {
      if (mySeq === seqRef.current) {
        setRefreshing(false);
        // Cleared on error too — a failed first load must not leave the skeleton
        // up forever (the channels page has no auto-poll to self-heal).
        setInitialLoading(false);
      }
    }
  }, []);

  // Always refresh on mount so navigating to the page picks up latest data.
  // Runs silently in the background — cached data is shown immediately.
  // Wrapped in startTransition so refresh()'s synchronous setRefreshing(true)/setError("")
  // aren't a synchronous setState in an effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    startTransition(() => {
      refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    channels,
    channelGroups,
    channelMetadata,
    channelRevisionDeltas,
    channelCodeTemplatesChanged,
    channelLocalIds,
    channelDependencies,
    channelTags,
    refreshedAt,
    loading: initialLoading,
    refreshing,
    error,
    refresh,
  };
}

/**
 * Replaces `${key}` variable expressions with values from the configuration map.
 * If a key is not found in the map, the original expression is left unchanged.
 */
export function resolveConfigVar(value: string, configMap: Map<string, string>): string {
  if (!value.includes("${")) return value;
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => configMap.get(key) ?? match);
}

/**
 * Fetches the configuration map on every mount and caches it in the shared store.
 * Multiple pages can call this — the cached value is shown immediately while the
 * background fetch completes, so stale values (e.g. after editing Settings) are
 * refreshed on the next page visit.
 */
export function useConfigMap(): Map<string, string> {
  const configMap = useCacheSelector((s) => s.configMap);

  useEffect(() => {
    getConfigurationMap()
      .then((entries) => {
        const map = new Map(entries.map((e) => [e.key, e.value]));
        updateConfigMap(map);
      })
      .catch(() => {
        // Non-fatal — variable expressions will display unresolved rather than blank
      });
  }, []);

  return configMap;
}

/**
 * Coerce XStream-serialized channelIds to a plain string[].
 *
 * XStream serializes Set<String> in several ways depending on size:
 *   - Empty set  → null / undefined / {}
 *   - Single ID  → "uuid-string"  (scalar, not array)
 *   - Multi IDs  → ["id1","id2"]  (already normalized by normalizeXStream)
 * Our normalizeXStream handles inline list fields, but for Set<String> with
 * a single element XStream may emit the scalar directly.
 */
function toStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return (val as unknown[]).map(String);
  if (typeof val === "string") return [val];
  // XStream may produce { string: "id" } or { string: ["id1","id2"] }
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const inner = obj["string"] ?? obj["id"] ?? Object.values(obj)[0];
    if (Array.isArray(inner)) return (inner as unknown[]).map(String);
    if (inner) return [String(inner)];
  }
  return [];
}

/**
 * Normalize a ChannelTag so its name is always a plain string.
 * XStream may serialize the name field as a number or object in edge cases.
 */
function normalizeTag(raw: ChannelTag): ChannelTag {
  return {
    ...raw,
    name: raw.name != null ? String(raw.name) : "",
    channelIds: toStringArray(raw.channelIds as unknown),
  };
}

/**
 * Fires getCodeTemplatesCached() and getCodeTemplateLibrariesCached() on mount
 * so the first Ctrl+Space in a Monaco editor doesn't pay the HTTP round-trip.
 * Returns nothing; results stay in the module-level promise cache.
 */
export function useCodeTemplatesPrefetch(): void {
  useEffect(() => {
    void getCodeTemplatesCached();
    void getCodeTemplateLibrariesCached();
  }, []);
}

/**
 * Returns a Map<channelId, ChannelTag[]> derived from the tag list.
 * Tags reference channels by ID (each ChannelTag has channelIds: string[]).
 */
export function useTagMap(tags: ChannelTag[]): Map<string, ChannelTag[]> {
  return useMemo(() => {
    const map = new Map<string, ChannelTag[]>();
    for (const rawTag of tags) {
      const tag = normalizeTag(rawTag);
      for (const id of tag.channelIds) {
        const existing = map.get(id) ?? [];
        existing.push(tag);
        map.set(id, existing);
      }
    }
    return map;
  }, [tags]);
}
