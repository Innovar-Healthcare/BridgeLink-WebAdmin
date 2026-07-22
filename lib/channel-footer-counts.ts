/**
 * Footer "N of M" count math for the Channels tab, mirroring Java
 * ChannelPanel.updateModel (ChannelPanel.java:2853-2912). Pure + framework-free
 * so it can be unit-tested directly.
 */

import type { Channel, ChannelGroup } from "@/lib/types";

/** A visible/total count pair for one footer segment. */
export interface FooterCount {
  visible: number;
  total: number;
}

export interface ChannelsFooterCounts {
  groups: FooterCount;
  channels: FooterCount;
  enabled: FooterCount;
}

/** A channel is enabled per its export metadata, falling back to the top-level flag. */
function isChannelEnabled(ch: Channel): boolean {
  return ch.exportData?.metadata?.enabled ?? ch.enabled;
}

/**
 * Compute the Groups / Channels / Enabled footer counts.
 *
 * - `visibleChannels` is the post-filter channel list; `channels` is the full set.
 * - Empty groups are subtracted from the visible group count ONLY when a filter is
 *   active — Java only removes them when `totalChannelCount != visibleChannelCount`.
 *   When nothing is filtered, every group (including empty ones) counts.
 */
export function computeFooterCounts(
  channels: Channel[],
  visibleChannels: Channel[],
  allGroups: ChannelGroup[],
  filterActive: boolean
): ChannelsFooterCounts {
  const visibleIds = new Set(visibleChannels.map((ch) => ch.id));
  const visibleGroups = filterActive
    ? allGroups.filter((g) => (g.channels ?? []).some((c) => visibleIds.has(c.id))).length
    : allGroups.length;

  return {
    groups: { visible: visibleGroups, total: allGroups.length },
    channels: { visible: visibleChannels.length, total: channels.length },
    enabled: {
      visible: visibleChannels.filter(isChannelEnabled).length,
      total: channels.filter(isChannelEnabled).length,
    },
  };
}

/**
 * Format one footer segment: the total alone when nothing is hidden, otherwise
 * "visible of total" (Java's "N of M").
 */
export function formatCount({ visible, total }: FooterCount): string {
  return visible === total ? String(total) : `${visible} of ${total}`;
}
