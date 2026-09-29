"use client";

/**
 * Right-pane preview for one settings panel Slice 3).
 *
 * Renders `SchemaFormSection` directly with local state, bypassing
 * `usePluginSettings` — this panel isn't backed by a real extension's
 * `/extensions/{name}/properties` endpoint. State is kept as user OVERRIDES
 * merged over the manifest's declared `defaultValue`s, so editing the manifest
 * (changing a default, adding a field) is reflected live while the user's own
 * edits are preserved. `validateFieldValues` (the same per-field engine
 * `compileSettingsValidator` is built on) gives per-field highlighting.
 */

import { useMemo, useState } from "react";
import { SchemaFormSection } from "@/components/schema-form/schema-form-section";
import { ValidateBar } from "./validate-bar";
import type { CollectionFieldValue } from "@/components/schema-form/schema-collection-field";
import { validateFieldValues } from "@/lib/runtime-plugins/compile-validate";
import { decodeCollectionJson, encodeCollectionJson } from "@/lib/runtime-plugins/collection-json";
import { collectionSpec } from "@/lib/runtime-plugins/xml-collection-binding";
import {
  COLLECTION_FIELD_TYPES,
  type SettingsPanelContribution,
} from "@/lib/runtime-plugins/manifest-types";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

function defaultsFrom(panel: SettingsPanelContribution): Record<string, string> {
  const values: Record<string, string> = {};
  for (const section of panel.sections) {
    for (const field of section.fields) {
      values[field.key] = field.defaultValue ?? "";
    }
  }
  return values;
}

export function SettingsPanelPreview({
  panel,
  attribution,
}: {
  panel: SettingsPanelContribution;
  attribution: string;
}) {
  const fields = useMemo(() => panel.sections.flatMap((s) => s.fields), [panel]);
  const collectionFields = useMemo(
    () => fields.filter((f) => COLLECTION_TYPES.has(f.type)),
    [fields]
  );
  // User edits layered over the manifest's declared defaults; recomputed when
  // the manifest changes so new/changed defaults show through immediately.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const values = useMemo(() => ({ ...defaultsFrom(panel), ...overrides }), [panel, overrides]);
  // Collection fields are stored as canonical JSON in the property value; decode
  // for the renderer, re-encode on change (same contract the settings tab uses).
  const collectionValues = useMemo(() => {
    const out: Record<string, CollectionFieldValue> = {};
    for (const field of collectionFields) {
      out[field.key] = decodeCollectionJson(collectionSpec(field), values[field.key] ?? "");
    }
    return out;
  }, [collectionFields, values]);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<{ field: string; message: string }[] | null>(null);

  function handleValidate() {
    const result = validateFieldValues(fields, values);
    setErrors(result);
    setInvalidFields(new Set(result.map((e) => e.field)));
  }

  return (
    <div className="space-y-3">
      <SchemaFormSection
        sections={panel.sections}
        actions={panel.actions}
        values={values}
        onValueChange={(key, value) => {
          setOverrides((prev) => ({ ...prev, [key]: value }));
          // Clear stale validation so highlights don't lie while the user fixes fields.
          setErrors(null);
          setInvalidFields(new Set());
        }}
        collectionValues={collectionValues}
        onCollectionChange={(key, rows) => {
          const field = collectionFields.find((f) => f.key === key);
          if (!field) return;
          setOverrides((prev) => ({
            ...prev,
            [key]: encodeCollectionJson(collectionSpec(field), rows),
          }));
          setErrors(null);
          setInvalidFields(new Set());
        }}
        invalidFields={invalidFields}
        attribution={attribution}
        actionsDisabled
      />
      <ValidateBar onValidate={handleValidate} errors={errors} />
    </div>
  );
}
