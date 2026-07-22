/**
 * source-response-harvest.ts
 *
 * Harvests response-map variable names for the Source tab's Response dropdown,
 * mirroring Java `SourceSettingsPanel.updateResponseDropDown()`. The Java client
 * scans, for response-map keys:
 *   - the source filter + transformer
 *   - every destination's filter, transformer, and response transformer
 *   - the pre/post-processor scripts (and destination connector scripts)
 *
 * Here we operate on the editor's XML blobs (filter/transformer are stored as
 * raw XML strings) plus the raw pre/post scripts.
 */

import { parseFilterFromXml, parseTransformerFromXml } from "./filter-transformer-xml";
import {
  extractResponseVariablesFromElements,
  getResponseVariablesFromScript,
} from "./variable-extraction";

export interface HarvestDestination {
  filterXml?: string | null;
  transformerXml?: string | null;
  responseTransformerXml?: string | null;
  /**
   * The destination connector's `<properties>` XML. Scanned for connector script bodies that may
   * call `responseMap.put` — mirrors Java's `tempConnector.getScripts(props)`: JavaScript Writer's
   * `<script>` and Database Writer's `<query>` (only when `<useScript>` is true).
   */
  propertiesXml?: string | null;
}

export interface HarvestInput {
  sourceFilterXml?: string | null;
  sourceTransformerXml?: string | null;
  destinations?: HarvestDestination[];
  /** Raw scripts (pre/post-processor, etc.) scanned for responseMap.put / $r. */
  scripts?: (string | null | undefined)[];
}

function addFilterVars(xml: string | null | undefined, target: Set<string>): void {
  if (!xml) return;
  try {
    const { elements } = parseFilterFromXml(xml);
    for (const v of extractResponseVariablesFromElements(elements)) target.add(v);
  } catch {
    // Ignore parse errors — filter/transformer XML may be empty or invalid.
  }
}

function addTransformerVars(xml: string | null | undefined, target: Set<string>): void {
  if (!xml) return;
  try {
    const { elements } = parseTransformerFromXml(xml);
    for (const v of extractResponseVariablesFromElements(elements)) target.add(v);
  } catch {
    // Ignore parse errors.
  }
}

/**
 * Scan a destination connector's `<properties>` for script bodies that reference response-map
 * variables. Mirrors Java `getScripts()` for the two script-bearing dispatchers: JavaScript Writer
 * (`<script>`) and Database Writer (`<query>`, only when `<useScript>` is true).
 */
function addDestConnectorScriptVars(xml: string | null | undefined, target: Set<string>): void {
  if (!xml) return;
  try {
    const props = new DOMParser()
      .parseFromString(xml, "application/xml")
      .querySelector("properties");
    if (!props) return;
    const cls = props.getAttribute("class") ?? "";
    const scripts: (string | null | undefined)[] = [];
    if (cls.endsWith("JavaScriptDispatcherProperties")) {
      scripts.push(props.querySelector(":scope > script")?.textContent);
    } else if (cls.endsWith("DatabaseDispatcherProperties")) {
      const useScript = props.querySelector(":scope > useScript")?.textContent?.trim() === "true";
      if (useScript) scripts.push(props.querySelector(":scope > query")?.textContent);
    }
    for (const script of scripts) {
      for (const v of getResponseVariablesFromScript(script)) target.add(v);
    }
  } catch {
    // Ignore parse errors — the properties blob may be empty or malformed.
  }
}

/**
 * Harvest the deduplicated set of response-map variable names referenced
 * anywhere in the channel's filters, transformers, response transformers, and
 * pre/post-processor scripts.
 */
export function harvestSourceResponseVariables(input: HarvestInput): string[] {
  const vars = new Set<string>();

  addFilterVars(input.sourceFilterXml, vars);
  addTransformerVars(input.sourceTransformerXml, vars);

  for (const d of input.destinations ?? []) {
    addFilterVars(d.filterXml, vars);
    addTransformerVars(d.transformerXml, vars);
    addTransformerVars(d.responseTransformerXml, vars);
  }

  // Destination connector script bodies (JS Writer / DB Writer) — harvested after rule/transformer
  // vars, alongside the pre/post scripts, matching Java's scan order.
  for (const d of input.destinations ?? []) {
    addDestConnectorScriptVars(d.propertiesXml, vars);
  }

  for (const script of input.scripts ?? []) {
    for (const v of getResponseVariablesFromScript(script)) vars.add(v);
  }

  return Array.from(vars);
}
