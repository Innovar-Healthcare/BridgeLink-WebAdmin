/**
 * Compiles a runtime panel's declarative validation rules into the host's
 * existing validation contracts.
 *
 *  - Connector panels → `validate(propertiesXml): ValidationError[]` — the
 *    ConnectorDefinition contract, so save-time validation and invalid-field
 *    highlighting work unmodified (field keys ARE the XML element names).
 *  - Settings panels → `validate(record): string | null` — the
 *    usePluginSettings contract (first failure message, or null).
 *
 * Rule semantics:
 *  - Rules on a field whose `visibleWhen` evaluates false are skipped — a
 *    hidden required field must never block save.
 *  - `required` fails on empty/whitespace-only values.
 *  - `pattern` / `min` / `max` apply only to non-empty values (`required`
 *    owns emptiness).
 *  - `pattern` runs through boundedRegexTest; an over-length input FAILS
 *    CLOSED with a "too long to validate" error rather than running the
 *    regex (ReDoS containment).
 */

import type { ValidationError } from "@/app/(app)/channels/_connectors/shared/validate-utils";
import { evaluateCondition } from "./condition-eval";
import { boundedRegexTest } from "./safe-regex";
import { readFieldValues } from "./xml-field-binding";
import type {
  ConnectorPanelContribution,
  FieldDescriptor,
  SettingsPanelContribution,
} from "./manifest-types";

function panelFields(
  panel: ConnectorPanelContribution | SettingsPanelContribution
): FieldDescriptor[] {
  return panel.sections.flatMap((section) => section.fields);
}

/** Runs every applicable rule of every visible field against `values`. */
export function validateFieldValues(
  fields: readonly FieldDescriptor[],
  values: Record<string, string>
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of fields) {
    if (!field.validation || field.validation.length === 0) continue;
    if (field.visibleWhen && !evaluateCondition(field.visibleWhen, values)) continue;
    const value = values[field.key] ?? "";
    for (const rule of field.validation) {
      const message = applyRule(field, rule, value);
      if (message) errors.push({ field: field.key, message });
    }
  }
  return errors;
}

function applyRule(
  field: FieldDescriptor,
  rule: NonNullable<FieldDescriptor["validation"]>[number],
  value: string
): string | null {
  if (rule.rule === "required") {
    return value.trim() === "" ? (rule.message ?? `${field.label} is required.`) : null;
  }
  // The remaining rules only constrain non-empty values.
  if (value === "") return null;
  switch (rule.rule) {
    case "pattern": {
      const result = boundedRegexTest(rule.pattern, value);
      if (result === "match") return null;
      if (result === "too-long") return `${field.label} is too long to validate.`;
      if (result === "invalid") return `${field.label} has an invalid validation pattern.`;
      return rule.message ?? `${field.label} does not match the required format.`;
    }
    case "min": {
      const num = Number(value);
      if (!Number.isFinite(num)) return rule.message ?? `${field.label} must be a number.`;
      return num < rule.value
        ? (rule.message ?? `${field.label} must be at least ${rule.value}.`)
        : null;
    }
    case "max": {
      const num = Number(value);
      if (!Number.isFinite(num)) return rule.message ?? `${field.label} must be a number.`;
      return num > rule.value
        ? (rule.message ?? `${field.label} must be at most ${rule.value}.`)
        : null;
    }
  }
}

/**
 * Builds the ConnectorDefinition `validate` function for a declared connector
 * panel. Missing/unparseable properties XML reads all values as "" (so
 * `required` fields report normally).
 */
export function compileConnectorValidator(
  panel: ConnectorPanelContribution
): (propertiesXml: string | null) => ValidationError[] {
  const fields = panelFields(panel);
  const keys = fields.map((f) => f.key);
  return (propertiesXml) => validateFieldValues(fields, readFieldValues(propertiesXml, keys));
}

/**
 * Builds the usePluginSettings `validate` function for a declared settings
 * panel: the first failure message, or null when valid.
 */
export function compileSettingsValidator(
  panel: SettingsPanelContribution
): (record: Record<string, string>) => string | null {
  const fields = panelFields(panel);
  return (record) => validateFieldValues(fields, record)[0]?.message ?? null;
}
