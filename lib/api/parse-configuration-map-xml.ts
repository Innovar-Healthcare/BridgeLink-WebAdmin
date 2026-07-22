/**
 * XML parser for the configuration map returned by GET /server/configurationMap.
 *
 * The configuration map is fetched as XML (not JSON) on purpose: the server serializes
 * JSON through Staxon with autoPrimitive enabled, which coerces any numeric-looking value
 * (e.g. "10e33") into a number — irreversibly rewriting it to scientific notation
 * ("1.0E+34"), and JSON.parse loses precision on long digit strings — before it ever
 * reaches the client (the same gotcha already fixed for channel tags, here
 * fixed for the config map under. XML carries the literal text content intact,
 * so parsing it here preserves the original value exactly.
 *
 * XML shape (Map<String, com.mirth.connect.util.ConfigurationProperty>):
 *   <map>
 *     <entry>
 *       <string>KEY</string>
 *       <com.mirth.connect.util.ConfigurationProperty>
 *         <value>10e33</value>
 *         <comment>some comment</comment>
 *       </com.mirth.connect.util.ConfigurationProperty>
 *     </entry>
 *     ...
 *   </map>
 *
 * An empty map serializes as <map/> and yields an empty array.
 */

import type { ConfigurationMapEntry } from "./api-settings";

/**
 * Parse the `<map>` of configuration-property entries returned by
 * GET /server/configurationMap into a flat `{ key, value, comment }[]`.
 */
export function parseConfigurationMapFromXml(xml: string): ConfigurationMapEntry[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;
  if (root.tagName !== "map") {
    throw new Error(`Unexpected root element <${root.tagName}>. Expected <map>.`);
  }

  const entries: ConfigurationMapEntry[] = [];
  root.querySelectorAll(":scope > entry").forEach((entry) => {
    // Key is the <string> child. Do NOT trim — preserve the literal key.
    // textContent auto-unescapes XML entities (&amp; → &), giving the literal value.
    const key = entry.querySelector(":scope > string")?.textContent ?? "";

    // The value element is the entry's other child: <com.mirth.connect.util.ConfigurationProperty>.
    // Its tag name contains dots, which CSS selectors read as class selectors, so we cannot use
    // querySelector with that name — find the non-<string> child element instead.
    let propEl: Element | undefined;
    for (const child of Array.from(entry.children)) {
      if (child.tagName !== "string") {
        propEl = child;
        break;
      }
    }

    // <value> and <comment> have plain (dot-free) tag names, so getElementsByTagName is safe.
    // They are the only descendants of the property element, so [0] is unambiguous.
    // Do NOT trim — value/comment are user data and must round-trip byte-for-byte.
    const value = propEl?.getElementsByTagName("value")[0]?.textContent ?? "";
    const comment = propEl?.getElementsByTagName("comment")[0]?.textContent ?? "";

    entries.push({ key, value, comment });
  });

  return entries;
}
