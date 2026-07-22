import type { ChannelDependency } from "@/lib/cache-store";
import { getChannelDependencies, setChannelDependencies } from "@/lib/api-client";
import {
  parseChannelDependencyIds,
  buildDependencyAdditions,
  mergeChannelDependencies,
} from "./channel-import-xml";

/**
 * Persist the channel dependency relationships declared in one or more imported
 * channels' exportData into the global dependency set.
 *
 * Mirrors the Java client's `ChannelPanel.importChannel`
 * (bridgelink-core `ChannelPanel.java:1566-1592`): collect the additions from every
 * imported channel, fetch the current global set, merge (deduping by pair), and PUT
 * the merged set back only when something actually changed. Batch semantics — one
 * fetch and at most one PUT for N channels — match the group-import path.
 *
 * Blank ids and self-references are skipped by `buildDependencyAdditions`; referenced
 * ids are passed through `remap` (identity for single-channel import, where the other
 * channels already exist on the target under their original ids).
 *
 * Shared by the single-channel import dialog and the group import dialog so the two
 * paths cannot drift apart again (they diverged once —.
 *
 * @returns whether a PUT was issued (i.e. the global set changed).
 */
export async function applyImportedChannelDependencies(
  items: { xml: string; finalId: string }[],
  remap: (id: string) => string = (id) => id
): Promise<boolean> {
  const additions: ChannelDependency[] = [];
  for (const { xml, finalId } of items) {
    const deps = parseChannelDependencyIds(xml);
    if (deps.dependentIds.length > 0 || deps.dependencyIds.length > 0) {
      additions.push(...buildDependencyAdditions(finalId, deps, remap));
    }
  }
  if (additions.length === 0) return false;

  const existing = await getChannelDependencies();
  const { merged, changed } = mergeChannelDependencies(existing, additions);
  if (changed) await setChannelDependencies(merged);
  return changed;
}
