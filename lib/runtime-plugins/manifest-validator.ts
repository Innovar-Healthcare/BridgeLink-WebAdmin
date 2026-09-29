/**
 * Strict validator for runtime plugin manifest entries,.
 *
 * Validates one raw entry of `GET /extensions/_webadmin` against the contract
 * (docs/WEBADMIN-PLUGIN-CONTRACT.md) — manifestVersion 1, 2, or 3. Deliberately
 * strict:
 *
 *  - Unknown keys are REJECTED at every level, so a kind's grammar can only
 *    grow behind a `manifestVersion` bump. This is also what forbids
 *    `licensedPluginId` (and any other host-internal field) on runtime
 *    manifests — they simply aren't in the schema.
 *  - The one v2 exception: RESERVED_V2_KINDS are accepted as top-level keys;
 *    a reserved kind this build doesn't implement is collected into
 *    `skippedKinds` (value deliberately uninspected) so the manifest's other
 *    kinds still load. Non-reserved unknown keys still reject the whole
 *    manifest.
 *  - Every complexity cap in MANIFEST_CAPS is enforced here, and the failure
 *    reason names the violated cap or key with its JSON path.
 *  - Action endpoints must live under the contributing extension's own
 *    `/extensions/<path>/` namespace.
 *  - Regex validation patterns must compile and fit MAX_PATTERN_LENGTH.
 *
 * Hand-rolled on purpose: no schema library is a dependency, and the app CSP
 * (`script-src 'self'`) forbids eval-based validators.
 */

import { scanPatternHazard } from "./safe-regex";
import {
  COLLECTION_FIELD_TYPES,
  DATA_TYPE_GROUP_NAMES,
  IMPLEMENTED_V2_KINDS,
  MANIFEST_CAPS,
  RESERVED_V2_KINDS,
  type ActionButton,
  type Condition,
  type ConnectorPanelContribution,
  type ConnectorSectionContribution,
  type DataTypeContribution,
  type DataTypeGroupName,
  type DataTypePropertyGroup,
  type FieldDescriptor,
  type FieldOption,
  type FieldType,
  type LeafCondition,
  type PanelSection,
  type SettingsPanelContribution,
  type SkippedKind,
  type TableColumn,
  type TransformerStepContribution,
  type TransmissionModeContribution,
  type ValidatedManifestEntry,
  type ValidationRule,
  type VariableToggleDescriptor,
  type WebAdminManifest,
} from "./manifest-types";

type ManifestVersion = 1 | 2 | 3;

function isCollectionType(type: FieldType): boolean {
  return (COLLECTION_FIELD_TYPES as readonly string[]).includes(type);
}

export type ManifestValidationResult =
  | { ok: true; entry: ValidatedManifestEntry; skippedKinds: SkippedKind[] }
  | { ok: false; reason: string };

/** Internal control-flow signal — the first validation failure aborts the walk. */
class ManifestRejection {
  constructor(public readonly reason: string) {}
}

function fail(path: string, message: string): never {
  throw new ManifestRejection(path ? `${path}: ${message}` : message);
}

// ─── Primitive expectations ───────────────────────────────────────────────────

function expectPlainObject(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    fail(path, "expected an object");
  }
  return v as Record<string, unknown>;
}

/** Rejects any key not in `known` — the strictness backbone. */
function rejectUnknownKeys(obj: Record<string, unknown>, path: string, known: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) fail(path, `unknown key "${key}"`);
  }
}

function expectString(v: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof v !== "string") fail(path, "expected a string");
  if (!allowEmpty && v.trim() === "") fail(path, "must not be empty");
  if (v.length > maxLength) fail(path, `exceeds ${maxLength} characters`);
  return v;
}

function expectArray(v: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) fail(path, "expected an array");
  if (v.length < min) fail(path, `must contain at least ${min} item(s)`);
  if (v.length > max) fail(path, `exceeds ${max} items`);
  return v;
}

// ─── Identifier patterns ──────────────────────────────────────────────────────

/** Field keys: XML element names / property record keys. */
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
/**
 * Object-prototype names that must never be used as a field key or table column
 * element: as a JS object key they either silently no-op (`__proto__`) or read a
 * prototype member instead of stored data, so a collection row keyed by one
 * would appear to lose its value. Rejected up front (also hardens the scalar
 * value-record path).
 */
const RESERVED_OBJECT_KEYS = ["__proto__", "prototype", "constructor"];
/** Settings tab keys: slugs. */
const TAB_KEY_PATTERN = /^[a-z0-9-]+$/;
/** Transport names: dropdown entries; letters/digits with word separators. */
const TRANSPORT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
/** Extension names: as reported by the engine; conservative charset. */
const EXTENSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/;
/** Extension install path: a single URL path segment. */
const EXTENSION_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Segments of an action endpoint after the /extensions/<path>/ prefix. */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9 ._()-]+$/;
/**
 * minWebAdminVersion: dotted numerics only. Exported for the loader's
 * best-effort pre-validation version gate (a manifest written for a NEWER
 * WebAdmin may use grammar this build's strict validator rejects — the
 * friendly "requires WebAdmin x.y" skip must win over "unknown key").
 */
export const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;
/** Java fully-qualified class name (transmission-mode propertiesClass). */
const JAVA_FQN_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;
/** Uppercase hex byte string, empty allowed — TcpUtil.isValidHexString parity. */
const HEX_BYTES_PATTERN = /^[0-9A-F]*$/;
/** Elements of <transmissionModeProperties> owned by the shared writer. */
const TRANSMISSION_MODE_RESERVED_KEYS = [
  "pluginPointName",
  "startOfMessageBytes",
  "endOfMessageBytes",
];
/**
 * The five DataTypeProperties group element names (batch included — it exists
 * on the wire even though it isn't declarable). A data type field key naming
 * one of these would collide with the structural elements.
 */
const DATA_TYPE_GROUP_ELEMENT_KEYS = [
  "serializationProperties",
  "deserializationProperties",
  "batchProperties",
  "responseGenerationProperties",
  "responseValidationProperties",
];
/**
 * `<pluginProperties>` child elements owned by compiled-in connector sections
 * (SSL, HTTP Auth). A runtime section declaring one of these would be a second
 * writer on the same element — the two would silently corrupt each other.
 */
const HOST_OWNED_CONTAINER_CLASSES = ["com.mirth.connect.plugins.ssl.SSLSettingsProperties"];
// Both separators: "." for the package's classes, "$" for any future inner
// class serialized under the package root (JAVA_FQN_PATTERN allows "$").
const HOST_OWNED_CONTAINER_PREFIXES = [
  "com.mirth.connect.plugins.httpauth.",
  "com.mirth.connect.plugins.httpauth$",
];
/**
 * Elements a transformer step's `<{stepClass}>` element carries that are
 * written by the shared step registry (serializeStep), not by the declared
 * fields. A field key naming one of these would produce a duplicate child.
 */
const STEP_RESERVED_FIELD_KEYS = ["name", "sequenceNumber", "enabled"];
/**
 * The seven built-in transformer step classes. A runtime step's `stepClass`
 * naming one of these would collide with a compiled-in step at parse time
 * (resolveStepByXmlTag is first-registered-wins, and built-ins register first).
 * Exact FQNs only, NOT a `com.mirth.connect.` prefix — existing commercial and
 * partner Swing steps legitimately live under `com.mirth.connect.plugins.*`, and
 * any future core step is covered by the sink's live registry scan anyway.
 */
const BUILTIN_STEP_CLASSES = [
  "com.mirth.connect.plugins.mapper.MapperStep",
  "com.mirth.connect.plugins.messagebuilder.MessageBuilderStep",
  "com.mirth.connect.plugins.javascriptstep.JavaScriptStep",
  "com.mirth.connect.plugins.xsltstep.XsltStep",
  "com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep",
  "com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep",
  "com.mirth.connect.model.IteratorStep",
];

// ─── Conditions ───────────────────────────────────────────────────────────────

function validateLeafCondition(
  v: unknown,
  path: string,
  fieldKeys: ReadonlySet<string>,
  collectionKeys: ReadonlySet<string>
): LeafCondition {
  const obj = expectPlainObject(v, path);
  const op = obj.op;
  if (op !== "eq" && op !== "ne" && op !== "in" && op !== "truthy") {
    fail(path, `op must be one of "eq", "ne", "in", "truthy"`);
  }
  const field = expectString(obj.field, `${path}.field`, MANIFEST_CAPS.MAX_KEY_LENGTH);
  if (!fieldKeys.has(field)) {
    fail(`${path}.field`, `references unknown field "${field}"`);
  }
  if (collectionKeys.has(field)) {
    fail(`${path}.field`, `conditions cannot reference the collection field "${field}"`);
  }
  if (op === "eq" || op === "ne") {
    rejectUnknownKeys(obj, path, ["field", "op", "value"]);
    const value = expectString(obj.value, `${path}.value`, MANIFEST_CAPS.MAX_TEXT_LENGTH, true);
    return { field, op, value };
  }
  if (op === "in") {
    rejectUnknownKeys(obj, path, ["field", "op", "values"]);
    const values = expectArray(obj.values, `${path}.values`, 1, MANIFEST_CAPS.MAX_CONDITION_TERMS);
    return {
      field,
      op,
      values: values.map((entry, i) =>
        expectString(entry, `${path}.values[${i}]`, MANIFEST_CAPS.MAX_TEXT_LENGTH, true)
      ),
    };
  }
  rejectUnknownKeys(obj, path, ["field", "op"]);
  return { field, op };
}

function validateCondition(
  v: unknown,
  path: string,
  fieldKeys: ReadonlySet<string>,
  collectionKeys: ReadonlySet<string> = new Set()
): Condition {
  const obj = expectPlainObject(v, path);
  const isAllOf = "allOf" in obj;
  const isAnyOf = "anyOf" in obj;
  if (isAllOf || isAnyOf) {
    const kind = isAllOf ? "allOf" : "anyOf";
    rejectUnknownKeys(obj, path, [kind]);
    const terms = expectArray(
      obj[kind],
      `${path}.${kind}`,
      1,
      MANIFEST_CAPS.MAX_CONDITION_TERMS
    ).map((term, i) => {
      // Composites nest LEAF conditions only (MAX_CONDITION_DEPTH = 2): a
      // nested allOf/anyOf fails the leaf-shape check below.
      const termObj = expectPlainObject(term, `${path}.${kind}[${i}]`);
      if ("allOf" in termObj || "anyOf" in termObj) {
        fail(`${path}.${kind}[${i}]`, "nested composite conditions are not allowed (max depth 2)");
      }
      return validateLeafCondition(term, `${path}.${kind}[${i}]`, fieldKeys, collectionKeys);
    });
    return isAllOf ? { allOf: terms } : { anyOf: terms };
  }
  return validateLeafCondition(v, path, fieldKeys, collectionKeys);
}

// ─── Validation rules ─────────────────────────────────────────────────────────

function validateRule(v: unknown, path: string, fieldType: FieldType): ValidationRule {
  const obj = expectPlainObject(v, path);
  const rule = obj.rule;
  const message =
    obj.message === undefined
      ? undefined
      : expectString(obj.message, `${path}.message`, MANIFEST_CAPS.MAX_TEXT_LENGTH);
  if (rule === "required") {
    rejectUnknownKeys(obj, path, ["rule", "message"]);
    return { rule, ...(message !== undefined ? { message } : {}) };
  }
  if (rule === "pattern") {
    rejectUnknownKeys(obj, path, ["rule", "pattern", "message"]);
    if (fieldType === "javascript") {
      // Script values routinely exceed the bounded-regex input cap, so a
      // pattern rule would fail closed on every real script — reject the
      // nonsensical combination up front (only "required" applies).
      fail(path, `rule "pattern" is not allowed on javascript fields`);
    }
    const pattern = expectString(obj.pattern, `${path}.pattern`, MANIFEST_CAPS.MAX_PATTERN_LENGTH);
    try {
      new RegExp(pattern);
    } catch {
      fail(`${path}.pattern`, "is not a valid regular expression");
    }
    const hazard = scanPatternHazard(pattern);
    if (hazard === "nested-quantifier") {
      fail(
        `${path}.pattern`,
        "must not contain nested quantifiers (catastrophic backtracking guard)"
      );
    }
    if (hazard === "ambiguous-alternation") {
      fail(
        `${path}.pattern`,
        "must not repeat an alternation whose branches can match the same text (catastrophic backtracking guard)"
      );
    }
    return { rule, pattern, ...(message !== undefined ? { message } : {}) };
  }
  if (rule === "min" || rule === "max") {
    rejectUnknownKeys(obj, path, ["rule", "value", "message"]);
    if (fieldType !== "number") {
      fail(path, `rule "${rule}" is only allowed on number fields`);
    }
    if (typeof obj.value !== "number" || !Number.isFinite(obj.value)) {
      fail(`${path}.value`, "expected a finite number");
    }
    return { rule, value: obj.value, ...(message !== undefined ? { message } : {}) };
  }
  fail(path, `rule must be one of "required", "pattern", "min", "max"`);
}

// ─── Fields ───────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldType[] = [
  "text",
  "secret",
  "number",
  "checkbox",
  "select",
  "radio",
  "textarea",
  "javascript",
  "map",
  "multimap",
  "stringList",
  "table",
];
const PLACEHOLDER_TYPES: FieldType[] = ["text", "secret", "number", "textarea"];

interface FieldValidationOptions {
  /** The manifest's version (collection types require 3). */
  manifestVersion: ManifestVersion;
  /** Whether `defaultValue` is permitted on this kind's fields. */
  allowDefaultValue: boolean;
  /** Whether the "javascript" field type is permitted (data types + transformer steps). */
  allowJavaScript?: boolean;
  /** Whether collection field types are permitted for this kind. */
  allowCollections?: boolean;
  /**
   * Whether a collection field may carry a `variableToggle`. Only the
   * validateSections-based kinds (connector panels, settings panels, connector
   * sections) run the cross-field toggle-collision second pass, so the toggle is
   * permitted only there — not in data types / transformer steps.
   */
  allowVariableToggle?: boolean;
}

function validateFieldShallow(
  v: unknown,
  path: string,
  {
    manifestVersion,
    allowDefaultValue,
    allowJavaScript = false,
    allowCollections = false,
    allowVariableToggle = true,
  }: FieldValidationOptions
): FieldDescriptor {
  const obj = expectPlainObject(v, path);

  // The allowed-key set is type-dependent (collection fields carry a different
  // grammar than scalars), so read + gate the type BEFORE rejecting unknown keys.
  const key = expectString(obj.key, `${path}.key`, MANIFEST_CAPS.MAX_KEY_LENGTH);
  if (!FIELD_KEY_PATTERN.test(key)) {
    fail(`${path}.key`, `"${key}" is not a valid field key`);
  }
  // Gated to v3 so the frozen v1/v2 grammar is not retroactively tightened.
  // (v1/v2 scalar keys flow through readFieldValues, which pre-seeds every key
  // as an own property, so a "constructor"/"prototype" key is inert there.)
  if (manifestVersion === 3 && RESERVED_OBJECT_KEYS.includes(key)) {
    fail(`${path}.key`, `"${key}" is a reserved key`);
  }
  const rawType = obj.type;
  if (typeof rawType !== "string" || !(FIELD_TYPES as readonly string[]).includes(rawType)) {
    fail(`${path}.type`, `type must be one of ${FIELD_TYPES.map((t) => `"${t}"`).join(", ")}`);
  }
  const type = rawType as FieldType;
  if (type === "javascript" && !allowJavaScript) {
    fail(
      `${path}.type`,
      `type "javascript" is only allowed on data type and transformer step fields`
    );
  }
  if (isCollectionType(type)) {
    if (manifestVersion !== 3) {
      fail(`${path}.type`, `type "${type}" requires manifestVersion 3`);
    }
    if (!allowCollections) {
      fail(`${path}.type`, `collection field type "${type}" is not supported in this panel kind`);
    }
  }
  const label = expectString(obj.label, `${path}.label`, MANIFEST_CAPS.MAX_LABEL_LENGTH);

  return isCollectionType(type)
    ? validateCollectionField(obj, path, type, key, label, allowVariableToggle)
    : validateScalarField(obj, path, type, key, label, allowDefaultValue);
}

/** Scalar field grammar (v1): the original text/secret/number/…/javascript shape. */
function validateScalarField(
  obj: Record<string, unknown>,
  path: string,
  type: FieldType,
  key: string,
  label: string,
  allowDefaultValue: boolean
): FieldDescriptor {
  rejectUnknownKeys(obj, path, [
    "key",
    "type",
    "label",
    "tooltip",
    "placeholder",
    "options",
    "defaultValue",
    "visibleWhen",
    "enabledWhen",
    "validation",
  ]);

  const field: FieldDescriptor = { key, type, label };

  if (obj.tooltip !== undefined) {
    field.tooltip = expectString(obj.tooltip, `${path}.tooltip`, MANIFEST_CAPS.MAX_TEXT_LENGTH);
  }
  if (obj.placeholder !== undefined) {
    if (!PLACEHOLDER_TYPES.includes(type)) {
      fail(`${path}.placeholder`, `not allowed on type "${type}"`);
    }
    field.placeholder = expectString(
      obj.placeholder,
      `${path}.placeholder`,
      MANIFEST_CAPS.MAX_TEXT_LENGTH
    );
  }

  const needsOptions = type === "select" || type === "radio";
  if (obj.options !== undefined) {
    if (!needsOptions) fail(`${path}.options`, `not allowed on type "${type}"`);
    const options = expectArray(
      obj.options,
      `${path}.options`,
      1,
      MANIFEST_CAPS.MAX_OPTIONS_PER_FIELD
    );
    field.options = options.map((opt, i): FieldOption => {
      const optObj = expectPlainObject(opt, `${path}.options[${i}]`);
      rejectUnknownKeys(optObj, `${path}.options[${i}]`, ["value", "label"]);
      return {
        value: expectString(
          optObj.value,
          `${path}.options[${i}].value`,
          MANIFEST_CAPS.MAX_TEXT_LENGTH,
          true
        ),
        label: expectString(
          optObj.label,
          `${path}.options[${i}].label`,
          MANIFEST_CAPS.MAX_LABEL_LENGTH
        ),
      };
    });
  } else if (needsOptions) {
    fail(`${path}.options`, `required for type "${type}"`);
  }

  if (obj.defaultValue !== undefined) {
    if (!allowDefaultValue) {
      fail(
        `${path}.defaultValue`,
        "not allowed on connector panel fields (defaults come from the engine defaults endpoint)"
      );
    }
    // A default for a "javascript" field would be extension-authored code
    // seeded into channel data and executed by the engine — the "no code ever
    // travels in the manifest" invariant forbids it even where defaultValue is
    // otherwise allowed (the engine's own Java class supplies the default).
    if (type === "javascript") {
      fail(`${path}.defaultValue`, `not allowed on "javascript" fields`);
    }
    field.defaultValue = expectString(
      obj.defaultValue,
      `${path}.defaultValue`,
      MANIFEST_CAPS.MAX_TEXT_LENGTH,
      true
    );
  }

  if (obj.validation !== undefined) {
    const rules = expectArray(
      obj.validation,
      `${path}.validation`,
      1,
      MANIFEST_CAPS.MAX_RULES_PER_FIELD
    );
    field.validation = rules.map((rule, i) => validateRule(rule, `${path}.validation[${i}]`, type));
  }

  // Conditions are validated in a second pass, once the panel's full key set
  // is known (they may reference fields declared later in the panel).
  return field;
}

/**
 * Collection field grammar (v3,. No `placeholder`/`options`/
 * `defaultValue`/`validation` (all rejected via the type-specific allowed-key
 * set below): defaults come from the engine defaults XML, and no compiled-in
 * connector needs per-row validation. `visibleWhen`/`enabledWhen` are permitted
 * (validated in the sections second pass, like scalars).
 */
function validateCollectionField(
  obj: Record<string, unknown>,
  path: string,
  type: FieldType,
  key: string,
  label: string,
  allowVariableToggle: boolean
): FieldDescriptor {
  const commonKeys = ["key", "type", "label", "tooltip", "visibleWhen", "enabledWhen", "addLabel"];
  if (allowVariableToggle) commonKeys.push("variableToggle");
  const perTypeKeys: Record<string, string[]> = {
    map: ["keyLabel", "valueLabel"],
    multimap: ["keyLabel", "valueLabel"],
    stringList: ["itemLabel"],
    table: ["rowElement", "columns"],
  };
  rejectUnknownKeys(obj, path, [...commonKeys, ...(perTypeKeys[type] ?? [])]);

  const field: FieldDescriptor = { key, type, label };

  if (obj.tooltip !== undefined) {
    field.tooltip = expectString(obj.tooltip, `${path}.tooltip`, MANIFEST_CAPS.MAX_TEXT_LENGTH);
  }
  if (obj.addLabel !== undefined) {
    field.addLabel = expectString(obj.addLabel, `${path}.addLabel`, MANIFEST_CAPS.MAX_LABEL_LENGTH);
  }
  if (type === "map" || type === "multimap") {
    if (obj.keyLabel !== undefined) {
      field.keyLabel = expectString(
        obj.keyLabel,
        `${path}.keyLabel`,
        MANIFEST_CAPS.MAX_LABEL_LENGTH
      );
    }
    if (obj.valueLabel !== undefined) {
      field.valueLabel = expectString(
        obj.valueLabel,
        `${path}.valueLabel`,
        MANIFEST_CAPS.MAX_LABEL_LENGTH
      );
    }
  }
  if (type === "stringList" && obj.itemLabel !== undefined) {
    field.itemLabel = expectString(
      obj.itemLabel,
      `${path}.itemLabel`,
      MANIFEST_CAPS.MAX_LABEL_LENGTH
    );
  }
  if (type === "table") {
    field.rowElement = validateRowElement(obj.rowElement, `${path}.rowElement`);
    field.columns = validateTableColumns(obj.columns, `${path}.columns`);
  }
  if (obj.variableToggle !== undefined) {
    field.variableToggle = validateVariableToggle(
      obj.variableToggle,
      `${path}.variableToggle`,
      key
    );
  }
  return field;
}

function validateRowElement(v: unknown, path: string): string {
  const rowElement = expectString(v, path, MANIFEST_CAPS.MAX_NAME_LENGTH);
  if (!JAVA_FQN_PATTERN.test(rowElement)) {
    fail(path, `"${rowElement}" is not a valid class name`);
  }
  return rowElement;
}

function validateTableColumns(v: unknown, path: string): TableColumn[] {
  const rawCols = expectArray(v, path, 1, MANIFEST_CAPS.MAX_TABLE_COLUMNS);
  const seen = new Set<string>();
  return rawCols.map((c, i): TableColumn => {
    const cPath = `${path}[${i}]`;
    const cObj = expectPlainObject(c, cPath);
    rejectUnknownKeys(cObj, cPath, ["element", "label", "placeholder"]);
    const element = expectString(cObj.element, `${cPath}.element`, MANIFEST_CAPS.MAX_KEY_LENGTH);
    if (!FIELD_KEY_PATTERN.test(element)) {
      fail(`${cPath}.element`, `"${element}" is not a valid column element name`);
    }
    if (RESERVED_OBJECT_KEYS.includes(element)) {
      fail(`${cPath}.element`, `"${element}" is a reserved key`);
    }
    if (seen.has(element)) fail(`${cPath}.element`, `duplicate column element "${element}"`);
    seen.add(element);
    const column: TableColumn = {
      element,
      label: expectString(cObj.label, `${cPath}.label`, MANIFEST_CAPS.MAX_LABEL_LENGTH),
    };
    if (cObj.placeholder !== undefined) {
      column.placeholder = expectString(
        cObj.placeholder,
        `${cPath}.placeholder`,
        MANIFEST_CAPS.MAX_TEXT_LENGTH
      );
    }
    return column;
  });
}

/**
 * Validates a collection field's variable-mode toggle. `variableKey`/
 * `useVariableKey` must be valid field keys, distinct from each other and from
 * the collection's own key; the cross-field collision check against ALL declared
 * panel keys runs in the sections second pass (validateSections).
 */
function validateVariableToggle(
  v: unknown,
  path: string,
  fieldKey: string
): VariableToggleDescriptor {
  const obj = expectPlainObject(v, path);
  rejectUnknownKeys(obj, path, [
    "variableKey",
    "useVariableKey",
    "tableLabel",
    "variableLabel",
    "variablePlaceholder",
    "variableTooltip",
  ]);
  const variableKey = expectString(
    obj.variableKey,
    `${path}.variableKey`,
    MANIFEST_CAPS.MAX_KEY_LENGTH
  );
  if (!FIELD_KEY_PATTERN.test(variableKey) || RESERVED_OBJECT_KEYS.includes(variableKey)) {
    fail(`${path}.variableKey`, `"${variableKey}" is not a valid field key`);
  }
  const useVariableKey = expectString(
    obj.useVariableKey,
    `${path}.useVariableKey`,
    MANIFEST_CAPS.MAX_KEY_LENGTH
  );
  if (!FIELD_KEY_PATTERN.test(useVariableKey) || RESERVED_OBJECT_KEYS.includes(useVariableKey)) {
    fail(`${path}.useVariableKey`, `"${useVariableKey}" is not a valid field key`);
  }
  const all = [variableKey, useVariableKey, fieldKey];
  if (new Set(all).size !== all.length) {
    fail(path, "variableKey, useVariableKey, and the field key must all differ");
  }
  const toggle: VariableToggleDescriptor = { variableKey, useVariableKey };
  if (obj.tableLabel !== undefined) {
    toggle.tableLabel = expectString(
      obj.tableLabel,
      `${path}.tableLabel`,
      MANIFEST_CAPS.MAX_LABEL_LENGTH
    );
  }
  if (obj.variableLabel !== undefined) {
    toggle.variableLabel = expectString(
      obj.variableLabel,
      `${path}.variableLabel`,
      MANIFEST_CAPS.MAX_LABEL_LENGTH
    );
  }
  if (obj.variablePlaceholder !== undefined) {
    toggle.variablePlaceholder = expectString(
      obj.variablePlaceholder,
      `${path}.variablePlaceholder`,
      MANIFEST_CAPS.MAX_TEXT_LENGTH
    );
  }
  if (obj.variableTooltip !== undefined) {
    toggle.variableTooltip = expectString(
      obj.variableTooltip,
      `${path}.variableTooltip`,
      MANIFEST_CAPS.MAX_TEXT_LENGTH
    );
  }
  return toggle;
}

// ─── Sections and panels ──────────────────────────────────────────────────────

interface RawSectionField {
  field: FieldDescriptor;
  raw: Record<string, unknown>;
  path: string;
}

interface SectionValidationOptions {
  manifestVersion: ManifestVersion;
  allowDefaultValue: boolean;
  /** Whether collection field types are permitted for this kind. */
  allowCollections?: boolean;
  /** Whether the section `presentation` hint is permitted for this kind. */
  allowPresentation?: boolean;
}

function validateSections(
  v: unknown,
  path: string,
  {
    manifestVersion,
    allowDefaultValue,
    allowCollections = false,
    allowPresentation = false,
  }: SectionValidationOptions
): { sections: PanelSection[]; fieldKeys: Set<string>; collectionKeys: Set<string> } {
  const rawSections = expectArray(v, path, 1, MANIFEST_CAPS.MAX_SECTIONS_PER_PANEL);
  const fieldKeys = new Set<string>();
  const collectionKeys = new Set<string>();
  const collected: RawSectionField[] = [];
  // variableToggle companion elements: separate siblings, so they must not
  // collide with any declared field key or with each other. Checked once the
  // full field-key set is known (second pass).
  const toggleKeys: { key: string; path: string }[] = [];
  let totalFields = 0;

  const sections = rawSections.map((sec, sIdx): PanelSection => {
    const sPath = `${path}[${sIdx}]`;
    const secObj = expectPlainObject(sec, sPath);
    // `presentation` is a v3 section key wired for the section-based kinds
    // (connector panels, settings panels, connector sections). Elsewhere — and
    // at v1/v2 — it rejects as unknown (typo safety, and keeps the schema a
    // superset since the schema only places it on those section defs).
    const allowPresentationKey = allowPresentation && manifestVersion === 3;
    rejectUnknownKeys(
      secObj,
      sPath,
      allowPresentationKey ? ["title", "fields", "presentation"] : ["title", "fields"]
    );
    const title = expectString(secObj.title, `${sPath}.title`, MANIFEST_CAPS.MAX_LABEL_LENGTH);
    let presentation: PanelSection["presentation"];
    if (secObj.presentation !== undefined) {
      if (secObj.presentation !== "inline" && secObj.presentation !== "dialog") {
        fail(`${sPath}.presentation`, `must be "inline" or "dialog"`);
      }
      presentation = secObj.presentation;
    }
    const rawFields = expectArray(
      secObj.fields,
      `${sPath}.fields`,
      1,
      MANIFEST_CAPS.MAX_FIELDS_PER_PANEL
    );
    totalFields += rawFields.length;
    if (totalFields > MANIFEST_CAPS.MAX_FIELDS_PER_PANEL) {
      fail(path, `panel exceeds ${MANIFEST_CAPS.MAX_FIELDS_PER_PANEL} fields`);
    }
    const fields = rawFields.map((f, fIdx) => {
      const fPath = `${sPath}.fields[${fIdx}]`;
      const field = validateFieldShallow(f, fPath, {
        manifestVersion,
        allowDefaultValue,
        allowCollections,
      });
      if (fieldKeys.has(field.key)) {
        fail(`${fPath}.key`, `duplicate field key "${field.key}" in panel`);
      }
      fieldKeys.add(field.key);
      if (isCollectionType(field.type)) collectionKeys.add(field.key);
      if (field.variableToggle) {
        toggleKeys.push({
          key: field.variableToggle.variableKey,
          path: `${fPath}.variableToggle.variableKey`,
        });
        toggleKeys.push({
          key: field.variableToggle.useVariableKey,
          path: `${fPath}.variableToggle.useVariableKey`,
        });
      }
      collected.push({ field, raw: expectPlainObject(f, fPath), path: fPath });
      return field;
    });
    const section: PanelSection = { title, fields };
    if (presentation) section.presentation = presentation;
    return section;
  });

  // variableToggle companion elements must be unique across the panel and must
  // not shadow a declared field element.
  const toggleSeen = new Set<string>();
  for (const { key, path: tPath } of toggleKeys) {
    if (fieldKeys.has(key)) {
      fail(tPath, `variable toggle element "${key}" collides with a declared field key`);
    }
    if (toggleSeen.has(key)) fail(tPath, `duplicate variable toggle element "${key}"`);
    toggleSeen.add(key);
  }

  // Second pass: conditions may reference any SCALAR field key in the same panel
  // (not collection fields — collectionKeys).
  for (const { field, raw, path: fPath } of collected) {
    if (raw.visibleWhen !== undefined) {
      field.visibleWhen = validateCondition(
        raw.visibleWhen,
        `${fPath}.visibleWhen`,
        fieldKeys,
        collectionKeys
      );
    }
    if (raw.enabledWhen !== undefined) {
      field.enabledWhen = validateCondition(
        raw.enabledWhen,
        `${fPath}.enabledWhen`,
        fieldKeys,
        collectionKeys
      );
    }
  }

  return { sections, fieldKeys, collectionKeys };
}

function validateActions(v: unknown, path: string, extensionPath: string): ActionButton[] {
  const rawActions = expectArray(v, path, 1, MANIFEST_CAPS.MAX_ACTIONS_PER_PANEL);
  return rawActions.map((a, i): ActionButton => {
    const aPath = `${path}[${i}]`;
    const obj = expectPlainObject(a, aPath);
    rejectUnknownKeys(obj, aPath, ["label", "endpoint", "method", "confirm"]);
    const label = expectString(obj.label, `${aPath}.label`, MANIFEST_CAPS.MAX_LABEL_LENGTH);
    const method = obj.method;
    if (method !== "GET" && method !== "POST") {
      fail(`${aPath}.method`, `method must be "GET" or "POST"`);
    }
    const endpoint = expectString(
      obj.endpoint,
      `${aPath}.endpoint`,
      MANIFEST_CAPS.MAX_ENDPOINT_LENGTH
    );
    const prefix = `/extensions/${extensionPath}/`;
    if (!endpoint.startsWith(prefix)) {
      fail(`${aPath}.endpoint`, `must start with the extension's own namespace "${prefix}"`);
    }
    const remainder = endpoint.slice(prefix.length);
    if (remainder === "") fail(`${aPath}.endpoint`, "must name an endpoint under the namespace");
    for (const segment of remainder.split("/")) {
      if (
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !ENDPOINT_SEGMENT_PATTERN.test(segment)
      ) {
        fail(`${aPath}.endpoint`, `contains an invalid path segment "${segment}"`);
      }
    }
    const action: ActionButton = { label, endpoint, method };
    if (obj.confirm !== undefined) {
      action.confirm = expectString(obj.confirm, `${aPath}.confirm`, MANIFEST_CAPS.MAX_TEXT_LENGTH);
    }
    return action;
  });
}

// ─── Transmission modes (v2 kind) ─────────────────────────────────────────────

function validateTransmissionModes(
  v: unknown,
  path: string,
  manifestVersion: ManifestVersion
): TransmissionModeContribution[] {
  const rawModes = expectArray(v, path, 1, MANIFEST_CAPS.MAX_PANELS);
  const names = new Set<string>();
  return rawModes.map((m, i): TransmissionModeContribution => {
    const mPath = `${path}[${i}]`;
    const obj = expectPlainObject(m, mPath);
    rejectUnknownKeys(obj, mPath, [
      "name",
      "displayName",
      "propertiesClass",
      "defaultStartBytes",
      "defaultEndBytes",
      "startBytesValidation",
      "endBytesValidation",
      "fields",
    ]);

    const name = expectString(obj.name, `${mPath}.name`, MANIFEST_CAPS.MAX_KEY_LENGTH);
    if (!TRANSPORT_NAME_PATTERN.test(name)) {
      fail(`${mPath}.name`, `"${name}" is not a valid transmission mode name`);
    }
    if (names.has(name)) {
      fail(`${mPath}.name`, `duplicate transmission mode name "${name}"`);
    }
    names.add(name);

    const displayName = expectString(
      obj.displayName,
      `${mPath}.displayName`,
      MANIFEST_CAPS.MAX_LABEL_LENGTH
    );

    // Written as the element's class attribute — strict XStream requires a
    // real Java class, but shape-wise we can at least enforce an FQN.
    const propertiesClass = expectString(
      obj.propertiesClass,
      `${mPath}.propertiesClass`,
      MANIFEST_CAPS.MAX_ENDPOINT_LENGTH
    );
    if (!JAVA_FQN_PATTERN.test(propertiesClass)) {
      fail(`${mPath}.propertiesClass`, `"${propertiesClass}" is not a fully-qualified class name`);
    }

    // TcpUtil.isValidHexString parity: uppercase hex, empty allowed.
    const hexField = (key: "defaultStartBytes" | "defaultEndBytes"): string => {
      const value = expectString(obj[key], `${mPath}.${key}`, MANIFEST_CAPS.MAX_KEY_LENGTH, true);
      if (!HEX_BYTES_PATTERN.test(value)) {
        fail(`${mPath}.${key}`, "must contain only uppercase hex characters (0-9, A-F)");
      }
      return value;
    };
    const defaultStartBytes = hexField("defaultStartBytes");
    const defaultEndBytes = hexField("defaultEndBytes");

    const mode: TransmissionModeContribution = {
      name,
      displayName,
      propertiesClass,
      defaultStartBytes,
      defaultEndBytes,
    };

    // Rules for the two host-owned byte elements (v3). They are not fields —
    // their keys are reserved — so they carry their rules on the mode itself.
    // Evaluated as a "text" field, which is what rejects min/max.
    const byteRules = (key: "startBytesValidation" | "endBytesValidation") => {
      if (obj[key] === undefined) return;
      if (manifestVersion < 3) {
        fail(`${mPath}.${key}`, "requires manifestVersion 3 or newer");
      }
      const rules = expectArray(obj[key], `${mPath}.${key}`, 1, MANIFEST_CAPS.MAX_RULES_PER_FIELD);
      mode[key] = rules.map((rule, i) => validateRule(rule, `${mPath}.${key}[${i}]`, "text"));
    };
    byteRules("startBytesValidation");
    byteRules("endBytesValidation");

    if (obj.fields !== undefined) {
      const rawFields = expectArray(
        obj.fields,
        `${mPath}.fields`,
        1,
        MANIFEST_CAPS.MAX_FIELDS_PER_PANEL
      );
      const fieldKeys = new Set<string>();
      const collected: { field: FieldDescriptor; raw: Record<string, unknown>; path: string }[] =
        [];
      mode.fields = rawFields.map((f, fIdx) => {
        const fPath = `${mPath}.fields[${fIdx}]`;
        // defaultValue IS allowed here: the client builds the element from
        // scratch — no engine defaults exist for it, even for built-ins.
        const field = validateFieldShallow(f, fPath, { manifestVersion, allowDefaultValue: true });
        if (TRANSMISSION_MODE_RESERVED_KEYS.includes(field.key)) {
          fail(
            `${fPath}.key`,
            `"${field.key}" is written by the transmission-mode serializer and cannot be declared`
          );
        }
        if (fieldKeys.has(field.key)) {
          fail(`${fPath}.key`, `duplicate field key "${field.key}" in transmission mode`);
        }
        fieldKeys.add(field.key);
        collected.push({ field, raw: expectPlainObject(f, fPath), path: fPath });
        return field;
      });
      // Second pass: conditions may reference any field key in the same mode.
      for (const { field, raw, path: fPath } of collected) {
        if (raw.visibleWhen !== undefined) {
          field.visibleWhen = validateCondition(raw.visibleWhen, `${fPath}.visibleWhen`, fieldKeys);
        }
        if (raw.enabledWhen !== undefined) {
          field.enabledWhen = validateCondition(raw.enabledWhen, `${fPath}.enabledWhen`, fieldKeys);
        }
      }
    }

    return mode;
  });
}

// ─── Data types (v2 kind) ─────────────────────────────────────────────────────

function validateDataTypes(
  v: unknown,
  path: string,
  manifestVersion: ManifestVersion
): DataTypeContribution[] {
  const rawTypes = expectArray(v, path, 1, MANIFEST_CAPS.MAX_PANELS);
  const names = new Set<string>();
  return rawTypes.map((d, i): DataTypeContribution => {
    const dPath = `${path}[${i}]`;
    const obj = expectPlainObject(d, dPath);
    rejectUnknownKeys(obj, dPath, [
      "name",
      "displayName",
      "isBinary",
      "defaultAttachmentHandler",
      "propertyGroups",
    ]);

    // The name is also the datatype-defaults URL segment and a fixture
    // filename — TRANSPORT_NAME_PATTERN excludes "/" and ":" (both
    // load-bearing there).
    const name = expectString(obj.name, `${dPath}.name`, MANIFEST_CAPS.MAX_KEY_LENGTH);
    if (!TRANSPORT_NAME_PATTERN.test(name)) {
      fail(`${dPath}.name`, `"${name}" is not a valid data type name`);
    }
    if (names.has(name)) {
      fail(`${dPath}.name`, `duplicate data type name "${name}"`);
    }
    names.add(name);

    const dataType: DataTypeContribution = { name };

    if (obj.displayName !== undefined) {
      dataType.displayName = expectString(
        obj.displayName,
        `${dPath}.displayName`,
        MANIFEST_CAPS.MAX_LABEL_LENGTH
      );
    }
    if (obj.isBinary !== undefined) {
      if (typeof obj.isBinary !== "boolean") fail(`${dPath}.isBinary`, "expected a boolean");
      dataType.isBinary = obj.isBinary;
    }
    // An attachment-handler provider class — strict XStream requires a real
    // Java class, but shape-wise we can at least enforce an FQN.
    if (obj.defaultAttachmentHandler !== undefined) {
      const fqn = expectString(
        obj.defaultAttachmentHandler,
        `${dPath}.defaultAttachmentHandler`,
        MANIFEST_CAPS.MAX_ENDPOINT_LENGTH
      );
      if (!JAVA_FQN_PATTERN.test(fqn)) {
        fail(`${dPath}.defaultAttachmentHandler`, `"${fqn}" is not a fully-qualified class name`);
      }
      dataType.defaultAttachmentHandler = fqn;
    }

    if (obj.propertyGroups !== undefined) {
      const rawGroups = expectArray(
        obj.propertyGroups,
        `${dPath}.propertyGroups`,
        1,
        DATA_TYPE_GROUP_NAMES.length
      );
      const seenGroups = new Set<DataTypeGroupName>();
      let totalFields = 0;
      dataType.propertyGroups = rawGroups.map((g, gIdx): DataTypePropertyGroup => {
        const gPath = `${dPath}.propertyGroups[${gIdx}]`;
        const gObj = expectPlainObject(g, gPath);
        rejectUnknownKeys(gObj, gPath, ["group", "fields"]);

        const rawGroup = gObj.group;
        if (
          typeof rawGroup !== "string" ||
          !(DATA_TYPE_GROUP_NAMES as readonly string[]).includes(rawGroup)
        ) {
          fail(
            `${gPath}.group`,
            `group must be one of ${DATA_TYPE_GROUP_NAMES.map((n) => `"${n}"`).join(", ")}`
          );
        }
        const group = rawGroup as DataTypeGroupName;
        if (seenGroups.has(group)) {
          fail(`${gPath}.group`, `duplicate property group "${group}"`);
        }
        seenGroups.add(group);

        const rawFields = expectArray(
          gObj.fields,
          `${gPath}.fields`,
          1,
          MANIFEST_CAPS.MAX_FIELDS_PER_PANEL
        );
        totalFields += rawFields.length;
        if (totalFields > MANIFEST_CAPS.MAX_FIELDS_PER_PANEL) {
          fail(dPath, `data type exceeds ${MANIFEST_CAPS.MAX_FIELDS_PER_PANEL} fields`);
        }
        // Per-group key namespace: the same key MAY appear in two different
        // groups (distinct XML parents and render scopes), and conditions may
        // reference keys of the SAME group only.
        const fieldKeys = new Set<string>();
        const collectionKeys = new Set<string>();
        const collected: { field: FieldDescriptor; raw: Record<string, unknown>; path: string }[] =
          [];
        const fields = rawFields.map((f, fIdx) => {
          const fPath = `${gPath}.fields[${fIdx}]`;
          // defaultValue is NOT allowed: the engine's datatype-defaults
          // endpoint is the single source of truth (connector-panel rule).
          // The "javascript" editor type IS allowed (Java
          // PropertyEditorType.JAVASCRIPT parity — the batch script pattern).
          // Collections are allowed but NOT variableToggle: data-type groups run
          // no cross-field toggle-collision pass, and a group is not a connector
          // property surface with channel-variable runtime semantics.
          const field = validateFieldShallow(f, fPath, {
            manifestVersion,
            allowDefaultValue: false,
            allowJavaScript: true,
            allowCollections: true,
            allowVariableToggle: false,
          });
          if (DATA_TYPE_GROUP_ELEMENT_KEYS.includes(field.key)) {
            fail(
              `${fPath}.key`,
              `"${field.key}" is a data type property group element and cannot be declared as a field`
            );
          }
          if (fieldKeys.has(field.key)) {
            fail(`${fPath}.key`, `duplicate field key "${field.key}" in property group`);
          }
          fieldKeys.add(field.key);
          if (isCollectionType(field.type)) collectionKeys.add(field.key);
          collected.push({ field, raw: expectPlainObject(f, fPath), path: fPath });
          return field;
        });
        // Second pass: conditions may reference any SCALAR field key in the same group.
        for (const { field, raw, path: fPath } of collected) {
          if (raw.visibleWhen !== undefined) {
            field.visibleWhen = validateCondition(
              raw.visibleWhen,
              `${fPath}.visibleWhen`,
              fieldKeys,
              collectionKeys
            );
          }
          if (raw.enabledWhen !== undefined) {
            field.enabledWhen = validateCondition(
              raw.enabledWhen,
              `${fPath}.enabledWhen`,
              fieldKeys,
              collectionKeys
            );
          }
        }
        return { group, fields };
      });
    }

    return dataType;
  });
}

// ─── Connector sections (v2 kind) ─────────────────────────────────────────────

function validateConnectorSections(
  v: unknown,
  path: string,
  extensionPath: string,
  panelTransportsByMode: ReadonlyMap<"source" | "destination", ReadonlySet<string>>,
  manifestVersion: ManifestVersion
): ConnectorSectionContribution[] {
  const rawSections = expectArray(v, path, 1, MANIFEST_CAPS.MAX_PANELS);
  const names = new Set<string>();
  const modeClassPairs = new Set<string>();
  return rawSections.map((s, i): ConnectorSectionContribution => {
    const sPath = `${path}[${i}]`;
    const obj = expectPlainObject(s, sPath);
    rejectUnknownKeys(obj, sPath, [
      "mode",
      "name",
      "propertiesClass",
      "appliesTo",
      "sections",
      "actions",
      "securesTransportWhen",
    ]);

    const mode = obj.mode;
    if (mode !== "source" && mode !== "destination") {
      fail(`${sPath}.mode`, `mode must be "source" or "destination"`);
    }

    const name = expectString(obj.name, `${sPath}.name`, MANIFEST_CAPS.MAX_KEY_LENGTH);
    if (!TRANSPORT_NAME_PATTERN.test(name)) {
      fail(`${sPath}.name`, `"${name}" is not a valid connector section name`);
    }
    if (names.has(name)) {
      fail(`${sPath}.name`, `duplicate connector section name "${name}"`);
    }
    names.add(name);

    // Written as the element tag under <pluginProperties> — strict XStream
    // requires a real Java class, but shape-wise we can at least enforce an
    // FQN and keep runtime sections off the compiled-in sections' elements.
    const propertiesClass = expectString(
      obj.propertiesClass,
      `${sPath}.propertiesClass`,
      MANIFEST_CAPS.MAX_ENDPOINT_LENGTH
    );
    if (!JAVA_FQN_PATTERN.test(propertiesClass)) {
      fail(`${sPath}.propertiesClass`, `"${propertiesClass}" is not a fully-qualified class name`);
    }
    if (
      HOST_OWNED_CONTAINER_CLASSES.includes(propertiesClass) ||
      HOST_OWNED_CONTAINER_PREFIXES.some((prefix) => propertiesClass.startsWith(prefix))
    ) {
      fail(
        `${sPath}.propertiesClass`,
        `"${propertiesClass}" is owned by a compiled-in connector section and cannot be declared`
      );
    }
    // Two contributions writing the same element for the same host mode is
    // ambiguous; the same class on both modes is the SSL mirror pattern.
    const pairKey = `${mode}\x00${propertiesClass}`;
    if (modeClassPairs.has(pairKey)) {
      fail(`${sPath}.propertiesClass`, `duplicate ${mode} section for "${propertiesClass}"`);
    }
    modeClassPairs.add(pairKey);

    const rawTransports = expectArray(
      obj.appliesTo,
      `${sPath}.appliesTo`,
      1,
      MANIFEST_CAPS.MAX_SECTION_TRANSPORTS
    );
    const seenTransports = new Set<string>();
    const ownPanelTransports = panelTransportsByMode.get(mode);
    const appliesTo = rawTransports.map((t, tIdx): string => {
      const tPath = `${sPath}.appliesTo[${tIdx}]`;
      const transport = expectString(t, tPath, MANIFEST_CAPS.MAX_KEY_LENGTH);
      if (!TRANSPORT_NAME_PATTERN.test(transport)) {
        fail(tPath, `"${transport}" is not a valid transport name`);
      }
      if (seenTransports.has(transport)) {
        fail(tPath, `duplicate transport "${transport}"`);
      }
      seenTransports.add(transport);
      // Double-render guard: a manifest cannot inject a section into a
      // connector panel it declares itself (same mode). Cross-mode overlap is
      // fine — a source section never renders in a destination host.
      if (ownPanelTransports?.has(transport)) {
        fail(
          tPath,
          `"${transport}" is also declared as a ${mode} connectorPanel by this manifest — ` +
            `a manifest cannot inject a section into its own connector panel`
        );
      }
      return transport;
    });

    // defaultValue IS allowed here: the client builds the element from
    // scratch (the Swing client's panel.getDefaults() is client-side too).
    // Collections + section presentation are supported, like connector panels.
    const { sections, fieldKeys, collectionKeys } = validateSections(
      obj.sections,
      `${sPath}.sections`,
      {
        manifestVersion,
        allowDefaultValue: true,
        allowCollections: true,
        allowPresentation: true,
      }
    );

    const section: ConnectorSectionContribution = {
      mode,
      name,
      propertiesClass,
      appliesTo,
      sections,
    };
    if (obj.actions !== undefined) {
      section.actions = validateActions(obj.actions, `${sPath}.actions`, extensionPath);
    }
    if (obj.securesTransportWhen !== undefined) {
      section.securesTransportWhen =
        obj.securesTransportWhen === true
          ? true
          : validateCondition(
              obj.securesTransportWhen,
              `${sPath}.securesTransportWhen`,
              fieldKeys,
              collectionKeys
            );
    }
    return section;
  });
}

// ─── Transformer steps (v2 kind) ──────────────────────────────────────────────

function validateTransformerSteps(
  v: unknown,
  path: string,
  manifestVersion: ManifestVersion
): TransformerStepContribution[] {
  const rawSteps = expectArray(v, path, 1, MANIFEST_CAPS.MAX_PANELS);
  const names = new Set<string>();
  const stepClasses = new Set<string>();
  return rawSteps.map((s, i): TransformerStepContribution => {
    const sPath = `${path}[${i}]`;
    const obj = expectPlainObject(s, sPath);
    rejectUnknownKeys(obj, sPath, ["name", "stepClass", "contexts", "fields"]);

    // The name is the registry key, the "Add" dropdown label, and the display
    // string in the step-list table (no separate displayName — the built-in
    // steps use their type as the label too).
    const name = expectString(obj.name, `${sPath}.name`, MANIFEST_CAPS.MAX_KEY_LENGTH);
    if (!TRANSPORT_NAME_PATTERN.test(name)) {
      fail(`${sPath}.name`, `"${name}" is not a valid transformer step name`);
    }
    if (names.has(name)) {
      fail(`${sPath}.name`, `duplicate transformer step name "${name}"`);
    }
    names.add(name);

    // Written as the step's XML element tag — strict XStream requires a real
    // Java Step subclass; shape-wise we enforce an FQN and reject the built-in
    // step classes (a runtime step can never redefine a compiled-in step).
    const stepClass = expectString(
      obj.stepClass,
      `${sPath}.stepClass`,
      MANIFEST_CAPS.MAX_ENDPOINT_LENGTH
    );
    if (!JAVA_FQN_PATTERN.test(stepClass)) {
      fail(`${sPath}.stepClass`, `"${stepClass}" is not a fully-qualified class name`);
    }
    if (BUILTIN_STEP_CLASSES.includes(stepClass)) {
      fail(`${sPath}.stepClass`, `"${stepClass}" is a built-in step class and cannot be redefined`);
    }
    if (stepClasses.has(stepClass)) {
      fail(`${sPath}.stepClass`, `duplicate transformer step class "${stepClass}"`);
    }
    stepClasses.add(stepClass);

    const rawContexts = expectArray(obj.contexts, `${sPath}.contexts`, 1, 2);
    const contexts: ("source" | "destination")[] = [];
    rawContexts.forEach((c, cIdx) => {
      if (c !== "source" && c !== "destination") {
        fail(`${sPath}.contexts[${cIdx}]`, `must be "source" or "destination"`);
      }
      if (contexts.includes(c)) {
        fail(`${sPath}.contexts[${cIdx}]`, `duplicate context "${c}"`);
      }
      contexts.push(c);
    });

    const step: TransformerStepContribution = { name, stepClass, contexts };

    if (obj.fields !== undefined) {
      const rawFields = expectArray(
        obj.fields,
        `${sPath}.fields`,
        1,
        MANIFEST_CAPS.MAX_FIELDS_PER_PANEL
      );
      const fieldKeys = new Set<string>();
      const collectionKeys = new Set<string>();
      const collected: { field: FieldDescriptor; raw: Record<string, unknown>; path: string }[] =
        [];
      step.fields = rawFields.map((f, fIdx) => {
        const fPath = `${sPath}.fields[${fIdx}]`;
        // defaultValue IS allowed (the client builds the element from scratch),
        // and the "javascript" editor type IS allowed (Java
        // PropertyEditorType.JAVASCRIPT — user-authored channel data run by the
        // engine, not a manifest script hook). defaultValue on a javascript
        // field is separately forbidden by validateFieldShallow. Collections are
        // allowed but NOT variableToggle (no cross-field toggle-collision pass
        // here, and a step is not a connector property surface).
        const field = validateFieldShallow(f, fPath, {
          manifestVersion,
          allowDefaultValue: true,
          allowJavaScript: true,
          allowCollections: true,
          allowVariableToggle: false,
        });
        if (STEP_RESERVED_FIELD_KEYS.includes(field.key)) {
          fail(
            `${fPath}.key`,
            `"${field.key}" is written by the transformer step serializer and cannot be declared`
          );
        }
        if (fieldKeys.has(field.key)) {
          fail(`${fPath}.key`, `duplicate field key "${field.key}" in transformer step`);
        }
        fieldKeys.add(field.key);
        if (isCollectionType(field.type)) collectionKeys.add(field.key);
        collected.push({ field, raw: expectPlainObject(f, fPath), path: fPath });
        return field;
      });
      // Second pass: conditions may reference any SCALAR field key in the same step.
      for (const { field, raw, path: fPath } of collected) {
        if (raw.visibleWhen !== undefined) {
          field.visibleWhen = validateCondition(
            raw.visibleWhen,
            `${fPath}.visibleWhen`,
            fieldKeys,
            collectionKeys
          );
        }
        if (raw.enabledWhen !== undefined) {
          field.enabledWhen = validateCondition(
            raw.enabledWhen,
            `${fPath}.enabledWhen`,
            fieldKeys,
            collectionKeys
          );
        }
      }
    }

    return step;
  });
}

// ─── Entry validation ─────────────────────────────────────────────────────────

/**
 * Validates one raw entry of `GET /extensions/_webadmin`. Never throws:
 * returns `{ ok: false, reason }` with the first failure (including its JSON
 * path) for the Extensions page's skipped-with-reason display. On success,
 * `skippedKinds` lists any v2 reserved contribution kinds this build doesn't
 * implement (their values are excluded from the typed manifest).
 */
export function validateManifestEntry(raw: unknown): ManifestValidationResult {
  try {
    return { ok: true, ...validateEntry(raw) };
  } catch (err) {
    if (err instanceof ManifestRejection) {
      return { ok: false, reason: err.reason };
    }
    throw err;
  }
}

function validateEntry(raw: unknown): {
  entry: ValidatedManifestEntry;
  skippedKinds: SkippedKind[];
} {
  const obj = expectPlainObject(raw, "");
  rejectUnknownKeys(obj, "", ["name", "path", "version", "manifest"]);

  const name = expectString(obj.name, "name", MANIFEST_CAPS.MAX_NAME_LENGTH);
  if (!EXTENSION_NAME_PATTERN.test(name)) fail("name", `"${name}" is not a valid extension name`);
  const path = expectString(obj.path, "path", MANIFEST_CAPS.MAX_NAME_LENGTH);
  if (!EXTENSION_PATH_PATTERN.test(path)) fail("path", `"${path}" is not a valid extension path`);
  const version = expectString(obj.version, "version", MANIFEST_CAPS.MAX_NAME_LENGTH);

  // Size gate before the deep walk — an over-cap manifest is rejected without
  // spending time validating its interior.
  const manifestBytes = JSON.stringify(obj.manifest)?.length ?? 0;
  if (manifestBytes > MANIFEST_CAPS.MAX_MANIFEST_BYTES) {
    fail("manifest", `exceeds ${MANIFEST_CAPS.MAX_MANIFEST_BYTES} bytes`);
  }

  const m = expectPlainObject(obj.manifest, "manifest");
  // The version check runs before the key allowlist because the allowlist is
  // version-dependent: v2 reserves the planned contribution-kind names, v1
  // stays frozen (a v1 manifest using a reserved kind rejects whole). v3 is a
  // superset of v2 (all v2 kinds still valid) plus the collection field grammar.
  const rawManifestVersion = m.manifestVersion;
  if (rawManifestVersion !== 1 && rawManifestVersion !== 2 && rawManifestVersion !== 3) {
    fail(
      "manifest.manifestVersion",
      "unsupported manifest version (this build supports 1, 2, and 3)"
    );
  }
  const manifestVersion: ManifestVersion = rawManifestVersion;
  const knownKeys = [
    // "$schema" is a tooling annotation (points editors at the published JSON
    // Schema for autocomplete/validation). It is not part of the manifest
    // grammar — accepted and ignored at every manifestVersion, so adding a
    // `$schema` line for authoring never causes the runtime to skip the
    // manifest. Must be a string if present.
    "$schema",
    "manifestVersion",
    "minWebAdminVersion",
    "connectorPanels",
    "settingsPanels",
    ...(manifestVersion >= 2 ? RESERVED_V2_KINDS : []),
  ];
  rejectUnknownKeys(m, "manifest", knownKeys);
  if (m.$schema !== undefined) {
    expectString(m.$schema, "manifest.$schema", MANIFEST_CAPS.MAX_ENDPOINT_LENGTH);
  }

  // Reserved v2 kinds this build doesn't implement: collect a per-kind skip
  // and DON'T inspect the value — a future grammar this build can't know must
  // degrade to a skipped kind, never to a whole-manifest reject. (Key-level
  // typos are still caught: a misspelled kind isn't in the allowlist above.)
  const skippedKinds: SkippedKind[] = [];
  if (manifestVersion >= 2) {
    for (const kind of RESERVED_V2_KINDS) {
      if (m[kind] !== undefined && !IMPLEMENTED_V2_KINDS.has(kind)) {
        skippedKinds.push({ kind, reason: "not supported by this WebAdmin build" });
      }
    }
  }

  const manifest: WebAdminManifest = { manifestVersion };

  if (m.minWebAdminVersion !== undefined) {
    const min = expectString(
      m.minWebAdminVersion,
      "manifest.minWebAdminVersion",
      MANIFEST_CAPS.MAX_NAME_LENGTH
    );
    if (!VERSION_PATTERN.test(min)) {
      fail("manifest.minWebAdminVersion", `"${min}" is not a valid version`);
    }
    manifest.minWebAdminVersion = min;
  }

  const connectorCount = Array.isArray(m.connectorPanels) ? m.connectorPanels.length : 0;
  const settingsCount = Array.isArray(m.settingsPanels) ? m.settingsPanels.length : 0;
  // Transmission modes, data types, connector sections, and transformer steps
  // count toward the same combined cap.
  const modeCount =
    manifestVersion >= 2 && Array.isArray(m.transmissionModes) ? m.transmissionModes.length : 0;
  const dataTypeCount = manifestVersion >= 2 && Array.isArray(m.dataTypes) ? m.dataTypes.length : 0;
  const sectionCount =
    manifestVersion >= 2 && Array.isArray(m.connectorSections) ? m.connectorSections.length : 0;
  const stepCount =
    manifestVersion >= 2 && Array.isArray(m.transformerSteps) ? m.transformerSteps.length : 0;
  if (
    connectorCount + settingsCount + modeCount + dataTypeCount + sectionCount + stepCount >
    MANIFEST_CAPS.MAX_PANELS
  ) {
    fail("manifest", `exceeds ${MANIFEST_CAPS.MAX_PANELS} panels`);
  }

  if (m.connectorPanels !== undefined) {
    const rawPanels = expectArray(
      m.connectorPanels,
      "manifest.connectorPanels",
      1,
      MANIFEST_CAPS.MAX_PANELS
    );
    const transportNames = new Set<string>();
    manifest.connectorPanels = rawPanels.map((p, i): ConnectorPanelContribution => {
      const pPath = `manifest.connectorPanels[${i}]`;
      const pObj = expectPlainObject(p, pPath);
      rejectUnknownKeys(pObj, pPath, ["mode", "transportName", "sections", "actions"]);
      const mode = pObj.mode;
      if (mode !== "source" && mode !== "destination") {
        fail(`${pPath}.mode`, `mode must be "source" or "destination"`);
      }
      const transportName = expectString(
        pObj.transportName,
        `${pPath}.transportName`,
        MANIFEST_CAPS.MAX_KEY_LENGTH
      );
      if (!TRANSPORT_NAME_PATTERN.test(transportName)) {
        fail(`${pPath}.transportName`, `"${transportName}" is not a valid transport name`);
      }
      if (transportNames.has(transportName)) {
        fail(`${pPath}.transportName`, `duplicate transport name "${transportName}"`);
      }
      transportNames.add(transportName);

      // Connector panels are where the v3 collection field types + the section
      // `presentation` hint are wired.
      const { sections } = validateSections(pObj.sections, `${pPath}.sections`, {
        manifestVersion,
        allowDefaultValue: false,
        allowCollections: true,
        allowPresentation: true,
      });
      const panel: ConnectorPanelContribution = { mode, transportName, sections };
      if (pObj.actions !== undefined) {
        panel.actions = validateActions(pObj.actions, `${pPath}.actions`, path);
      }
      return panel;
    });
  }

  if (m.settingsPanels !== undefined) {
    const rawPanels = expectArray(
      m.settingsPanels,
      "manifest.settingsPanels",
      1,
      MANIFEST_CAPS.MAX_PANELS
    );
    const tabKeys = new Set<string>();
    manifest.settingsPanels = rawPanels.map((p, i): SettingsPanelContribution => {
      const pPath = `manifest.settingsPanels[${i}]`;
      const pObj = expectPlainObject(p, pPath);
      rejectUnknownKeys(pObj, pPath, ["tabKey", "tabLabel", "sections", "actions"]);
      const tabKey = expectString(pObj.tabKey, `${pPath}.tabKey`, MANIFEST_CAPS.MAX_KEY_LENGTH);
      if (!TAB_KEY_PATTERN.test(tabKey)) {
        fail(`${pPath}.tabKey`, `"${tabKey}" is not a valid tab key (lowercase slug)`);
      }
      if (tabKeys.has(tabKey)) {
        fail(`${pPath}.tabKey`, `duplicate tab key "${tabKey}"`);
      }
      tabKeys.add(tabKey);
      const tabLabel = expectString(
        pObj.tabLabel,
        `${pPath}.tabLabel`,
        MANIFEST_CAPS.MAX_LABEL_LENGTH
      );
      // Settings panels support collection fields (JSON-encoded in the property
      // record) and the section `presentation` hint, like connector panels.
      const { sections } = validateSections(pObj.sections, `${pPath}.sections`, {
        manifestVersion,
        allowDefaultValue: true,
        allowCollections: true,
        allowPresentation: true,
      });
      const panel: SettingsPanelContribution = { tabKey, tabLabel, sections };
      if (pObj.actions !== undefined) {
        panel.actions = validateActions(pObj.actions, `${pPath}.actions`, path);
      }
      return panel;
    });
  }

  if (manifestVersion >= 2 && m.transmissionModes !== undefined) {
    manifest.transmissionModes = validateTransmissionModes(
      m.transmissionModes,
      "manifest.transmissionModes",
      manifestVersion
    );
  }

  if (manifestVersion >= 2 && m.dataTypes !== undefined) {
    manifest.dataTypes = validateDataTypes(m.dataTypes, "manifest.dataTypes", manifestVersion);
  }

  if (manifestVersion >= 2 && m.connectorSections !== undefined) {
    // Double-render guard input: the transports this manifest declares as its
    // own connector panels, per mode (connectorPanels validated above).
    const panelTransportsByMode = new Map<"source" | "destination", Set<string>>([
      ["source", new Set()],
      ["destination", new Set()],
    ]);
    for (const panel of manifest.connectorPanels ?? []) {
      panelTransportsByMode.get(panel.mode)?.add(panel.transportName);
    }
    manifest.connectorSections = validateConnectorSections(
      m.connectorSections,
      "manifest.connectorSections",
      path,
      panelTransportsByMode,
      manifestVersion
    );
  }

  if (manifestVersion >= 2 && m.transformerSteps !== undefined) {
    manifest.transformerSteps = validateTransformerSteps(
      m.transformerSteps,
      "manifest.transformerSteps",
      manifestVersion
    );
  }

  return { entry: { name, path, version, manifest }, skippedKinds };
}
