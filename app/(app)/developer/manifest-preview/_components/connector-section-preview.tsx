"use client";

/**
 * Right-pane preview for one declared connector section.
 *
 * Like ConnectorPanelPreview — and for the same reason — this deliberately does
 * NOT call `createRuntimeConnectorPluginSection`. That factory returns a
 * component typed to exactly `{propertiesXml, onChange, invalidFields}` so it
 * structurally matches the real source/destination connector-plugin Section
 * contracts at registration time; it has no room for an `actionsDisabled` prop
 * and must not gain one. The connector-section grammar DOES declare `actions`,
 * so to render the action buttons disabled (they'd call non-existent extension
 * endpoints) this reimplements the same thin binding
 * (effectiveSectionValues/writeSectionValue -> SchemaFormSection) directly and
 * passes `actionsDisabled` through. Do not "simplify" this back to the factory.
 *
 * In production a section renders inside OTHER connectors' panels (the ones it
 * `appliesTo`). Here it renders against a standalone placeholder host document
 * so its fields, defaults, validation, and action buttons can be exercised in
 * isolation.
 */

import { useMemo, useState } from "react";
import { SchemaFormSection } from "@/components/schema-form/schema-form-section";
import {
  compileConnectorSection,
  effectiveSectionValues,
  namespacedSectionFieldKey,
  readSectionCollections,
  writeSectionCollection,
  writeSectionValue,
} from "@/lib/runtime-plugins/compile-connector-section";
import { pluginContainerExists } from "@/lib/runtime-plugins/xml-field-binding";
import type { ConnectorSectionContribution } from "@/lib/runtime-plugins/manifest-types";
import { ValidateBar, type ValidateError } from "./validate-bar";
import { LiveXmlDisclosure } from "./live-xml-disclosure";

const PLACEHOLDER_HOST_XML =
  '<properties class="com.example.PreviewHostProperties" version="1.0.0"/>';

export function ConnectorSectionPreview({
  section,
  attribution,
}: {
  section: ConnectorSectionContribution;
  attribution: string;
}) {
  const compiled = useMemo(() => compileConnectorSection(section), [section]);
  // Start with NO section container (a bare placeholder host document). While
  // the container is absent, effectiveSectionValues reads the manifest defaults
  // LIVE (container-absent branch), so edits to the section in the manifest —
  // changed defaults, added fields — are reflected here without staleness. The
  // first field edit materializes the container (writeSectionValue), matching
  // the real host's materialize-on-edit model.
  const [propertiesXml, setPropertiesXml] = useState(PLACEHOLDER_HOST_XML);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<ValidateError[] | null>(null);

  const values = useMemo(
    () => effectiveSectionValues(section, propertiesXml),
    [section, propertiesXml]
  );
  const collectionValues = useMemo(
    () => readSectionCollections(section, propertiesXml),
    [section, propertiesXml]
  );

  const stripNamespace = (key: string) => {
    const prefix = namespacedSectionFieldKey(section.propertiesClass, "");
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  };

  function handleValidate() {
    // The real host validates a materialized container (an untouched section
    // serializes nothing, so it's not validated). Materialize a TRANSIENT copy
    // from the current manifest defaults for the check — without storing it, so
    // the form keeps live-tracking manifest edits until the user actually edits
    // a field. compiled.validate emits namespaced keys (propertiesClass-
    // prefixed); strip the namespace for this standalone preview's bare-key list.
    const xmlToValidate = pluginContainerExists(propertiesXml, section.propertiesClass)
      ? propertiesXml
      : compiled.injectDefaults(section.appliesTo[0] ?? "", propertiesXml);
    const result = compiled
      .validate(xmlToValidate)
      .map((e) => ({ field: stripNamespace(e.field), message: e.message }));
    setErrors(result);
    setInvalidFields(new Set(result.map((e) => e.field)));
  }

  function clearValidation() {
    setErrors(null);
    setInvalidFields(new Set());
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-medium capitalize">
          {section.mode}
        </span>
        <span>Injected into:</span>
        {section.appliesTo.map((t) => (
          <span key={t} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
            {t}
          </span>
        ))}
      </div>

      <SchemaFormSection
        sections={section.sections}
        actions={section.actions}
        values={values}
        onValueChange={(key, value) => {
          setPropertiesXml(writeSectionValue(section, propertiesXml, key, value));
          clearValidation();
        }}
        collectionValues={collectionValues}
        onCollectionChange={(key, rows) => {
          setPropertiesXml(writeSectionCollection(section, propertiesXml, key, rows));
          clearValidation();
        }}
        invalidFields={invalidFields}
        attribution={attribution}
        actionsDisabled
      />

      <ValidateBar onValidate={handleValidate} errors={errors} />

      <LiveXmlDisclosure
        xml={propertiesXml}
        path={`webadmin-preview-section-${section.mode}-${section.propertiesClass}.xml`}
      />
    </div>
  );
}
