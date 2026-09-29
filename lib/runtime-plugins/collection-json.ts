/**
 * Canonical JSON codec for collection field values in SETTINGS panels.
 *
 * Connector panels bind collections directly to properties XML (see
 * xml-collection-binding.ts), but settings-panel values are a flat string
 * property record — there is no XML document to surgically edit. So a settings
 * collection field stores its rows as canonical JSON in that field's property
 * value, and the contributing extension's Java side parses the JSON:
 *
 *   stringList → ["a","b"]
 *   map        → [["k1","v1"],["k2","v2"]]          (array-of-pairs: order-preserving, dup-tolerant)
 *   multimap   → [["k1",["v1","v2"]],["k2",["v3"]]]
 *   table      → [{"name":"a","content":"b","mimeType":"c"}]  (only declared columns)
 *
 * An empty collection encodes to "[]". Every decoder is TOTAL — it never throws;
 * a malformed or absent stored value decodes to [] (fail-open). The settings kind
 * wrapper is responsible for preserving an unparseable raw value untouched until
 * the user edits the field (no destructive normalization on mere render).
 */

import type {
  CollectionFieldSpec,
  CollectionMapRow,
  CollectionRows,
  CollectionTableRow,
} from "./xml-collection-binding";

function safeParseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── stringList ───────────────────────────────────────────────────────────────

export function encodeStringList(items: readonly string[]): string {
  return JSON.stringify(items);
}

export function decodeStringList(value: string): string[] {
  return safeParseArray(value).filter((x): x is string => typeof x === "string");
}

// ─── map (array-of-pairs) ───────────────────────────────────────────────────

export function encodeMap(rows: readonly CollectionMapRow[]): string {
  return JSON.stringify(rows.map((r) => [r.name, r.value]));
}

export function decodeMap(value: string): CollectionMapRow[] {
  const rows: CollectionMapRow[] = [];
  for (const pair of safeParseArray(value)) {
    if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
      rows.push({ name: pair[0], value: pair[1] });
    }
  }
  return rows;
}

// ─── multimap (array of [key, values[]]) ──────────────────────────────────────

export function encodeMultimap(rows: readonly CollectionMapRow[]): string {
  // Group by name, first-seen order (matches the XML multimap grouping).
  const grouped = new Map<string, string[]>();
  for (const { name, value } of rows) {
    const existing = grouped.get(name);
    if (existing) existing.push(value);
    else grouped.set(name, [value]);
  }
  return JSON.stringify(Array.from(grouped.entries()));
}

export function decodeMultimap(value: string): CollectionMapRow[] {
  const rows: CollectionMapRow[] = [];
  for (const pair of safeParseArray(value)) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string" || !Array.isArray(pair[1])) continue;
    const name = pair[0];
    for (const v of pair[1]) {
      if (typeof v === "string") rows.push({ name, value: v });
    }
  }
  return rows;
}

// ─── table (array of row objects, declared columns only) ──────────────────────

export function encodeTable(
  rows: readonly CollectionTableRow[],
  columnElements: readonly string[]
): string {
  const trimmed = rows.map((row) => {
    const out: CollectionTableRow = {};
    for (const col of columnElements) out[col] = row[col] ?? "";
    return out;
  });
  return JSON.stringify(trimmed);
}

export function decodeTable(
  value: string,
  columnElements: readonly string[]
): CollectionTableRow[] {
  const rows: CollectionTableRow[] = [];
  for (const raw of safeParseArray(value)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const source = raw as Record<string, unknown>;
    const row: CollectionTableRow = {};
    for (const col of columnElements) {
      row[col] = typeof source[col] === "string" ? (source[col] as string) : "";
    }
    rows.push(row);
  }
  return rows;
}

// ─── Type-dispatched (settings kind) ──────────────────────────────────────────

/** Decodes a settings collection field's stored JSON into rows (fail-open to []). */
export function decodeCollectionJson(spec: CollectionFieldSpec, value: string): CollectionRows {
  switch (spec.type) {
    case "map":
      return decodeMap(value);
    case "multimap":
      return decodeMultimap(value);
    case "stringList":
      return decodeStringList(value);
    case "table":
      return decodeTable(value, spec.columns ?? []);
  }
}

/** Encodes a settings collection field's rows to canonical JSON. */
export function encodeCollectionJson(spec: CollectionFieldSpec, rows: CollectionRows): string {
  switch (spec.type) {
    case "map":
      return encodeMap(rows as CollectionMapRow[]);
    case "multimap":
      return encodeMultimap(rows as CollectionMapRow[]);
    case "stringList":
      return encodeStringList(rows as string[]);
    case "table":
      return encodeTable(rows as CollectionTableRow[], spec.columns ?? []);
  }
}
