/**
 * Central registry of all known data types.
 *
 * ─── Adding a built-in data type ──────────────────────────────────────────────
 *   1. Create `_datatypes/<name>.ts(x)` exporting a DataTypeDefinition.
 *   2. Call registerDataType() with the definition below.
 *   — No other files need to change.
 *
 * ─── Adding a commercial plugin data type ─────────────────────────────────────
 *   1. Create `plugins/<name>/index.ts` exporting a DataTypeDefinition.
 *   2. Call registerDataType() from that index.ts (imported by plugins/index.ts).
 *   — The type will appear in dropdowns on next registry read.
 *
 * Order in DATA_TYPE_REGISTRY determines dropdown order.
 */

export type {
  DataTypeDefinition,
  MsgTreeNode,
  ParseResult,
  DataTypePropertiesSectionProps,
  MonacoTokenProvider,
  CodeTemplateContribution,
  MessageAttachment,
} from "./types";

import { connectContributionSink, warnDuplicateContribution } from "@/lib/plugin-manifest";
import { RawDataType } from "./raw";
import { HL7V2DataType } from "./hl7v2";
import { HL7V3DataType } from "./hl7v3";
import { XMLDataType } from "./xml";
import { JSONDataType } from "./json";
import { DelimitedDataType } from "./delimited";
import { EDIDataType } from "./edix12";
import { NCPDPDataType } from "./ncpdp";
import { DICOMDataType } from "./dicom";
import type { DataTypeDefinition } from "./types";

/** Mutable data type registry. Commercial plugins self-register here. */
export let DATA_TYPE_REGISTRY = new Map<string, DataTypeDefinition>([
  ["RAW", RawDataType],
  ["HL7V2", HL7V2DataType],
  ["HL7V3", HL7V3DataType],
  ["XML", XMLDataType],
  ["JSON", JSONDataType],
  ["DELIMITED", DelimitedDataType],
  ["EDI/X12", EDIDataType],
  ["NCPDP", NCPDPDataType],
  ["DICOM", DICOMDataType],
]);

/**
 * Ordered list of registered type names, in registry insertion order.
 * Updated by registerDataType() so dropdowns reflect plugin-contributed types.
 * Replaces the old hardcoded DATA_TYPE_OPTIONS array in channel-xml.ts.
 */
export let DATA_TYPE_OPTIONS: readonly string[] = [...DATA_TYPE_REGISTRY.keys()];

/** Alias for any registered data type name (includes plugin-contributed types). */
export type DataType = string;

/**
 * Register a data type. Called by built-ins at module init and by commercial
 * plugins from their plugins/index.ts entry point.
 *
 * `def.name` becomes the registry key (e.g. "DIMSE", "HL7V2").
 * Re-registering an existing name overwrites the previous definition.
 */
export function registerDataType(def: DataTypeDefinition): void {
  DATA_TYPE_REGISTRY = new Map([...DATA_TYPE_REGISTRY, [def.name, def]]);
  DATA_TYPE_OPTIONS = [...DATA_TYPE_REGISTRY.keys()];
}

// Receive definePlugin() manifest contributions (first-wins by name).
connectContributionSink("dataTypes", (def, pluginId) => {
  if (DATA_TYPE_REGISTRY.has(def.name)) {
    warnDuplicateContribution(pluginId, "data type", def.name);
    return false;
  }
  registerDataType(def);
  return true;
});
