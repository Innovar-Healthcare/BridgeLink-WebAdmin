/**
 * Built-in Mapper step definition.
 *
 * Mirrors the Java class `com.mirth.connect.plugins.mapper.MapperStep`.
 */

import { MapperPanel } from "../../_components/filter-transformer/mapper-panel";
import type { MapperStep, MapperScope, Replacement } from "../filter-transformer-xml";
import type { TransformerStepDefinition } from "./types";
import {
  childText,
  childTextRaw,
  childReplacements,
  dropBlankRegexReplacements,
  tcStr,
  serializeReplacementsStr,
} from "../filter-transformer-xml-helpers";
import { convertIdentifier } from "../iterator-utils";

const SCOPE_MAP: Record<MapperScope, string> = {
  CONNECTOR: "connectorMap",
  CHANNEL: "channelMap",
  GLOBAL_CHANNEL: "globalChannelMap",
  GLOBAL: "globalMap",
  RESPONSE: "responseMap",
};

function buildRegexArray(replacements: Replacement[]): string {
  // Drop blank-regex rows before generating clauses — mirrors Java
  // MapperPanel.getProperties, which excludes them so a blank regex never emits a
  // malformed `new Array(, "x")` clause.
  const rows = dropBlankRegexReplacements(replacements);
  if (rows.length === 0) return "new Array()";
  const inner = rows.map((r) => `new Array(${r.regex}, ${r.replaceWith})`).join(",");
  return `new Array(${inner})`;
}

/** Java `StringUtils.defaultIfBlank` — whitespace-only (or empty) is replaced by the fallback. */
function defaultIfBlank(value: string, fallback: string): string {
  return value.trim() ? value : fallback;
}

/** Java `length() == 0` — only a truly empty string is replaced; whitespace is preserved. */
function defaultIfEmpty(value: string, fallback: string): string {
  return value.length === 0 ? fallback : value;
}

/**
 * The shared `var mapping; try { ... } catch (e) { ... }` block plus the
 * `validate( mapping , <default>, <regex>)` expression. Both the standalone
 * script and the Iterator iteration script start from this and only differ in
 * how the validated value is stored, so they share one source of truth.
 *
 * Mirrors `MapperStep.getScript()`: `mapping` uses Java's `defaultIfBlank`
 * (whitespace → `''`), while `defaultValue` uses Java's `length() == 0` check
 * (whitespace preserved). Matching this per-field means the WebUI displays the
 * exact script the server rebuilds at deploy — so a whitespace-only default
 * surfaces the same `validate( mapping ,   , …)` the server would.
 */
function buildMappingBlock(step: MapperStep): { block: string; validateExpr: string } {
  const regexArray = buildRegexArray(step.replacements);
  const mapping = defaultIfBlank(step.mapping, "''");
  const defVal = defaultIfEmpty(step.defaultValue, "''");
  let block = "";
  block += "var mapping;\n\n";
  block += `try {\n\tmapping = ${mapping}; \n} `;
  block += "catch (e) {\n\tmapping = '';\n}\n\n";
  return { block, validateExpr: `validate( mapping , ${defVal}, ${regexArray})` };
}

/**
 * Builds the JavaScript the step compiles to on the server.
 * Mirrors `MapperStep.getScript()` in the Java client. The `variable` is emitted single-quoted
 * inside `<scopeMap>.put('<variable>', ...)`, so quote/backslash injection breaks the script.
 */
function buildMapperScript(step: MapperStep): string {
  const scopeMap = SCOPE_MAP[step.scope] ?? SCOPE_MAP.CHANNEL;
  const { block, validateExpr } = buildMappingBlock(step);
  return `${block}${scopeMap}.put('${step.variable}', ${validateExpr});`;
}

/**
 * Accumulator variable name used inside an Iterator: `_` + the variable with
 * any non-identifier characters stripped (`convertIdentifier`). The map key in
 * the post-script uses the RAW variable, not this converted name — matching
 * Java's `MapperStep`, which puts under `variable` but accumulates into
 * `_convertIdentifier(variable)`.
 */
function accumulatorName(step: MapperStep): string {
  return `_${convertIdentifier(step.variable)}`;
}

export const MapperStepDefinition: TransformerStepDefinition<MapperStep> = {
  type: "Mapper",
  xmlTag: "com.mirth.connect.plugins.mapper.MapperStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "Mapper",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    variable: "",
    mapping: "",
    defaultValue: "",
    replacements: [],
    scope: "CHANNEL",
  }),

  parse: (el) => ({
    type: "Mapper",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    variable: childText(el, "variable"),
    mapping: childTextRaw(el, "mapping"),
    defaultValue: childTextRaw(el, "defaultValue"),
    replacements: childReplacements(el, "replacements"),
    scope: childText(el, "scope", "CHANNEL") as MapperScope,
  }),

  serialize: (step) =>
    tcStr("variable", step.variable) +
    tcStr("mapping", step.mapping) +
    tcStr("defaultValue", step.defaultValue) +
    serializeReplacementsStr("replacements", dropBlankRegexReplacements(step.replacements)) +
    tcStr("scope", step.scope),

  emitScript: (step) => buildMapperScript(step),

  // Iterator phases — mirror MapperStep.getPreScript/getIterationScript/getPostScript.
  emitPreScript: (step) => `var ${accumulatorName(step)} = Lists.list();`,

  emitIterationScript: (step) => {
    const { block, validateExpr } = buildMappingBlock(step);
    return `${block}${accumulatorName(step)}.add(${validateExpr});`;
  },

  emitPostScript: (step) => {
    const scopeMap = SCOPE_MAP[step.scope] ?? SCOPE_MAP.CHANNEL;
    return `${scopeMap}.put('${step.variable}', ${accumulatorName(step)}.toArray());`;
  },

  // Java MapperPanel.checkProperties requires only `variable`. Empty mapping /
  // default value and invalid JavaScript do NOT block save (the editor panel still
  // flags them inline as non-blocking warnings).
  validate: (step) => {
    if (!step.variable?.trim()) return "Variable cannot be empty.";
    return null;
  },

  EditorPanel: MapperPanel,
};
