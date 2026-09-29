/**
 * Tiny DOM helpers shared by the transmission-mode registry hooks (index.ts) and the shared
 * read/write helpers (xml.ts). Kept in a leaf module so both can import them without creating an
 * index ↔ xml import cycle.
 */

/** Append a `<tag>value</tag>` text child to `parent`. */
export function appendTextChild(parent: Element, tag: string, value: string, doc: Document): void {
  const el = doc.createElementNS(null, tag);
  el.textContent = value;
  parent.appendChild(el);
}

/** Read the trimmed text content of a direct/descendant `<tag>` child, or undefined if absent. */
export function readChildText(el: Element, tag: string): string | undefined {
  return el.querySelector(tag)?.textContent?.trim();
}

/**
 * Read the text content of a DIRECT `<tag>` child, untrimmed, or undefined
 * when the element is absent (a present-but-empty element reads as "" —
 * XStream's present-empty-string semantics). Scans children by tagName
 * instead of querySelector because runtime-manifest field keys may contain
 * dots, which CSS-parse as class selectors (same rationale as
 * findDirectChild in lib/runtime-plugins/xml-field-binding.ts).
 */
export function readDirectChildText(el: Element, tag: string): string | undefined {
  for (const child of el.children) {
    if (child.tagName === tag) return child.textContent ?? "";
  }
  return undefined;
}
