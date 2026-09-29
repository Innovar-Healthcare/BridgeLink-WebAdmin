/**
 * Compiles a runtime connectorSections contribution into the host's
 * ConnectorPluginDefinition surface — everything except the React
 * Section component, which createRuntimeConnectorPluginSection pairs in (the
 * compile-validate / runtime-connector-section split, kept JSX-free).
 *
 * Semantics (PLAN-RuntimeConnectorSections-BusinessLogic.md §6):
 *  - `isApplicable` is a pure transport-name match — the Java
 *    isSupported(String transportName) contract. Deliberately NO XML
 *    detection: paired with materialize-on-edit (no engine synthesis), an
 *    element-presence gate would hide the section forever on channels that
 *    predate the extension.
 *  - Effective values: container absent → each field reads its manifest
 *    defaultValue (the Swing client's panel.getDefaults() synthesis parity);
 *    container present → per-field read, missing child reads "". One shared
 *    helper feeds the Section, validate, and securesTransport so all three
 *    always agree.
 *  - `injectDefaults` inserts the complete default container on
 *    connector-type switch (the only path that repopulates plugin XML after
 *    the host replaces propertiesXml with the new type's default blob).
 *  - `securesTransportWhen: true` compiles to a constant (the SSL-destination
 *    "always decorates" precedent); a Condition evaluates against the
 *    effective values (the SSL-source sslEnabled precedent).
 */

import type { ValidationError } from "@/app/(app)/channels/_connectors/shared/validate-utils";
import { evaluateCondition } from "./condition-eval";
import { validateFieldValues } from "./compile-validate";
import {
  ensurePluginContainer,
  findPluginContainer,
  injectPluginSectionDefaults,
  parsePropertiesDoc,
  pluginContainerExists,
  readPluginSectionValues,
  writePluginSectionValue,
} from "./xml-field-binding";
import {
  collectionSpec,
  readCollectionFrom,
  writeCollectionInto,
  type CollectionRows,
} from "./xml-collection-binding";
import { COLLECTION_FIELD_TYPES } from "./manifest-types";
import type { ConnectorSectionContribution, FieldDescriptor } from "./manifest-types";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

/** The compiled, component-less part of a ConnectorPluginDefinition. */
export interface CompiledConnectorSection {
  isApplicable: (transportName: string, propertiesXml: string | null) => boolean;
  injectDefaults: (transportName: string, propertiesXml: string) => string;
  validate: (propertiesXml: string | null) => ValidationError[];
  securesTransport?: (propertiesXml: string | null) => boolean;
}

/**
 * Namespaces a section field key for the host's flat `invalidFields` set.
 * The set is shared between the host connector's own fields and every plugin
 * section, all keyed by bare field name — a section field named "host" would
 * otherwise cross-highlight the host connector's Host input (and vice versa).
 * "/" is unambiguous: FIELD_KEY_PATTERN forbids it and no host connector key
 * contains it. Producer (the compiled `validate`) and consumer
 * (runtime-connector-plugin-section) both live in this codebase.
 */
export function namespacedSectionFieldKey(propertiesClass: string, fieldKey: string): string {
  return `${propertiesClass}/${fieldKey}`;
}

function sectionFields(section: ConnectorSectionContribution): FieldDescriptor[] {
  return section.sections.flatMap((s) => s.fields);
}

function scalarSectionFields(section: ConnectorSectionContribution): FieldDescriptor[] {
  return sectionFields(section).filter((f) => !COLLECTION_TYPES.has(f.type));
}

function collectionSectionFields(section: ConnectorSectionContribution): FieldDescriptor[] {
  return sectionFields(section).filter((f) => COLLECTION_TYPES.has(f.type));
}

/**
 * variableToggle companion element keys for the section's collection fields.
 * They are ordinary scalar elements (not declared fields), so they must be read
 * into the scalar bag for the toggle radio to reflect + persist its state
 * (mirrors runtime-connector-section for panels).
 */
function toggleCompanionKeys(section: ConnectorSectionContribution): string[] {
  return collectionSectionFields(section).flatMap((f) =>
    f.variableToggle ? [f.variableToggle.variableKey, f.variableToggle.useVariableKey] : []
  );
}

/**
 * Declared fields at their manifest defaults, in declaration order. Collection
 * fields have no scalar defaultValue; they materialize as an empty element
 * (`""` textContent — XStream reads that as an empty collection), and the
 * proper class-attributed / list form is written on the first collection edit.
 */
export function sectionDefaults(
  section: ConnectorSectionContribution
): ReadonlyArray<readonly [string, string]> {
  return sectionFields(section).map((field) => [field.key, field.defaultValue ?? ""] as const);
}

/**
 * The section's current SCALAR field values: manifest defaults while the
 * container is absent (Java getDefaults() synthesis parity), the container's
 * element text once it exists (missing child reads "" — the present-empty rule).
 * Collection fields are excluded — they bind through readSectionCollections.
 */
export function effectiveSectionValues(
  section: ConnectorSectionContribution,
  propertiesXml: string | null
): Record<string, string> {
  // Scalar declared fields + each collection's variableToggle companion elements.
  const scalarKeys = [
    ...scalarSectionFields(section).map((f) => f.key),
    ...toggleCompanionKeys(section),
  ];
  if (!pluginContainerExists(propertiesXml, section.propertiesClass)) {
    const defaults: Record<string, string> = {};
    for (const f of scalarSectionFields(section)) defaults[f.key] = f.defaultValue ?? "";
    for (const key of toggleCompanionKeys(section)) defaults[key] = "";
    return defaults;
  }
  return readPluginSectionValues(propertiesXml, section.propertiesClass, scalarKeys);
}

/** The section's current collection field rows, by key (empty while the container is absent). */
export function readSectionCollections(
  section: ConnectorSectionContribution,
  propertiesXml: string | null
): Record<string, CollectionRows> {
  const root = propertiesXml ? (parsePropertiesDoc(propertiesXml)?.documentElement ?? null) : null;
  const container = root ? findPluginContainer(root, section.propertiesClass) : null;
  const out: Record<string, CollectionRows> = {};
  for (const field of collectionSectionFields(section)) {
    out[field.key] = readCollectionFrom(container, collectionSpec(field));
  }
  return out;
}

/**
 * Writes one collection field edit into the section's container, materializing
 * the complete default container first when absent (same rule as the scalar
 * writeSectionValue). Unknown/unparseable input returned unchanged.
 */
export function writeSectionCollection(
  section: ConnectorSectionContribution,
  propertiesXml: string,
  key: string,
  rows: CollectionRows
): string {
  const doc = parsePropertiesDoc(propertiesXml);
  if (!doc) return propertiesXml;
  const field = collectionSectionFields(section).find((f) => f.key === key);
  if (!field) return propertiesXml;
  const container = ensurePluginContainer(doc, section.propertiesClass, sectionDefaults(section));
  writeCollectionInto(container, collectionSpec(field), rows, doc);
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Writes one field edit, materializing the complete default container first
 * when absent — the Section component's onValueChange path.
 */
export function writeSectionValue(
  section: ConnectorSectionContribution,
  propertiesXml: string,
  key: string,
  value: string
): string {
  return writePluginSectionValue(
    propertiesXml,
    section.propertiesClass,
    sectionDefaults(section),
    key,
    value
  );
}

export function compileConnectorSection(
  section: ConnectorSectionContribution
): CompiledConnectorSection {
  const fields = sectionFields(section);
  const transports = new Set(section.appliesTo);
  const defaults = sectionDefaults(section);
  const { securesTransportWhen } = section;

  const compiled: CompiledConnectorSection = {
    isApplicable: (transportName) => transports.has(transportName),
    injectDefaults: (transportName, propertiesXml) =>
      transports.has(transportName)
        ? injectPluginSectionDefaults(propertiesXml, section.propertiesClass, defaults)
        : propertiesXml,
    // No container ⇒ no validation: an untouched section serializes NOTHING
    // (materialize-on-edit), so validating the manifest defaults would block
    // Save/Enable on pre-existing channels the user never touched — a state
    // the engine already accepts. Once the container exists (first edit, or
    // injectDefaults on type switch), the rules apply. Error keys are
    // namespaced so they can never collide with the host connector's own
    // invalid-field highlighting (see namespacedSectionFieldKey).
    validate: (propertiesXml) =>
      pluginContainerExists(propertiesXml, section.propertiesClass)
        ? validateFieldValues(fields, effectiveSectionValues(section, propertiesXml)).map(
            (error) => ({
              ...error,
              field: namespacedSectionFieldKey(section.propertiesClass, error.field),
            })
          )
        : [],
  };
  if (securesTransportWhen === true) {
    compiled.securesTransport = () => true;
  } else if (securesTransportWhen !== undefined) {
    compiled.securesTransport = (propertiesXml) =>
      evaluateCondition(securesTransportWhen, effectiveSectionValues(section, propertiesXml));
  }
  return compiled;
}
