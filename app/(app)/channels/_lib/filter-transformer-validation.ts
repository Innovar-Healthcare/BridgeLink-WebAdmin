/**
 * filter-transformer-validation.ts
 *
 * Standalone validation for filter rules and transformer steps.
 * Mirrors the Java Swing client's checkProperties() methods on each
 * rule/step panel. Used both for in-editor validation and save-time
 * blocking in channel-editor-core.
 */

import type {
  Rule,
  Step,
  RuleBuilderRule,
  JavaScriptRule,
  ExternalScriptRule,
  IteratorRule,
  IteratorStep,
} from "./filter-transformer-xml";
import { parseFilterFromXml, parseTransformerFromXml } from "./filter-transformer-xml";
import { tryParseJs } from "@/lib/js-validation";
import { parseSourceConnectorFromXml, parseDestinationConnectorsFromXml } from "./channel-xml";
import { resolveStep } from "./filter-transformer-steps";
import {
  scriptErrorMessage,
  serverSupportsScriptValidation,
  validateScriptsBatch,
} from "@/lib/api/api-script-validation";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FtValidationError {
  /** e.g. "Source Filter", "Destination \"HTTP Out\" Transformer" */
  location: string;
  /** Element name from the FTBase.name field */
  elementName: string;
  /** Element type discriminator, e.g. "Rule Builder", "External Script" */
  elementType: string;
  /** Human-readable error message */
  message: string;
}

// ─── Element-level validation ────────────────────────────────────────────────

/** Validate a single filter rule. Returns error message or null if valid. */
export function validateRule(el: Rule): string | null {
  return validateElement(el);
}

/** Validate a single transformer step. Returns error message or null if valid. */
export function validateStep(el: Step): string | null {
  return validateElement(el);
}

/** Detect whether an Iterator element is a filter Iterator rule. */
function isRuleIterator(el: Rule | Step): el is IteratorRule {
  return el.type === "Iterator" && "intersectIterations" in el;
}

/** Detect whether an element is a filter Rule (vs. transformer Step). */
function isRule(el: Rule | Step): el is Rule {
  switch (el.type) {
    case "Rule Builder":
      return true;
    case "JavaScript":
      return "operator" in el;
    case "External Script":
      return "operator" in el;
    case "Iterator":
      return isRuleIterator(el);
    default:
      return false;
  }
}

/**
 * The JavaScript source an element contributes to server-side (Rhino) syntax validation, or
 * `null` when it carries none. Only JavaScript filter rules and JavaScript
 * transformer steps carry a script — this matches exactly what the client-side acorn path
 * validates today, so routing it through the server changes accuracy, not coverage. Steps built
 * from structured fields (Mapper, Message Builder, …) keep validating those fields via
 * {@link validateElementNonScript}; validating their *generated* scripts too would be a wider
 * parity change and is deliberately out of scope here.
 */
export function getElementScript(el: Rule | Step): string | null {
  if (!isRule(el)) {
    const step = el as Step;
    return resolveStep(step.type)?.getScript?.(step) ?? null;
  }
  if (el.type === "JavaScript") return (el as JavaScriptRule).script;
  return null;
}

/**
 * Structural (non-script) validation for a single rule or step — synchronous and local.
 * Returns null when valid, or a human-readable error message. The JS-parse of elements that
 * carry a script ({@link getElementScript}) is handled separately (acorn in {@link
 * validateElement}, or the server batch in the channel-wide async path), so it is NOT repeated
 * here — an element with a script contributes no structural error. Mirrors the structural half
 * of Java `BaseEditorPane.validateElement` (plugin.checkProperties before the script compile).
 */
export function validateElementNonScript(el: Rule | Step): string | null {
  if (!isRule(el)) {
    const step = el as Step;
    const def = resolveStep(step.type);
    if (!def) return null;
    // A step that carries a script defers its parse to getElementScript; its registry
    // validate() IS that parse (JavaScript step), so skip it here to avoid double-reporting.
    return def.getScript ? null : def.validate(step);
  }

  // Filter rules
  switch (el.type) {
    case "Rule Builder": {
      // Java RuleBuilderPanel.checkProperties requires only `field`. A blank value
      // is legal (the generated script falls back to `field == ""` — the "is blank"
      // case), so we do NOT require a value for EQUALS/CONTAINS.
      const r = el as RuleBuilderRule;
      if (!r.field?.trim()) return "Field cannot be empty.";
      return null;
    }
    case "JavaScript":
      // Script handled by getElementScript; no structural check.
      return null;
    case "External Script": {
      const s = el as ExternalScriptRule;
      if (!s.scriptPath?.trim()) return "Script path cannot be empty.";
      return null;
    }
    case "Iterator": {
      const i = el as IteratorRule;
      if (!i.target?.trim()) return "Target cannot be empty.";
      if (!i.indexVariable?.trim()) return "Index variable cannot be empty.";
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validate a single rule or step (synchronous, acorn). Returns null if valid, or a
 * human-readable error message. Composes the structural check with the client-side JS parse —
 * the behavior the live editor, per-element Validate buttons, and render-time auto-validate
 * rely on. The channel-wide save/enable path instead batches {@link getElementScript} to the
 * server and reuses {@link validateElementNonScript} for the structural half.
 */
export function validateElement(el: Rule | Step): string | null {
  const structural = validateElementNonScript(el);
  if (structural) return structural;
  const script = getElementScript(el);
  return script != null ? tryParseJs(script) : null;
}

// ─── Recursive element list validation ───────────────────────────────────────

/**
 * One validation slot in tree order. A structural error has `message` set and `scriptId` null.
 * A JavaScript element that needs a Rhino/acorn parse has `message` null and `scriptId` set —
 * its `message` is filled by {@link resolveScriptSlots} after the (possibly batched) parse.
 * Elements with no error and no script produce no slot. Keeping every element as an ordered slot
 * preserves the exact tree order the synchronous validator produced, even though scripts resolve
 * after the walk.
 */
export interface ScriptSlot {
  location: string;
  elementName: string;
  elementType: string;
  message: string | null;
  scriptId: string | null;
}

/** Accumulator threaded through the recursive walk. */
interface SlotCollector {
  slots: ScriptSlot[];
  scripts: Record<string, string>;
  next: number;
}

/**
 * Walk a list of rules or steps in tree order, recursing into Iterator children, appending a
 * {@link ScriptSlot} for each element that has a structural error or a script to parse.
 *
 * `ancestorIndexVars` carries the index variables of the enclosing Iterators, so a nested
 * Iterator that reuses an ancestor's index variable is flagged. Mirrors Java's
 * BaseEditorPane.validateElementRecursive (BaseEditorPane.java:842-867) — the check is
 * ancestor-only, so two *sibling* Iterators may share an index variable without colliding.
 */
function collectElementSlots(
  elements: (Rule | Step)[],
  location: string,
  acc: SlotCollector,
  ancestorIndexVars: string[] = []
): void {
  for (const el of elements) {
    const structural = validateElementNonScript(el);
    if (structural) {
      acc.slots.push({
        location,
        elementName: el.name,
        elementType: el.type,
        message: structural,
        scriptId: null,
      });
    } else {
      const script = getElementScript(el);
      if (script != null) {
        const id = String(acc.next++);
        acc.scripts[id] = script;
        acc.slots.push({
          location,
          elementName: el.name,
          elementType: el.type,
          message: null,
          scriptId: id,
        });
      }
    }
    // Recurse into Iterator children, tracking index variables down the tree.
    if (el.type === "Iterator") {
      const iter = el as IteratorRule | IteratorStep;
      const indexVariable = iter.indexVariable?.trim();
      if (indexVariable && ancestorIndexVars.includes(indexVariable)) {
        acc.slots.push({
          location,
          elementName: el.name,
          elementType: el.type,
          message: `Duplicate Iterator index variable ${indexVariable} found.`,
          scriptId: null,
        });
      }
      if (iter.children?.length) {
        collectElementSlots(iter.children, location, acc, [
          ...ancestorIndexVars,
          ...(indexVariable ? [indexVariable] : []),
        ]);
      }
    }
  }
}

// ─── Channel-level validation ────────────────────────────────────────────────

/**
 * Collect the filter/transformer validation of a full channel into ordered {@link ScriptSlot}s
 * and the map of scripts to parse. Structural errors are resolved inline; JavaScript scripts are
 * left pending so a caller can batch them (optionally alongside other scripts, e.g. the channel
 * scripts on the enable path) in one {@link resolveScriptSlots} call. Exported so the enable
 * validator can share a single batch round-trip.
 */
export function collectChannelFtSlots(channelXml: string): {
  slots: ScriptSlot[];
  scripts: Record<string, string>;
} {
  const acc: SlotCollector = { slots: [], scripts: {}, next: 0 };

  const walk = (
    xml: string | null | undefined,
    location: string,
    parse: (x: string) => { elements: (Rule | Step)[] }
  ) => {
    if (!xml) return;
    try {
      collectElementSlots(parse(xml).elements, location, acc);
    } catch {
      // Malformed XML — skip; serialization fails elsewhere with a clearer error.
    }
  };

  const src = parseSourceConnectorFromXml(channelXml);
  walk(src.filterXml, "Source Filter", parseFilterFromXml);
  walk(src.transformerXml, "Source Transformer", parseTransformerFromXml);

  for (const dest of parseDestinationConnectorsFromXml(channelXml)) {
    const destLabel = `Destination "${dest.name}"`;
    walk(dest.filterXml, `${destLabel} Filter`, parseFilterFromXml);
    walk(dest.transformerXml, `${destLabel} Transformer`, parseTransformerFromXml);
    walk(dest.responseTransformerXml, `${destLabel} Response Transformer`, parseTransformerFromXml);
  }

  return { slots: acc.slots, scripts: acc.scripts };
}

/**
 * Resolve every pending script slot's `message` — server-side (real Rhino, one batch call) when
 * the connected Core supports it, else via the acorn fallback. Mutates the slots in
 * place. Callers may pass extra script slots (and their scripts) beyond the filter/transformer
 * ones so a single round-trip covers everything (e.g. the channel scripts on enable).
 */
export async function resolveScriptSlots(
  slots: ScriptSlot[],
  scripts: Record<string, string>
): Promise<void> {
  const pending = slots.filter((s) => s.scriptId != null);
  if (pending.length === 0) return;

  if (serverSupportsScriptValidation()) {
    const results = await validateScriptsBatch(scripts);
    for (const slot of pending) {
      slot.message = scriptErrorMessage(results[slot.scriptId as string]);
    }
    return;
  }

  // TRANSITIONAL FALLBACK — client-side acorn path for Core older than the endpoint.
  // Delete once MIN_SUPPORTED_SERVER_VERSION >= MIN_SERVER_VALIDATE_SCRIPTS.
  for (const slot of pending) {
    slot.message = tryParseJs(scripts[slot.scriptId as string]);
  }
}

/** Ordered slots → the display error list, dropping slots that resolved clean. */
function slotsToFtErrors(slots: ScriptSlot[]): FtValidationError[] {
  const errors: FtValidationError[] = [];
  for (const s of slots) {
    if (s.message) {
      errors.push({
        location: s.location,
        elementName: s.elementName,
        elementType: s.elementType,
        message: s.message,
      });
    }
  }
  return errors;
}

/**
 * Validate all filter rules and transformer steps in a full channel XML string. Structural
 * checks run locally; JavaScript scripts are validated with the server's Rhino engine in one
 * batch call when the Core supports it, else via the acorn fallback. Returns errors
 * with location context, in tree order.
 */
export async function validateChannelFiltersAndTransformers(
  channelXml: string
): Promise<FtValidationError[]> {
  const { slots, scripts } = collectChannelFtSlots(channelXml);
  await resolveScriptSlots(slots, scripts);
  return slotsToFtErrors(slots);
}
