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

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { SettingsSection } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { evaluateCondition } from "@/lib/runtime-plugins/condition-eval";
import {
  COLLECTION_FIELD_TYPES,
  type ActionButton,
  type PanelSection,
} from "@/lib/runtime-plugins/manifest-types";
import { SchemaActionButton } from "./schema-action-button";
import { SchemaField } from "./schema-field";
import { SchemaCollectionField, type CollectionFieldValue } from "./schema-collection-field";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

/**
 * A `presentation: "dialog"` section: the fields live behind an Advanced button
 * in a modal (the FTP/SFTP/S3-advanced pattern). Edits apply live (each control
 * calls onChange as the user types), so the dialog just needs a Close affordance
 * — no separate commit. The section's fields render identically to the inline
 * path (same `children`).
 */
function DialogPanelSection({
  title,
  invalidCount = 0,
  children,
}: {
  title: string;
  /** Count of invalid fields inside the dialog — surfaced as a badge on the trigger. */
  invalidCount?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title={title}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={
              invalidCount > 0
                ? `Configure ${title} — ${invalidCount} invalid ${invalidCount === 1 ? "field" : "fields"}`
                : undefined
            }
            className="inline-flex items-center gap-1.5 rounded border border-input bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Configure {title}…
            {invalidCount > 0 && (
              <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">
                {invalidCount}
              </span>
            )}
          </button>
        </DialogTrigger>
        {/* No DialogDescription: the section title is self-describing.
            aria-describedby={undefined} opts out of Radix's description warning. */}
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">{children}</div>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

export interface SchemaFormSectionProps {
  sections: PanelSection[];
  actions?: ActionButton[];
  /** Current field values by key; a missing key reads as "". */
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /**
   * v3 collection field rows by key (map/multimap/stringList/table). Bound by the
   * kind wrapper directly to the properties XML — not carried in the scalar
   * `values` bag. Required whenever a section declares a collection field.
   */
  collectionValues?: Record<string, CollectionFieldValue>;
  onCollectionChange?: (key: string, value: CollectionFieldValue) => void;
  /** Field keys that failed validation (save-time or Validate button). */
  invalidFields?: Set<string>;
  /** Contributing extension name — rendered as the panel attribution. */
  attribution: string;
  /** Disable every control (e.g. while saving). */
  disabled?: boolean;
  /**
   * Disable only the action buttons, leaving fields interactive — for hosts
   * that render a panel without a live extension backing its endpoints (e.g.
   * the Manifest Preview page).
   */
  actionsDisabled?: boolean;
}

export function SchemaFormSection({
  sections,
  actions,
  values,
  onValueChange,
  collectionValues,
  onCollectionChange,
  invalidFields,
  attribution,
  disabled = false,
  actionsDisabled = false,
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
        const isDialog = section.presentation === "dialog";
        // Inline sections with nothing visible collapse away; a dialog section
        // keeps its trigger so an open dialog whose last field just hid (via
        // visibleWhen) doesn't abruptly unmount and lose its state.
        if (visibleFields.length === 0 && !isDialog) return null;

        const invalidCount = visibleFields.filter((f) => invalidFields?.has(f.key)).length;

        const renderField = (field: (typeof visibleFields)[number]) => {
          const fieldDisabled =
            disabled || (field.enabledWhen ? !evaluateCondition(field.enabledWhen, values) : false);
          if (COLLECTION_TYPES.has(field.type)) {
            const toggle = field.variableToggle;
            return (
              <SchemaCollectionField
                key={field.key}
                field={field}
                value={collectionValues?.[field.key] ?? []}
                onChange={(value) => onCollectionChange?.(field.key, value)}
                useVariable={toggle ? values[toggle.useVariableKey] === "true" : false}
                variableValue={toggle ? (values[toggle.variableKey] ?? "") : ""}
                onUseVariableChange={(b) =>
                  toggle && onValueChange(toggle.useVariableKey, b ? "true" : "false")
                }
                onVariableValueChange={(v) => toggle && onValueChange(toggle.variableKey, v)}
                disabled={fieldDisabled}
                density={viewDensity}
              />
            );
          }
          return (
            <SchemaField
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(value) => onValueChange(field.key, value)}
              disabled={fieldDisabled}
              invalid={invalidFields?.has(field.key) ?? false}
              density={viewDensity}
            />
          );
        };

        const fieldNodes = visibleFields.map(renderField);
        return isDialog ? (
          <DialogPanelSection key={sectionIndex} title={section.title} invalidCount={invalidCount}>
            {fieldNodes.length > 0 ? (
              fieldNodes
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No settings apply with the current configuration.
              </p>
            )}
          </DialogPanelSection>
        ) : (
          <SettingsSection key={sectionIndex} title={section.title}>
            {fieldNodes}
          </SettingsSection>
        );
      })}
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-2">
          {actions.map((action, actionIndex) => (
            <HoverTooltip
              key={actionIndex}
              content={actionsDisabled ? "Disabled in preview" : null}
            >
              <span>
                <SchemaActionButton action={action} disabled={disabled || actionsDisabled} />
              </span>
            </HoverTooltip>
          ))}
        </div>
      )}
    </div>
  );
}
