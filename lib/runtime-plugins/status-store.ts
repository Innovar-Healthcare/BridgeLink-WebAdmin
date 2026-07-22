/**
 * Per-extension load status for runtime plugin manifests.
 *
 * The loader records one row per manifest entry — loaded, or skipped with a
 * single human-readable reason — plus the state of the manifest-list fetch
 * itself. The Extensions page renders this as the "Web contributions"
 * section. Loading completes before the app shell's children mount, so the
 * first read already sees final data; the subscription exists so a reset
 * (logout/401 teardown) re-renders an open page.
 */

import { useSyncExternalStore } from "react";
import type { RuntimeManifestListState, RuntimePluginStatus } from "./manifest-types";

export interface RuntimePluginStatusSnapshot {
  statuses: readonly RuntimePluginStatus[];
  listState: RuntimeManifestListState;
}

const EMPTY_SNAPSHOT: RuntimePluginStatusSnapshot = { statuses: [], listState: "idle" };

let snapshot: RuntimePluginStatusSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function emit(next: RuntimePluginStatusSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Appends one extension's status row. */
export function recordRuntimePluginStatus(status: RuntimePluginStatus): void {
  emit({ ...snapshot, statuses: [...snapshot.statuses, status] });
}

/**
 * Replaces one extension's status row in place (matched by name). No-ops when
 * the row is gone — a post-teardown late settlement of a deferred contribution
 * (channel registry draining after logout) must not resurrect stale rows.
 */
export function updateRuntimePluginStatus(
  name: string,
  update: (row: RuntimePluginStatus) => RuntimePluginStatus
): void {
  if (!snapshot.statuses.some((row) => row.name === name)) return;
  emit({
    ...snapshot,
    statuses: snapshot.statuses.map((row) => (row.name === name ? update(row) : row)),
  });
}

/** Sets the manifest-list fetch state. */
export function setRuntimeManifestListState(listState: RuntimeManifestListState): void {
  emit({ ...snapshot, listState });
}

/** Clears all rows and the list state (loader teardown on logout/401). */
export function resetRuntimePluginStatuses(): void {
  emit(EMPTY_SNAPSHOT);
}

/** Non-hook snapshot read. */
export function getRuntimePluginStatusSnapshot(): RuntimePluginStatusSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive read of the runtime plugin statuses (Extensions page). */
export function useRuntimePluginStatuses(): RuntimePluginStatusSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY_SNAPSHOT
  );
}
