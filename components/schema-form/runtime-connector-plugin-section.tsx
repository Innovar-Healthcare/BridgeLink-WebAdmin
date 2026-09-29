"use client";

/**
 * Cross-connector section binding for runtime plugin manifests.
 *
 * `createRuntimeConnectorPluginSection(section, entry)` builds the component
 * the loader registers as a ConnectorPluginDefinition / DestinationPluginDefinition
 * `Section` — the section an extension injects into OTHER connectors' panels
 * (the declarative HTTP Auth / SSL pattern). Like RuntimeConnectorSection, it
 * satisfies both hosts' section contracts structurally by using only
 * `propertiesXml`, `onChange`, and `invalidFields`.
 *
 * Binding model (PLAN-RuntimeConnectorSections-BusinessLogic.md §6): the
 * section owns ONE element — its `propertiesClass` tag under the host
 * connector's `<pluginProperties>`. While that element is absent the form
 * shows the manifest defaults WITHOUT writing (a mount-time write would dirty
 * every channel on open); the first edit materializes the complete container
 * — every declared field, version attribute copied from the host — and every
 * write is a surgical DOM edit + whole-document re-serialize, so the host
 * connector's own fields and sibling plugin elements (an SSL entry!) survive
 * verbatim.
 */

import { useMemo } from "react";
import type { FunctionComponent } from "react";
import { parsePropertiesDoc } from "@/lib/runtime-plugins/xml-field-binding";
import {
  effectiveSectionValues,
  namespacedSectionFieldKey,
  readSectionCollections,
  writeSectionCollection,
  writeSectionValue,
} from "@/lib/runtime-plugins/compile-connector-section";
import type { ConnectorSectionContribution } from "@/lib/runtime-plugins/manifest-types";
import { SchemaFormSection } from "./schema-form-section";
import type { RuntimeConnectorSectionProps } from "./runtime-connector-section";

// Returned as a FunctionComponent for the same contravariance reason as
// createRuntimeConnectorSection: the narrower-props function component is
// assignable to both the source and destination Section contracts.
export function createRuntimeConnectorPluginSection(
  section: ConnectorSectionContribution,
  entry: { name: string }
): FunctionComponent<RuntimeConnectorSectionProps> {
  function RuntimeConnectorPluginSection({
    propertiesXml,
    onChange,
    invalidFields,
  }: RuntimeConnectorSectionProps) {
    const values = useMemo(() => effectiveSectionValues(section, propertiesXml), [propertiesXml]);
    const collectionValues = useMemo(
      () => readSectionCollections(section, propertiesXml),
      [propertiesXml]
    );
    const unparseable = useMemo(
      () => propertiesXml !== null && parsePropertiesDoc(propertiesXml) === null,
      [propertiesXml]
    );
    // The host's invalidFields set is a flat, shared key namespace; this
    // section's compiled validate emits namespaced keys so highlights never
    // cross between the host connector's fields and the section's (or between
    // two sections sharing a field name). Strip the namespace back off for
    // SchemaFormSection's bare-key lookup.
    const sectionInvalidFields = useMemo(() => {
      if (!invalidFields || invalidFields.size === 0) return undefined;
      const prefix = namespacedSectionFieldKey(section.propertiesClass, "");
      const scoped = new Set<string>();
      for (const key of invalidFields) {
        if (key.startsWith(prefix)) scoped.add(key.slice(prefix.length));
      }
      return scoped;
    }, [invalidFields]);

    // Fail soft, never crash the editor: leave broken XML alone and say so.
    if (unparseable) {
      return (
        <p className="text-sm text-muted-foreground">
          The connector properties XML could not be parsed, so the {section.name} settings form is
          unavailable. The stored XML has been left untouched.
        </p>
      );
    }

    return (
      <SchemaFormSection
        sections={section.sections}
        actions={section.actions}
        values={values}
        onValueChange={(key, value) => {
          // No properties yet means nothing to bind into — the editor always
          // seeds defaultPropertiesXml on type switch, so this is a guard, not
          // a path.
          if (!propertiesXml) return;
          onChange({ propertiesXml: writeSectionValue(section, propertiesXml, key, value) });
        }}
        collectionValues={collectionValues}
        onCollectionChange={(key, rows) => {
          if (!propertiesXml) return;
          onChange({ propertiesXml: writeSectionCollection(section, propertiesXml, key, rows) });
        }}
        invalidFields={sectionInvalidFields}
        attribution={entry.name}
      />
    );
  }
  RuntimeConnectorPluginSection.displayName = `RuntimeConnectorPluginSection(${section.name})`;
  return RuntimeConnectorPluginSection;
}
