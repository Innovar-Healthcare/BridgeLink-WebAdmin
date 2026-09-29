/**
 * Derives the on-page grammar reference tables from the published v3 JSON
 * Schema, so the docs can't drift from what the validator actually accepts
 *. Field-type lists and per-kind availability come from the schema's
 * `$defs`; the complexity caps come from `MANIFEST_CAPS` (code-authoritative —
 * the schema's own maxItems are deliberately looser than the validator).
 *
 * Defensive throughout: an unexpected schema shape yields null, and the pane
 * falls back to a "reference unavailable" note.
 */

import { MANIFEST_CAPS } from "@/lib/runtime-plugins/manifest-types";

export interface KindCapability {
  /** Contribution-kind array key (e.g. "connectorPanels"). */
  key: string;
  label: string;
  /** Scalar field types this kind accepts (7 standard, +javascript for data/step kinds). */
  scalarTypes: string[];
  allowsJavascript: boolean;
  allowsCollections: boolean;
  allowsDefaultValue: boolean;
  /** A caveat on allowsDefaultValue (e.g. the step grammar forbids it on javascript fields). */
  defaultValueNote?: string;
  allowsActions: boolean;
}

export interface CapRow {
  key: string;
  label: string;
  value: number;
}

export interface ReferenceModel {
  standardTypes: string[];
  collectionTypes: string[];
  kinds: KindCapability[];
  caps: CapRow[];
}

/** (kind key, display label, field $def name, whether the grammar allows action buttons). */
const KIND_DEFS = [
  { key: "connectorPanels", label: "Connector panel", def: "connectorField", actions: true },
  { key: "settingsPanels", label: "Settings panel", def: "settingsField", actions: true },
  {
    key: "connectorSections",
    label: "Connector section",
    def: "connectorSectionField",
    actions: true,
  },
  {
    key: "transmissionModes",
    label: "Transmission mode",
    def: "transmissionModeField",
    actions: false,
  },
  { key: "dataTypes", label: "Data type", def: "dataTypeField", actions: false },
  {
    key: "transformerSteps",
    label: "Transformer step",
    def: "transformerStepField",
    actions: false,
  },
] as const;

/** Curated author-facing caps, in a sensible reading order. */
const CAP_DEFS: { key: keyof typeof MANIFEST_CAPS; label: string }[] = [
  { key: "MAX_PANELS", label: "Contributions per manifest (all kinds)" },
  { key: "MAX_SECTIONS_PER_PANEL", label: "Sections per panel" },
  { key: "MAX_FIELDS_PER_PANEL", label: "Fields per panel (summed across sections)" },
  { key: "MAX_OPTIONS_PER_FIELD", label: "Options per select / radio field" },
  { key: "MAX_ACTIONS_PER_PANEL", label: "Action buttons per panel" },
  { key: "MAX_RULES_PER_FIELD", label: "Validation rules per field" },
  { key: "MAX_SECTION_TRANSPORTS", label: "appliesTo transports per section" },
  { key: "MAX_TABLE_COLUMNS", label: "Columns per table field" },
  { key: "MAX_COLLECTION_ROWS", label: "Rows addable per collection field (UI)" },
  { key: "MAX_MANIFEST_BYTES", label: "Manifest size (bytes)" },
];

type Json = Record<string, unknown>;

const asObject = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const refName = (ref: unknown): string | undefined =>
  typeof ref === "string" ? ref.split("/").pop() : undefined;

interface FieldAnalysis {
  scalarTypes: string[];
  allowsJavascript: boolean;
  allowsCollections: boolean;
  allowsDefaultValue: boolean;
  /** defaultValue is allowed generally but forbidden on javascript fields (the step grammar). */
  defaultValueExceptJavascript: boolean;
}

/** True for `{ if: type == "javascript", then: not required defaultValue }`. */
function isJavascriptDefaultValueGuard(entry: Json): boolean {
  const ifClause = asObject(entry.if);
  const thenClause = asObject(entry.then);
  if (!ifClause || !thenClause) return false;
  const ifProps = asObject(ifClause.properties);
  const ifType = ifProps ? asObject(ifProps.type) : null;
  const isJs =
    !!ifType &&
    (ifType.const === "javascript" ||
      (Array.isArray(ifType.enum) && ifType.enum.includes("javascript")));
  const thenNot = asObject(thenClause.not);
  const forbids =
    !!thenNot && Array.isArray(thenNot.required) && thenNot.required.includes("defaultValue");
  return isJs && forbids;
}

/** Reads a per-kind field `$def` (a `oneOf[scalar, collection]`, or a scalar-only `allOf`). */
function analyzeFieldDef(def: unknown, standardTypes: string[]): FieldAnalysis | null {
  const d = asObject(def);
  if (!d) return null;

  let scalarBranch: Json | null = null;
  let allowsCollections = false;
  if (Array.isArray(d.oneOf)) {
    for (const branch of d.oneOf) {
      const b = asObject(branch);
      if (b && refName(b.$ref) === "collectionField") {
        allowsCollections = true;
        continue;
      }
      // A second scalar candidate means the shape isn't what we model → bail.
      if (b) {
        if (scalarBranch) return null;
        scalarBranch = b;
      }
    }
  } else if (Array.isArray(d.allOf)) {
    scalarBranch = d; // scalar-only kind (transmission mode)
  }
  if (!scalarBranch || !Array.isArray(scalarBranch.allOf)) return null;

  let scalarTypes: string[] | null = null;
  let allowsDefaultValue = false;
  let forbidsDefaultValue = false;
  let defaultValueExceptJavascript = false;
  for (const entry of scalarBranch.allOf) {
    const e = asObject(entry);
    if (!e) continue;
    const not = asObject(e.not);
    if (not && Array.isArray(not.required) && not.required.includes("defaultValue")) {
      forbidsDefaultValue = true;
    }
    if (isJavascriptDefaultValueGuard(e)) defaultValueExceptJavascript = true;
    const props = asObject(e.properties);
    const typeSchema = props ? asObject(props.type) : null;
    if (typeSchema) {
      if (refName(typeSchema.$ref) === "standardFieldType") scalarTypes = standardTypes;
      else if (Array.isArray(typeSchema.enum)) scalarTypes = typeSchema.enum as string[];
    }
    if (props && props.defaultValue !== undefined) allowsDefaultValue = true;
  }
  if (!scalarTypes) return null;

  return {
    scalarTypes,
    allowsJavascript: scalarTypes.includes("javascript"),
    allowsCollections,
    allowsDefaultValue: allowsDefaultValue && !forbidsDefaultValue,
    defaultValueExceptJavascript: defaultValueExceptJavascript && !forbidsDefaultValue,
  };
}

export function buildReferenceModel(schema: unknown): ReferenceModel | null {
  const root = asObject(schema);
  const defs = root ? asObject(root.$defs) : null;
  if (!defs) return null;

  const standard = asObject(defs.standardFieldType);
  const collection = asObject(defs.collectionFieldType);
  if (!standard || !Array.isArray(standard.enum)) return null;
  if (!collection || !Array.isArray(collection.enum)) return null;
  const standardTypes = standard.enum as string[];
  const collectionTypes = collection.enum as string[];

  const kinds: KindCapability[] = [];
  for (const kd of KIND_DEFS) {
    const analysis = analyzeFieldDef(defs[kd.def], standardTypes);
    if (!analysis) return null; // unexpected schema shape → whole reference unavailable
    kinds.push({
      key: kd.key,
      label: kd.label,
      scalarTypes: analysis.scalarTypes,
      allowsJavascript: analysis.allowsJavascript,
      allowsCollections: analysis.allowsCollections,
      allowsDefaultValue: analysis.allowsDefaultValue,
      defaultValueNote: analysis.defaultValueExceptJavascript
        ? "not on javascript fields"
        : undefined,
      allowsActions: kd.actions,
    });
  }

  const caps: CapRow[] = CAP_DEFS.map((c) => ({
    key: c.key,
    label: c.label,
    value: MANIFEST_CAPS[c.key],
  }));

  return { standardTypes, collectionTypes, kinds, caps };
}

/** Whether a field type is allowed in a given kind (for the availability matrix). */
export function isFieldTypeAllowed(
  model: ReferenceModel,
  fieldType: string,
  kind: KindCapability
): boolean {
  if (kind.scalarTypes.includes(fieldType)) return true;
  return model.collectionTypes.includes(fieldType) && kind.allowsCollections;
}
