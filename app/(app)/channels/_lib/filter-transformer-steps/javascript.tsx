/**
 * Built-in JavaScript step definition.
 *
 * Mirrors the Java class
 * `com.mirth.connect.plugins.javascriptstep.JavaScriptStep`.
 */

import { JavaScriptPanel } from "../../_components/filter-transformer/javascript-panel";
import type { JavaScriptStep } from "../filter-transformer-xml";
import type { TransformerStepDefinition, TransformerStepEditorProps } from "./types";
import { childTextRaw, tcStr } from "../filter-transformer-xml-helpers";
import { tryParseJs } from "@/lib/js-validation";

function JavaScriptStepEditor({
  step,
  onChange,
  showErrors,
  contextType,
  channelId,
  context,
}: TransformerStepEditorProps<JavaScriptStep>) {
  return (
    <JavaScriptPanel
      element={step}
      onChange={(el) => onChange(el as JavaScriptStep)}
      showErrors={showErrors}
      contextType={contextType}
      channelId={channelId}
      context={context}
    />
  );
}

export const JavaScriptStepDefinition: TransformerStepDefinition<JavaScriptStep> = {
  type: "JavaScript",
  xmlTag: "com.mirth.connect.plugins.javascriptstep.JavaScriptStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "JavaScript",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    script: "",
  }),

  parse: (el) => ({
    type: "JavaScript",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    script: childTextRaw(el, "script"),
  }),

  serialize: (step) => tcStr("script", step.script),

  emitScript: (step) => step.script,

  // Java JavaScriptStepPanel.checkProperties compiles the script and blocks only on
  // a compile error — a blank script compiles fine, so it is legal. We keep the
  // JS-parse check (mirrors the Rhino compile) but drop the required check.
  validate: (step) => {
    return tryParseJs(step.script);
  },

  // The raw script is what gets Rhino-validated server-side when the Core supports
  // it; the channel-wide async validator batches these instead of running `validate` (acorn).
  getScript: (step) => step.script,

  EditorPanel: JavaScriptStepEditor,
};
