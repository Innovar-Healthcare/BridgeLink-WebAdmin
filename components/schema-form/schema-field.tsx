"use client";

/**
 * One schema-declared form field.
 *
 * Renders a runtime plugin manifest FieldDescriptor with the host's own form
 * primitives, keyed by field type. The value model is strings throughout —
 * checkboxes read/write the literal "true"/"false" (XStream boolean text).
 * Every string from the manifest renders as a plain text node.
 */

import { cn } from "@/lib/utils";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import { FieldRow, FullWidthField, RadioField } from "@/components/settings/settings-section";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { SecretInput } from "@/components/ui/secret-input";
import {
  inputCls,
  inputErrorCls,
  selectCls,
  selectErrorCls,
} from "@/app/(app)/channels/_connectors/shared/styles";
import type { FieldDescriptor } from "@/lib/runtime-plugins/manifest-types";

export interface SchemaFieldProps {
  field: FieldDescriptor;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  density?: ViewDensity;
}

export function SchemaField({
  field,
  value,
  onChange,
  disabled = false,
  invalid = false,
  density,
}: SchemaFieldProps) {
  switch (field.type) {
    case "checkbox":
      // Empty row label keeps the checkbox aligned with the control column.
      return (
        <FieldRow label="" tooltip={field.tooltip}>
          <FormCheckbox
            label={field.label}
            checked={value === "true"}
            onChange={(checked) => onChange(checked ? "true" : "false")}
            disabled={disabled}
            density={density}
          />
        </FieldRow>
      );

    case "radio":
      return (
        <RadioField
          label={field.label}
          name={`rt-field-${field.key}`}
          value={value}
          onChange={onChange}
          options={field.options ?? []}
          disabled={disabled}
          tooltip={field.tooltip}
        />
      );

    case "select":
      return (
        <FieldRow label={field.label} tooltip={field.tooltip}>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={field.label}
            className={cn(selectCls(density), "min-w-44", invalid && selectErrorCls)}
          >
            {/* The stored value may predate the manifest's option list (or the
                engine default may not be listed) — surface it instead of
                silently snapping to the first option. */}
            {!field.options?.some((opt) => opt.value === value) && (
              <option value={value}>{value}</option>
            )}
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FieldRow>
      );

    case "textarea":
      return (
        <FullWidthField label={field.label} tooltip={field.tooltip}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={field.placeholder}
            aria-label={field.label}
            rows={4}
            className={cn(
              inputCls(density),
              "w-full h-auto py-1.5 resize-y font-mono text-xs",
              invalid && inputErrorCls
            )}
          />
        </FullWidthField>
      );

    case "secret":
      return (
        <FieldRow label={field.label} tooltip={field.tooltip}>
          <SecretInput
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={field.placeholder}
            aria-label={field.label}
            revealable
            density={density}
            className={cn("w-72", invalid && inputErrorCls)}
          />
        </FieldRow>
      );

    case "number":
    case "text":
      return (
        <FieldRow label={field.label} tooltip={field.tooltip}>
          <input
            type="text"
            inputMode={field.type === "number" ? "numeric" : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={field.placeholder}
            aria-label={field.label}
            className={cn(
              inputCls(density),
              field.type === "number" ? "w-36" : "w-72",
              invalid && inputErrorCls
            )}
          />
        </FieldRow>
      );
  }
}
