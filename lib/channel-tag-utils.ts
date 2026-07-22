/**
 * Pure helpers for re-associating channel tags during import and clone.
 *
 * BridgeLink persists channel tags as a single global set (`PUT /server/channelTags`);
 * each tag holds the set of channel ids it applies to. When a channel is imported or
 * cloned it gets a (possibly new) id that must be folded into the relevant tags before
 * the set is saved. These helpers mirror the Java client's behavior in
 * `ChannelPanel.updateChannelTags` (import) and `ChannelPanel.cloneChannel` (clone).
 */

import type { ChannelTag } from "./types";

/** Server-enforced maximum length of a channel tag name (Java truncates to 24 chars). */
const MAX_TAG_NAME_LENGTH = 24;

/** Append a channel id to a tag's id list without duplicating it. */
function withChannelId(tag: ChannelTag, channelId: string): ChannelTag {
  if (tag.channelIds.includes(channelId)) return tag;
  return { ...tag, channelIds: [...tag.channelIds, channelId] };
}

/**
 * Fold the tags carried in an import file into the existing global tag set, remapping
 * them onto the imported channel's final id.
 *
 * Mirrors Java `ChannelPanel.updateChannelTags`: for each imported tag, match an
 * existing tag by id OR case-insensitive name. On a match, add `channelId` to that
 * existing tag. Otherwise add the imported tag as new, truncating its name to 24
 * chars and associating it with `channelId` only.
 *
 * Pure: returns a new array with new tag objects; never mutates the inputs.
 */
export function mergeImportedChannelTags(
  existing: ChannelTag[],
  imported: ChannelTag[],
  channelId: string
): ChannelTag[] {
  const result = existing.map((t) => ({ ...t, channelIds: [...t.channelIds] }));

  for (const tag of imported) {
    const lowerName = tag.name.toLowerCase();
    const match = result.find((t) => t.id === tag.id || t.name.toLowerCase() === lowerName);

    if (match) {
      if (!match.channelIds.includes(channelId)) match.channelIds.push(channelId);
    } else {
      const newTag: ChannelTag = {
        id: tag.id,
        name: tag.name.slice(0, MAX_TAG_NAME_LENGTH),
        channelIds: [channelId],
      };
      if (tag.backgroundColor !== undefined) newTag.backgroundColor = tag.backgroundColor;
      result.push(newTag);
    }
  }

  return result;
}

/**
 * Copy a source channel's tag memberships onto a clone's new id.
 *
 * Mirrors Java `ChannelPanel.cloneChannel`: every tag whose id list contains `sourceId`
 * also gets `newId` added. Tags that don't reference the source are returned unchanged.
 *
 * Pure: returns a new array; only the affected tag objects are cloned.
 */
export function addChannelToSourceTags(
  tags: ChannelTag[],
  sourceId: string,
  newId: string
): ChannelTag[] {
  return tags.map((t) => (t.channelIds.includes(sourceId) ? withChannelId(t, newId) : t));
}
