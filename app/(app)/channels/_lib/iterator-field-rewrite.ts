/**
 * iterator-field-rewrite.ts
 *
 * Per-element-type iterator index-variable rewriting for the filter/transformer
 * editor. This is the WebUI analogue of the Java `FilterTransformerTypePlugin`
 * methods `getIteratorInfo` / `setIteratorInfo` / `replaceOrRemoveIteratorVariables`
 * (see each `*Plugin.java`), driven from `BaseEditorPane.doAssignToIterator`,
 * `doRemoveFromIterator`, and the move-out flow.
 *
 * When an element is moved into or out of an Iterator, each ancestor Iterator's
 * index variable (`[i]`) must be stripped from the element's expression fields
 * before it detaches and re-applied against its new parent chain after it
 * reattaches — otherwise a moved-out step keeps a stale `[i]` (undefined at
 * runtime) and an assigned-in step never iterates.
 *
 * A standalone type switch is used (rather than the transformer-only step
 * registry) because filter rules participate too.
 */

import type {
  Rule,
  Step,
  MapperStep,
  MessageBuilderStep,
  RuleBuilderRule,
  DestinationSetFilterStep,
  XsltStep,
  IteratorRule,
  IteratorStep,
  Replacement,
} from "./filter-transformer-xml";
import { getElementAtPath } from "./filter-transformer-xml";
import { replaceIteratorVariables, removeIteratorVariables } from "./iterator-utils";

type AnyElement = Rule | Step;

/** The primary iteration target and (Message Builder only) outbound expression. */
export interface IteratorInfo {
  target: string;
  outbound: string;
}

function isBlank(s: string | undefined | null): boolean {
  return !s || !s.trim();
}

/**
 * Extract the element's primary iteration target (and, for Message Builder, its
 * outbound message expression). Mirrors each plugin's `getIteratorInfo(element)`.
 */
export function getIteratorInfo(el: AnyElement): IteratorInfo {
  switch (el.type) {
    case "Mapper":
      return { target: (el as MapperStep).mapping, outbound: "" };
    case "Message Builder": {
      const mb = el as MessageBuilderStep;
      // Java: mapping blank → (messageSegment, null); else (mapping, messageSegment)
      return isBlank(mb.mapping)
        ? { target: mb.messageSegment, outbound: "" }
        : { target: mb.mapping, outbound: mb.messageSegment };
    }
    case "Rule Builder":
      return { target: (el as RuleBuilderRule).field, outbound: "" };
    case "Destination Set Filter":
      return { target: (el as DestinationSetFilterStep).field, outbound: "" };
    case "XSLT Step":
      return { target: (el as XsltStep).sourceXml, outbound: "" };
    case "Iterator":
      return { target: (el as IteratorRule | IteratorStep).target, outbound: "" };
    default:
      // JavaScript, External Script, Unknown — no discernible target.
      return { target: "", outbound: "" };
  }
}

/**
 * Write the iteration `target` (and `outbound`, Message Builder only) back into
 * the element's primary field(s). Mutates `el` — operate on a clone. Mirrors each
 * plugin's `setIteratorInfo`. XSLT/JavaScript/External Script/Unknown are no-ops
 * (matching the Java base implementation).
 */
export function setIteratorInfo(el: AnyElement, target: string, outbound: string): void {
  switch (el.type) {
    case "Mapper":
      (el as MapperStep).mapping = target;
      break;
    case "Message Builder": {
      const mb = el as MessageBuilderStep;
      // Java: outbound blank → messageSegment=target; else messageSegment=outbound, mapping=target
      if (isBlank(outbound)) {
        mb.messageSegment = target;
      } else {
        mb.messageSegment = outbound;
        mb.mapping = target;
      }
      break;
    }
    case "Rule Builder":
      (el as RuleBuilderRule).field = target;
      break;
    case "Destination Set Filter":
      (el as DestinationSetFilterStep).field = target;
      break;
    case "Iterator":
      (el as IteratorRule | IteratorStep).target = target;
      break;
    default:
      break;
  }
}

/**
 * Rewrite every iterator-relevant expression field of a single element via
 * `apply`, without recursing into children. Mutates `el` (reassigning fields and
 * replacing array-valued fields with mapped copies — safe on a shallow clone).
 * Mirrors each plugin's `replaceOrRemoveIteratorVariables`.
 */
export function rewriteElementFields(el: AnyElement, apply: (expr: string) => string): void {
  const applyReplacement = (r: Replacement): Replacement => ({
    regex: apply(r.regex),
    replaceWith: apply(r.replaceWith),
  });
  switch (el.type) {
    case "Mapper": {
      const m = el as MapperStep;
      m.mapping = apply(m.mapping);
      m.defaultValue = apply(m.defaultValue);
      m.replacements = m.replacements.map(applyReplacement);
      break;
    }
    case "Message Builder": {
      const mb = el as MessageBuilderStep;
      mb.messageSegment = apply(mb.messageSegment);
      mb.mapping = apply(mb.mapping);
      mb.defaultValue = apply(mb.defaultValue);
      mb.replacements = mb.replacements.map(applyReplacement);
      break;
    }
    case "Rule Builder": {
      const rb = el as RuleBuilderRule;
      rb.field = apply(rb.field);
      rb.values = rb.values.map(apply);
      break;
    }
    case "Destination Set Filter": {
      const d = el as DestinationSetFilterStep;
      d.field = apply(d.field);
      d.values = d.values.map(apply);
      break;
    }
    case "XSLT Step": {
      const x = el as XsltStep;
      x.sourceXml = apply(x.sourceXml);
      break;
    }
    case "Iterator": {
      const it = el as IteratorRule | IteratorStep;
      it.target = apply(it.target);
      it.prefixSubstitutions = it.prefixSubstitutions.map(apply);
      break;
    }
    default:
      break;
  }
}

/**
 * Walk the element at `nodePath` and all its descendants, rewriting each node's
 * fields against that node's own ancestor-iterator chain within `elements`.
 * Mutates the tree in place — pass a clone.
 *
 * `replace=true`  → apply index variables (self first, then children).
 * `replace=false` → remove index variables (children first, then self).
 *
 * The recursion order mirrors Java's `BaseEditorPane.replaceIteratorVariables`
 * (self-first) and `removeIteratorVariables` (children-first).
 */
function walkSubtree(elements: AnyElement[], nodePath: number[], replace: boolean): void {
  const node = getElementAtPath(elements, nodePath);
  if (!node) return;
  const parentPath = nodePath.slice(0, -1);
  const apply = (expr: string): string =>
    replace
      ? replaceIteratorVariables(expr, elements, parentPath)
      : removeIteratorVariables(expr, elements, parentPath);

  const recurseChildren = () => {
    if (node.type === "Iterator") {
      const children = (node as IteratorRule | IteratorStep).children as AnyElement[];
      for (let i = 0; i < children.length; i++) {
        walkSubtree(elements, [...nodePath, i], replace);
      }
    }
  };

  if (replace) {
    rewriteElementFields(node, apply);
    recurseChildren();
  } else {
    recurseChildren();
    rewriteElementFields(node, apply);
  }
}

/**
 * Apply ancestor-iterator index variables across the element at `elementPath`
 * and its descendants, after it has been (re)inserted into its new parent.
 * Mutates `elements` in place — pass a clone.
 */
export function applyIteratorVarsToSubtree(elements: AnyElement[], elementPath: number[]): void {
  walkSubtree(elements, elementPath, true);
}

/**
 * Remove ancestor-iterator index variables across the element at `elementPath`
 * and its descendants, before it is detached from its current parent.
 * Mutates `elements` in place — pass a clone.
 */
export function removeIteratorVarsFromSubtree(elements: AnyElement[], elementPath: number[]): void {
  walkSubtree(elements, elementPath, false);
}
