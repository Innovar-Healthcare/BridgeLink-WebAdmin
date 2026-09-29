"use client";

/**
 * Transmission-mode dialog binding for runtime plugin manifests.
 *
 * `createRuntimeTransmissionModeSection(mode, entry)` builds the component the
 * loader registers as the compiled mode's SettingsSection — the declared
 * fields rendered below the dialog's shared SOM/EOM rows, bound to the
 * settings draft's `extra` bag. Rendered for every runtime mode (even one
 * with no fields) so the "Provided by <extension>" attribution always shows —
 * a third-party dialog section can never impersonate a built-in mode.
 */

import type { FunctionComponent } from "react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { evaluateCondition } from "@/lib/runtime-plugins/condition-eval";
import type { TransmissionModeContribution } from "@/lib/runtime-plugins/manifest-types";
import type { TransmissionModeSectionProps } from "@/app/(app)/channels/_connectors/shared/transmission-modes/types";
import { SchemaField } from "./schema-field";

/**
 * Stable, module-level render body. The `mode`/`entry` the factory closes over
 * are passed as props here so the component identity never changes — which lets
 * the Manifest Preview page render it directly (calling the factory during
 * render would mint a new component type each render, tripping the React
 * Compiler `react-hooks/static-components` rule). The factory below wraps it for
 * the loader's registry contract, where it's instantiated once at registration.
 */
export function RuntimeTransmissionModeSectionImpl({
  mode,
  entry,
  settings,
  onChange,
  invalidFields,
}: TransmissionModeSectionProps & {
  mode: TransmissionModeContribution;
  entry: { name: string };
}) {
  const fields = mode.fields ?? [];
  const { viewDensity } = useCompactMode();
  // Values for rendering AND condition evaluation: the draft's extra bag,
  // falling back to the declared defaults (a fresh mode switch seeds them,
  // but a hand-edited XML may omit elements).
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.key] = settings.extra[field.key] ?? field.defaultValue ?? "";
  }

  return (
    <div className="pt-1.5">
      <p className="text-xs text-muted-foreground mb-1">Provided by {entry.name}</p>
      {fields
        .filter((field) => !field.visibleWhen || evaluateCondition(field.visibleWhen, values))
        .map((field) => (
          <SchemaField
            key={field.key}
            field={field}
            value={values[field.key] ?? ""}
            onChange={(value) => onChange({ extra: { ...settings.extra, [field.key]: value } })}
            disabled={field.enabledWhen ? !evaluateCondition(field.enabledWhen, values) : false}
            invalid={invalidFields.has(field.key)}
            density={viewDensity}
          />
        ))}
    </div>
  );
}

export function createRuntimeTransmissionModeSection(
  mode: TransmissionModeContribution,
  entry: { name: string }
): FunctionComponent<TransmissionModeSectionProps> {
  function RuntimeTransmissionModeSection(props: TransmissionModeSectionProps) {
    return <RuntimeTransmissionModeSectionImpl mode={mode} entry={entry} {...props} />;
  }
  RuntimeTransmissionModeSection.displayName = `RuntimeTransmissionModeSection(${mode.name})`;
  return RuntimeTransmissionModeSection;
}
