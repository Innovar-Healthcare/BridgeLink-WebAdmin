"use client";

/**
 * Generic schema-driven form renderer for runtime plugin panels.
 *
 * Renders a validated manifest panel (sections of fields plus optional action
 * buttons) with the host's own form primitives, so runtime plugin UI is
 * automatically on-theme, dark-mode-correct, and density-aware. Controlled:
 * the caller owns the values (an all-strings record) and receives per-field
 * changes.
 *
 * Security posture (docs/WEBADMIN-PLUGIN-CONTRACT.md):
 *  - Every manifest string renders as a plain React text node.
 *  - The "Provided by <extension>" attribution is rendered HERE, so it is
 *    structurally impossible to mount a declared panel without it — a
 *    third-party form can never impersonate built-in settings.
 *  - visibleWhen === false means the field is NOT rendered and its XML
 *    element / property entry is never touched — round-trip safe by
 *    construction.
 */

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { SettingsSection } from "@/components/settings/settings-section";
import { evaluateCondition } from "@/lib/runtime-plugins/condition-eval";
import type { ActionButton, PanelSection } from "@/lib/runtime-plugins/manifest-types";
import { SchemaActionButton } from "./schema-action-button";
import { SchemaField } from "./schema-field";

export interface SchemaFormSectionProps {
  sections: PanelSection[];
  actions?: ActionButton[];
  /** Current field values by key; a missing key reads as "". */
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /** Field keys that failed validation (save-time or Validate button). */
  invalidFields?: Set<string>;
  /** Contributing extension name — rendered as the panel attribution. */
  attribution: string;
  /** Disable every control (e.g. while saving). */
  disabled?: boolean;
}

export function SchemaFormSection({
  sections,
  actions,
  values,
  onValueChange,
  invalidFields,
  attribution,
  disabled = false,
}: SchemaFormSectionProps) {
  const { viewDensity } = useCompactMode();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Provided by {attribution}</p>
      {/* Sections/actions are keyed by index: their titles/labels are
          manifest-controlled strings the validator does not dedupe. */}
      {sections.map((section, sectionIndex) => {
        const visibleFields = section.fields.filter(
          (field) => !field.visibleWhen || evaluateCondition(field.visibleWhen, values)
        );
        if (visibleFields.length === 0) return null;
        return (
          <SettingsSection key={sectionIndex} title={section.title}>
            {visibleFields.map((field) => (
              <SchemaField
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={(value) => onValueChange(field.key, value)}
                disabled={
                  disabled ||
                  (field.enabledWhen ? !evaluateCondition(field.enabledWhen, values) : false)
                }
                invalid={invalidFields?.has(field.key) ?? false}
                density={viewDensity}
              />
            ))}
          </SettingsSection>
        );
      })}
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-2">
          {actions.map((action, actionIndex) => (
            <SchemaActionButton key={actionIndex} action={action} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  );
}
