/**
 * variable-extraction.ts
 *
 * Port of Java VariableListUtil — extracts variable names from filter/transformer
 * elements by scanning JavaScript code for map.put() calls and $x() shorthand.
 * Also reads Mapper step variable names directly.
 */

import type {
  Rule,
  Step,
  MapperStep,
  JavaScriptRule,
  JavaScriptStep,
  IteratorRule,
  IteratorStep,
} from "./filter-transformer-xml";

// ─── Comment stripping (mirrors Java VariableListUtil) ─────────────────────

const COMMENT_SIMPLE = /\/\/.*/g;
const COMMENT_BLOCK = /\/\*[\s\S]*?\*\//g;

function stripComments(script: string): string {
  try {
    let result = script.replace(COMMENT_SIMPLE, "");
    result = result.replace(COMMENT_BLOCK, "");
    return result;
  } catch {
    return script;
  }
}

// ─── Variable extraction regex (mirrors Java VariableListUtil) ──────────────
//
// Captures two forms:
//   1. xxxxxMap.put('key', ...) — full map name syntax
//   2. $x('key', ...)          — shorthand syntax (lookahead for comma = put, not get)
//
// Group layout (per alternation side):
//   Full form:  group(1) = quote char, group(2) = key
//   Short form: group(3) = quote char, group(4) = key

const GLOBAL_AND_CHANNEL_PATTERN =
  /(?<![A-Za-z0-9_$])(?:channel|global|globalChannel|response)Map\s*\.\s*put\s*\(\s*(['"])([^]*?)\1|(?<![A-Za-z0-9_$])\$(?:g|gc|c|r)\s*\(\s*(['"])([^]*?)\3(?=\s*,)/g;

const LOCAL_PATTERN =
  /(?<![A-Za-z0-9_$])(?:channel|global|globalChannel|response|connector)Map\s*\.\s*put\s*\(\s*(['"])([^]*?)\1|(?<![A-Za-z0-9_$])\$(?:g|gc|c|r|co)\s*\(\s*(['"])([^]*?)\3(?=\s*,)/g;

function extractFromScript(script: string, includeLocalVars: boolean, target: Set<string>): void {
  const cleaned = stripComments(script);
  const pattern = includeLocalVars ? LOCAL_PATTERN : GLOBAL_AND_CHANNEL_PATTERN;
  // Reset lastIndex since these are global regexes
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cleaned)) !== null) {
    // group(2) = full-form key, group(4) = short-form key
    const key = match[2] ?? match[4];
    if (key != null) {
      target.add(unescapeEcmaScript(key));
    }
  }
}

// ─── Response-variable extraction (mirrors Java JavaScriptSharedUtil) ──────────
//
// The Source tab's Response combo harvests only RESPONSE-map keys, set via
//   responseMap.put('key', ...)  or  $r('key', ...)
// This is narrower than extractFromScript above (which also captures channel/
// global/connector map vars). Mirrors Java `JavaScriptSharedUtil.RESULT_PATTERN`.
//   Full form:  group(1) = quote char, group(2) = key
//   Short form: group(3) = quote char, group(4) = key

const RESPONSE_PATTERN =
  /(?<![A-Za-z0-9_$])responseMap\s*\.\s*put\s*\(\s*(['"])([^]*?)\1|(?<![A-Za-z0-9_$])\$r\s*\(\s*(['"])([^]*?)\3(?=\s*,)/g;

function extractResponseFromScript(script: string, target: Set<string>): void {
  const cleaned = stripComments(script);
  RESPONSE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RESPONSE_PATTERN.exec(cleaned)) !== null) {
    const key = match[2] ?? match[4];
    if (key != null) {
      target.add(unescapeEcmaScript(key));
    }
  }
}

/** Minimal unescape for JS string escape sequences (matches Java StringEscapeUtils.unescapeEcmaScript). */
function unescapeEcmaScript(s: string): string {
  return s.replace(/\\(['"\\/bfnrt])/g, (_m, ch: string) => {
    switch (ch) {
      case "'":
        return "'";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return ch;
    }
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract variable names from filter/transformer elements.
 *
 * Mirrors Java `VariableListUtil.getStepVariables / getRuleVariables`:
 * - For JavaScript rules/steps: applies regex to the script field
 * - For Mapper steps: reads the `variable` field directly
 * - Recursively traverses Iterator children
 * - Skips disabled elements
 *
 * @param elements  The rules or steps from the current filter/transformer
 * @param includeLocalVars  When true, also captures connectorMap / $co variables
 * @param upToFlatIndex  When provided, only process elements that appear before
 *   this index in the flat (depth-first) traversal order — mirrors the Java client's
 *   `int row` parameter so a step only sees variables defined by earlier steps.
 * @returns  Deduplicated array of variable names
 */
export function extractVariablesFromElements(
  elements: (Rule | Step)[],
  includeLocalVars: boolean,
  upToFlatIndex?: number
): string[] {
  const vars = new Set<string>();
  let flatIndex = 0;
  let done = false;

  function visit(els: (Rule | Step)[]): void {
    for (const el of els) {
      if (done) return;
      if (upToFlatIndex !== undefined && flatIndex >= upToFlatIndex) {
        done = true;
        return;
      }
      flatIndex++;

      if (el.enabled) {
        if (el.type === "Mapper") {
          const mapper = el as MapperStep;
          if (mapper.variable?.trim()) {
            vars.add(mapper.variable.trim());
          }
        } else if (el.type === "JavaScript") {
          const js = el as JavaScriptRule | JavaScriptStep;
          if (js.script?.trim()) {
            extractFromScript(js.script, includeLocalVars, vars);
          }
        }
      }

      if (el.type === "Iterator") {
        visit((el as IteratorRule | IteratorStep).children);
      }
    }
  }

  visit(elements);
  return Array.from(vars);
}

/**
 * Extract response-map variable names from a raw script (pre/post-processor).
 *
 * Mirrors Java `JavaScriptSharedUtil.getResponseVariables(script)`: scans for
 * `responseMap.put('key', …)` and `$r('key', …)`.
 */
export function getResponseVariablesFromScript(script: string | null | undefined): string[] {
  const vars = new Set<string>();
  if (script?.trim()) {
    extractResponseFromScript(script, vars);
  }
  return Array.from(vars);
}

/**
 * Extract response-map variable names from filter/transformer elements.
 *
 * Mirrors Java `Rule.getResponseVariables()` / `Step.getResponseVariables()` as
 * used by `SourceSettingsPanel.updateResponseDropDown()`:
 * - JavaScript rules/steps: regex-scan the script for response-map keys
 * - Mapper steps: include the `variable` only when its scope is RESPONSE
 * - Recursively traverses Iterator children
 * - Skips disabled elements
 *
 * Unlike {@link extractVariablesFromElements}, this captures RESPONSE-map keys
 * only (not channel/global/connector vars).
 */
export function extractResponseVariablesFromElements(elements: (Rule | Step)[]): string[] {
  const vars = new Set<string>();

  function visit(els: (Rule | Step)[]): void {
    for (const el of els) {
      if (el.enabled) {
        if (el.type === "Mapper") {
          const mapper = el as MapperStep;
          if (mapper.scope === "RESPONSE" && mapper.variable?.trim()) {
            vars.add(mapper.variable.trim());
          }
        } else if (el.type === "JavaScript") {
          const js = el as JavaScriptRule | JavaScriptStep;
          if (js.script?.trim()) {
            extractResponseFromScript(js.script, vars);
          }
        }
      }

      if (el.type === "Iterator") {
        visit((el as IteratorRule | IteratorStep).children);
      }
    }
  }

  visit(elements);
  return Array.from(vars);
}
