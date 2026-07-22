/**
 * XML field binding for runtime connector panels.
 *
 * Manifest field keys map to DIRECT CHILD ELEMENTS of the connector's
 * `<properties>` XML. The load-bearing rule (mirrors the hand-written
 * connectors in app/(app)/channels/_lib/channel-xml.ts): parse the current
 * XML string, mutate ONLY the one element being edited (find-or-create by
 * tag name), and re-serialize the WHOLE document. Never rebuild the XML from
 * form state — that is what preserves sibling elements, attributes
 * (`class=`, `version=`), `<pluginProperties>`, and element order that the
 * schema does not model. The engine's own rule is the same: never delete
 * fields you don't understand.
 *
 * Child lookup iterates `children` and compares `tagName` directly instead of
 * using CSS selectors — field keys may contain dots, which would need
 * escaping in a `querySelector` call.
 */

/** Parses a properties XML string; returns null on a parse error. */
export function parsePropertiesDoc(propertiesXml: string): Document | null {
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  if (!doc.documentElement) return null;
  return doc;
}

function findDirectChild(root: Element, tagName: string): Element | null {
  for (const child of Array.from(root.children)) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

/**
 * Reads the current value of each field key from the properties XML.
 * A missing element (or missing/unparseable XML) reads as "".
 */
export function readFieldValues(
  propertiesXml: string | null,
  keys: readonly string[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) values[key] = "";
  if (!propertiesXml) return values;
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return values;
  const root = doc.documentElement;
  for (const key of keys) {
    values[key] = findDirectChild(root, key)?.textContent ?? "";
  }
  return values;
}

/**
 * Writes one field value into the properties XML and returns the
 * re-serialized document. The target element is found-or-created as a direct
 * child of the root; `textContent` assignment lets the DOM handle escaping.
 * Unparseable input is returned unchanged (the caller renders a fallback
 * instead of the form in that case).
 */
export function writeFieldValue(propertiesXml: string, key: string, value: string): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  const root = doc.documentElement;
  let el = findDirectChild(root, key);
  if (!el) {
    el = doc.createElementNS(null, key);
    root.appendChild(el);
  }
  el.textContent = value;
  return new XMLSerializer().serializeToString(doc);
}
