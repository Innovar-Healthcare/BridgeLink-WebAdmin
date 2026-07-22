"use client";

import { useMemo } from "react";
import type { DashboardStatus, ChannelGroup, ChannelTag } from "@/lib/types";
import { useSessionState, useSessionSet } from "@/lib/hooks/use-session-state";

const DEFAULT_GROUP_ID = "Default Group";
const DEFAULT_GROUP_NAME = "[Default Group]";

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages dashboard filtering state:
 * - Group/flat view toggle
 * - Text search (persisted to sessionStorage)
 * - Tag and group filter dropdowns (persisted to sessionStorage)
 * - Derived: tag/group dropdown options, filtered statuses
 */
export function useDashboardFilters(
  statuses: DashboardStatus[],
  channelTags: ChannelTag[],
  allGroups: ChannelGroup[],
  tagMap: Map<string, ChannelTag[]>
) {
  // ── View mode ───────────────────────────────────────────────────────────
  const [groupMode, setGroupMode] = useSessionState("bl-dashboard-group-mode", true);

  // ── Search + tag/group filter state ─────────────────────────────────────
  const [search, setSearch] = useSessionState("bl-filter-dashboard-search", "");
  const [selectedTagNames, setSelectedTagNames] = useSessionSet("bl-filter-dashboard-tags");
  const [selectedGroupIds, setSelectedGroupIds] = useSessionSet("bl-filter-dashboard-groups");
  const [tagMode, setTagMode] = useSessionState<"or" | "and">("bl-filter-dashboard-tag-mode", "or");

  // ── Dropdown options ────────────────────────────────────────────────────
  // Only show tags/groups that have at least one channel currently deployed
  // (i.e. present in the dashboard statuses). Selecting an empty group/tag
  // would silently return zero results, which is confusing.
  const deployedChannelIds = useMemo(() => new Set(statuses.map((s) => s.channelId)), [statuses]);

  const tagOptions = useMemo(
    () =>
      [...channelTags]
        .filter((t) => t.channelIds?.some((id) => deployedChannelIds.has(id)))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((t) => ({ value: String(t.name), label: String(t.name) })),
    [channelTags, deployedChannelIds]
  );

  const groupOptions = useMemo(
    () =>
      [...allGroups]
        .filter((g) => (g.channels ?? []).some((c) => deployedChannelIds.has(c.id)))
        .sort((a, b) =>
          a.id === DEFAULT_GROUP_ID
            ? 1
            : b.id === DEFAULT_GROUP_ID
              ? -1
              : (a.name ?? "").localeCompare(b.name ?? "")
        )
        .map((g) => ({
          value: g.id,
          label: g.id === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : (g.name ?? g.id),
        })),
    [allGroups, deployedChannelIds]
  );

  // ── Derived filter sets ─────────────────────────────────────────────────
  const groupFilteredIds = useMemo<Set<string> | null>(() => {
    if (selectedGroupIds.size === 0) return null;
    const ids = new Set<string>();
    for (const g of allGroups) {
      if (selectedGroupIds.has(g.id)) (g.channels ?? []).forEach((c) => ids.add(c.id));
    }
    return ids;
  }, [allGroups, selectedGroupIds]);

  const anyFilter = !!(search.trim() || selectedTagNames.size > 0 || selectedGroupIds.size > 0);

  // ── Filtered statuses ───────────────────────────────────────────────────
  const filteredStatuses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return statuses.filter((s) => {
      if (
        q &&
        !(
          String(s.name).toLowerCase().includes(q) ||
          s.channelId.toLowerCase().includes(q) ||
          (tagMap.get(s.channelId) ?? []).some((t) => String(t.name).toLowerCase().includes(q))
        )
      )
        return false;
      if (selectedTagNames.size > 0) {
        const chTags = tagMap.get(s.channelId) ?? [];
        const match =
          tagMode === "and"
            ? [...selectedTagNames].every((name) => chTags.some((t) => String(t.name) === name))
            : chTags.some((t) => selectedTagNames.has(String(t.name)));
        if (!match) return false;
      }
      if (groupFilteredIds && !groupFilteredIds.has(s.channelId)) return false;
      return true;
    });
  }, [statuses, search, tagMap, selectedTagNames, tagMode, groupFilteredIds]);

  return {
    groupMode,
    setGroupMode,
    search,
    setSearch,
    selectedTagNames,
    setSelectedTagNames,
    selectedGroupIds,
    setSelectedGroupIds,
    tagMode,
    setTagMode,
    tagOptions,
    groupOptions,
    anyFilter,
    filteredStatuses,
  };
}
