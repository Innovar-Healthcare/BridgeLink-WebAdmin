/**
 * iterator-utils.ts
 *
 * Pure utility functions for the Iterator feature in filter/transformer editors.
 * Mirrors the logic in Java's IteratorUtil.java and JavaScriptSharedUtil.getExpressionParts().
 */

import type { Rule, Step, IteratorRule, IteratorStep } from "./filter-transformer-xml";
import { getElementAtPath } from "./filter-transformer-xml";

type AnyElement = Rule | Step;

// ─── Expression Helpers ───────────────────────────────────────────────────────

const TO_STRING_SUFFIX = ".toString()";

/**
 * Strip a trailing `.toString()` from an expression, if present.
 *
 * The message tree appends `.toString()` to inbound node paths so they read as
 * source expressions (e.g. a Mapper's "mapping" field). Contexts that use the
 * path as an assignment **target** — the Iterator wizard's expression parsing,
 * and a Message Builder step's "Message Segment" — must drop the suffix, since
 * you cannot assign into `msg['MSH']['MSH.1'].toString()`. Mirrors Java's
 * pre-processing in IteratorWizardDialog.
 */
export function stripToStringSuffix(expression: string): string {
  return expression.endsWith(TO_STRING_SUFFIX)
    ? expression.slice(0, -TO_STRING_SUFFIX.length)
    : expression;
}

// ─── Expression Parts ─────────────────────────────────────────────────────────

/**
 * One part of a parsed JavaScript/E4X expression, matching Java's ExprPart.
 * - `value`: the text fragment appended to build the expression prefix (e.g. "msg", "['PID']", ".field")
 * - `propertyName`: the identifier extracted from this part (e.g. "msg", "'PID'", "field")
 * - `numberLiteral`: true when this is a numeric bracket access like [0]
 */
export interface ExprPart {
  value: string;
  propertyName: string;
  numberLiteral?: boolean;
}

/**
 * Parse a JavaScript/E4X expression into its constituent access parts.
 * Mirrors Java's JavaScriptSharedUtil.getExpressionParts(expression, includeNumberLiterals).
 *
 * Examples:
 *   "msg['PID']['PID.3']"  →  [{value:"msg",pn:"msg"}, {value:"['PID']",pn:"'PID'"}, {value:"['PID.3']",pn:"'PID.3'"}]
 *   "msg.PID.field1"       →  [{value:"msg",pn:"msg"}, {value:".PID",pn:"PID"}, {value:".field1",pn:"field1"}]
 *
 * `includeIndexBrackets` controls how an identifier bracket (e.g. an iterator
 * index like `[i]`) is handled. The default (`false`) stops parsing at the
 * index bracket — this is what the Iterator wizard / drag-drop prefix logic
 * wants, since the prefix must end before the index. Message Builder's
 * iteration-script E4X prologue needs the index bracket present as a part (so
 * it can locate the index variable's position via its property name), so it
 * passes `true`, mirroring Java's full `getExpressionParts(expr, true)` used by
 * `MessageBuilderStep.getIterationScript`.
 */
export function getExpressionParts(
  expression: string,
  includeNumberLiterals = false,
  includeIndexBrackets = false
): ExprPart[] {
  if (!expression || !expression.trim()) return [];

  // Strip .toString() suffix (matches Java's pre-processing in IteratorWizardDialog)
  const expr = stripToStringSuffix(expression);

  const parts: ExprPart[] = [];
  let pos = 0;

  // First token must be an identifier
  const identRe = /^[a-zA-Z_$][a-zA-Z0-9_$]*/;
  const identMatch = identRe.exec(expr.slice(pos));
  if (!identMatch) {
    // Unparseable — fall back to single-part (matches Java fallback)
    return expression.trim() ? [{ value: expression, propertyName: expression }] : [];
  }
  parts.push({ value: identMatch[0], propertyName: identMatch[0] });
  pos += identMatch[0].length;

  while (pos < expr.length) {
    const rest = expr.slice(pos);

    // Bracket access with quoted string: ['...' ] or ["..."]
    const bracketStrRe = /^\[(['"])(.*?)\1\]/;
    const bracketStrMatch = bracketStrRe.exec(rest);
    if (bracketStrMatch) {
      const quote = bracketStrMatch[1];
      const inner = bracketStrMatch[2];
      parts.push({
        value: bracketStrMatch[0],
        propertyName: quote + inner + quote,
      });
      pos += bracketStrMatch[0].length;
      continue;
    }

    // Dot access: .identifier
    const dotRe = /^\.[a-zA-Z_$][a-zA-Z0-9_$]*/;
    const dotMatch = dotRe.exec(rest);
    if (dotMatch) {
      parts.push({ value: dotMatch[0], propertyName: dotMatch[0].slice(1) });
      pos += dotMatch[0].length;
      continue;
    }

    // Number literal bracket: [0], [1], etc.
    const numRe = /^\[\d+\]/;
    const numMatch = numRe.exec(rest);
    if (numMatch) {
      if (includeNumberLiterals) {
        parts.push({
          value: numMatch[0],
          propertyName: numMatch[0].slice(1, -1),
          numberLiteral: true,
        });
      }
      pos += numMatch[0].length;
      continue;
    }

    // Bracket access with identifier (e.g. [varName] — index variable)
    const bracketIdentRe = /^\[([a-zA-Z_$][a-zA-Z0-9_$]*)\]/;
    const bracketIdentMatch = bracketIdentRe.exec(rest);
    if (bracketIdentMatch) {
      if (includeIndexBrackets) {
        // Keep the index bracket as a part with the bare identifier as its
        // property name (matches Java's ExprPart("[i]", "i")). Continue parsing.
        parts.push({ value: bracketIdentMatch[0], propertyName: bracketIdentMatch[1] });
        pos += bracketIdentMatch[0].length;
        continue;
      }
      // This is an iterator index bracket — stop here so the expression prefix
      // ends before the index, matching Java's behaviour of stripping number literals
      break;
    }

    // E4X property ref: .('PID') or .* — treat as opaque, stop further splitting
    break;
  }

  return parts;
}

/**
 * Remove any characters that aren't valid in a JavaScript identifier, leaving
 * only `[a-zA-Z0-9_$]`. Returns `"_"` when nothing remains.
 *
 * Mirrors Java's `JavaScriptSharedUtil.convertIdentifier`. Used to derive the
 * per-child accumulator variable name (e.g. `_myvar`) inside an Iterator's
 * generated script, where the raw user variable may contain characters that are
 * illegal in a bare JS identifier.
 */
export function convertIdentifier(identifier: string): string {
  if (!identifier) return "_";
  const cleaned = identifier.replace(/[^a-zA-Z0-9_$]/g, "");
  return cleaned.length > 0 ? cleaned : "_";
}

/**
 * Build a cumulative prefix string by concatenating the first `count` part values.
 * e.g. parts=["msg","['PID']","['3']"], count=2 → "msg['PID']"
 */
export function buildPrefix(parts: ExprPart[], count: number): string {
  return parts
    .slice(0, count)
    .map((p) => p.value)
    .join("");
}

// ─── Iterator Variable Utilities ─────────────────────────────────────────────

/**
 * Collect the indexVariable of every ancestor Iterator along `path`.
 * Order: outermost → innermost (matches Java's getAncestorIndexVariables traversal).
 */
export function getAncestorIndexVariables(elements: AnyElement[], path: number[]): string[] {
  const result: string[] = [];
  for (let depth = 1; depth < path.length; depth++) {
    const parentPath = path.slice(0, depth);
    const el = getElementAtPath(elements, parentPath);
    if (el && el.type === "Iterator") {
      result.push((el as IteratorRule | IteratorStep).indexVariable);
    }
  }
  return result;
}

/**
 * Collect the indexVariable of every descendant Iterator under the element at `path`.
 * If `path` is [] (top-level), collects from all top-level elements.
 */
export function getDescendantIndexVariables(elements: AnyElement[], path: number[]): string[] {
  const result: string[] = [];
  if (path.length === 0) {
    for (const el of elements) {
      collectDescendantVars(el, result);
    }
  } else {
    const el = getElementAtPath(elements, path);
    if (el) collectDescendantVars(el, result);
  }
  return result;
}

function collectDescendantVars(el: AnyElement, result: string[]): void {
  if (el.type === "Iterator") {
    const iter = el as IteratorRule | IteratorStep;
    result.push(iter.indexVariable);
    for (const child of iter.children as AnyElement[]) {
      collectDescendantVars(child, result);
    }
  }
}

/**
 * Find the next unused index variable starting from "i".
 * Sequence: i, j, k, ..., z, ii, jj, kk, ..., zz, iii, ...
 * Mirrors Java's IteratorUtil.getValidIndexVariable().
 */
export function getValidIndexVariable(ancestors: string[], descendants: string[]): string {
  const used = new Set([...ancestors, ...descendants]);
  let charCode = "i".charCodeAt(0);
  let len = 1;
  while (true) {
    const candidate = String.fromCharCode(charCode).repeat(len);
    if (!used.has(candidate)) return candidate;
    charCode++;
    if (charCode > "z".charCodeAt(0)) {
      charCode = "i".charCodeAt(0);
      len++;
    }
  }
}

/**
 * Apply an iterator's index variable to an expression.
 * For each prefix substitution, if the expression starts with the prefix (but not
 * already indexed), insert [indexVariable] after the prefix.
 *
 * Example: prefix="msg['PID']", indexVar="i", expression="msg['PID']['PID.3']"
 * → "msg['PID'][i]['PID.3']"
 *
 * Mirrors Java's IteratorUtil.replaceIteratorVariables(expression, IteratorElement).
 */
export function applyIteratorVariables(
  expression: string,
  prefixSubstitutions: string[],
  indexVariable: string
): string {
  if (!expression) return expression;
  const indexBracket = "[" + indexVariable + "]";
  let result = expression;
  for (const prefix of prefixSubstitutions) {
    if (result.startsWith(prefix) && !result.startsWith(prefix + indexBracket)) {
      // Drop every number-literal bracket from the suffix, mirroring Java's
      // IteratorUtil.replaceIteratorVariables: prepend "msg" so the tail parses
      // as a standalone expression, run it through removeNumberLiterals, then
      // strip the synthetic "msg" back off. This removes trailing fixed indices
      // (e.g. the [1] in msg['OBX'][2]['OBX.5'][1]), not just the leading one.
      const rawSuffix = result.slice(prefix.length);
      const cleaned = removeNumberLiterals("msg" + rawSuffix);
      const cleanSuffix = cleaned.startsWith("msg") ? cleaned.slice("msg".length) : cleaned;
      result = prefix + indexBracket + cleanSuffix;
    }
  }
  return result;
}

/**
 * Remove an iterator's index variable from an expression.
 * Inverse of applyIteratorVariables.
 *
 * Example: prefix="msg['PID']", indexVar="i", expression="msg['PID'][i]['PID.3']"
 * → "msg['PID']['PID.3']"
 */
export function stripIteratorVariables(
  expression: string,
  prefixSubstitutions: string[],
  indexVariable: string
): string {
  if (!expression) return expression;
  const indexBracket = "[" + indexVariable + "]";
  let result = expression;
  for (const prefix of prefixSubstitutions) {
    if (result.startsWith(prefix + indexBracket)) {
      result = prefix + result.slice((prefix + indexBracket).length);
    }
  }
  return result;
}

/**
 * Apply all ancestor iterator variables to an expression, walking from outermost to innermost.
 * Used when inserting an element as a child of an iterator.
 */
export function replaceIteratorVariables(
  expression: string,
  elements: AnyElement[],
  parentPath: number[]
): string {
  if (!expression) return expression;
  let result = expression;
  // Walk from root down to the immediate parent, applying each iterator's variables
  for (let depth = 1; depth <= parentPath.length; depth++) {
    const ancestorPath = parentPath.slice(0, depth);
    const el = getElementAtPath(elements, ancestorPath);
    if (el && el.type === "Iterator") {
      const iter = el as IteratorRule | IteratorStep;
      result = applyIteratorVariables(result, iter.prefixSubstitutions, iter.indexVariable);
    }
  }
  return result;
}

/**
 * Remove all ancestor iterator variables from an expression.
 * Used when detaching an element from its parent iterator before moving.
 */
export function removeIteratorVariables(
  expression: string,
  elements: AnyElement[],
  parentPath: number[]
): string {
  if (!expression) return expression;
  let result = expression;
  // Walk from innermost to outermost to reverse in order
  for (let depth = parentPath.length; depth >= 1; depth--) {
    const ancestorPath = parentPath.slice(0, depth);
    const el = getElementAtPath(elements, ancestorPath);
    if (el && el.type === "Iterator") {
      const iter = el as IteratorRule | IteratorStep;
      result = stripIteratorVariables(result, iter.prefixSubstitutions, iter.indexVariable);
    }
  }
  return result;
}

/**
 * Remove every number-literal bracket access (`[0]`, `[2]`, …) from an
 * expression, wherever it appears — not just the leading one.
 *
 * Faithful port of Java's `JavaScriptSharedUtil.removeNumberLiterals`: it strips
 * a trailing `.toString()`, rebuilds the expression from
 * `getExpressionParts(expr, includeNumberLiterals=false)` (which skips numeric
 * brackets while keeping identifier/index brackets), then re-appends the
 * `.toString()`. Example: `msg['OBX'][2]['OBX.5'][1]` → `msg['OBX']['OBX.5']`.
 */
export function removeNumberLiterals(expression: string): string {
  if (!expression) return expression;
  let suffix = "";
  let expr = expression;
  if (expr.endsWith(TO_STRING_SUFFIX)) {
    suffix = TO_STRING_SUFFIX;
    expr = expr.slice(0, -TO_STRING_SUFFIX.length);
  }
  const rebuilt = getExpressionParts(expr, false, true)
    .map((p) => p.value)
    .join("");
  return rebuilt + suffix;
}

// ─── Iterator Entry List (for Wizard dropdown) ───────────────────────────────

/** An existing iterator available for selection in the Iterator Wizard. */
export interface IteratorEntry {
  /** Path to this iterator in the elements array */
  path: number[];
  /** Display name (the iterator's name field) */
  label: string;
  /** Nesting depth for indentation in the dropdown */
  depth: number;
}

/**
 * Collect all Iterator elements in the tree as a flat list for the wizard dropdown.
 * Mirrors Java's IteratorWizardDialog.fillIteratorEntries().
 *
 * @param elements The top-level elements array
 * @param excludePath Optional path to exclude (the element being configured)
 */
export function findIteratorEntries(
  elements: AnyElement[],
  excludePath?: number[]
): IteratorEntry[] {
  const result: IteratorEntry[] = [];
  collectEntries(elements, [], result, excludePath, 0);
  return result;
}

function pathsMatch(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function collectEntries(
  elements: AnyElement[],
  basePath: number[],
  result: IteratorEntry[],
  excludePath: number[] | undefined,
  depth: number
): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const path = [...basePath, i];
    if (el.type === "Iterator") {
      if (!excludePath || !pathsMatch(path, excludePath)) {
        result.push({ path, label: el.name || "(unnamed iterator)", depth });
        const iter = el as IteratorRule | IteratorStep;
        collectEntries(iter.children as AnyElement[], path, result, excludePath, depth + 1);
      }
    }
  }
}
