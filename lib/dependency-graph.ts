import type { ChannelDependency } from "@/lib/cache-store";
import type { DeployedState } from "@/lib/types";

export interface DepTreeNode {
  channelId: string;
  channelName: string;
  children: DepTreeNode[];
}

export type DepDirection = "depends-on" | "depended-by";

/** Dashboard channel operations that expand along the dependency graph (Java ChannelTask). */
export type DependencyTask = "start" | "resume" | "stop" | "pause" | "undeploy";

export interface DependencyExpansion {
  /** All channel IDs the task should act on: the original selection plus pulled-in neighbors. */
  all: Set<string>;
  /** Only the neighbors pulled in beyond the original selection (all − selected). */
  added: Set<string>;
}

/**
 * Expand a channel selection along the dependency graph for a start/stop-style task,
 * mirroring `Frame.addChannelToTaskSet` (Frame.java:3211-3247).
 *
 * - start/resume are "forward order": pull in the channels each selected channel
 *   DEPENDS ON that are deployed and not already STARTED (they must start first).
 * - stop/pause/undeploy are "reverse order": pull in the channels that DEPEND ON
 *   each selected channel (its dependents), filtered by current state:
 *     - stop     → dependent not already STOPPED
 *     - pause    → dependent not already PAUSED or STOPPED
 *     - undeploy → every deployed dependent
 *
 * Only deployed channels (present in `stateByChannelId`) are pulled in. The
 * originally-selected channels are always included regardless of their state.
 * `halt` is intentionally not a task — the Java client halts without dependency
 * expansion (`Frame.doHalt`).
 */
export function expandWithDependencies(
  selectedIds: Iterable<string>,
  stateByChannelId: Map<string, DeployedState>,
  edges: ChannelDependency[],
  task: DependencyTask
): DependencyExpansion {
  const forward = task === "start" || task === "resume";
  const adjacency = buildAdjacency(edges, forward ? "depends-on" : "depended-by");

  const shouldPull = (neighborId: string): boolean => {
    const state = stateByChannelId.get(neighborId);
    if (state === undefined) return false; // not deployed — never pulled in
    switch (task) {
      case "start":
      case "resume":
        return state !== "STARTED";
      case "stop":
        return state !== "STOPPED";
      case "pause":
        return state !== "PAUSED" && state !== "STOPPED";
      case "undeploy":
        return true;
    }
  };

  const all = new Set<string>();
  const visit = (channelId: string): void => {
    if (all.has(channelId)) return;
    all.add(channelId);
    const neighbors = adjacency.get(channelId);
    if (!neighbors) return;
    for (const n of neighbors) {
      if (shouldPull(n)) visit(n);
    }
  };

  const selected = new Set(selectedIds);
  for (const id of selected) visit(id);

  const added = new Set<string>();
  for (const id of all) if (!selected.has(id)) added.add(id);
  return { all, added };
}

/**
 * Build the rooted dependency tree for a channel.
 *
 * - "depends-on": children are channels this one depends on (deployed/started before).
 * - "depended-by": children are channels that depend on this one (deployed/started after).
 *
 * Walks the full transitive chain, mirroring `ChannelDependenciesPanel.addDependencyNode`
 * in the Java client. Children are sorted alphabetically by name (matching `NodeComparator`).
 * Channels missing from `channelNameById` are skipped.
 *
 * Returns the direct children only — the caller renders them as the top level of the tree.
 */
export function buildDependencyTree(
  rootChannelId: string,
  direction: DepDirection,
  edges: ChannelDependency[],
  channelNameById: Map<string, string>
): DepTreeNode[] {
  const adjacency = buildAdjacency(edges, direction);
  return walk(rootChannelId, adjacency, channelNameById, new Set([rootChannelId]));
}

/**
 * Set of channel IDs that, if added as a `direction` dependency of `rootChannelId`,
 * would create a cycle in the dependency graph. Always includes `rootChannelId` itself
 * (a channel can't depend on itself).
 *
 * For "depends-on": forbidden = root ∪ all transitive depended-by of root.
 *   (Adding any of those would mean root depends on something that already depends on
 *    root → cycle.)
 * For "depended-by": symmetric — forbidden = root ∪ all transitive depends-on of root.
 */
export function getCycleCausingChannelIds(
  rootChannelId: string,
  direction: DepDirection,
  edges: ChannelDependency[]
): Set<string> {
  const reverse: DepDirection = direction === "depends-on" ? "depended-by" : "depends-on";
  const adjacency = buildAdjacency(edges, reverse);
  const forbidden = new Set<string>();
  forbidden.add(rootChannelId);
  collectReachable(rootChannelId, adjacency, forbidden);
  return forbidden;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function buildAdjacency(
  edges: ChannelDependency[],
  direction: DepDirection
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e || !e.dependentId || !e.dependencyId) continue;
    const [from, to] =
      direction === "depends-on"
        ? [e.dependentId, e.dependencyId] // X depends on Y → from X follow to Y
        : [e.dependencyId, e.dependentId]; // X is depended on by Y → from X follow to Y
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  }
  return adj;
}

function walk(
  fromId: string,
  adjacency: Map<string, string[]>,
  channelNameById: Map<string, string>,
  visited: Set<string>
): DepTreeNode[] {
  const nextIds = adjacency.get(fromId);
  if (!nextIds || nextIds.length === 0) return [];
  const nodes: DepTreeNode[] = [];
  for (const id of nextIds) {
    if (visited.has(id)) continue; // cycle defence (server should reject these, but cache may be stale)
    const name = channelNameById.get(id);
    if (!name) continue; // mirror Java's StringUtils.isNotBlank guard
    const branchVisited = new Set(visited);
    branchVisited.add(id);
    nodes.push({
      channelId: id,
      channelName: name,
      children: walk(id, adjacency, channelNameById, branchVisited),
    });
  }
  nodes.sort((a, b) => a.channelName.localeCompare(b.channelName));
  return nodes;
}

function collectReachable(
  fromId: string,
  adjacency: Map<string, string[]>,
  out: Set<string>
): void {
  const next = adjacency.get(fromId);
  if (!next) return;
  for (const id of next) {
    if (out.has(id)) continue;
    out.add(id);
    collectReachable(id, adjacency, out);
  }
}
