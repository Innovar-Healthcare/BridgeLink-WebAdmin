/**
 * dicom-tag-parser.ts
 *
 * Client-side DICOM utilities for the BridgeLink Web UI.
 *
 * Provides:
 *  - Detection helpers (isBase64DicomLike, isDicomXml)
 *  - Binary → BridgeLink DICOM XML conversion (dicomBase64ToXml)
 *  - DICOM XML → MsgTreeNode tree builder (dicomXmlToMsgTree)
 *  - DICOM tag name lookup via dcmjs built-in dictionary (getTagDescription)
 *
 * The XML format matches the Java UI's DICOMSerializer.toXML() output:
 *   <dicom>
 *     <tag00100010>Doe^John</tag00100010>
 *     <tag00081110>
 *       <item>
 *         <tag00081150>1.2.840.10008.5.1.4.1.1.2</tag00081150>
 *       </item>
 *     </tag00081110>
 *   </dicom>
 *
 * Tag names: 8 lowercase hex chars prefixed with "tag" (e.g. tag00100010).
 * Drag expressions: msg['tag00100010'].toString() — E4X bracket notation.
 *
 * NOTE: This module runs client-side only (imported from "use client" components).
 */

// dcmjs has no @types package — typed via the interface below.
interface DcmjsModule {
  data: {
    DicomMessage: {
      readFile(buffer: ArrayBuffer, options?: Record<string, unknown>): { dict: DcmDict };
    };
    DicomMetaDictionary: {
      nameMap: Record<string, { tag: string; name: string; vr: string }>;
    };
  };
}

// dcmjs is ~11MB. Loading it via a top-level require() pulled it into the
// Messages chunk for every channel/message view. Instead we load it lazily with
// a dynamic import() so the bundler emits it as its own chunk, fetched only when
// DICOM content is actually parsed. Callers MUST await ensureDcmjs() before
// invoking any function that touches the dictionary or parses a binary; the sync
// dcmjs() accessor then reads the cached module (keeping the DataTypeDefinition
// interface synchronous — see message-tree-viewer.tsx for the preload gate).
let _dcmjs: DcmjsModule | null = null;

/** Load and cache the dcmjs module. Idempotent; safe to call repeatedly. */
export async function ensureDcmjs(): Promise<void> {
  if (_dcmjs) return;
  const mod = await import("dcmjs");
  _dcmjs = ((mod as { default?: DcmjsModule }).default ?? mod) as unknown as DcmjsModule;
}

function dcmjs(): DcmjsModule {
  if (!_dcmjs) {
    throw new Error("dcmjs not loaded — await ensureDcmjs() before parsing DICOM content");
  }
  return _dcmjs;
}

// ─── Internal dcmjs types ──────────────────────────────────────────────────────

type DcmElement = {
  vr: string;
  Value?: unknown[];
};
type DcmDict = Record<string, DcmElement>;

// ─── Tag description lookup ───────────────────────────────────────────────────

/**
 * Convert a camelCase DICOM keyword (e.g. "PatientName") to a human-readable
 * space-separated label (e.g. "Patient Name").
 */
function keywordToLabel(keyword: string): string {
  return keyword
    .replace(/^RETIRED_/, "RETIRED: ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/** tagHex8 (e.g. "00100010") → "Patient Name" | null */
let _tagDescCache: Map<string, string> | null = null;

function tagDescCache(): Map<string, string> {
  if (_tagDescCache) return _tagDescCache;
  _tagDescCache = new Map();
  const nameMap = dcmjs().data.DicomMetaDictionary.nameMap;
  for (const [keyword, entry] of Object.entries(nameMap)) {
    // entry.tag is "(GGGG,EEEE)" — strip parens/comma → 8 uppercase hex chars
    const hex8 = entry.tag
      .replace(/[(),\s]/g, "")
      .toUpperCase()
      .padStart(8, "0");
    _tagDescCache.set(hex8, keywordToLabel(keyword));
  }
  return _tagDescCache;
}

/**
 * Look up a human-readable tag description.
 * @param tagHex8 – 8-char hex tag ID, e.g. "00100010" (case-insensitive).
 * @returns Human-readable name like "Patient Name", or null if unknown.
 */
export function getTagDescription(tagHex8: string): string | null {
  return tagDescCache().get(tagHex8.toUpperCase()) ?? null;
}

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * Returns true when the text looks like a base64-encoded DICOM Part 10 file
 * (has the "DICM" magic marker at byte offset 128 after decoding).
 */
export function isBase64DicomLike(text: string): boolean {
  const trimmed = text.trim();
  // Minimum: 132 bytes preamble+marker → ~176 base64 chars
  if (trimmed.length < 172) return false;
  // Must look like base64
  if (!/^[A-Za-z0-9+/\r\n]+=*$/.test(trimmed)) return false;
  try {
    const raw = atob(trimmed.replace(/\s/g, ""));
    // DICOM Part 10: 128-byte preamble followed by "DICM"
    return raw.length > 131 && raw.substring(128, 132) === "DICM";
  } catch {
    return false;
  }
}

/** Returns true when the text is BridgeLink DICOM XML (starts with <dicom). */
export function isDicomXml(text: string): boolean {
  return text.trimStart().startsWith("<dicom");
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** VRs that carry raw binary data — omitted from the XML output (matches Java UI behaviour). */
const BINARY_VRS = new Set(["OB", "OW", "OF", "OD", "OL", "OV", "UN"]);

/**
 * Format a dcmjs element Value array to a displayable string.
 * Handles the PN (PersonName) structured object and multi-valued fields.
 */
function formatValue(vr: string, value: unknown[]): string {
  if (!value || value.length === 0) return "";
  if (vr === "PN") {
    // dcmjs represents person names as { Alphabetic, Ideographic, Phonetic }
    return value
      .map((v) => {
        if (typeof v === "object" && v !== null && "Alphabetic" in v) {
          return String((v as Record<string, unknown>).Alphabetic ?? "");
        }
        return String(v ?? "");
      })
      .join("\\");
  }
  // Multi-valued: join with DICOM backslash separator
  return value.map((v) => String(v ?? "")).join("\\");
}

/**
 * Convert a dcmjs dict to BridgeLink DICOM XML lines (recursive, handles SQ sequences).
 * Tag keys from dcmjs readFile are 8 uppercase hex chars (e.g. "00100010").
 */
function dictToXmlLines(dict: DcmDict, indent: string): string[] {
  const lines: string[] = [];

  // Sort by tag ID for deterministic output
  const sorted = Object.entries(dict).sort(([a], [b]) => a.localeCompare(b));

  for (const [tagKey, element] of sorted) {
    if (!element || typeof element !== "object") continue;

    const vr = element.vr ?? "";
    const value = element.Value ?? [];
    // Normalize tag key to 8 lowercase hex chars for XML element names
    const tagHex8Lower = tagKey
      .replace(/[(),\s]/g, "")
      .toLowerCase()
      .padStart(8, "0");
    const tagName = `tag${tagHex8Lower}`;

    // Skip pixel data and other large binary VRs
    if (BINARY_VRS.has(vr)) continue;

    if (vr === "SQ") {
      // Sequence: emit <tagXXXXXXXX><item>...</item></tagXXXXXXXX>
      lines.push(`${indent}<${tagName}>`);
      for (const item of value) {
        lines.push(`${indent}  <item>`);
        // Each SQ item has a .dict property (DicomMessage/DicomDict)
        const itemAsObj = item as Record<string, unknown> | null | undefined;
        const itemDict: DcmDict = (itemAsObj?.dict ?? item ?? {}) as DcmDict;
        lines.push(...dictToXmlLines(itemDict, `${indent}    `));
        lines.push(`${indent}  </item>`);
      }
      lines.push(`${indent}</${tagName}>`);
    } else {
      const formatted = escapeXml(formatValue(vr, value));
      lines.push(`${indent}<${tagName}>${formatted}</${tagName}>`);
    }
  }

  return lines;
}

// ─── Binary → XML conversion ──────────────────────────────────────────────────

/**
 * Decode a base64-encoded DICOM binary and convert it to BridgeLink DICOM XML.
 *
 * The output format matches DICOMSerializer.toXML() from the Java UI:
 *   <dicom>
 *     <tag00100010>Doe^John</tag00100010>
 *     ...
 *   </dicom>
 *
 * Pixel data (OB/OW/UN/…) is intentionally excluded — same as the Java UI.
 *
 * @throws Error when the input is not valid DICOM.
 */
export function dicomBase64ToXml(base64: string): string {
  const cleaned = base64.replace(/\s/g, "");

  // Decode base64 → ArrayBuffer
  const binaryStr = atob(cleaned);
  const buffer = new ArrayBuffer(binaryStr.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binaryStr.length; i++) {
    view[i] = binaryStr.charCodeAt(i);
  }

  const dataset = dcmjs().data.DicomMessage.readFile(buffer);
  const lines = ["<dicom>", ...dictToXmlLines(dataset.dict, "  "), "</dicom>"];
  return lines.join("\n");
}

// ─── XML → MsgTreeNode tree ───────────────────────────────────────────────────

import type { MsgTreeNode } from "@/app/(app)/channels/_datatypes/types";

/**
 * Build a MsgTreeNode tree from BridgeLink DICOM XML.
 * Tag nodes use E4X bracket notation for drag expressions, matching the Java UI:
 *   msg['tag00100010'].toString()
 *   msg['tag00081110']['item'][0]['tag00081150'].toString()
 */
export function dicomXmlToMsgTree(xml: string, prefix: string, suffix: string): MsgTreeNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // Check for XML parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid DICOM XML: " + parseError.textContent?.slice(0, 120));
  }

  const root = doc.documentElement; // <dicom>

  return {
    id: "root",
    label: "DICOM",
    dragExpr: prefix,
    children: Array.from(root.children).map((el, i) => buildTagNode(el, prefix, suffix, `n${i}`)),
  };
}

function buildTagNode(el: Element, parentPath: string, suffix: string, id: string): MsgTreeNode {
  const tagName = el.tagName; // e.g. "tag00100010"
  // Strip "tag" prefix to get hex ID for dictionary lookup (uppercase for lookup)
  const tagHex8 = tagName.startsWith("tag")
    ? tagName.slice(3).toUpperCase()
    : tagName.toUpperCase();
  const desc = getTagDescription(tagHex8);
  const label = desc ? `${tagName} (${desc})` : tagName;
  const path = `${parentPath}['${tagName}']`;

  const childElements = Array.from(el.children);

  if (childElements.length === 0) {
    // Leaf node — show the text value
    const textValue = el.textContent ?? "";
    return {
      id,
      label,
      dragExpr: `${path}${suffix}`,
      children: [],
      value: textValue || undefined,
    };
  }

  // Has child elements — check whether they are <item> nodes (SQ sequence)
  if (childElements[0].tagName === "item") {
    return {
      id,
      label,
      dragExpr: `${path}${suffix}`,
      children: childElements.map((item, idx) =>
        buildItemNode(item, path, suffix, `${id}-i${idx}`, idx)
      ),
    };
  }

  // Nested non-item children (unusual but handled gracefully)
  return {
    id,
    label,
    dragExpr: `${path}${suffix}`,
    children: childElements.map((child, idx) => buildTagNode(child, path, suffix, `${id}-c${idx}`)),
  };
}

function buildItemNode(
  item: Element,
  parentPath: string,
  suffix: string,
  id: string,
  idx: number
): MsgTreeNode {
  const path = `${parentPath}['item'][${idx}]`;
  return {
    id,
    label: `item [${idx}]`,
    dragExpr: `${path}${suffix}`,
    children: Array.from(item.children).map((child, i) =>
      buildTagNode(child, path, suffix, `${id}-c${i}`)
    ),
  };
}
