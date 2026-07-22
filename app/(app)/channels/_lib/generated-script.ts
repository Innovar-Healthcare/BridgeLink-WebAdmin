/**
 * Client-side script generation matching each Java element type's `getScript(false)`.
 *
 * In the Java Swing client, every filter rule and transformer step has a
 * "Generated Script" tab that shows the compiled JavaScript. This module
 * replicates that logic so the web UI can display the same output.
 *
 * Transformer-step generators now live alongside each step definition in
 * `./filter-transformer-steps/*` — this module dispatches to the registry via
 * `emitStepJs()` for any Step. Filter rules remain hardcoded here pending a
 * future rule registry.
 *
 * Source of truth: each element's `getScript(boolean)` method in the Java
 * server source under `server/src/com/mirth/connect/plugins/` and `model/`.
 */

import type {
  Rule,
  Step,
  RuleBuilderRule,
  JavaScriptRule,
  ExternalScriptRule,
  IteratorRule,
} from "./filter-transformer-xml";
import { emitStepJs } from "./filter-transformer-steps";
import { dropBlankValues } from "./filter-transformer-xml-helpers";

// ─── Per-type script generators ──────────────────────────────────────────────
//
// Transformer-step generators now live alongside each step's definition in
// `./filter-transformer-steps/*`. This module only contains rule generators
// plus the iterator-rule recursion.

/** RuleBuilderRule.java → getScript(false) */
function generateRuleBuilderScript(rule: RuleBuilderRule): string {
  let s = "if(";

  // Drop blank value rows before generating clauses — mirrors Java
  // RuleBuilderPanel.getValues(), which excludes empty rows so a blank value
  // never emits malformed JS (e.g. `field == ` or a spurious trailing clause).
  const values = dropBlankValues(rule.values);

  if (rule.condition === "EXISTS") {
    s += `${rule.field}.length > 0) `;
  } else if (rule.condition === "NOT_EXIST") {
    s += `${rule.field}.length == 0) `;
  } else if (rule.condition === "CONTAINS" || rule.condition === "NOT_CONTAIN") {
    const eq = rule.condition === "CONTAINS" ? "!=" : "==";
    const op = rule.condition === "CONTAINS" ? "||" : "&&";
    if (values.length > 0) {
      for (let i = 0; i < values.length; i++) {
        s += `(${rule.field}.indexOf(${values[i]}) ${eq} -1)`;
        s += i + 1 === values.length ? ") " : ` ${op} `;
      }
    } else {
      s += `${rule.field}.indexOf("") ${eq} -1) `;
    }
  } else {
    // EQUALS or NOT_EQUAL
    const eq = rule.condition === "EQUALS" ? "==" : "!=";
    const op = rule.condition === "EQUALS" ? "||" : "&&";
    if (values.length > 0) {
      for (let i = 0; i < values.length; i++) {
        s += `${rule.field} ${eq} ${values[i]}`;
        s += i + 1 === values.length ? ") " : ` ${op} `;
      }
    } else {
      s += `${rule.field} ${eq} "") `;
    }
  }

  s += "{\n";
  s += "\treturn true;";
  s += "\n}\n";
  s += "return false;";
  return s;
}

/**
 * IteratorRuleProperties → getIterationScript(false)
 *
 * Generates a for loop with flag variable, IIFE-wrapped child rules
 * combined with AND/OR operators, and optional break-early.
 */
function generateIteratorRuleScript(rule: IteratorRule, depth = 0): string {
  const idx = rule.indexVariable || "i";
  const enabledChildren = rule.children.filter((c) => c.enabled);

  let s = "";
  s += `var _iterator_flag_${depth} = ${rule.intersectIterations};\n`;
  s += `for (var ${idx} = 0; ${idx} < getArrayOrXmlLength(${rule.target}); ${idx}++) {\n`;

  if (enabledChildren.length > 0) {
    s += "if (";
    if (rule.intersectIterations) s += "!(";

    let first = true;
    for (const child of enabledChildren) {
      if (first) {
        first = false;
      } else {
        // UnknownElement children carry no operator (preserved verbatim); the
        // script preview defaults them to AND — display-only, the real operator
        // stays inside the element's rawXml.
        const op = "operator" in child ? child.operator : "AND";
        s += op === "AND" ? "&&" : "||";
      }
      s += "\n(function() {\n";
      if (child.type === "Iterator") {
        s += generateIteratorRuleScript(child, depth + 1);
      } else {
        s += generateScript(child);
      }
      s += "\n}() == true)\n";
    }

    if (rule.intersectIterations) s += ")";
    s += `) { _iterator_flag_${depth} = ${!rule.intersectIterations}; `;
    if (rule.breakEarly) s += "break; ";
    s += "}\n";
  }

  s += `\n}\nreturn _iterator_flag_${depth};\n`;
  return s;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/** Detect whether a Rule | Step with type "Iterator" is a Rule iterator. */
function isRuleIterator(element: Rule | Step): element is IteratorRule {
  return element.type === "Iterator" && "intersectIterations" in element;
}

/** Detect whether the element is a filter Rule (vs. transformer Step). */
function isRule(element: Rule | Step): element is Rule {
  switch (element.type) {
    case "Rule Builder":
      return true;
    case "JavaScript":
      return "operator" in element;
    case "External Script":
      return "operator" in element;
    case "Iterator":
      return isRuleIterator(element);
    default:
      return false;
  }
}

/**
 * Generate the JavaScript source for a filter rule or transformer step,
 * matching the Java client's `element.getScript(false)` output.
 *
 * Transformer-step generation is delegated to the step registry
 * (`emitStepJs`). Filter rules remain hardcoded until a rule registry lands.
 */
export function generateScript(element: Rule | Step): string {
  if (isRule(element)) {
    switch (element.type) {
      case "Rule Builder":
        return generateRuleBuilderScript(element);
      case "JavaScript":
        return (element as JavaScriptRule).script;
      case "External Script":
        return `// External script will be loaded on deploy\n// Path: ${(element as ExternalScriptRule).scriptPath}\n`;
      case "Iterator":
        return generateIteratorRuleScript(element);
    }
  }
  return emitStepJs(element as Step);
}
