/**
 * Built-in Message Builder step definition.
 *
 * Mirrors the Java class
 * `com.mirth.connect.plugins.messagebuilder.MessageBuilderStep`.
 */

import { MessageBuilderPanel } from "../../_components/filter-transformer/message-builder-panel";
import type { MessageBuilderStep, Replacement } from "../filter-transformer-xml";
import type { IteratorAncestor, TransformerStepDefinition } from "./types";
import {
  childTextRaw,
  childReplacements,
  dropBlankRegexReplacements,
  tcStr,
  serializeReplacementsStr,
} from "../filter-transformer-xml-helpers";
import { buildPrefix, getExpressionParts, type ExprPart } from "../iterator-utils";

function buildRegexArray(replacements: Replacement[]): string {
  // Drop blank-regex rows before generating clauses — mirrors Java
  // MessageBuilderPanel.getProperties, which excludes them so a blank regex never
  // emits a malformed `new Array(, "x")` clause.
  const rows = dropBlankRegexReplacements(replacements);
  if (rows.length === 0) return "new Array()";
  const inner = rows.map((r) => `new Array(${r.regex}, ${r.replaceWith})`).join(",");
  return `new Array(${inner})`;
}

/** Java `StringUtils.isEmpty` — only a truly empty string is replaced; whitespace is preserved. */
function defaultIfEmpty(value: string, fallback: string): string {
  return value.length === 0 ? fallback : value;
}

/**
 * Builds the JavaScript the step compiles to on the server.
 * Mirrors `MessageBuilderStep.getScript()` in the Java client. The `messageSegment` is
 * emitted as the bare assignment target (LHS), so an invalid segment produces a syntax error.
 * Both `mapping` and `defaultValue` use Java's `StringUtils.isEmpty` check (empty-only,
 * whitespace preserved), so the WebUI displays the exact script the server rebuilds at deploy.
 */
function buildMessageBuilderScript(step: MessageBuilderStep): string {
  const regexArray = buildRegexArray(step.replacements);
  const defVal = defaultIfEmpty(step.defaultValue, "''");
  const mapping = defaultIfEmpty(step.mapping, "''");
  return `${step.messageSegment} = validate(${mapping}, ${defVal}, ${regexArray});`;
}

/** Index of the part whose property name equals `indexVar`, or -1. Mirrors Java `getExprIndex`. */
function getExprIndex(parts: ExprPart[], indexVar: string): number {
  return parts.findIndex((p) => p.propertyName === indexVar);
}

/**
 * Pragmatic port of Apache commons-text `StringEscapeUtils.escapeEcmaScript` for
 * the characters that can appear in a segment/property name being wrapped as a
 * single-quoted JS string literal. Segment names are typically HL7 identifiers,
 * so this only needs to guard quotes, backslashes and forward slashes.
 */
function escapeEcmaScript(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\//g, "\\/");
}

/** Quote a segment name as a JS string literal unless it already starts with a quote. */
function quoteSegmentName(name: string): string {
  return name.startsWith('"') || name.startsWith("'") ? name : `'${escapeEcmaScript(name)}'`;
}

/**
 * Build the Message Builder iteration script: an E4X segment-creation prologue
 * followed by the standalone assignment. Faithful port of Java
 * `MessageBuilderStep.getIterationScript`. The prologue ensures every parent
 * segment of `messageSegment` exists before the assignment — using E4X
 * `createSegment(...)` for XML and `{}` / `[]` for plain objects — for each
 * enclosing iterator's index variable.
 *
 * Known preview divergence #66, display-only, deferred): this WebUI
 * preview can differ from the exact script the server generates in two ways —
 * (1) a trailing `.toString()` on the mapping is stripped here but kept by the
 * Java server, and (2) the expression parser (`getExpressionParts`) does not
 * decompose E4X constructs (`..`, `.*`, `.@attr`), so segment-creation for those
 * paths may be omitted. This affects only the previewed script text, not the
 * step data that is saved; the server regenerates the authoritative script on
 * deploy. Documented rather than fixed — a faithful E4X parser is a larger effort
 * with display-only payoff.
 */
function buildMessageBuilderIterationScript(
  step: MessageBuilderStep,
  ancestors: IteratorAncestor[]
): string {
  // Java calls getExpressionParts(messageSegment) — i.e. includeNumberLiterals=true —
  // and needs the index brackets present as parts so getExprIndex can locate them.
  const exprParts = getExpressionParts(step.messageSegment, true, true);

  // Ancestors are outermost-first, matching Java's ancestors.descendingIterator().
  const indexVariables = new Set(ancestors.map((a) => a.indexVariable));

  let script = "";

  // Don't do anything if there aren't at least two parts to the expression.
  if (exprParts.length > 1) {
    // The segment creation logic differs for E4X XML versus regular objects.
    script += `if (typeof(${exprParts[0].value}) == 'xml') {\n`;

    // Add creation steps for each iterator (XML branch).
    for (const ancestor of ancestors) {
      const indexVar = ancestor.indexVariable;
      const currentIndex = getExprIndex(exprParts, indexVar);

      // Only add E4X createSegment calls if the index variable is at least in the
      // third position (e.g. tmp['OBR'][i]) — implying a base target object, a
      // segment name, and a position.
      if (currentIndex > 1) {
        const segmentPart = exprParts[currentIndex - 1];
        let segmentName = segmentPart.propertyName;

        if (!segmentPart.numberLiteral && !indexVariables.has(segmentName)) {
          // First make sure the base target object exists.
          if (currentIndex > 2) {
            const baseSegmentPart = exprParts[currentIndex - 2];
            let baseSegmentName = baseSegmentPart.propertyName;

            if (!baseSegmentPart.numberLiteral && !indexVariables.has(baseSegmentName)) {
              const baseSegment = buildPrefix(exprParts, currentIndex - 1);
              script += `if (typeof(${baseSegment}[0]) == 'undefined') {\n`;

              // Segment excluding the index variable and the two properties before it.
              const targetSegment = buildPrefix(exprParts, currentIndex - 2);
              baseSegmentName = quoteSegmentName(baseSegmentName);
              script += `createSegment(${baseSegmentName}, ${targetSegment});\n}\n`;
            }
          }

          // Segment including the index variable, e.g. tmp['OBR'][i].
          const wholeSegment = buildPrefix(exprParts, currentIndex + 1);
          script += `if (typeof(${wholeSegment}) == 'undefined') {\n`;

          // Segment excluding the index variable and the property before it, e.g. tmp.
          const targetSegment = buildPrefix(exprParts, currentIndex - 1);
          segmentName = quoteSegmentName(segmentName);
          script += `createSegment(${segmentName}, ${targetSegment}, ${indexVar});\n}\n`;
        }
      }
    }

    script += "} else {\n";

    // For regular objects we check every segment up until the second-to-last
    // (the last is set by the assignment). Each LHS is an empty object, except
    // segments occurring before an index variable, which become an empty array.
    let lastIndexChecked = -1;

    for (const ancestor of ancestors) {
      const indexVar = ancestor.indexVariable;
      const currentIndex = getExprIndex(exprParts, indexVar);

      // Make sure the index variable occurs in at least the second position.
      if (currentIndex > 0) {
        for (let i = lastIndexChecked + 1; i <= currentIndex; i++) {
          const targetSegment = buildPrefix(exprParts, i + 1);
          script += `if (typeof(${targetSegment}) == 'undefined') {\n`;

          // Empty array if right before the index variable or a number literal.
          let value = "{}";
          if (
            i === currentIndex - 1 ||
            (exprParts.length > i + 1 &&
              (exprParts[i + 1].numberLiteral || indexVariables.has(exprParts[i + 1].propertyName)))
          ) {
            value = "[]";
          }
          script += `${targetSegment} = ${value};\n`;
          script += "}\n";
          lastIndexChecked = i;
        }
      }
    }

    // Create the rest of the segments up until the second-to-last one.
    for (let i = lastIndexChecked + 1; i <= exprParts.length - 2; i++) {
      const targetSegment = buildPrefix(exprParts, i + 1);
      script += `if (typeof(${targetSegment}) == 'undefined') {\n`;

      // Empty array if right before a number literal or index variable.
      let value = "{}";
      if (
        exprParts.length > i + 1 &&
        (exprParts[i + 1].numberLiteral || indexVariables.has(exprParts[i + 1].propertyName))
      ) {
        value = "[]";
      }
      script += `${targetSegment} = ${value};\n`;
      script += "}\n";
    }

    script += "}\n";
  }

  script += buildMessageBuilderScript(step);
  return script;
}

export const MessageBuilderStepDefinition: TransformerStepDefinition<MessageBuilderStep> = {
  type: "Message Builder",
  xmlTag: "com.mirth.connect.plugins.messagebuilder.MessageBuilderStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "Message Builder",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    messageSegment: "",
    mapping: "",
    defaultValue: "",
    replacements: [],
  }),

  parse: (el) => ({
    type: "Message Builder",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    messageSegment: childTextRaw(el, "messageSegment"),
    mapping: childTextRaw(el, "mapping"),
    defaultValue: childTextRaw(el, "defaultValue"),
    replacements: childReplacements(el, "replacements"),
  }),

  serialize: (step) =>
    tcStr("messageSegment", step.messageSegment) +
    tcStr("mapping", step.mapping) +
    tcStr("defaultValue", step.defaultValue) +
    serializeReplacementsStr("replacements", dropBlankRegexReplacements(step.replacements)),

  emitScript: (step) => buildMessageBuilderScript(step),

  // Message Builder has no Iterator pre/post script (Java getPreScript/getPostScript
  // return null), but its iteration body adds an E4X segment-creation prologue.
  emitIterationScript: (step, ancestors) => buildMessageBuilderIterationScript(step, ancestors),

  // Java MessageBuilderPanel.checkProperties requires only `messageSegment`. Empty
  // mapping / default value and invalid JavaScript do NOT block save (the editor
  // panel still flags them inline as non-blocking warnings).
  validate: (step) => {
    if (!step.messageSegment?.trim()) return "Message segment cannot be empty.";
    return null;
  },

  EditorPanel: MessageBuilderPanel,
};
