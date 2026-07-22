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
import { validateStepInRegistry } from "./filter-transformer-steps";

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
 * Validate a single rule or step.
 * Returns null if valid, or a human-readable error message.
 *
 * Step validation is delegated to the step registry — each
 * TransformerStepDefinition owns its own `validate()` function. Filter rules
 * stay hardcoded pending a future rule registry.
 */
export function validateElement(el: Rule | Step): string | null {
  if (!isRule(el)) {
    // Transformer steps: ask the registry.
    return validateStepInRegistry(el as Step);
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
    case "JavaScript": {
      // Java JavaScriptRulePanel.checkProperties compiles the script and blocks only
      // on a compile error — a blank script compiles fine, so it is legal. We keep
      // the JS-parse check (mirrors the Rhino compile) but drop the required check.
      const j = el as JavaScriptRule;
      return tryParseJs(j.script);
    }
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

// ─── Recursive element list validation ───────────────────────────────────────

interface ElementError {
  elementName: string;
  elementType: string;
  message: string;
}

/**
 * Validate a list of rules or steps, recursing into Iterator children.
 *
 * `ancestorIndexVars` carries the index variables of the enclosing Iterators, so
 * a nested Iterator that reuses an ancestor's index variable is flagged. This
 * mirrors Java's BaseEditorPane.validateElementRecursive (BaseEditorPane.java:842-867),
 * which walks a Deque of ancestor index variables — the check is ancestor-only,
 * so two *sibling* Iterators may share an index variable without colliding.
 */
function validateElements(
  elements: (Rule | Step)[],
  ancestorIndexVars: string[] = []
): ElementError[] {
  const errors: ElementError[] = [];
  for (const el of elements) {
    const msg = validateElement(el);
    if (msg) {
      errors.push({ elementName: el.name, elementType: el.type, message: msg });
    }
    // Recurse into Iterator children, tracking index variables down the tree.
    if (el.type === "Iterator") {
      const iter = el as IteratorRule | IteratorStep;
      const indexVariable = iter.indexVariable?.trim();
      if (indexVariable && ancestorIndexVars.includes(indexVariable)) {
        errors.push({
          elementName: el.name,
          elementType: el.type,
          message: `Duplicate Iterator index variable ${indexVariable} found.`,
        });
      }
      if (iter.children?.length) {
        const childErrors = validateElements(iter.children, [
          ...ancestorIndexVars,
          ...(indexVariable ? [indexVariable] : []),
        ]);
        errors.push(...childErrors);
      }
    }
  }
  return errors;
}

// ─── Channel-level validation ────────────────────────────────────────────────

/**
 * Validate all filter rules and transformer steps in a full channel XML string.
 * Parses source and destination connectors, then validates each filter/transformer.
 * Returns an array of errors with location context for display.
 */
export function validateChannelFiltersAndTransformers(channelXml: string): FtValidationError[] {
  const allErrors: FtValidationError[] = [];

  // Source connector
  const src = parseSourceConnectorFromXml(channelXml);
  if (src.filterXml) {
    try {
      const filter = parseFilterFromXml(src.filterXml);
      for (const err of validateElements(filter.elements)) {
        allErrors.push({ location: "Source Filter", ...err });
      }
    } catch {
      // If XML is malformed, skip — serialization will fail elsewhere
    }
  }
  if (src.transformerXml) {
    try {
      const transformer = parseTransformerFromXml(src.transformerXml);
      for (const err of validateElements(transformer.elements)) {
        allErrors.push({ location: "Source Transformer", ...err });
      }
    } catch {
      // skip
    }
  }

  // Destination connectors
  const dests = parseDestinationConnectorsFromXml(channelXml);
  for (const dest of dests) {
    const destLabel = `Destination "${dest.name}"`;

    if (dest.filterXml) {
      try {
        const filter = parseFilterFromXml(dest.filterXml);
        for (const err of validateElements(filter.elements)) {
          allErrors.push({ location: `${destLabel} Filter`, ...err });
        }
      } catch {
        // skip
      }
    }
    if (dest.transformerXml) {
      try {
        const transformer = parseTransformerFromXml(dest.transformerXml);
        for (const err of validateElements(transformer.elements)) {
          allErrors.push({ location: `${destLabel} Transformer`, ...err });
        }
      } catch {
        // skip
      }
    }
    if (dest.responseTransformerXml) {
      try {
        const transformer = parseTransformerFromXml(dest.responseTransformerXml);
        for (const err of validateElements(transformer.elements)) {
          allErrors.push({ location: `${destLabel} Response Transformer`, ...err });
        }
      } catch {
        // skip
      }
    }
  }

  return allErrors;
}
