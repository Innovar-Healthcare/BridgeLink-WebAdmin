/**
 * filter-transformer-xml.ts
 *
 * Types and XML parse/serialize for the Filter and Transformer editors.
 *
 * XML uses full Java class names as element tags (e.g.
 * "com.mirth.connect.plugins.mapper.MapperStep"), so we avoid querySelector
 * with dots and iterate children directly.
 *
 * Step-specific XML parsing, serialization, validation and script generation
 * now go through the transformer-step registry
 * (`./filter-transformer-steps`). Each built-in and commercial plugin step
 * self-registers there. Filter rules remain hardcoded in this module pending
 * a future rule registry.
 */

import {
  parseStep as parseStepFromRegistry,
  serializeStep as serializeStepFromRegistry,
  stepDefaults,
  stepTypesForContext,
  resolveStep,
  TRANSFORMER_STEP_REGISTRY,
} from "./filter-transformer-steps";
import {
  childEl,
  childText,
  childTextRaw,
  childBool,
  childStrings,
  escapeXml,
  escapeXmlAttr,
  encodeBase64Utf8,
  outerXml,
  tcStr,
  serializeStringsStr,
  dropBlankValues,
} from "./filter-transformer-xml-helpers";
import type { Replacement } from "./filter-transformer-xml-helpers";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type Operator = "NONE" | "AND" | "OR";
export type RuleCondition =
  | "EXISTS"
  | "NOT_EXIST"
  | "EQUALS"
  | "NOT_EQUAL"
  | "CONTAINS"
  | "NOT_CONTAIN";
export type MapperScope = "CONNECTOR" | "CHANNEL" | "GLOBAL_CHANNEL" | "GLOBAL" | "RESPONSE";
export type DestBehavior = "REMOVE" | "REMOVE_ALL_EXCEPT" | "REMOVE_ALL";

export type { Replacement };

interface FTBase {
  name: string;
  sequenceNumber: string;
  enabled: boolean;
}

/**
 * Opaque placeholder for a filter rule / transformer step whose XML tag is not
 * recognized by any registered rule/step type — e.g. an element from a plugin
 * (FilterRulePlugin / TransformerStepPlugin) whose WebUI counterpart is not
 * loaded, the commercial overlay being absent, or a newer server. The full
 * element is preserved verbatim in `rawXml` and re-emitted unchanged on
 * serialize so that editing a sibling element never silently deletes it
 *. Rendered read-only in the element list — the user cannot mutate
 * or convert an opaque element.
 */
export interface UnknownElement extends FTBase {
  type: "unknown";
  /** Verbatim outer XML of the original element, re-emitted unchanged. */
  rawXml: string;
}

// ─── Filter Rule types ────────────────────────────────────────────────────────

export interface RuleBuilderRule extends FTBase {
  type: "Rule Builder";
  operator: Operator;
  field: string;
  condition: RuleCondition;
  values: string[];
}
export interface JavaScriptRule extends FTBase {
  type: "JavaScript";
  operator: Operator;
  script: string;
}
export interface ExternalScriptRule extends FTBase {
  type: "External Script";
  operator: Operator;
  scriptPath: string;
}
export interface IteratorRule extends FTBase {
  type: "Iterator";
  operator: Operator;
  target: string;
  indexVariable: string;
  prefixSubstitutions: string[];
  intersectIterations: boolean;
  breakEarly: boolean;
  children: Rule[];
}
export type Rule =
  | RuleBuilderRule
  | JavaScriptRule
  | ExternalScriptRule
  | IteratorRule
  | UnknownElement;

// ─── Transformer Step types ───────────────────────────────────────────────────

export interface MapperStep extends FTBase {
  type: "Mapper";
  variable: string;
  mapping: string;
  defaultValue: string;
  replacements: Replacement[];
  scope: MapperScope;
}
export interface MessageBuilderStep extends FTBase {
  type: "Message Builder";
  messageSegment: string;
  mapping: string;
  defaultValue: string;
  replacements: Replacement[];
}
export interface JavaScriptStep extends FTBase {
  type: "JavaScript";
  script: string;
}
export interface XsltStep extends FTBase {
  type: "XSLT Step";
  sourceXml: string;
  resultVariable: string;
  template: string;
  useCustomFactory: boolean;
  customFactory: string;
}
export interface ExternalScriptStep extends FTBase {
  type: "External Script";
  scriptPath: string;
}
export interface DestinationSetFilterStep extends FTBase {
  type: "Destination Set Filter";
  behavior: DestBehavior;
  metaDataIds: number[];
  field: string;
  condition: RuleCondition;
  values: string[];
}
export interface IteratorStep extends FTBase {
  type: "Iterator";
  target: string;
  indexVariable: string;
  prefixSubstitutions: string[];
  children: Step[];
}
export type Step =
  | MapperStep
  | MessageBuilderStep
  | JavaScriptStep
  | XsltStep
  | ExternalScriptStep
  | DestinationSetFilterStep
  | IteratorStep
  | UnknownElement;

// ─── Container states ────────────────────────────────────────────────────────

export interface FilterState {
  version: string;
  elements: Rule[];
}

export interface TransformerState {
  version: string;
  elements: Step[];
  /** base64-decoded inbound template content, or null */
  inboundTemplate: string | null;
  /** base64-decoded outbound template content, or null */
  outboundTemplate: string | null;
  inboundDataType: string;
  outboundDataType: string;
  /** outer XML of the <inboundProperties> element, preserved verbatim */
  inboundPropertiesXml: string | null;
  /** outer XML of the <outboundProperties> element, preserved verbatim */
  outboundPropertiesXml: string | null;
}

// ─── XML tag name → TypeScript type maps ─────────────────────────────────────

const RULE_TAG: Record<string, Rule["type"]> = {
  "com.mirth.connect.plugins.rulebuilder.RuleBuilderRule": "Rule Builder",
  "com.mirth.connect.plugins.javascriptrule.JavaScriptRule": "JavaScript",
  "com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule": "External Script",
  "com.mirth.connect.model.IteratorRule": "Iterator",
};

export const RULE_TYPE_TO_TAG: Record<Rule["type"], string> = Object.fromEntries(
  Object.entries(RULE_TAG).map(([k, v]) => [v, k])
) as Record<Rule["type"], string>;

/**
 * Legacy lookup of step type → FQN class tag, preserved as an export because
 * a few consumers still reach for it directly (e.g. debug tools). Backed by a
 * Proxy that reads from the step registry on every access — this avoids a
 * TDZ when consumers in the registry's step-module chain (e.g. panels)
 * reimport this module before the registry is fully initialized.
 */
export const STEP_TYPE_TO_TAG: Readonly<Record<string, string>> = new Proxy(
  {} as Record<string, string>,
  {
    get(_, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      const def = resolveStep(prop);
      return def?.xmlTag;
    },
    has(_, prop: string | symbol) {
      return typeof prop === "string" && TRANSFORMER_STEP_REGISTRY.has(prop);
    },
    ownKeys() {
      return Array.from(TRANSFORMER_STEP_REGISTRY.keys());
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      const def = resolveStep(prop);
      if (!def) return undefined;
      return { enumerable: true, configurable: true, value: def.xmlTag };
    },
  }
);

// ─── Auto-name generators ─────────────────────────────────────────────────────

const CONDITION_PRESENT: Record<RuleCondition, string> = {
  EXISTS: "exists",
  NOT_EXIST: "does not exist",
  EQUALS: "equals",
  NOT_EQUAL: "does not equal",
  CONTAINS: "contains",
  NOT_CONTAIN: "does not contain",
};

// Conditions that take values (mirrors Java RuleBuilderPanel Condition.isValuesEnabled()).
// EXISTS / NOT_EXIST are value-less.
const VALUES_ENABLED: ReadonlySet<RuleCondition> = new Set([
  "EQUALS",
  "NOT_EQUAL",
  "CONTAINS",
  "NOT_CONTAIN",
]);

export function generateRuleBuilderName(
  field: string,
  condition: RuleCondition,
  values: string[]
): string {
  const cond = CONDITION_PRESENT[condition];
  if (!VALUES_ENABLED.has(condition)) return `Accept message if "${field}" ${cond}`;
  // Mirrors Java RuleBuilderPanel.updateName: join non-blank values with " or ",
  // with blank/empty special cases for EQUALS / NOT_EQUAL.
  const nonBlank = values.filter((v) => v.trim() !== "");
  if (nonBlank.length === 0) {
    if (condition === "EQUALS") return `Accept message if "${field}" is blank`;
    if (condition === "NOT_EQUAL") return `Accept message if "${field}" is not blank`;
    return `Accept message if "${field}" ${cond} ""`;
  }
  return `Accept message if "${field}" ${cond} ${nonBlank.join(" or ")}`;
}

export function generateDestSetFilterName(
  field: string,
  condition: RuleCondition,
  values: string[]
): string {
  const cond = CONDITION_PRESENT[condition];
  if (!VALUES_ENABLED.has(condition)) return `Filter destination(s) if "${field}" ${cond}`;
  // Mirrors Java DestinationSetFilterPanel.updateName: join non-blank values with " or ",
  // with blank/empty special cases for EQUALS / NOT_EQUAL.
  const nonBlank = values.filter((v) => v.trim() !== "");
  if (nonBlank.length === 0) {
    if (condition === "EQUALS") return `Filter destination(s) if "${field}" is blank`;
    if (condition === "NOT_EQUAL") return `Filter destination(s) if "${field}" is not blank`;
    return `Filter destination(s) if "${field}" ${cond} ""`;
  }
  return `Filter destination(s) if "${field}" ${cond} ${nonBlank.join(" or ")}`;
}

export function generateIteratorRuleName(target: string, intersectIterations: boolean): string {
  if (intersectIterations) {
    return `Accept message if all of the iterations return true for each ${target}`;
  }
  return `Accept message if at least one of the iterations returns true for each ${target}`;
}

export function generateIteratorStepName(target: string): string {
  // Mirrors Java IteratorStepPanel.getName: "For each " + target.
  return `For each ${target}`;
}

// ─── Default new elements ─────────────────────────────────────────────────────

export function defaultRule(type: Rule["type"], operator: Operator = "AND"): Rule {
  const base: FTBase = { name: "", sequenceNumber: "0", enabled: true };
  switch (type) {
    case "Rule Builder":
      return { ...base, type, operator, field: "", condition: "EXISTS", values: [] };
    case "JavaScript":
      return { ...base, type, operator, script: "" };
    case "External Script":
      return { ...base, type, operator, scriptPath: "" };
    case "Iterator":
      return {
        ...base,
        type,
        operator,
        target: "",
        indexVariable: "i",
        prefixSubstitutions: [],
        intersectIterations: false,
        breakEarly: true,
        children: [],
      };
    case "unknown":
      // Unreachable: the Add / type dropdowns never offer "unknown" — opaque
      // elements are read-only and cannot be created or converted-to.
      throw new Error("Cannot create a default for an opaque unknown rule.");
  }
}

export function defaultStep(type: Step["type"]): Step {
  const def = stepDefaults(type);
  if (!def) {
    throw new Error(`Unknown transformer step type: ${type}`);
  }
  return def as Step;
}

// ─── Sequence number assignment ───────────────────────────────────────────────

export function assignSequenceNumbers(elements: (Rule | Step)[], parentSeq?: string): void {
  for (let i = 0; i < elements.length; i++) {
    const seq = parentSeq !== undefined ? `${parentSeq}-${i}` : String(i);
    elements[i].sequenceNumber = seq;
    if (elements[i].type === "Iterator") {
      const iter = elements[i] as IteratorRule | IteratorStep;
      assignSequenceNumbers(iter.children, seq);
    }
  }
}

// ─── Operator normalization ───────────────────────────────────────────────────

/**
 * Renormalize filter rule operators in place after any structural mutation
 * (move, delete, import, move in/out of iterator). Mirrors the Java client's
 * `FilterPane.updateOperations` (called from the single `updateTable` chokepoint):
 * at every nesting level the first sibling's operator is forced to `NONE` and any
 * non-first sibling whose operator is `NONE` is coerced to `AND`; existing
 * `AND`/`OR` selections are left untouched.
 *
 * Without this, moving a `NONE`-operator rule into a non-first slot leaves it
 * `NONE`; the serializer then omits `<operator>` for that non-first rule, the
 * server deserializes a null operator, and the generated `doFilter()` joins the
 * two rule calls with no operator — a syntax error that fails every message
 * (and, inside an Iterator, is silently treated as `||`). See.
 *
 * Applies to filter rules only — transformer steps carry no operator.
 */
export function normalizeOperators(elements: Rule[]): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    // Opaque unknown elements carry no operator — it lives inside the
    // preserved rawXml, which we re-emit verbatim and must not rewrite. Skip them.
    if (el.type === "unknown") continue;
    if (i === 0) {
      el.operator = "NONE";
    } else if (el.operator === "NONE") {
      el.operator = "AND";
    }
    if (el.type === "Iterator") {
      normalizeOperators((el as IteratorRule).children);
    }
  }
}

// ─── Parse a single rule element ─────────────────────────────────────────────

function parseRule(el: Element): Rule | null {
  const ruleType = RULE_TAG[el.tagName];
  if (!ruleType) {
    // Unrecognized rule tag (unregistered plugin rule / newer server). Preserve
    // it verbatim rather than dropping it on the next edit.
    return {
      type: "unknown",
      rawXml: outerXml(el) ?? "",
      name: childText(el, "name"),
      sequenceNumber: childText(el, "sequenceNumber", "0"),
      enabled: childBool(el, "enabled", true),
    };
  }

  const name = childText(el, "name");
  const sequenceNumber = childText(el, "sequenceNumber", "0");
  const enabled = childBool(el, "enabled", true);
  const operatorRaw = childText(el, "operator", "NONE") as Operator;
  const operator: Operator = operatorRaw === "AND" || operatorRaw === "OR" ? operatorRaw : "NONE";

  switch (ruleType) {
    case "Rule Builder": {
      return {
        type: "Rule Builder",
        name,
        sequenceNumber,
        enabled,
        operator,
        field: childText(el, "field"),
        condition: childText(el, "condition", "EXISTS") as RuleCondition,
        values: childStrings(el, "values"),
      };
    }
    case "JavaScript": {
      return {
        type: "JavaScript",
        name,
        sequenceNumber,
        enabled,
        operator,
        // Verbatim: script bodies are whitespace-significant #49).
        script: childTextRaw(el, "script"),
      };
    }
    case "External Script": {
      return {
        type: "External Script",
        name,
        sequenceNumber,
        enabled,
        operator,
        scriptPath: childText(el, "scriptPath"),
      };
    }
    case "Iterator": {
      const propsEl = childEl(el, "properties");
      const children: Rule[] = [];
      if (propsEl) {
        const childrenEl = childEl(propsEl, "children");
        if (childrenEl) {
          for (const child of Array.from(childrenEl.children)) {
            const rule = parseRule(child);
            if (rule) children.push(rule);
          }
        }
      }
      return {
        type: "Iterator",
        name,
        sequenceNumber,
        enabled,
        operator,
        target: propsEl ? childText(propsEl, "target") : "",
        indexVariable: propsEl ? childText(propsEl, "indexVariable", "i") : "i",
        prefixSubstitutions: propsEl ? childStrings(propsEl, "prefixSubstitutions") : [],
        intersectIterations: propsEl ? childBool(propsEl, "intersectIterations", false) : false,
        breakEarly: propsEl ? childBool(propsEl, "breakEarly", true) : true,
        children,
      };
    }
  }
  // Unreachable: `ruleType` is one of the four RULE_TAG values here (unknown
  // tags returned early above). Present to satisfy the compiler now that
  // Rule["type"] includes the opaque "unknown" member.
  return null;
}

// ─── Parse a single step element ──────────────────────────────────────────────
// Dispatch is delegated to the step registry — see
// `./filter-transformer-steps/index.ts`.

function parseStep(el: Element): Step | null {
  return parseStepFromRegistry(el) as Step | null;
}

// ─── Parse filter XML ─────────────────────────────────────────────────────────

export function parseFilterFromXml(xml: string): FilterState {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  const version = root.getAttribute("version") ?? "4.6.1";
  const elemsEl = childEl(root, "elements");
  const elements: Rule[] = [];
  if (elemsEl) {
    for (const child of Array.from(elemsEl.children)) {
      const rule = parseRule(child);
      if (rule) elements.push(rule);
    }
  }
  return { version, elements };
}

// ─── Parse transformer XML ────────────────────────────────────────────────────

export function parseTransformerFromXml(xml: string): TransformerState {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  const version = root.getAttribute("version") ?? "4.6.1";
  const elemsEl = childEl(root, "elements");
  const elements: Step[] = [];
  if (elemsEl) {
    for (const child of Array.from(elemsEl.children)) {
      const step = parseStep(child);
      if (step) elements.push(step);
    }
  }

  // Template (base64-encoded or plain text). An absent OR empty element is null
  // (empty ≈ null — engine-equivalent, symmetric with the serialize gate below).
  // A whitespace-only *content* template base64-encodes to a non-empty string, so
  // it decodes fine here; it was previously destroyed only on serialize (fixed).
  const decodeTemplate = (el: Element | null): string | null => {
    if (!el) return null;
    const raw = el.textContent ?? "";
    if (!raw.trim()) return null;
    const enc = el.getAttribute("encoding");
    if (enc === "base64") {
      try {
        // BridgeLink encodes templates as UTF-8 bytes → base64.
        // atob() gives us the raw binary string; re-interpret as UTF-8.
        const binaryStr = atob(raw.trim());
        const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      } catch {
        // Not valid base64: drop rather than return the still-encoded raw — returning
        // raw would make serialize re-encode an already-encoded string, producing
        // double base64 #51). An undecodable template can't be recovered.
        return null;
      }
    }
    return raw;
  };

  return {
    version,
    elements,
    inboundTemplate: decodeTemplate(childEl(root, "inboundTemplate")),
    outboundTemplate: decodeTemplate(childEl(root, "outboundTemplate")),
    inboundDataType: childText(root, "inboundDataType", "RAW"),
    outboundDataType: childText(root, "outboundDataType", "RAW"),
    inboundPropertiesXml: outerXml(childEl(root, "inboundProperties")),
    outboundPropertiesXml: outerXml(childEl(root, "outboundProperties")),
  };
}

// ─── Serialize helpers ───────────────────────────────────────────────────────
//
// Low-level string-based XML helpers (tcStr, escapeXml, etc.) live in
// `./filter-transformer-xml-helpers` and are imported at the top of this
// module. We build XML as plain strings rather than constructing DOM elements
// because happy-dom normalises tag-name casing even in `application/xml`
// documents, which corrupts FQN Java class names and camelCase child tags.

// ─── Serialize a single rule ──────────────────────────────────────────────────

function serializeRuleXml(rule: Rule, isFirst: boolean, version: string): string {
  // Opaque preserved element — re-emit its original XML verbatim.
  if (rule.type === "unknown") return rule.rawXml;

  const tagName = RULE_TYPE_TO_TAG[rule.type];
  let inner =
    tcStr("name", rule.name) +
    tcStr("sequenceNumber", rule.sequenceNumber) +
    tcStr("enabled", String(rule.enabled));
  if (!isFirst && rule.operator !== "NONE") {
    inner += tcStr("operator", rule.operator);
  }

  switch (rule.type) {
    case "Rule Builder": {
      // Drop blank value rows on serialize so they never persist to channel XML —
      // mirrors Java RuleBuilderPanel.getValues().
      inner +=
        tcStr("field", rule.field) +
        tcStr("condition", rule.condition) +
        serializeStringsStr("values", dropBlankValues(rule.values));
      break;
    }
    case "JavaScript": {
      inner += tcStr("script", rule.script);
      break;
    }
    case "External Script": {
      inner += tcStr("scriptPath", rule.scriptPath);
      break;
    }
    case "Iterator": {
      const childrenXml = rule.children
        .map((child, i) => serializeRuleXml(child, i === 0, version))
        .join("");
      inner +=
        `<properties>` +
        tcStr("target", rule.target) +
        tcStr("indexVariable", rule.indexVariable) +
        serializeStringsStr("prefixSubstitutions", rule.prefixSubstitutions) +
        `<children>${childrenXml}</children>` +
        tcStr("intersectIterations", String(rule.intersectIterations)) +
        tcStr("breakEarly", String(rule.breakEarly)) +
        `</properties>`;
      break;
    }
  }

  return `<${tagName} version="${escapeXmlAttr(version)}">${inner}</${tagName}>`;
}

// ─── Serialize a single step ──────────────────────────────────────────────────
// Dispatch is delegated to the step registry — see
// `./filter-transformer-steps/index.ts`.

function serializeStepXml(step: Step, version: string): string {
  return serializeStepFromRegistry(step, version);
}

// ─── Serialize filter XML ─────────────────────────────────────────────────────

/**
 * Rebuild the `<filter>` XML from state, returning it as a string.
 *
 * The base XML is parsed only to read root-level attributes (e.g. `version`)
 * that should be preserved in the output; the `<elements>` block is rebuilt
 * entirely from state using string concatenation so that FQN Java class names
 * and camelCase child element names are always emitted with the exact casing
 * that BridgeLink's XML parser expects.
 */
export function serializeFilterToXml(baseXml: string, state: FilterState): string {
  const doc = new DOMParser().parseFromString(baseXml, "application/xml");
  const root = doc.documentElement;
  const version = root.getAttribute("version") ?? state.version;

  const elementsXml = state.elements
    .map((rule, i) => serializeRuleXml(rule, i === 0, state.version))
    .join("");

  return `<filter version="${escapeXmlAttr(version)}"><elements>${elementsXml}</elements></filter>`;
}

// ─── Serialize transformer XML ────────────────────────────────────────────────

/**
 * Rebuild the transformer XML from state, returning it as a string.
 *
 * Like `serializeFilterToXml`, we use string concatenation for all content
 * that originates from state so that camelCase element names survive the
 * round-trip faithfully.  The `inboundProperties` / `outboundProperties`
 * blobs are inserted verbatim because they were captured as XML strings by
 * `parseTransformerFromXml` and their internal structure is opaque to us.
 *
 * `rootTag` selects the wrapping element. A destination connector's
 * `<responseTransformer>` shares the exact same inner shape as `<transformer>`,
 * so the response-transformer editor reuses this serializer and MUST pass
 * `"responseTransformer"` — otherwise the element is written back into the
 * connector as a second `<transformer>`, leaving no `<responseTransformer>` and
 * producing a channel the server cannot deserialize. Defaulting to
 * `"transformer"` keeps every source/request-transformer caller unchanged.
 */
export function serializeTransformerToXml(
  baseXml: string,
  state: TransformerState,
  rootTag: "transformer" | "responseTransformer" = "transformer"
): string {
  // baseXml is accepted for API compatibility (the caller may supply the
  // original XML when only partial edits have been made), but we no longer
  // rely on DOM manipulation of it — all known fields come from `state`.
  void baseXml;

  const elementsXml = state.elements.map((step) => serializeStepXml(step, state.version)).join("");

  let xml = `<${rootTag} version="${escapeXmlAttr(state.version)}">`;
  xml += `<elements>${elementsXml}</elements>`;
  xml += `<inboundDataType>${escapeXml(state.inboundDataType)}</inboundDataType>`;
  xml += `<outboundDataType>${escapeXml(state.outboundDataType)}</outboundDataType>`;

  // Emit when the template has content — including whitespace-only content, which
  // the previous `.trim() !== ""` gate silently destroyed on save #51).
  // Empty "" is still omitted (empty ≈ null, symmetric with decodeTemplate).
  if (state.inboundTemplate !== null && state.inboundTemplate !== "") {
    xml += `<inboundTemplate encoding="base64">${encodeBase64Utf8(state.inboundTemplate)}</inboundTemplate>`;
  }
  if (state.outboundTemplate !== null && state.outboundTemplate !== "") {
    xml += `<outboundTemplate encoding="base64">${encodeBase64Utf8(state.outboundTemplate)}</outboundTemplate>`;
  }

  if (state.inboundPropertiesXml) xml += state.inboundPropertiesXml;
  if (state.outboundPropertiesXml) xml += state.outboundPropertiesXml;

  xml += `</${rootTag}>`;
  return xml;
}

// ─── Default empty XML blobs ──────────────────────────────────────────────────

/**
 * Empty `<filter>` blob stamped with the given server/channel version. A factory
 * (not a constant) so every caller supplies a real version — mirrors Java's marshal
 * and prevents a stale hardcoded release from reaching the server.
 */
export function emptyFilterXml(version: string): string {
  return `<filter version="${version}"><elements/></filter>`;
}

// ─── Available types per context ──────────────────────────────────────────────

export const SOURCE_RULE_TYPES: Rule["type"][] = [
  "Rule Builder",
  "JavaScript",
  "External Script",
  "Iterator",
];
export const DESTINATION_RULE_TYPES: Rule["type"][] = [
  "Rule Builder",
  "JavaScript",
  "External Script",
  // Iterator is available in destination filters too — Java FilterPane.getPlugins()
  // (FilterPane.java:135-139) registers the iterator plugin in BOTH the source and
  // destination plugin maps.
  "Iterator",
];
/**
 * Lazy-array Proxy that defers to `stepTypesForContext()` on every read so
 * that commercial plugins registering after module init are visible and so
 * that the surrounding circular import chain (step modules ↔ xml module) can
 * initialize in either order without a TDZ on the registry.
 */
function lazyStepTypeArray(context: "source" | "destination"): Step["type"][] {
  return new Proxy([] as Step["type"][], {
    get(_, prop: string | symbol) {
      const actual = stepTypesForContext(context) as Step["type"][];
      return Reflect.get(actual, prop);
    },
    has(_, prop: string | symbol) {
      const actual = stepTypesForContext(context) as Step["type"][];
      return Reflect.has(actual, prop);
    },
    ownKeys() {
      const actual = stepTypesForContext(context) as Step["type"][];
      return Reflect.ownKeys(actual);
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      const actual = stepTypesForContext(context) as Step["type"][];
      return Reflect.getOwnPropertyDescriptor(actual, prop);
    },
  });
}

/**
 * Step types available in the source transformer's "Add" dropdown.
 * Derived from the step registry lazily on access; order follows registration
 * order in `filter-transformer-steps/index.ts`, so plugin steps appear after
 * built-ins.
 */
export const SOURCE_STEP_TYPES: Step["type"][] = lazyStepTypeArray("source");

/**
 * Step types available in destination transformer and response transformer
 * "Add" dropdowns. (Destination Set Filter is source-only — it is the
 * `contexts` field on each definition that filters this list.)
 */
export const DESTINATION_STEP_TYPES: Step["type"][] = lazyStepTypeArray("destination");

// ─── Flat display list (for rendering the tree as a flat table) ───────────────

export interface DisplayItem {
  element: Rule | Step;
  /** Index path from root, e.g. [2] for top-level, [2, 0] for first child of third iterator */
  path: number[];
  depth: number;
  /** Is this element a direct child of an iterator? */
  isChild: boolean;
}

export function flattenElements(
  elements: (Rule | Step)[],
  depth = 0,
  parentPath: number[] = []
): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (let i = 0; i < elements.length; i++) {
    const path = [...parentPath, i];
    const el = elements[i];
    items.push({ element: el, path, depth, isChild: depth > 0 });
    if (el.type === "Iterator") {
      const iter = el as IteratorRule | IteratorStep;
      items.push(...flattenElements(iter.children, depth + 1, path));
    }
  }
  return items;
}

// ─── Immutable path-based update helpers ─────────────────────────────────────

type AnyElement = Rule | Step;

export function getElementAtPath(elements: AnyElement[], path: number[]): AnyElement | null {
  if (path.length === 0) return null;
  let current: AnyElement | null = elements[path[0]] ?? null;
  for (let i = 1; i < path.length; i++) {
    if (!current || current.type !== "Iterator") return null;
    current = (current as IteratorRule | IteratorStep).children[path[i]] ?? null;
  }
  return current;
}

export function updateElementAtPath(
  elements: AnyElement[],
  path: number[],
  updater: (el: AnyElement) => AnyElement
): AnyElement[] {
  if (path.length === 0) return elements;
  return elements.map((el, i) => {
    if (i !== path[0]) return el;
    if (path.length === 1) return updater(el);
    if (el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    const newChildren = updateElementAtPath(iter.children as AnyElement[], path.slice(1), updater);
    return { ...iter, children: newChildren } as AnyElement;
  });
}

export function deleteElementAtPath(elements: AnyElement[], path: number[]): AnyElement[] {
  if (path.length === 0) return elements;
  if (path.length === 1) {
    return elements.filter((_, i) => i !== path[0]);
  }
  return elements.map((el, i) => {
    if (i !== path[0] || el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    return {
      ...iter,
      children: deleteElementAtPath(iter.children as AnyElement[], path.slice(1)),
    } as AnyElement;
  });
}

export function insertElementAtPath(
  elements: AnyElement[],
  parentPath: number[],
  newEl: AnyElement
): AnyElement[] {
  if (parentPath.length === 0) {
    // Insert at top level (end)
    return [...elements, newEl];
  }
  return elements.map((el, i) => {
    if (i !== parentPath[0] || el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    if (parentPath.length === 1) {
      return { ...iter, children: [...(iter.children as AnyElement[]), newEl] } as AnyElement;
    }
    return {
      ...iter,
      children: insertElementAtPath(iter.children as AnyElement[], parentPath.slice(1), newEl),
    } as AnyElement;
  });
}

/**
 * Insert `newEl` into the array at `parentPath` at a specific `index`
 * (clamped to `[0, length]`). Unlike `insertElementAtPath`, which only appends,
 * this places the element at a chosen sibling position — used when wrapping an
 * element in a new Iterator at the element's former index (mirrors Java's
 * `insertNode(parent, element, childIndex)`).
 */
export function insertElementAtIndex(
  elements: AnyElement[],
  parentPath: number[],
  index: number,
  newEl: AnyElement
): AnyElement[] {
  if (parentPath.length === 0) {
    const copy = [...elements];
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, newEl);
    return copy;
  }
  return elements.map((el, i) => {
    if (i !== parentPath[0] || el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    if (parentPath.length === 1) {
      const children = [...(iter.children as AnyElement[])];
      children.splice(Math.max(0, Math.min(index, children.length)), 0, newEl);
      return { ...iter, children } as AnyElement;
    }
    return {
      ...iter,
      children: insertElementAtIndex(
        iter.children as AnyElement[],
        parentPath.slice(1),
        index,
        newEl
      ),
    } as AnyElement;
  });
}

/** Move element at `path` up one position among its siblings. */
export function moveElementUp(elements: AnyElement[], path: number[]): AnyElement[] {
  if (path.length === 0) return elements;
  if (path.length === 1) {
    const i = path[0];
    if (i <= 0) return elements;
    const copy = [...elements];
    [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
    return copy;
  }
  return elements.map((el, i) => {
    if (i !== path[0] || el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    return {
      ...iter,
      children: moveElementUp(iter.children as AnyElement[], path.slice(1)),
    } as AnyElement;
  });
}

/** Move element at `path` down one position among its siblings. */
export function moveElementDown(elements: AnyElement[], path: number[]): AnyElement[] {
  if (path.length === 0) return elements;
  if (path.length === 1) {
    const i = path[0];
    const copy = [...elements];
    if (i >= copy.length - 1) return elements;
    [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
    return copy;
  }
  return elements.map((el, i) => {
    if (i !== path[0] || el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    return {
      ...iter,
      children: moveElementDown(iter.children as AnyElement[], path.slice(1)),
    } as AnyElement;
  });
}

/**
 * Move an iterator child out of its parent iterator, placing it ABOVE the iterator
 * at the parent level. Only valid when `path` has length >= 2 and the element is
 * the first child of its iterator (index 0).
 *
 * Mirrors Java's BaseEditorPane.moveElement(up=true) cross-boundary case.
 */
export function moveElementOutUp(elements: AnyElement[], path: number[]): AnyElement[] {
  if (path.length < 2) return elements;
  const iterPath = path.slice(0, -1);

  // Remove from iterator
  const withoutChild = deleteElementAtPath(elements, path);
  // Get the iterator's position in its parent
  // Insert the removed element at the iterator's position in the parent level
  const el = getElementAtPath(elements, path);
  if (!el) return elements;

  // Build a new array inserting `el` at iterPath's position in its parent
  return insertAtSiblingPosition(withoutChild, iterPath, el, "before");
}

/**
 * Move an iterator child out of its parent iterator, placing it BELOW the iterator
 * at the parent level. Only valid when `path` has length >= 2 and the element is
 * the last child of its iterator.
 *
 * Mirrors Java's BaseEditorPane.moveElement(up=false) cross-boundary case.
 */
export function moveElementOutDown(elements: AnyElement[], path: number[]): AnyElement[] {
  if (path.length < 2) return elements;
  const iterPath = path.slice(0, -1);

  const el = getElementAtPath(elements, path);
  if (!el) return elements;

  const withoutChild = deleteElementAtPath(elements, path);
  return insertAtSiblingPosition(withoutChild, iterPath, el, "after");
}

/**
 * Insert `newEl` into the same parent array as the element at `siblingPath`,
 * either immediately before or after that sibling.
 */
function insertAtSiblingPosition(
  elements: AnyElement[],
  siblingPath: number[],
  newEl: AnyElement,
  position: "before" | "after"
): AnyElement[] {
  if (siblingPath.length === 1) {
    const sibIdx = siblingPath[0];
    const insertIdx = position === "before" ? sibIdx : sibIdx + 1;
    const copy = [...elements];
    copy.splice(insertIdx, 0, newEl);
    return copy;
  }
  return elements.map((el, i) => {
    if (i !== siblingPath[0] || el.type !== "Iterator") return el;
    const iter = el as IteratorRule | IteratorStep;
    return {
      ...iter,
      children: insertAtSiblingPosition(
        iter.children as AnyElement[],
        siblingPath.slice(1),
        newEl,
        position
      ),
    } as AnyElement;
  });
}
