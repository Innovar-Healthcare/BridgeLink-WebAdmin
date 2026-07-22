/**
 * Built-in Iterator step definition.
 *
 * Mirrors the Java class `com.mirth.connect.model.IteratorStep`.
 *
 * Container step: iterates over its child steps via the `visitChildren` /
 * `withChildren` hooks and recurses through the registry's parseStep /
 * serializeStep / emitStepJs helpers for child steps.
 */

import { IteratorStepPanel } from "../../_components/filter-transformer/iterator-step-panel";
import type { Step, IteratorStep } from "../filter-transformer-xml";
import type {
  TransformerStepBase,
  TransformerStepDefinition,
  TransformerStepEditorProps,
} from "./types";
import {
  childEl,
  childStrings,
  childText,
  serializeStringsStr,
  tcStr,
} from "../filter-transformer-xml-helpers";
import {
  emitStepIterationJs,
  emitStepJs,
  emitStepPostJs,
  emitStepPreJs,
  isStepIterable,
  parseStep,
  serializeStep,
} from "./index";
import type { IteratorAncestor } from "./types";

function IteratorStepEditorAdapter({
  step,
  onChange,
  showErrors,
}: TransformerStepEditorProps<IteratorStep>) {
  return <IteratorStepPanel step={step} onChange={onChange} showErrors={showErrors} />;
}

export const IteratorStepDefinition: TransformerStepDefinition<IteratorStep> = {
  type: "Iterator",
  xmlTag: "com.mirth.connect.model.IteratorStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "Iterator",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    target: "",
    indexVariable: "i",
    prefixSubstitutions: [],
    children: [],
  }),

  parse: (el) => {
    const propsEl = childEl(el, "properties");
    const children: Step[] = [];
    if (propsEl) {
      const childrenEl = childEl(propsEl, "children");
      if (childrenEl) {
        for (const child of Array.from(childrenEl.children)) {
          const parsed = parseStep(child);
          if (parsed) children.push(parsed as Step);
        }
      }
    }
    return {
      type: "Iterator",
      name: "",
      sequenceNumber: "0",
      enabled: true,
      target: propsEl ? childText(propsEl, "target") : "",
      indexVariable: propsEl ? childText(propsEl, "indexVariable", "i") : "i",
      prefixSubstitutions: propsEl ? childStrings(propsEl, "prefixSubstitutions") : [],
      children,
    };
  },

  serialize: (step, version) => {
    const childrenXml = step.children.map((c) => serializeStep(c, version)).join("");
    return (
      `<properties>` +
      tcStr("target", step.target) +
      tcStr("indexVariable", step.indexVariable) +
      serializeStringsStr("prefixSubstitutions", step.prefixSubstitutions) +
      `<children>${childrenXml}</children>` +
      `</properties>`
    );
  },

  // Mirrors IteratorProperties.getScript: pre + iteration + post, composed over
  // the enabled children. Standalone emit starts with an empty ancestor chain.
  emitScript: (step) =>
    IteratorStepDefinition.emitPreScript!(step) +
    IteratorStepDefinition.emitIterationScript!(step, []) +
    IteratorStepDefinition.emitPostScript!(step),

  // Pre-phase: each iterable child declares its accumulator before the loop.
  // Non-iterable children contribute nothing. Mirrors IteratorProperties.getPreScript.
  emitPreScript: (step) => {
    let s = "";
    for (const child of step.children) {
      if (!child.enabled) continue;
      if (isStepIterable(child)) {
        s += `${emitStepPreJs(child)}\n`;
      }
    }
    return s;
  },

  // Iteration-phase: the for-loop. Iterable children emit their iteration script
  // (with this iterator appended to the ancestor chain); others emit standalone.
  // Mirrors IteratorProperties.getIterationScript.
  emitIterationScript: (step, ancestors) => {
    const idx = step.indexVariable || "i";
    const childAncestors: IteratorAncestor[] = [
      ...ancestors,
      { indexVariable: idx, target: step.target },
    ];
    let s = `for (var ${idx} = 0; ${idx} < getArrayOrXmlLength(${step.target}); ${idx}++) {\n`;
    for (const child of step.children) {
      if (!child.enabled) continue;
      s += "\n";
      s += isStepIterable(child) ? emitStepIterationJs(child, childAncestors) : emitStepJs(child);
      s += "\n";
    }
    s += "\n}\n";
    return s;
  },

  // Post-phase: each iterable child stores its accumulated array after the loop.
  // Mirrors IteratorProperties.getPostScript.
  emitPostScript: (step) => {
    let s = "";
    for (const child of step.children) {
      if (!child.enabled) continue;
      if (isStepIterable(child)) {
        s += `${emitStepPostJs(child)}\n`;
      }
    }
    return s;
  },

  validate: (step) => {
    if (!step.target?.trim()) return "Target cannot be empty.";
    if (!step.indexVariable?.trim()) return "Index variable cannot be empty.";
    return null;
  },

  EditorPanel: IteratorStepEditorAdapter,

  visitChildren: (step) => step.children as unknown as TransformerStepBase[],
  withChildren: (step, children) => ({
    ...step,
    children: children as unknown as Step[],
  }),
};
