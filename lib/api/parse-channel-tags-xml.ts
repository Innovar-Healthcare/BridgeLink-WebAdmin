/**
 * XML parser for the channel tags set returned by GET /server/channelTags.
 *
 * Channel tags are fetched as XML (not JSON) on purpose: the server serializes JSON
 * through Staxon with autoPrimitive enabled, which coerces any numeric-looking tag name
 * (e.g. "10e33") into a BigDecimal — irreversibly rewriting it to scientific notation
 * ("1.0E+34") before it ever reaches the client. XML carries the literal
 * text content intact, so parsing it here preserves the original tag name exactly.
 *
 * XML shape:
 *   <set>
 *     <channelTag>
 *       <id>UUID</id>
 *       <name>10e33</name>
 *       <channelIds>
 *         <string>channelId</string>
 *         ...
 *       </channelIds>
 *       <backgroundColor><red>128</red><green>0</green><blue>0</blue><alpha>255</alpha></backgroundColor>
 *     </channelTag>
 *     ...
 *   </set>
 */

import type { ChannelTag, XStreamColor } from "../types";

/** Read a `<backgroundColor>` element into an XStreamColor, or undefined when absent/incomplete. */
function parseBackgroundColor(el: Element): XStreamColor | undefined {
  const colorEl = el.querySelector(":scope > backgroundColor");
  if (!colorEl) return undefined;

  const num = (tag: string): number | undefined => {
    const text = colorEl.querySelector(`:scope > ${tag}`)?.textContent?.trim();
    if (!text) return undefined;
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  };

  const red = num("red");
  const green = num("green");
  const blue = num("blue");
  if (red === undefined || green === undefined || blue === undefined) return undefined;

  return { red, green, blue, alpha: num("alpha") ?? 255 };
}

/**
 * Parse a `<channelTag>` element into a ChannelTag object.
 */
export function parseChannelTagElement(el: Element): ChannelTag {
  const id = el.querySelector(":scope > id")?.textContent?.trim() ?? "";
  // Do NOT trim the name — it is the user-visible value and must stay byte-faithful.
  // textContent auto-unescapes XML entities (&amp; → &), so this is the literal name.
  const name = el.querySelector(":scope > name")?.textContent ?? "";

  const channelIds: string[] = [];
  el.querySelectorAll(":scope > channelIds > string").forEach((s) => {
    const v = s.textContent?.trim();
    if (v) channelIds.push(v);
  });

  if (!id) throw new Error("Channel tag is missing an <id> element");
  if (!name) throw new Error("Channel tag is missing a <name> element");

  const tag: ChannelTag = { id, name, channelIds };
  const backgroundColor = parseBackgroundColor(el);
  if (backgroundColor) tag.backgroundColor = backgroundColor;
  return tag;
}

/**
 * Parse the `<set>` of `<channelTag>` elements returned by GET /server/channelTags.
 * An empty `<set/>` is valid and yields an empty array.
 */
export function parseChannelTagsFromXml(xml: string): ChannelTag[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;
  if (root.tagName !== "set") {
    throw new Error(`Unexpected root element <${root.tagName}>. Expected <set>.`);
  }

  const tags: ChannelTag[] = [];
  root.querySelectorAll(":scope > channelTag").forEach((el) => {
    tags.push(parseChannelTagElement(el));
  });
  return tags;
}

/**
 * Parse the channel tags carried in an exported channel's `<exportData>` block.
 *
 * Exported channel XML embeds the tags that referenced the channel at export time:
 *
 *   <channel>
 *     ...
 *     <exportData>
 *       <channelTags>
 *         <channelTag>...</channelTag>
 *         ...
 *       </channelTags>
 *     </exportData>
 *   </channel>
 *
 * The server omits an empty `<channelTags>` (and we strip empty ones in export-helpers),
 * so an absent or empty container yields an empty array. Malformed XML or a malformed
 * tag element also yields an empty array — tag recovery is best-effort and must never
 * abort an import. Mirrors Java's `ChannelPanel` import path, which restores
 * `exportData.getChannelTags()` onto the imported channel.
 */
export function parseChannelTagsFromExportXml(xml: string): ChannelTag[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return [];
  }
  if (doc.querySelector("parsererror")) return [];

  const tags: ChannelTag[] = [];
  doc.querySelectorAll("exportData > channelTags > channelTag").forEach((el) => {
    try {
      tags.push(parseChannelTagElement(el));
    } catch {
      /* skip a malformed tag rather than failing the whole import */
    }
  });
  return tags;
}
