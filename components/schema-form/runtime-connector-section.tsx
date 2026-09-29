"use client";

/**
 * Connector-panel binding for runtime plugin manifests,.
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
 * does not model are preserved verbatim. Scalar fields (and a collection's
 * variable-toggle companion elements) bind through xml-field-binding.ts;
 * collection fields (map/multimap/stringList/table, v3) bind through
 * xml-collection-binding.ts. Writes go through `onChange({ propertiesXml })`
 * on every change, exactly like the hand-written connectors, so the XML tab,
 * dirty tracking, and save path stay in sync.
 */

import { useMemo } from "react";
import type { FunctionComponent } from "react";
import {
  parsePropertiesDoc,
  readFieldValues,
  writeFieldValue,
} from "@/lib/runtime-plugins/xml-field-binding";
import {
  readMapRows,
  readMultimapRows,
  readStringListItems,
  readTableRows,
  writeMapRows,
  writeMultimapRows,
  writeStringListItems,
  writeTableRows,
  type CollectionMapRow,
  type CollectionTableRow,
} from "@/lib/runtime-plugins/xml-collection-binding";
import {
  COLLECTION_FIELD_TYPES,
  type ConnectorPanelContribution,
  type FieldDescriptor,
} from "@/lib/runtime-plugins/manifest-types";
import { SchemaFormSection } from "./schema-form-section";
import type { CollectionFieldValue } from "./schema-collection-field";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

export interface RuntimeConnectorSectionProps {
  propertiesXml: string | null;
  onChange: (updates: { propertiesXml?: string | null }) => void;
  invalidFields?: Set<string>;
}

export function createRuntimeConnectorSection(
  panel: ConnectorPanelContribution,
  entry: { name: string }
): FunctionComponent<RuntimeConnectorSectionProps> {
  const allFields = panel.sections.flatMap((section) => section.fields);
  const collectionFields = allFields.filter((f) => COLLECTION_TYPES.has(f.type));
  const collectionByKey = new Map<string, FieldDescriptor>(collectionFields.map((f) => [f.key, f]));
  // Scalar keys read into the value bag: every non-collection field plus each
  // collection's variable-toggle companion elements (ordinary scalar elements).
  const scalarKeys = [
    ...allFields.filter((f) => !COLLECTION_TYPES.has(f.type)).map((f) => f.key),
    ...collectionFields.flatMap((f) =>
      f.variableToggle ? [f.variableToggle.variableKey, f.variableToggle.useVariableKey] : []
    ),
  ];

  function readCollections(xml: string | null): Record<string, CollectionFieldValue> {
    const out: Record<string, CollectionFieldValue> = {};
    for (const f of collectionFields) {
      const columns = (f.columns ?? []).map((c) => c.element);
      switch (f.type) {
        case "map":
          out[f.key] = readMapRows(xml, f.key);
          break;
        case "multimap":
          out[f.key] = readMultimapRows(xml, f.key);
          break;
        case "stringList":
          out[f.key] = readStringListItems(xml, f.key);
          break;
        case "table":
          out[f.key] = readTableRows(xml, f.key, columns);
          break;
      }
    }
    return out;
  }

  function writeCollection(xml: string, key: string, value: CollectionFieldValue): string {
    const f = collectionByKey.get(key);
    if (!f) return xml;
    switch (f.type) {
      case "map":
        return writeMapRows(xml, key, value as CollectionMapRow[]);
      case "multimap":
        return writeMultimapRows(xml, key, value as CollectionMapRow[]);
      case "stringList":
        return writeStringListItems(xml, key, value as string[]);
      case "table":
        return writeTableRows(
          xml,
          key,
          f.rowElement ?? "",
          (f.columns ?? []).map((c) => c.element),
          value as CollectionTableRow[]
        );
      default:
        return xml;
    }
  }

  function RuntimeConnectorSection({
    propertiesXml,
    onChange,
    invalidFields,
  }: RuntimeConnectorSectionProps) {
    const values = useMemo(() => readFieldValues(propertiesXml, scalarKeys), [propertiesXml]);
    const collectionValues = useMemo(() => readCollections(propertiesXml), [propertiesXml]);
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
        collectionValues={collectionValues}
        onCollectionChange={(key, value) => {
          if (!propertiesXml) return;
          onChange({ propertiesXml: writeCollection(propertiesXml, key, value) });
        }}
        invalidFields={invalidFields}
        attribution={entry.name}
      />
    );
  }
  RuntimeConnectorSection.displayName = `RuntimeConnectorSection(${panel.transportName})`;
  return RuntimeConnectorSection;
}
