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
