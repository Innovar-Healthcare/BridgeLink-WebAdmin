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

/**
 * Finds the first direct child of `root` whose tag name equals `tagName`.
 * Iterates `children` and compares `tagName` directly rather than using a CSS
 * selector — field keys may contain dots, which break `querySelector`. Shared
 * with xml-collection-binding.ts (the collection field types,.
 */
export function findDirectChild(root: Element, tagName: string): Element | null {
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

// ─── One-level-nested variants (runtime data types, ─────────────────
//
// A data type's fields are NOT direct children of the stored element: they
// live one level down, inside a class-attributed group element
// (`<inboundProperties>` → `<serializationProperties>` → field). Same rules
// as the flat helpers — direct-child tagName scan at both levels (dots-safe),
// untrimmed values, present-empty reads as "", surgical edit + whole-document
// re-serialize so sibling groups (batchProperties!) and every attribute the
// schema doesn't model survive verbatim.

/**
 * Reads the current value of each field key from inside `groupTag` (a direct
 * child of the root). A missing group, missing element, or missing/unparseable
 * XML reads as "".
 */
export function readNestedFieldValues(
  propertiesXml: string | null,
  groupTag: string,
  keys: readonly string[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) values[key] = "";
  if (!propertiesXml) return values;
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return values;
  const group = findDirectChild(doc.documentElement, groupTag);
  if (!group) return values;
  for (const key of keys) {
    values[key] = findDirectChild(group, key)?.textContent ?? "";
  }
  return values;
}

/**
 * Writes one field value inside `groupTag` and returns the re-serialized
 * document. The field element is found-or-created as a direct child of the
 * group. The group itself is found-or-created too, but only defensively: it
 * is created WITHOUT a `class` attribute, which strict XStream cannot
 * deserialize — the loader guarantees every declared group exists in the
 * engine-served defaults, so the create path never runs against well-formed
 * data. Unparseable input is returned unchanged.
 */
export function writeNestedFieldValue(
  propertiesXml: string,
  groupTag: string,
  key: string,
  value: string
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  const root = doc.documentElement;
  let group = findDirectChild(root, groupTag);
  if (!group) {
    group = doc.createElementNS(null, groupTag);
    root.appendChild(group);
  }
  let el = findDirectChild(group, key);
  if (!el) {
    el = doc.createElementNS(null, key);
    group.appendChild(el);
  }
  el.textContent = value;
  return new XMLSerializer().serializeToString(doc);
}

// ─── Plugin-properties variants (runtime connector sections, ────────
//
// A connector section owns ONE element under the host connector's
// `<pluginProperties>`: `<properties>` → `<pluginProperties>` → the section's
// FQN-tagged container → field. Direct-child tagName scan at EVERY level —
// dots-safe (FQN tags break querySelector), and depth-scoped on purpose: the
// same FQN element can legitimately appear deeper in the tree (the SSL panel
// nests inside OAuth2 HTTP-auth blocks), and a document-wide lookup would
// match it. Same preservation rules as the other helpers: surgical edit +
// whole-document re-serialize, so sibling plugin elements (an SSL entry!),
// the host connector's own fields, and every attribute survive verbatim.
//
// Unlike the nested-group create path above, creating the container here is a
// REAL path, not defensive: channels that predate the extension lack the
// element, and the Java client synthesizes it client-side too
// (ConnectorPanel → panel.getDefaults()). The container is therefore always
// created COMPLETE — every declared field at its default — so strict XStream
// never sees a partial object, with the `version` attribute copied from the
// host `<properties>` (works for both the {{VERSION}} token, stamped later by
// withVersion(), and real engine-served versions — the compiled-in SSL
// plugin's trick).

/**
 * Resolves a connector section's container element (`<pluginProperties>` →
 * FQN-tagged container). Exported for the collection binding, which
 * reads/writes collection elements relative to this container.
 */
export function findPluginContainer(root: Element, containerTag: string): Element | null {
  const pluginProps = findDirectChild(root, "pluginProperties");
  if (!pluginProps) return null;
  return findDirectChild(pluginProps, containerTag);
}

/** True when the section's container element exists in the properties XML. */
export function pluginContainerExists(propertiesXml: string | null, containerTag: string): boolean {
  if (!propertiesXml) return false;
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return false;
  return findPluginContainer(doc.documentElement, containerTag) !== null;
}

/**
 * Reads the current value of each field key from inside the section's
 * container. A missing container, missing element, or missing/unparseable XML
 * reads as "" (the caller layers manifest defaults over the absent-container
 * case — see effectiveSectionValues in compile-connector-section.ts).
 */
export function readPluginSectionValues(
  propertiesXml: string | null,
  containerTag: string,
  keys: readonly string[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) values[key] = "";
  if (!propertiesXml) return values;
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return values;
  const container = findPluginContainer(doc.documentElement, containerTag);
  if (!container) return values;
  for (const key of keys) {
    values[key] = findDirectChild(container, key)?.textContent ?? "";
  }
  return values;
}

/**
 * Finds-or-creates `<pluginProperties>` (inserted before the first child —
 * its wire position in every built-in connector default) and the container
 * inside it. A freshly created container is populated COMPLETE from
 * `orderedDefaults` and stamped with the root's `version` attribute.
 */
/**
 * Finds-or-creates the section's `<pluginProperties>` container, populating a
 * freshly created one complete from `orderedDefaults` (version attribute copied
 * from root). Exported for the collection binding: a collection edit
 * materializes the container before writing collection elements into it.
 */
export function ensurePluginContainer(
  doc: Document,
  containerTag: string,
  orderedDefaults: ReadonlyArray<readonly [string, string]>
): Element {
  const root = doc.documentElement;
  let pluginProps = findDirectChild(root, "pluginProperties");
  if (!pluginProps) {
    pluginProps = doc.createElementNS(null, "pluginProperties");
    root.insertBefore(pluginProps, root.firstChild);
  }
  let container = findDirectChild(pluginProps, containerTag);
  if (!container) {
    container = doc.createElementNS(null, containerTag);
    const version = root.getAttribute("version");
    if (version) container.setAttribute("version", version);
    for (const [key, value] of orderedDefaults) {
      const el = doc.createElementNS(null, key);
      el.textContent = value;
      container.appendChild(el);
    }
    pluginProps.appendChild(container);
  }
  return container;
}

/**
 * Writes one field value into the section's container and returns the
 * re-serialized document. An absent container is materialized complete from
 * `orderedDefaults` first (so the edit lands on a full element — never a
 * partial one). Unparseable input is returned unchanged.
 */
export function writePluginSectionValue(
  propertiesXml: string,
  containerTag: string,
  orderedDefaults: ReadonlyArray<readonly [string, string]>,
  key: string,
  value: string
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  const container = ensurePluginContainer(doc, containerTag, orderedDefaults);
  let el = findDirectChild(container, key);
  if (!el) {
    el = doc.createElementNS(null, key);
    container.appendChild(el);
  }
  el.textContent = value;
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Inserts the section's complete default container when absent (the
 * connector-type-switch injectDefaults path); a no-op when the container
 * already exists or the XML is unparseable.
 */
export function injectPluginSectionDefaults(
  propertiesXml: string,
  containerTag: string,
  orderedDefaults: ReadonlyArray<readonly [string, string]>
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  if (findPluginContainer(doc.documentElement, containerTag)) return propertiesXml;
  ensurePluginContainer(doc, containerTag, orderedDefaults);
  return new XMLSerializer().serializeToString(doc);
}
