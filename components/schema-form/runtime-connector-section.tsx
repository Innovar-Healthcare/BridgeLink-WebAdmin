"use client";

/**
 * Connector-panel binding for runtime plugin manifests.
 *
 * `createRuntimeConnectorSection(panel, entry)` builds the component the
 * loader registers as the declared connector's BottomSection. It satisfies
 * both the source and destination section contracts structurally — it only
 * uses `propertiesXml`, `onChange`, and `invalidFields`.
 *
 * Binding model (the load-bearing round-trip rule): field values are read
 * from and written to DIRECT CHILD ELEMENTS of the connector's raw
 * `<properties>` XML string, one surgical DOM edit per change, re-serializing
 * the whole document — sibling elements, attributes, and order the schema
 * does not model are preserved verbatim (lib/runtime-plugins/xml-field-binding.ts).
 * Writes go through `onChange({ propertiesXml })` on every change, exactly
 * like the hand-written connectors, so the XML tab, dirty tracking, and save
 * path stay in sync.
 */

import { useMemo } from "react";
import type { FunctionComponent } from "react";
import {
  parsePropertiesDoc,
  readFieldValues,
  writeFieldValue,
} from "@/lib/runtime-plugins/xml-field-binding";
import type { ConnectorPanelContribution } from "@/lib/runtime-plugins/manifest-types";
import { SchemaFormSection } from "./schema-form-section";

/**
 * Structural subset of ConnectorSectionProps / DestinationConnectorSectionProps
 * — a component typed on this subset is assignable to both section contracts.
 */
export interface RuntimeConnectorSectionProps {
  propertiesXml: string | null;
  // The update type is deliberately optional/nullable so this signature is a
  // contravariant match for both hosts' `(updates: Partial<...State>) => void`
  // onChange props; the component itself only ever sends a string.
  onChange: (updates: { propertiesXml?: string | null }) => void;
  invalidFields?: Set<string>;
}

// Returned as a FunctionComponent (not ComponentType): the class-component
// half of ComponentType is covariant in props, which would reject this
// narrower-props component; the function half is contravariant and accepts it
// for both the source and destination section contracts.
export function createRuntimeConnectorSection(
  panel: ConnectorPanelContribution,
  entry: { name: string }
): FunctionComponent<RuntimeConnectorSectionProps> {
  const fieldKeys = panel.sections.flatMap((section) => section.fields.map((f) => f.key));

  function RuntimeConnectorSection({
    propertiesXml,
    onChange,
    invalidFields,
  }: RuntimeConnectorSectionProps) {
    const values = useMemo(() => readFieldValues(propertiesXml, fieldKeys), [propertiesXml]);
    const unparseable = useMemo(
      () => propertiesXml !== null && parsePropertiesDoc(propertiesXml) === null,
      [propertiesXml]
    );

    // Fail soft, never crash the editor: leave broken XML alone and say so.
    if (unparseable) {
      return (
        <p className="text-sm text-muted-foreground">
          The connector properties XML could not be parsed, so the {panel.transportName} settings
          form is unavailable. The stored XML has been left untouched.
        </p>
      );
    }

    return (
      <SchemaFormSection
        sections={panel.sections}
        actions={panel.actions}
        values={values}
        onValueChange={(key, value) => {
          // No properties yet means nothing to bind into — the editor always
          // seeds defaultPropertiesXml on type switch, so this is a guard, not
          // a path.
          if (!propertiesXml) return;
          onChange({ propertiesXml: writeFieldValue(propertiesXml, key, value) });
        }}
        invalidFields={invalidFields}
        attribution={entry.name}
      />
    );
  }
  RuntimeConnectorSection.displayName = `RuntimeConnectorSection(${panel.transportName})`;
  return RuntimeConnectorSection;
}
