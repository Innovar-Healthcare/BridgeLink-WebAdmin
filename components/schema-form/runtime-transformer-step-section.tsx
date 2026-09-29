"use client";

/**
 * Detail-pane editor for a runtime-contributed transformer step.
 *
 * `createRuntimeTransformerStepEditor(contribution, entry)` builds the
 * EditorPanel the loader attaches to the compiled TransformerStepDefinition.
 * It renders the step's declared fields with the host's own SchemaField
 * primitives (the same renderer connector panels / data types use), binding
 * each field to the step's flat `values` bag. Rendered with a mandatory
 * "Provided by <extension>" attribution so a runtime step can never
 * impersonate a built-in.
 *
 * "javascript" fields reuse the data-type section's exported ScriptField — the
 * one lazy ScriptEditorDialog entry point — so Monaco/acorn stay out of the
 * boot-path loader graph (loader.ts statically imports this factory). The
 * script VALUE is user-authored channel data executed by the engine at message
 * time; WebAdmin only edits text, and no code travels in the manifest.
 */

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { validateFieldValues } from "@/lib/runtime-plugins/compile-validate";
import { evaluateCondition } from "@/lib/runtime-plugins/condition-eval";
import {
  COLLECTION_FIELD_TYPES,
  type TransformerStepContribution,
} from "@/lib/runtime-plugins/manifest-types";
import type { RuntimeTransformerStep } from "@/lib/runtime-plugins/compile-transformer-step";
import type {
  TransformerStepEditorProps,
  TransformerStepDefinition,
} from "@/app/(app)/channels/_lib/filter-transformer-steps/types";
import { SchemaField } from "./schema-field";
import { SchemaCollectionField } from "./schema-collection-field";
import { ScriptField } from "./runtime-data-type-section";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

/**
 * Stable, module-level render body. The `contribution`/`entry` the factory
 * closes over are passed as props so the component identity never changes —
 * which lets the Manifest Preview page render it directly (calling the factory
 * during render would mint a new component type each render, tripping the React
 * Compiler `react-hooks/static-components` rule). The factory below wraps it for
 * the loader's registry contract, where it's instantiated once at registration.
 */
export function RuntimeTransformerStepEditorImpl({
  contribution,
  entry,
  step,
  onChange,
  showErrors,
  contextType,
  channelId,
}: TransformerStepEditorProps<RuntimeTransformerStep> & {
  contribution: TransformerStepContribution;
  entry: { name: string };
}) {
  const fields = contribution.fields ?? [];
  const { viewDensity } = useCompactMode();
  const values = step.values;
  const invalidFields = new Set(validateFieldValues(fields, values).map((e) => e.field));

  return (
    <div className="p-4 space-y-3 text-xs">
      <p className="text-xs text-muted-foreground">Provided by {entry.name}</p>
      {fields
        .filter((field) => !field.visibleWhen || evaluateCondition(field.visibleWhen, values))
        .map((field) => {
          // Defensive against hand-edited XML that omits a declared child.
          const value = values[field.key] ?? field.defaultValue ?? "";
          const setValue = (next: string) =>
            onChange({ ...step, values: { ...step.values, [field.key]: next } });
          const disabled = field.enabledWhen
            ? !evaluateCondition(field.enabledWhen, values)
            : false;
          // Highlight only under showErrors — the host sets it on save attempt,
          // matching the built-in step panels (not the always-on data dialog).
          const invalid = !!showErrors && invalidFields.has(field.key);
          if (COLLECTION_TYPES.has(field.type)) {
            // Collections live in the step's `collections` store (rows, not a
            // string); no variableToggle in steps (validator-forbidden).
            return (
              <SchemaCollectionField
                key={field.key}
                field={field}
                value={step.collections?.[field.key] ?? []}
                onChange={(rows) =>
                  onChange({
                    ...step,
                    collections: { ...step.collections, [field.key]: rows },
                  })
                }
                useVariable={false}
                variableValue=""
                onUseVariableChange={() => {}}
                onVariableValueChange={() => {}}
                disabled={disabled}
                density={viewDensity}
              />
            );
          }
          return field.type === "javascript" ? (
            <ScriptField
              key={field.key}
              field={field}
              value={value}
              onChange={setValue}
              disabled={disabled}
              invalid={invalid}
              channelId={channelId}
              contextType={contextType}
              description="Edit the JavaScript for this transformer step field."
            />
          ) : (
            <SchemaField
              key={field.key}
              field={field}
              value={value}
              onChange={setValue}
              disabled={disabled}
              invalid={invalid}
              density={viewDensity}
            />
          );
        })}
    </div>
  );
}

export function createRuntimeTransformerStepEditor(
  contribution: TransformerStepContribution,
  entry: { name: string }
): TransformerStepDefinition<RuntimeTransformerStep>["EditorPanel"] {
  function RuntimeTransformerStepEditor(props: TransformerStepEditorProps<RuntimeTransformerStep>) {
    return (
      <RuntimeTransformerStepEditorImpl contribution={contribution} entry={entry} {...props} />
    );
  }
  RuntimeTransformerStepEditor.displayName = `RuntimeTransformerStepEditor(${contribution.name})`;
  return RuntimeTransformerStepEditor;
}
