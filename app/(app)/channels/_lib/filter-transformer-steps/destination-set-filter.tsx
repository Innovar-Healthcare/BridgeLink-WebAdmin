/**
 * Built-in Destination Set Filter step definition.
 *
 * Mirrors the Java class
 * `com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep`.
 *
 * Only available in the source transformer — destination transformers and
 * response transformers cannot affect the destination set.
 */

import { DestinationSetFilterPanel } from "../../_components/filter-transformer/destination-set-filter-panel";
import type {
  DestinationSetFilterStep,
  DestBehavior,
  RuleCondition,
} from "../filter-transformer-xml";
import type { TransformerStepDefinition, TransformerStepEditorProps } from "./types";
import {
  childIntList,
  childStrings,
  childText,
  dropBlankValues,
  serializeIntListStr,
  serializeStringsStr,
  tcStr,
} from "../filter-transformer-xml-helpers";

function DestinationSetFilterStepEditor({
  step,
  onChange,
  destinations,
  showErrors,
}: TransformerStepEditorProps<DestinationSetFilterStep>) {
  return (
    <DestinationSetFilterPanel
      step={step}
      onChange={onChange}
      destinations={destinations ?? []}
      showErrors={showErrors}
    />
  );
}

export const DestinationSetFilterStepDefinition: TransformerStepDefinition<DestinationSetFilterStep> =
  {
    type: "Destination Set Filter",
    xmlTag: "com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep",
    contexts: ["source"],

    defaults: () => ({
      type: "Destination Set Filter",
      name: "",
      sequenceNumber: "0",
      enabled: true,
      behavior: "REMOVE",
      metaDataIds: [],
      field: "",
      condition: "EXISTS",
      values: [],
    }),

    parse: (el) => ({
      type: "Destination Set Filter",
      name: "",
      sequenceNumber: "0",
      enabled: true,
      behavior: childText(el, "behavior", "REMOVE") as DestBehavior,
      metaDataIds: childIntList(el, "metaDataIds"),
      field: childText(el, "field"),
      condition: childText(el, "condition", "EXISTS") as RuleCondition,
      values: childStrings(el, "values"),
    }),

    serialize: (step) =>
      tcStr("behavior", step.behavior) +
      serializeIntListStr("metaDataIds", step.metaDataIds) +
      tcStr("field", step.field) +
      tcStr("condition", step.condition) +
      // Drop blank value rows on serialize so they never persist — mirrors Java
      // DestinationSetFilterPanel.getValues() (Rule Builder already does this).
      serializeStringsStr("values", dropBlankValues(step.values)),

    emitScript: (step) => {
      // Drop blank value rows before generating clauses — mirrors Java
      // DestinationSetFilterPanel.getValues(), so a blank value never emits a
      // dangling `field == ` / `field.indexOf() ` clause (a deploy-time syntax error).
      const values = dropBlankValues(step.values);
      let s = "if (";
      if (step.condition === "EXISTS") {
        s += `getArrayOrXmlLength(${step.field}) > 0) `;
      } else if (step.condition === "NOT_EXIST") {
        s += `getArrayOrXmlLength(${step.field}) == 0) `;
      } else if (step.condition === "CONTAINS" || step.condition === "NOT_CONTAIN") {
        const eq = step.condition === "CONTAINS" ? "!=" : "==";
        const op = step.condition === "CONTAINS" ? "||" : "&&";
        if (values.length > 0) {
          for (let i = 0; i < values.length; i++) {
            s += `(${step.field}.indexOf(${values[i]}) ${eq} -1)`;
            s += i + 1 === values.length ? ") " : ` ${op} `;
          }
        } else {
          s += `${step.field}.indexOf("") ${eq} -1) `;
        }
      } else {
        const eq = step.condition === "EQUALS" ? "==" : "!=";
        const op = step.condition === "EQUALS" ? "||" : "&&";
        if (values.length > 0) {
          for (let i = 0; i < values.length; i++) {
            s += `${step.field} ${eq} ${values[i]}`;
            s += i + 1 === values.length ? ") " : ` ${op} `;
          }
        } else {
          s += `${step.field} ${eq} "") `;
        }
      }

      s += "{\n\tdestinationSet.";
      // Java Behavior enum: REMOVE, REMOVE_ALL_EXCEPT, REMOVE_ALL
      const behavior = step.behavior;
      if (behavior === "REMOVE") {
        s += "remove";
      } else if (behavior === "REMOVE_ALL_EXCEPT") {
        s += "removeAllExcept";
      } else {
        s += "removeAll";
      }
      s += "(";
      if (behavior !== "REMOVE_ALL") {
        s += `[${step.metaDataIds.join(", ")}]`;
      }
      s += ");\n}\n";
      return s;
    },

    // Java DestinationSetFilterPanel.checkProperties requires only `field`. A blank
    // value is legal (blank rows are dropped at serialize/script time), so we do NOT
    // require a value for EQUALS/CONTAINS conditions.
    validate: (step) => {
      if (!step.field?.trim()) return "Field cannot be empty.";
      return null;
    },

    EditorPanel: DestinationSetFilterStepEditor,
  };
