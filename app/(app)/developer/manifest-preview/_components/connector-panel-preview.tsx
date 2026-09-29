"use client";

/**
 * Right-pane preview for one connector panel Slice 3).
 *
 * This deliberately does NOT call `createRuntimeConnectorSection` — that
 * factory returns a component typed to exactly `{propertiesXml, onChange,
 * invalidFields}` so it structurally matches the real
 * ConnectorSectionProps/DestinationConnectorSectionProps contracts used at
 * registration time (see components/schema-form/runtime-connector-section.tsx).
 * It has no room for an `actionsDisabled` prop, and it must not gain one —
 * that would widen the registered component's props beyond what the real
 * host contracts allow. Instead this component reimplements the same thin
 * binding (readFieldValues/writeFieldValue -> SchemaFormSection) directly, so
 * it can pass `actionsDisabled` through. Do not "simplify" this back to
 * `createRuntimeConnectorSection` — that would silently re-enable action
 * buttons that call real (non-existent) extension endpoints.
 */

import { useMemo, useState } from "react";
import { SchemaFormSection } from "@/components/schema-form/schema-form-section";
import { ValidateBar } from "./validate-bar";
import { LiveXmlDisclosure } from "./live-xml-disclosure";
import type { CollectionFieldValue } from "@/components/schema-form/schema-collection-field";
import { compileConnectorValidator } from "@/lib/runtime-plugins/compile-validate";
import {
  parsePropertiesDoc,
  readFieldValues,
  writeFieldValue,
} from "@/lib/runtime-plugins/xml-field-binding";
import {
  collectionSpec,
  readCollectionFrom,
  writeCollectionInto,
} from "@/lib/runtime-plugins/xml-collection-binding";
import {
  COLLECTION_FIELD_TYPES,
  type ConnectorPanelContribution,
  type FieldDescriptor,
} from "@/lib/runtime-plugins/manifest-types";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

export function ConnectorPanelPreview({
  panel,
  attribution,
  propertiesXml,
  onPropertiesXmlChange,
}: {
  panel: ConnectorPanelContribution;
  attribution: string;
  propertiesXml: string;
  onPropertiesXmlChange: (xml: string) => void;
}) {
  const allFields = useMemo(() => panel.sections.flatMap((section) => section.fields), [panel]);
  const collectionFields = useMemo(
    () => allFields.filter((f) => COLLECTION_TYPES.has(f.type)),
    [allFields]
  );
  // Scalar bag = non-collection fields + each collection's variableToggle
  // companion elements (ordinary scalar elements).
  const scalarKeys = useMemo(
    () => [
      ...allFields.filter((f) => !COLLECTION_TYPES.has(f.type)).map((f) => f.key),
      ...collectionFields.flatMap((f) =>
        f.variableToggle ? [f.variableToggle.variableKey, f.variableToggle.useVariableKey] : []
      ),
    ],
    [allFields, collectionFields]
  );
  const validator = useMemo(() => compileConnectorValidator(panel), [panel]);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<{ field: string; message: string }[] | null>(null);

  const { values, collectionValues, unparseable } = useMemo(() => {
    const root = parsePropertiesDoc(propertiesXml)?.documentElement ?? null;
    const cols: Record<string, CollectionFieldValue> = {};
    for (const field of collectionFields) {
      cols[field.key] = readCollectionFrom(root, collectionSpec(field));
    }
    return {
      unparseable: parsePropertiesDoc(propertiesXml) === null,
      values: readFieldValues(propertiesXml, scalarKeys),
      collectionValues: cols,
    };
  }, [propertiesXml, scalarKeys, collectionFields]);

  function writeCollection(field: FieldDescriptor, rows: CollectionFieldValue): string {
    const doc = parsePropertiesDoc(propertiesXml);
    if (!doc) return propertiesXml;
    writeCollectionInto(doc.documentElement, collectionSpec(field), rows, doc);
    return new XMLSerializer().serializeToString(doc);
  }

  function handleValidate() {
    const result = validator(propertiesXml);
    setErrors(result);
    setInvalidFields(new Set(result.map((e) => e.field)));
  }

  return (
    <div className="space-y-3">
      {unparseable ? (
        <p className="text-sm text-muted-foreground">
          The Defaults XML for {panel.transportName} could not be parsed, so the form is
          unavailable. Fix the XML in the “Defaults XML — {panel.transportName}” tab.
        </p>
      ) : (
        <SchemaFormSection
          sections={panel.sections}
          actions={panel.actions}
          values={values}
          onValueChange={(key, value) => {
            onPropertiesXmlChange(writeFieldValue(propertiesXml, key, value));
            // Clear stale validation so highlights don't lie while the user fixes fields.
            setErrors(null);
            setInvalidFields(new Set());
          }}
          collectionValues={collectionValues}
          onCollectionChange={(key, rows) => {
            const field = collectionFields.find((f) => f.key === key);
            if (field) onPropertiesXmlChange(writeCollection(field, rows));
          }}
          invalidFields={invalidFields}
          attribution={attribution}
          actionsDisabled
        />
      )}

      <ValidateBar onValidate={handleValidate} errors={errors} />

      <LiveXmlDisclosure
        xml={propertiesXml}
        path={`webadmin-preview-roundtrip-${panel.transportName}.xml`}
      />
    </div>
  );
}
