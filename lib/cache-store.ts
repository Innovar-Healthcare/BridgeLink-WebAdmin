/**
 * Client-side cache store — mirrors the Java client's in-memory channel cache.
 *
 * The Java Swing client keeps:
 *   - channelIdsAndNames    Map<String, String>
 *   - channelStatuses       Map<String, ChannelStatus>
 *   - groupStatuses         Map<String, ChannelGroupStatus>
 *   - channelDependencies   Set<ChannelDependency>
 *   - cachedChannelTags     Set<ChannelTag>
 *
 * We replicate this as a module-level singleton so all tabs share the same
 * data without re-fetching, exactly as the Java client does.
 *
 * Refresh is always user-triggered (no auto-polling), matching Java behavior.
 * We add a staleness timestamp so consumers can show "last refreshed" info.
 */

import type {
  Channel,
  ChannelGroup,
  ChannelStatistics,
  ChannelSummary,
  ChannelTag,
  DashboardStatus,
} from "./types";
import type { ConnectorStateMap } from "./api/api-dashboard";

export interface ChannelPruningSettings {
  /** Days to retain message metadata. Absent = inherit global data pruner setting. */
  pruneMetaDataDays?: number;
  /** Days to retain message content. Absent = inherit global data pruner setting. */
  pruneContentDays?: number;
  archiveEnabled: boolean;
  pruneErroredMessages: boolean;
}

export interface ChannelMetadata {
  enabled: boolean;
  /** ISO string, converted from XStream Calendar {"time": millis, "timezone": "..."} by normalizeXStream */
  lastModified?: string;
  pruningSettings?: ChannelPruningSettings;
  /**
   * BridgeLink user id of whoever last modified the channel. Present in the server's
   * ChannelMetadata model; flows through getChannelMetadata's passthrough normalization (the
   * XStream {"int": N} wrapper is unwrapped to a number). Used by the editor's concurrent-edit
   * conflict handling to distinguish a same-user re-save from another user's edit.
   */
  userId?: number;
}

export interface ChannelDependency {
  dependentId: string;
  dependencyId: string;
}

export interface CacheStore {
  // Dashboard
  dashboardStatuses: DashboardStatus[];
  dashboardRefreshedAt: Date | null;
  connectorStates: ConnectorStateMap;

  // Channels tab
  // channelMap is the authoritative store (keyed by channel ID) that supports
  // delta merging from POST /channels/_getSummary.
  // channels is derived from channelMap for backward compatibility with consumers.
  channelMap: Map<string, Channel>;
  // deployedDate (ISO string) per channel, from ChannelSummary.channelStatus.deployedDate.
  // Used to build the ChannelHeader.deployedDate sent in subsequent _getSummary requests.
  channelDeployedDates: Map<string, string>;
  // deployedRevisionDelta per channel — current revision minus deployed revision.
  // > 0 means the channel has been saved but not yet redeployed. Shown as "Rev Δ" column.
  channelRevisionDeltas: Map<string, number>;
  // codeTemplatesChanged per channel — true when linked code templates changed since deploy.
  // Also triggers the orange Rev Δ highlight even when deployedRevisionDelta is 0.
  channelCodeTemplatesChanged: Map<string, boolean>;
  // localChannelId per channel — numeric id used in message-table names, from
  // ChannelSummary.channelStatus.localChannelId. Shown as the "Local Id" column.
  channelLocalIds: Map<string, number>;
  channels: Channel[];
  channelGroups: ChannelGroup[];
  channelMetadata: Record<string, ChannelMetadata>;
  channelDependencies: ChannelDependency[];
  channelTags: ChannelTag[];
  channelsRefreshedAt: Date | null;
  // Configuration map — key → resolved value. Fetched once and shared across pages.
  configMap: Map<string, string>;
}

// Module-level singleton — shared across all components
let store: CacheStore = {
  dashboardStatuses: [],
  dashboardRefreshedAt: null,
  connectorStates: {},
  channelMap: new Map(),
  channelDeployedDates: new Map(),
  channelRevisionDeltas: new Map(),
  channelCodeTemplatesChanged: new Map(),
  channelLocalIds: new Map(),
  channels: [],
  channelGroups: [],
  channelMetadata: {},
  channelDependencies: [],
  channelTags: [],
  channelsRefreshedAt: null,
  configMap: new Map(),
};

// Simple subscriber pattern so React components can react to cache updates
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function getCache(): Readonly<CacheStore> {
  return store;
}

/**
 * Reset the entire cache to its initial empty state.
 * Call this on login so stale data from a previous session (potentially a
 * different server) is never shown after the user authenticates.
 */
export function clearCache() {
  store = {
    dashboardStatuses: [],
    dashboardRefreshedAt: null,
    connectorStates: {},
    channelMap: new Map(),
    channelDeployedDates: new Map(),
    channelRevisionDeltas: new Map(),
    channelCodeTemplatesChanged: new Map(),
    channelLocalIds: new Map(),
    channels: [],
    channelGroups: [],
    channelMetadata: {},
    channelDependencies: [],
    channelTags: [],
    channelsRefreshedAt: null,
    configMap: new Map(),
  };
  notify();
}

export function updateConfigMap(entries: Map<string, string>) {
  // Keep the previous Map reference when contents are identical so configMap
  // selectors don't re-render on every page visit (the fetch runs per mount).
  const prev = store.configMap;
  if (prev.size === entries.size) {
    let same = true;
    for (const [k, v] of entries) {
      if (prev.get(k) !== v) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  store = { ...store, configMap: entries };
  notify();
}

// ── Cheap equality helpers ────────────────────────────────────────
// These compare only the fields that drive rendering, so the store can reuse
// previous object references when a poll returns unchanged data. Stable
// references let React.memo'd rows and downstream useMemo chains skip work on
// idle ticks. They are deliberately NOT deep-equals — just the displayed fields.

function statsEqual(a: ChannelStatistics | undefined, b: ChannelStatistics | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.RECEIVED === b.RECEIVED &&
    a.SENT === b.SENT &&
    a.ERROR === b.ERROR &&
    a.FILTERED === b.FILTERED &&
    a.QUEUED === b.QUEUED &&
    a.received === b.received &&
    a.sent === b.sent &&
    a.error === b.error &&
    a.filtered === b.filtered &&
    a.queued === b.queued
  );
}

function dashboardStatusEqual(a: DashboardStatus, b: DashboardStatus): boolean {
  if (a === b) return true;
  if (
    a.channelId !== b.channelId ||
    a.name !== b.name ||
    a.state !== b.state ||
    a.deployedRevisionDelta !== b.deployedRevisionDelta ||
    a.codeTemplatesChanged !== b.codeTemplatesChanged ||
    a.deployedDate !== b.deployedDate ||
    a.metaDataId !== b.metaDataId ||
    a.statusType !== b.statusType ||
    a.queueEnabled !== b.queueEnabled ||
    a.queued !== b.queued
  ) {
    return false;
  }
  if (!statsEqual(a.statistics, b.statistics)) return false;
  if (!statsEqual(a.lifetimeStatistics, b.lifetimeStatistics)) return false;
  const ac = a.childStatuses;
  const bc = b.childStatuses;
  if (ac === bc) return true;
  if (!ac || !bc || ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i++) {
    if (!dashboardStatusEqual(ac[i], bc[i])) return false;
  }
  return true;
}

function connectorStatesEqual(a: ConnectorStateMap, b: ConnectorStateMap): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const av = a[k];
    const bv = b[k];
    if (!bv || av[1] !== bv[1]) return false;
    const ac = av[0];
    const bc = bv[0];
    if (
      ac.red !== bc.red ||
      ac.green !== bc.green ||
      ac.blue !== bc.blue ||
      ac.alpha !== bc.alpha
    ) {
      return false;
    }
  }
  return true;
}

// Positional compare is intentional: ChannelGroup and its channels list are
// Java Lists (ordered), unlike dependencies/tags which are server-side Sets
// and therefore compared set-wise below. A false "changed" from a reorder only
// costs a reference swap, never stale UI.
function channelGroupsEqual(a: ChannelGroup[], b: ChannelGroup[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ga = a[i];
    const gb = b[i];
    // `channels` is null when the server returns a group with no channels
    // assigned (XStream serializes an empty <channels/> that normalizes to
    // null, not []). Guard with `?? []` like every other group.channels site.
    const ca = ga.channels ?? [];
    const cb = gb.channels ?? [];
    if (
      ga.id !== gb.id ||
      ga.name !== gb.name ||
      ga.description !== gb.description ||
      ga.revision !== gb.revision ||
      ga.lastModified !== gb.lastModified ||
      ca.length !== cb.length
    ) {
      return false;
    }
    for (let j = 0; j < ca.length; j++) {
      if (ca[j].id !== cb[j].id) return false;
    }
  }
  return true;
}

function channelMetadataEqual(
  a: Record<string, ChannelMetadata>,
  b: Record<string, ChannelMetadata>
): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const ma = a[k];
    const mb = b[k];
    if (!mb || ma.enabled !== mb.enabled || ma.lastModified !== mb.lastModified) return false;
    const pa = ma.pruningSettings;
    const pb = mb.pruningSettings;
    if (pa === pb) continue;
    if (
      !pa ||
      !pb ||
      pa.pruneMetaDataDays !== pb.pruneMetaDataDays ||
      pa.pruneContentDays !== pb.pruneContentDays ||
      pa.archiveEnabled !== pb.archiveEnabled ||
      pa.pruneErroredMessages !== pb.pruneErroredMessages
    ) {
      return false;
    }
  }
  return true;
}

function channelDependenciesEqual(a: ChannelDependency[], b: ChannelDependency[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  // Order is not guaranteed (Java backs this with a Set), so compare set-wise.
  const seen = new Set(a.map((d) => `${d.dependentId}|${d.dependencyId}`));
  for (const d of b) {
    if (!seen.has(`${d.dependentId}|${d.dependencyId}`)) return false;
  }
  return true;
}

function tagColorEqual(
  a: ChannelTag["backgroundColor"],
  b: ChannelTag["backgroundColor"]
): boolean {
  if (a === b) return true;
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (!a || !b) return false;
  return (
    a.r === b.r &&
    a.red === b.red &&
    a.g === b.g &&
    a.green === b.green &&
    a.b === b.b &&
    a.blue === b.blue &&
    a.value === b.value
  );
}

function channelTagsEqual(a: ChannelTag[], b: ChannelTag[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((t) => [t.id, t]));
  for (const tb of b) {
    const ta = byId.get(tb.id);
    if (
      !ta ||
      ta.name !== tb.name ||
      ta.channelIds.length !== tb.channelIds.length ||
      !tagColorEqual(ta.backgroundColor, tb.backgroundColor)
    ) {
      return false;
    }
    // channelIds is a normalized Set — compare set-wise.
    const ids = new Set(ta.channelIds);
    for (const id of tb.channelIds) {
      if (!ids.has(id)) return false;
    }
  }
  return true;
}

export function updateDashboard(statuses: DashboardStatus[], connectorStates?: ConnectorStateMap) {
  // XStream may deserialize numeric-only names as numbers; coerce to string.
  for (const s of statuses) {
    if (typeof s.name !== "string") s.name = String(s.name ?? "");
  }

  // Structural sharing: reuse the previous status object for each channel whose
  // displayed fields are unchanged, so React.memo'd rows keep a stable reference.
  const prev = store.dashboardStatuses;
  const prevById = new Map(prev.map((s) => [s.channelId, s]));
  const merged = statuses.map((s) => {
    const old = prevById.get(s.channelId);
    return old && dashboardStatusEqual(old, s) ? old : s;
  });

  // The status array is unchanged only if every element is reference-identical
  // to the previous array in the same position (covers adds, deletes, reorders).
  let statusesSame = merged.length === prev.length;
  if (statusesSame) {
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] !== prev[i]) {
        statusesSame = false;
        break;
      }
    }
  }

  const nextConnectorStates =
    connectorStates !== undefined ? connectorStates : store.connectorStates;
  const connectorsSame = connectorStatesEqual(store.connectorStates, nextConnectorStates);

  // Always stamp + notify, even when the data is unchanged: dashboardRefreshedAt
  // means "last successful refresh" (header timestamp, trend refetch tick), not
  // "last data change". The render win comes from the reference reuse above —
  // selectors and React.memo'd rows see identical references and skip, so an
  // idle tick re-renders only the components that select the timestamp itself.
  store = {
    ...store,
    dashboardStatuses: statusesSame ? prev : merged,
    dashboardRefreshedAt: new Date(),
    connectorStates: connectorsSame ? store.connectorStates : nextConnectorStates,
  };
  notify();
}

export function updateChannels(
  channels: Channel[],
  channelGroups: ChannelGroup[],
  channelMetadata: Record<string, ChannelMetadata>,
  channelDependencies: ChannelDependency[],
  channelTags: ChannelTag[]
) {
  const channelMap = new Map(channels.map((ch) => [ch.id, ch]));
  store = {
    ...store,
    channelMap,
    channels,
    channelGroups,
    channelMetadata,
    channelDependencies,
    channelTags,
    channelsRefreshedAt: new Date(),
  };
  notify();
}

/**
 * Merge a list of ChannelSummary deltas into the existing channelMap.
 * Mirrors Java's updateChannelStatuses():
 *   - deleted=true  → remove from map
 *   - channelStatus.channel non-null → update/add full Channel object
 *   - otherwise → leave existing cached Channel unchanged
 * Then derives the channels[] array from the updated map.
 */
export function mergeChannelSummaries(
  summaries: ChannelSummary[],
  channelGroups: ChannelGroup[],
  channelMetadata: Record<string, ChannelMetadata>,
  channelDependencies: ChannelDependency[],
  channelTags: ChannelTag[]
) {
  // Clone maps to apply the delta. Cloning a few-hundred-entry Map per 10s tick
  // is negligible; the important win is that we only assign the new
  // references to the store — and notify — when something actually changed.
  const channelMap = new Map(store.channelMap);
  const channelDeployedDates = new Map(store.channelDeployedDates);
  const channelRevisionDeltas = new Map(store.channelRevisionDeltas);
  const channelCodeTemplatesChanged = new Map(store.channelCodeTemplatesChanged);
  const channelLocalIds = new Map(store.channelLocalIds);
  let mapsChanged = false;

  for (const summary of summaries) {
    const id = summary.channelId;
    if (!id) continue;

    if (summary.deleted) {
      if (channelMap.delete(id)) mapsChanged = true;
      if (channelDeployedDates.delete(id)) mapsChanged = true;
      if (channelRevisionDeltas.delete(id)) mapsChanged = true;
      if (channelCodeTemplatesChanged.delete(id)) mapsChanged = true;
      if (channelLocalIds.delete(id)) mapsChanged = true;
    } else {
      const incoming = summary.channelStatus?.channel;
      if (incoming) {
        // Full channel object returned — channel changed since last cache.
        // XStream may deserialize numeric-only names (e.g. "123") as numbers;
        // coerce to string so all consumers can safely call .toLowerCase() etc.
        if (typeof incoming.name !== "string") {
          incoming.name = String(incoming.name ?? "");
        }
        channelMap.set(id, incoming);
        mapsChanged = true;
      }
      // Track the deployed date so we can build correct ChannelHeader on next refresh.
      // deployedDate comes as an ISO string after XStream/normalizeXStream processing.
      const deployedDate = summary.channelStatus?.deployedDate;
      if (deployedDate) {
        if (channelDeployedDates.get(id) !== deployedDate) {
          channelDeployedDates.set(id, deployedDate);
          mapsChanged = true;
        }
      } else if (summary.undeployed) {
        // On undeploy the server omits the now-null revision delta and ctc from JSON,
        // so the merge below would never overwrite the stale cached values. Clear them
        // here (mirrors ChannelPanel.java clearing deployedRevisionDelta + codeTemplatesChanged
        // on undeploy) so the "Rev Δ" column and its orange highlight reset.
        if (channelDeployedDates.delete(id)) mapsChanged = true;
        if (channelRevisionDeltas.delete(id)) mapsChanged = true;
        if (channelCodeTemplatesChanged.delete(id)) mapsChanged = true;
      }
      // Track revision delta (current revision − deployed revision) for the "Rev Δ" column.
      const delta = summary.channelStatus?.deployedRevisionDelta;
      if (delta != null && channelRevisionDeltas.get(id) !== delta) {
        channelRevisionDeltas.set(id, delta);
        mapsChanged = true;
      }
      // Track codeTemplatesChanged — also triggers the orange Rev Δ highlight.
      const ctc = summary.channelStatus?.codeTemplatesChanged;
      if (ctc != null && channelCodeTemplatesChanged.get(id) !== ctc) {
        channelCodeTemplatesChanged.set(id, ctc);
        mapsChanged = true;
      }
      // Track localChannelId for the "Local Id" column. The server populates this on
      // every summary (DefaultChannelController.getChannelSummary), so it's available
      // even on delta refreshes where the full channel object is absent. It's stable
      // for the channel's lifetime, so it is NOT cleared on undeploy.
      const localId = summary.channelStatus?.localChannelId;
      if (localId != null && channelLocalIds.get(id) !== localId) {
        channelLocalIds.set(id, localId);
        mapsChanged = true;
      }
      // If channel is null/absent, the cached copy is still current — leave it.
    }
  }

  // The group/metadata/dependency/tag collections come from separate endpoints
  // and arrive as fresh references every refresh; compare by value so unchanged
  // collections keep their previous reference and don't invalidate downstream memos.
  const groupsChanged = !channelGroupsEqual(store.channelGroups, channelGroups);
  const metadataChanged = !channelMetadataEqual(store.channelMetadata, channelMetadata);
  const depsChanged = !channelDependenciesEqual(store.channelDependencies, channelDependencies);
  const tagsChanged = !channelTagsEqual(store.channelTags, channelTags);

  // Always stamp + notify (channelsRefreshedAt = "last successful refresh");
  // unchanged collections keep their references so selectors/memos skip.
  store = {
    ...store,
    channelMap: mapsChanged ? channelMap : store.channelMap,
    channelDeployedDates: mapsChanged ? channelDeployedDates : store.channelDeployedDates,
    channelRevisionDeltas: mapsChanged ? channelRevisionDeltas : store.channelRevisionDeltas,
    channelCodeTemplatesChanged: mapsChanged
      ? channelCodeTemplatesChanged
      : store.channelCodeTemplatesChanged,
    channelLocalIds: mapsChanged ? channelLocalIds : store.channelLocalIds,
    channels: mapsChanged ? Array.from(channelMap.values()) : store.channels,
    channelGroups: groupsChanged ? channelGroups : store.channelGroups,
    channelMetadata: metadataChanged ? channelMetadata : store.channelMetadata,
    channelDependencies: depsChanged ? channelDependencies : store.channelDependencies,
    channelTags: tagsChanged ? channelTags : store.channelTags,
    channelsRefreshedAt: new Date(),
  };
  notify();
}

/**
 * Lightweight refresh of the grouping/tag metadata only — channel groups,
 * dependencies, and tags — without touching the channel map or running the
 * _getSummary delta. Mirrors the Java dashboard refresh, which re-fetches these
 * three collections every tick (Frame.doRefreshStatuses → retrieveGroups /
 * retrieveDependencies / tagsPanel.refresh) so changes made in another session
 * appear on the dashboard within one interval.
 *
 * Compares by value and only reassigns + notifies when something actually
 * changed; unchanged collections keep their previous reference so downstream
 * memos are not invalidated. Deliberately does NOT stamp channelsRefreshedAt —
 * the channel list itself was not refreshed, so the Channels page must still run
 * its own full load.
 */
export function mergeChannelMetadataOnly(
  channelGroups: ChannelGroup[],
  channelDependencies: ChannelDependency[],
  channelTags: ChannelTag[]
) {
  const groupsChanged = !channelGroupsEqual(store.channelGroups, channelGroups);
  const depsChanged = !channelDependenciesEqual(store.channelDependencies, channelDependencies);
  const tagsChanged = !channelTagsEqual(store.channelTags, channelTags);
  if (!groupsChanged && !depsChanged && !tagsChanged) return;

  store = {
    ...store,
    channelGroups: groupsChanged ? channelGroups : store.channelGroups,
    channelDependencies: depsChanged ? channelDependencies : store.channelDependencies,
    channelTags: tagsChanged ? channelTags : store.channelTags,
  };
  notify();
}
