/**
 * XML collection-field binding for runtime plugin panels, manifest v3).
 *
 * The scalar binding in xml-field-binding.ts maps a manifest field key to one
 * direct child element holding a single string. Collection field types
 * (`map`, `multimap`, `stringList`, `table`) instead bind a key to a CONTAINER
 * element holding repeated child structure. These helpers read those containers
 * into flat JS rows and write rows back — under the exact same discipline as the
 * scalar binding: parse the whole document, mutate ONLY the one container being
 * edited (find-or-create by tag name, dots-safe direct-child scan), and
 * re-serialize the WHOLE document so every sibling element, attribute, and the
 * order the schema does not model survive verbatim. Unparseable input is
 * returned unchanged.
 *
 * Two binding surfaces:
 *  - Root-relative (`read*Rows` / `write*Rows`): the collection element is a
 *    direct child of the properties root — connector panels.
 *  - Parent-relative (`read*From` / `write*Into`): the collection element is a
 *    direct child of a caller-resolved container — connector SECTIONS (the
 *    section's `<pluginProperties>` container) and DATA TYPES (a `${group}Properties`
 *    group element). The root helpers are thin wrappers over these.
 *  - String-built serializers (`serialize*Str`): emit a collection element as an
 *    XML string fragment — the transformer-step registry's serialize contract
 *    returns a string body (and string building sidesteps happy-dom tag-name
 *    case-normalization of FQN/camelCase step-field tags).
 *
 * DOM element creation uses `createElementNS` + `textContent` (the DOM handles
 * escaping); this includes `table` rows whose tags are FQN/camelCase Java class
 * names — the compiled-in `writeSmtpAttachments` writes that exact element the
 * same way, and happy-dom preserves the casing.
 */

import { parsePropertiesDoc, findDirectChild } from "./xml-field-binding";

/** One flat row of a `map` or `multimap` field (`multimap` rows repeat the name). */
export interface CollectionMapRow {
  name: string;
  value: string;
}

/** One row of a `table` field, keyed by column element name. */
export type CollectionTableRow = Record<string, string>;

/** The rows value carried for one collection field, shaped by the field's type. */
export type CollectionRows = CollectionMapRow[] | string[] | CollectionTableRow[];

const LINKED_HASH_MAP = "linked-hash-map";

/** XStream text escaping for the string-built serializers (element text only). */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function directChildrenByTag(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((c) => c.tagName === tagName);
}

function findOrCreateDirectChild(root: Element, tagName: string, doc: Document): Element {
  const existing = findDirectChild(root, tagName);
  if (existing) return existing;
  const el = doc.createElementNS(null, tagName);
  root.appendChild(el);
  return el;
}

function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ─── Parent-relative core ─────────────────────────────────────────────────────

/** map: `<key class="linked-hash-map"><entry><string>k</string><string>v</string></entry>…>`. */
export function readMapRowsFrom(parent: Element | null, key: string): CollectionMapRow[] {
  const mapEl = parent && findDirectChild(parent, key);
  if (!mapEl) return [];
  const rows: CollectionMapRow[] = [];
  for (const entry of directChildrenByTag(mapEl, "entry")) {
    const strings = directChildrenByTag(entry, "string");
    if (strings.length >= 2) {
      rows.push({ name: strings[0].textContent ?? "", value: strings[1].textContent ?? "" });
    }
  }
  return rows;
}

export function writeMapRowsInto(
  parent: Element,
  key: string,
  rows: readonly CollectionMapRow[],
  doc: Document
): void {
  const mapEl = findOrCreateDirectChild(parent, key, doc);
  mapEl.setAttribute("class", LINKED_HASH_MAP);
  clearChildren(mapEl);
  for (const { name, value } of rows) {
    const entry = doc.createElementNS(null, "entry");
    const k = doc.createElementNS(null, "string");
    k.textContent = name;
    const v = doc.createElementNS(null, "string");
    v.textContent = value;
    entry.appendChild(k);
    entry.appendChild(v);
    mapEl.appendChild(entry);
  }
}

/** multimap: `Map<String,List<String>>` — one flat row per value; legacy flat-form repaired on read. */
export function readMultimapRowsFrom(parent: Element | null, key: string): CollectionMapRow[] {
  const mapEl = parent && findDirectChild(parent, key);
  if (!mapEl) return [];
  const rows: CollectionMapRow[] = [];
  for (const entry of directChildrenByTag(mapEl, "entry")) {
    const strings = directChildrenByTag(entry, "string");
    if (strings.length === 0) continue;
    const name = strings[0].textContent ?? "";
    const listEl = directChildrenByTag(entry, "list")[0];
    if (listEl) {
      for (const s of directChildrenByTag(listEl, "string")) {
        rows.push({ name, value: s.textContent ?? "" });
      }
    } else {
      for (let i = 1; i < strings.length; i++) {
        rows.push({ name, value: strings[i].textContent ?? "" });
      }
    }
  }
  return rows;
}

export function writeMultimapRowsInto(
  parent: Element,
  key: string,
  rows: readonly CollectionMapRow[],
  doc: Document
): void {
  const mapEl = findOrCreateDirectChild(parent, key, doc);
  mapEl.setAttribute("class", LINKED_HASH_MAP);
  clearChildren(mapEl);
  const grouped = new Map<string, string[]>();
  for (const { name, value } of rows) {
    const existing = grouped.get(name);
    if (existing) existing.push(value);
    else grouped.set(name, [value]);
  }
  for (const [name, values] of grouped) {
    const entry = doc.createElementNS(null, "entry");
    const k = doc.createElementNS(null, "string");
    k.textContent = name;
    entry.appendChild(k);
    const list = doc.createElementNS(null, "list");
    for (const value of values) {
      const v = doc.createElementNS(null, "string");
      v.textContent = value;
      list.appendChild(v);
    }
    entry.appendChild(list);
    mapEl.appendChild(entry);
  }
}

/** stringList: `<key><string>a</string>…>` (NO class attribute). Values read verbatim. */
export function readStringListItemsFrom(parent: Element | null, key: string): string[] {
  const listEl = parent && findDirectChild(parent, key);
  if (!listEl) return [];
  return directChildrenByTag(listEl, "string").map((s) => s.textContent ?? "");
}

export function writeStringListItemsInto(
  parent: Element,
  key: string,
  items: readonly string[],
  doc: Document
): void {
  const listEl = findOrCreateDirectChild(parent, key, doc);
  clearChildren(listEl);
  for (const item of items) {
    const s = doc.createElementNS(null, "string");
    s.textContent = item;
    listEl.appendChild(s);
  }
}

/** table: `<key><rowElementFQN><col>v</col>…</rowElementFQN>…>` (nested class rows). */
export function readTableRowsFrom(
  parent: Element | null,
  key: string,
  columnElements: readonly string[]
): CollectionTableRow[] {
  const container = parent && findDirectChild(parent, key);
  if (!container) return [];
  const rows: CollectionTableRow[] = [];
  for (const rowEl of Array.from(container.children)) {
    const row: CollectionTableRow = {};
    for (const col of columnElements) {
      row[col] = directChildrenByTag(rowEl, col)[0]?.textContent ?? "";
    }
    rows.push(row);
  }
  return rows;
}

export function writeTableRowsInto(
  parent: Element,
  key: string,
  rowElement: string,
  columnElements: readonly string[],
  rows: readonly CollectionTableRow[],
  doc: Document
): void {
  const container = findOrCreateDirectChild(parent, key, doc);
  clearChildren(container);
  for (const row of rows) {
    const rowEl = doc.createElementNS(null, rowElement);
    for (const col of columnElements) {
      const cell = doc.createElementNS(null, col);
      cell.textContent = row[col] ?? "";
      rowEl.appendChild(cell);
    }
    container.appendChild(rowEl);
  }
}

// ─── Root-relative wrappers (connector panels) ────────────────────────────────

export function readMapRows(propertiesXml: string | null, key: string): CollectionMapRow[] {
  if (!propertiesXml) return [];
  return readMapRowsFrom(parsePropertiesDoc(propertiesXml)?.documentElement ?? null, key);
}

export function writeMapRows(
  propertiesXml: string,
  key: string,
  rows: readonly CollectionMapRow[]
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  writeMapRowsInto(doc.documentElement, key, rows, doc);
  return new XMLSerializer().serializeToString(doc);
}

export function readMultimapRows(propertiesXml: string | null, key: string): CollectionMapRow[] {
  if (!propertiesXml) return [];
  return readMultimapRowsFrom(parsePropertiesDoc(propertiesXml)?.documentElement ?? null, key);
}

export function writeMultimapRows(
  propertiesXml: string,
  key: string,
  rows: readonly CollectionMapRow[]
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  writeMultimapRowsInto(doc.documentElement, key, rows, doc);
  return new XMLSerializer().serializeToString(doc);
}

export function readStringListItems(propertiesXml: string | null, key: string): string[] {
  if (!propertiesXml) return [];
  return readStringListItemsFrom(parsePropertiesDoc(propertiesXml)?.documentElement ?? null, key);
}

export function writeStringListItems(
  propertiesXml: string,
  key: string,
  items: readonly string[]
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  writeStringListItemsInto(doc.documentElement, key, items, doc);
  return new XMLSerializer().serializeToString(doc);
}

export function readTableRows(
  propertiesXml: string | null,
  key: string,
  columnElements: readonly string[]
): CollectionTableRow[] {
  if (!propertiesXml) return [];
  return readTableRowsFrom(
    parsePropertiesDoc(propertiesXml)?.documentElement ?? null,
    key,
    columnElements
  );
}

export function writeTableRows(
  propertiesXml: string,
  key: string,
  rowElement: string,
  columnElements: readonly string[],
  rows: readonly CollectionTableRow[]
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  writeTableRowsInto(doc.documentElement, key, rowElement, columnElements, rows, doc);
  return new XMLSerializer().serializeToString(doc);
}

// ─── String-built serializers (transformer-step body) ─────────────────────────

function tag(name: string, inner: string): string {
  return inner === "" ? `<${name}/>` : `<${name}>${inner}</${name}>`;
}

export function serializeMapRowsStr(key: string, rows: readonly CollectionMapRow[]): string {
  const entries = rows
    .map(
      ({ name, value }) =>
        `<entry>${tag("string", escapeXml(name))}${tag("string", escapeXml(value))}</entry>`
    )
    .join("");
  return `<${key} class="${LINKED_HASH_MAP}">${entries}</${key}>`;
}

export function serializeMultimapRowsStr(key: string, rows: readonly CollectionMapRow[]): string {
  const grouped = new Map<string, string[]>();
  for (const { name, value } of rows) {
    const existing = grouped.get(name);
    if (existing) existing.push(value);
    else grouped.set(name, [value]);
  }
  const entries = Array.from(grouped.entries())
    .map(([name, values]) => {
      const list = values.map((v) => tag("string", escapeXml(v))).join("");
      return `<entry>${tag("string", escapeXml(name))}${tag("list", list)}</entry>`;
    })
    .join("");
  return `<${key} class="${LINKED_HASH_MAP}">${entries}</${key}>`;
}

export function serializeStringListStr(key: string, items: readonly string[]): string {
  return tag(key, items.map((v) => tag("string", escapeXml(v))).join(""));
}

export function serializeTableRowsStr(
  key: string,
  rowElement: string,
  columnElements: readonly string[],
  rows: readonly CollectionTableRow[]
): string {
  const body = rows
    .map((row) =>
      tag(rowElement, columnElements.map((c) => tag(c, escapeXml(row[c] ?? ""))).join(""))
    )
    .join("");
  return tag(key, body);
}

// ─── Type-dispatched helpers (nested/step kinds) ──────────────────────────────
//
// The kinds beyond connector panels bind collections one level down (data-type
// group element, connector-section container) or serialize them as a string
// (transformer-step body). These dispatch on a minimal, manifest-agnostic spec
// so each caller resolves its own parent element once and stays type-agnostic.

/** Minimal shape of a collection field for the dispatch helpers. */
export interface CollectionFieldSpec {
  type: "map" | "multimap" | "stringList" | "table";
  key: string;
  /** table only. */
  rowElement?: string;
  /** table only. */
  columns?: readonly string[];
}

/** Reads a collection field's rows from a resolved parent element. */
export function readCollectionFrom(
  parent: Element | null,
  spec: CollectionFieldSpec
): CollectionRows {
  switch (spec.type) {
    case "map":
      return readMapRowsFrom(parent, spec.key);
    case "multimap":
      return readMultimapRowsFrom(parent, spec.key);
    case "stringList":
      return readStringListItemsFrom(parent, spec.key);
    case "table":
      return readTableRowsFrom(parent, spec.key, spec.columns ?? []);
  }
}

/** Writes a collection field's rows into a resolved parent element. */
export function writeCollectionInto(
  parent: Element,
  spec: CollectionFieldSpec,
  rows: CollectionRows,
  doc: Document
): void {
  switch (spec.type) {
    case "map":
      writeMapRowsInto(parent, spec.key, rows as CollectionMapRow[], doc);
      return;
    case "multimap":
      writeMultimapRowsInto(parent, spec.key, rows as CollectionMapRow[], doc);
      return;
    case "stringList":
      writeStringListItemsInto(parent, spec.key, rows as string[], doc);
      return;
    case "table":
      writeTableRowsInto(
        parent,
        spec.key,
        spec.rowElement ?? "",
        spec.columns ?? [],
        rows as CollectionTableRow[],
        doc
      );
      return;
  }
}

/** Serializes a collection field's rows as an XML string fragment (transformer-step body). */
export function serializeCollectionStr(spec: CollectionFieldSpec, rows: CollectionRows): string {
  switch (spec.type) {
    case "map":
      return serializeMapRowsStr(spec.key, rows as CollectionMapRow[]);
    case "multimap":
      return serializeMultimapRowsStr(spec.key, rows as CollectionMapRow[]);
    case "stringList":
      return serializeStringListStr(spec.key, rows as string[]);
    case "table":
      return serializeTableRowsStr(
        spec.key,
        spec.rowElement ?? "",
        spec.columns ?? [],
        rows as CollectionTableRow[]
      );
  }
}

/** A field descriptor → the minimal spec the dispatch helpers need. */
export function collectionSpec(field: {
  type: string;
  key: string;
  rowElement?: string;
  columns?: readonly { element: string }[];
}): CollectionFieldSpec {
  return {
    type: field.type as CollectionFieldSpec["type"],
    key: field.key,
    rowElement: field.rowElement,
    columns: field.columns?.map((c) => c.element),
  };
}
