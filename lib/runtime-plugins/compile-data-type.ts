/**
 * Compiles a declared data type (manifest v2) into the host's
 * DataTypeDefinition contract — everything except the React
 * PropertiesSection, which the loader composes from
 * components/schema-form/runtime-data-type-section.tsx so this module stays
 * JSX-free (the compile-transmission-mode split).
 *
 * Wire model (PLAN-RuntimeDataTypes-BusinessLogic.md): the stored element is
 * `<inboundProperties>`/`<outboundProperties>`, class-attributed at every
 * level, seeded verbatim from the engine's datatype-defaults endpoint. The
 * engine has no business choosing between the two transformer-field tag
 * names, so its response uses a neutral root (`<dataTypeProperties>` by
 * contract, though only the class attribute is load-bearing) and this module
 * RETAGS the root to the requested side — attributes and children carried
 * over untouched, never rebuilt.
 */

import type { DataTypeDefinition } from "@/app/(app)/channels/_datatypes/types";
import { parsePropertiesDoc } from "./xml-field-binding";
import type { DataTypeContribution } from "./manifest-types";

/**
 * Renames the root element of `xml` to `tagName`, preserving all attributes
 * and moving all child nodes (including whitespace text nodes, so formatting
 * survives). Serializes the ELEMENT, not the document — the output is
 * consumed by DOMParser and importNode, neither of which wants a prolog.
 * Unparseable input is returned unchanged (the loader has already
 * parse-validated engine defaults, so that path never runs against them).
 */
export function retagRootElement(xml: string, tagName: string): string {
  const doc = parsePropertiesDoc(xml);
  if (!doc) return xml;
  const root = doc.documentElement;
  if (root.tagName === tagName) return new XMLSerializer().serializeToString(root);
  const retagged = doc.createElementNS(null, tagName);
  for (const attr of Array.from(root.attributes)) {
    retagged.setAttribute(attr.name, attr.value);
  }
  while (root.firstChild) retagged.appendChild(root.firstChild);
  return new XMLSerializer().serializeToString(retagged);
}

/**
 * Compile a validated data-type contribution over its prefetched engine
 * defaults. The returned definition registers through the same first-wins
 * sink as compiled-in data types; `pluginName` is stamped by registerPlugin
 * from the definition's serverPluginName, so server-enablement gating applies
 * unchanged.
 */
export function compileDataType(
  dataType: DataTypeContribution,
  defaultsXml: string
): Omit<DataTypeDefinition, "PropertiesSection"> {
  // Both tag variants computed eagerly: the loader already parse-validated
  // the defaults, and defaultPropertiesXml is called synchronously in hot
  // type-switch cascades (every connector row on bulk apply).
  const defaultsByTag = {
    inboundProperties: retagRootElement(defaultsXml, "inboundProperties"),
    outboundProperties: retagRootElement(defaultsXml, "outboundProperties"),
  } as const;

  const def: Omit<DataTypeDefinition, "PropertiesSection"> = {
    name: dataType.name,
    // The version parameter is deliberately unused: the engine XML carries
    // real class/version attributes, and withVersion() only replaces the
    // literal {{VERSION}} token, so the engine's stamp passes through the
    // channel-XML keystone untouched (same note as the connector-defaults
    // prefetch in loader.ts).
    defaultPropertiesXml: (tagName) => defaultsByTag[tagName],
    getDefaultAttachmentHandler: () => dataType.defaultAttachmentHandler ?? null,
  };
  if (dataType.displayName !== undefined) def.displayName = dataType.displayName;
  if (dataType.isBinary !== undefined) def.isBinary = dataType.isBinary;
  return def;
}
