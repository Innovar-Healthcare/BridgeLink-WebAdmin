/**
 * Built-in External Script step definition.
 *
 * Mirrors the Java class
 * `com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep`.
 */

import { ExternalScriptPanel } from "../../_components/filter-transformer/external-script-panel";
import type { ExternalScriptStep } from "../filter-transformer-xml";
import type { TransformerStepDefinition, TransformerStepEditorProps } from "./types";
import { childText, tcStr } from "../filter-transformer-xml-helpers";

function ExternalScriptStepEditor({
  step,
  onChange,
  showErrors,
}: TransformerStepEditorProps<ExternalScriptStep>) {
  return (
    <ExternalScriptPanel
      element={step}
      onChange={(el) => onChange(el as ExternalScriptStep)}
      showErrors={showErrors}
    />
  );
}

export const ExternalScriptStepDefinition: TransformerStepDefinition<ExternalScriptStep> = {
  type: "External Script",
  xmlTag: "com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "External Script",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    scriptPath: "",
  }),

  parse: (el) => ({
    type: "External Script",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    scriptPath: childText(el, "scriptPath"),
  }),

  serialize: (step) => tcStr("scriptPath", step.scriptPath),

  emitScript: (step) =>
    `// External script will be loaded on deploy\n// Path: ${step.scriptPath}\n`,

  validate: (step) => {
    if (!step.scriptPath?.trim()) return "Script path cannot be empty.";
    return null;
  },

  EditorPanel: ExternalScriptStepEditor,
};
