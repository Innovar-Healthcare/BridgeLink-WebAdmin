/**
 * HL7v2 specification lookup — resolves segment, field, and component
 * descriptions from the hl7-dictionary package.
 *
 * Used by parseHl7v2() to append human-readable labels to tree nodes,
 * e.g. "MSH.5" → "MSH.5 (Receiving Application)".
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// hl7-dictionary is a CommonJS-only package with no TS types.
// We type the subset of the structure we actually use.

interface Hl7Field {
  datatype: string;
  desc: string;
}

interface Hl7Segment {
  desc: string;
  fields: Hl7Field[];
}

interface Hl7CompositeField {
  desc: string;
  subfields: Hl7Field[];
}

interface Hl7VersionDef {
  segments: Record<string, Hl7Segment>;
  fields: Record<string, Hl7CompositeField>;
}

// Lazy-loaded definitions cache — avoids importing at module level.
let _definitions: Record<string, Hl7VersionDef> | null = null;

function defs(): Record<string, Hl7VersionDef> {
  if (!_definitions) {
    _definitions = require("hl7-dictionary").definitions as Record<string, Hl7VersionDef>;
  }
  return _definitions;
}

// Ordered from newest to oldest for fallback resolution.
const KNOWN_VERSIONS = ["2.7.1", "2.7", "2.6", "2.5.1", "2.5", "2.4", "2.3.1", "2.3", "2.2", "2.1"];

const DEFAULT_VERSION = "2.5.1";

/**
 * Resolve the best matching version definition.
 * Tries exact match first, then falls back to the closest lower version.
 */
function resolveVersion(version: string | undefined): Hl7VersionDef | undefined {
  const d = defs();
  if (!version) return d[DEFAULT_VERSION];

  // Exact match
  if (d[version]) return d[version];

  // Find closest lower version
  for (const v of KNOWN_VERSIONS) {
    if (v <= version && d[v]) return d[v];
  }

  // Ultimate fallback
  return d[DEFAULT_VERSION];
}

/**
 * Get segment description.
 * e.g. getSegmentDescription("2.5.1", "MSH") → "Message Header"
 */
export function getSegmentDescription(
  version: string | undefined,
  segName: string
): string | undefined {
  return resolveVersion(version)?.segments[segName]?.desc;
}

/**
 * Get field description.
 * fieldNum is 1-based (matching HL7 convention: MSH.1, PID.3, etc.)
 * e.g. getFieldDescription("2.5.1", "MSH", 5) → "Receiving Application"
 */
export function getFieldDescription(
  version: string | undefined,
  segName: string,
  fieldNum: number
): string | undefined {
  const seg = resolveVersion(version)?.segments[segName];
  if (!seg) return undefined;
  // fields array is 0-indexed; field 1 = index 0
  return seg.fields[fieldNum - 1]?.desc;
}

/**
 * Get the datatype of a segment field (used to look up component descriptions).
 * e.g. getFieldDatatype("2.5.1", "MSH", 9) → "MSG"
 */
export function getFieldDatatype(
  version: string | undefined,
  segName: string,
  fieldNum: number
): string | undefined {
  const seg = resolveVersion(version)?.segments[segName];
  if (!seg) return undefined;
  return seg.fields[fieldNum - 1]?.datatype;
}

/**
 * Get component description from a composite field type.
 * compNum is 1-based (MSH.9.1 → component 1 of datatype MSG).
 * e.g. getComponentDescription("2.5.1", "MSG", 1) → "Message Code"
 */
export function getComponentDescription(
  version: string | undefined,
  datatype: string,
  compNum: number
): string | undefined {
  const field = resolveVersion(version)?.fields[datatype];
  if (!field?.subfields) return undefined;
  // subfields array is 0-indexed; component 1 = index 0
  return field.subfields[compNum - 1]?.desc;
}

/**
 * Get the number of subfields for a composite datatype.
 * Returns 0 for primitive types (ST, NM, ID, etc.) that have no subfields.
 * Used to generate placeholder component nodes for empty fields.
 * e.g. getCompositeSubfieldCount("2.5.1", "CX") → 10
 */
export function getCompositeSubfieldCount(version: string | undefined, datatype: string): number {
  const field = resolveVersion(version)?.fields[datatype];
  return field?.subfields?.length ?? 0;
}
