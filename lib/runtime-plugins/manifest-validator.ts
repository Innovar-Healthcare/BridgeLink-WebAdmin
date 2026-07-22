/**
 * Strict validator for runtime plugin manifest entries.
 *
 * Validates one raw entry of `GET /extensions/_webadmin` against the frozen
 * v1 contract (docs/WEBADMIN-PLUGIN-CONTRACT.md). Deliberately strict:
 *
 *  - Unknown keys are REJECTED at every level, so the schema can only grow
 *    behind a `manifestVersion` bump. This is also what forbids
 *    `licensedPluginId` (and any other host-internal field) on runtime
 *    manifests — they simply aren't in the schema.
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
  MANIFEST_CAPS,
  type ActionButton,
  type Condition,
  type ConnectorPanelContribution,
  type FieldDescriptor,
  type FieldOption,
  type FieldType,
  type LeafCondition,
  type PanelSection,
  type SettingsPanelContribution,
  type ValidatedManifestEntry,
  type ValidationRule,
  type WebAdminManifest,
} from "./manifest-types";

export type ManifestValidationResult =
  | { ok: true; entry: ValidatedManifestEntry }
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
/** minWebAdminVersion: dotted numerics only. */
const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

// ─── Conditions ───────────────────────────────────────────────────────────────

function validateLeafCondition(
  v: unknown,
  path: string,
  fieldKeys: ReadonlySet<string>
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

function validateCondition(v: unknown, path: string, fieldKeys: ReadonlySet<string>): Condition {
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
      return validateLeafCondition(term, `${path}.${kind}[${i}]`, fieldKeys);
    });
    return isAllOf ? { allOf: terms } : { anyOf: terms };
  }
  return validateLeafCondition(v, path, fieldKeys);
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
];
const PLACEHOLDER_TYPES: FieldType[] = ["text", "secret", "number", "textarea"];

function validateFieldShallow(v: unknown, path: string, isSettingsPanel: boolean): FieldDescriptor {
  const obj = expectPlainObject(v, path);
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

  const key = expectString(obj.key, `${path}.key`, MANIFEST_CAPS.MAX_KEY_LENGTH);
  if (!FIELD_KEY_PATTERN.test(key)) {
    fail(`${path}.key`, `"${key}" is not a valid field key`);
  }
  const rawType = obj.type;
  if (typeof rawType !== "string" || !(FIELD_TYPES as readonly string[]).includes(rawType)) {
    fail(`${path}.type`, `type must be one of ${FIELD_TYPES.map((t) => `"${t}"`).join(", ")}`);
  }
  const type = rawType as FieldType;
  const label = expectString(obj.label, `${path}.label`, MANIFEST_CAPS.MAX_LABEL_LENGTH);

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
    if (!isSettingsPanel) {
      fail(
        `${path}.defaultValue`,
        "not allowed on connector panel fields (defaults come from the engine defaults endpoint)"
      );
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

// ─── Sections and panels ──────────────────────────────────────────────────────

interface RawSectionField {
  field: FieldDescriptor;
  raw: Record<string, unknown>;
  path: string;
}

function validateSections(
  v: unknown,
  path: string,
  isSettingsPanel: boolean
): { sections: PanelSection[]; fieldKeys: Set<string> } {
  const rawSections = expectArray(v, path, 1, MANIFEST_CAPS.MAX_SECTIONS_PER_PANEL);
  const fieldKeys = new Set<string>();
  const collected: RawSectionField[] = [];
  let totalFields = 0;

  const sections = rawSections.map((sec, sIdx): PanelSection => {
    const sPath = `${path}[${sIdx}]`;
    const secObj = expectPlainObject(sec, sPath);
    rejectUnknownKeys(secObj, sPath, ["title", "fields"]);
    const title = expectString(secObj.title, `${sPath}.title`, MANIFEST_CAPS.MAX_LABEL_LENGTH);
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
      const field = validateFieldShallow(f, fPath, isSettingsPanel);
      if (fieldKeys.has(field.key)) {
        fail(`${fPath}.key`, `duplicate field key "${field.key}" in panel`);
      }
      fieldKeys.add(field.key);
      collected.push({ field, raw: expectPlainObject(f, fPath), path: fPath });
      return field;
    });
    return { title, fields };
  });

  // Second pass: conditions may reference any field key in the same panel.
  for (const { field, raw, path: fPath } of collected) {
    if (raw.visibleWhen !== undefined) {
      field.visibleWhen = validateCondition(raw.visibleWhen, `${fPath}.visibleWhen`, fieldKeys);
    }
    if (raw.enabledWhen !== undefined) {
      field.enabledWhen = validateCondition(raw.enabledWhen, `${fPath}.enabledWhen`, fieldKeys);
    }
  }

  return { sections, fieldKeys };
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

// ─── Entry validation ─────────────────────────────────────────────────────────

/**
 * Validates one raw entry of `GET /extensions/_webadmin`. Never throws:
 * returns `{ ok: false, reason }` with the first failure (including its JSON
 * path) for the Extensions page's skipped-with-reason display.
 */
export function validateManifestEntry(raw: unknown): ManifestValidationResult {
  try {
    return { ok: true, entry: validateEntry(raw) };
  } catch (err) {
    if (err instanceof ManifestRejection) {
      return { ok: false, reason: err.reason };
    }
    throw err;
  }
}

function validateEntry(raw: unknown): ValidatedManifestEntry {
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
  rejectUnknownKeys(m, "manifest", [
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
  ]);
  if (m.$schema !== undefined) {
    expectString(m.$schema, "manifest.$schema", MANIFEST_CAPS.MAX_ENDPOINT_LENGTH);
  }
  if (m.manifestVersion !== 1) {
    fail("manifest.manifestVersion", "unsupported manifest version (this build supports 1)");
  }

  const manifest: WebAdminManifest = { manifestVersion: 1 };

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
  if (connectorCount + settingsCount > MANIFEST_CAPS.MAX_PANELS) {
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

      const { sections } = validateSections(pObj.sections, `${pPath}.sections`, false);
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
      const { sections } = validateSections(pObj.sections, `${pPath}.sections`, true);
      const panel: SettingsPanelContribution = { tabKey, tabLabel, sections };
      if (pObj.actions !== undefined) {
        panel.actions = validateActions(pObj.actions, `${pPath}.actions`, path);
      }
      return panel;
    });
  }

  return { name, path, version, manifest };
}
