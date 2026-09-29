/**
 * Declarative runtime plugin UI — manifest schema v1/v2,.
 *
 * A BridgeLink engine extension may ship a `webadmin/webadmin.json` file: a
 * pure-JSON description of the UI it contributes (connector properties panels
 * and settings panels). The engine serves those manifests from
 * `GET /extensions/_webadmin`, and WebAdmin renders them with its own
 * components — no third-party code ever executes in the browser.
 *
 * These types are the single TypeScript source of truth for the contract in
 * `docs/WEBADMIN-PLUGIN-CONTRACT.md`. The schema is deliberately small and
 * additive-only: unknown keys are REJECTED by the validator, so any addition
 * *within* a contribution kind's grammar requires a `manifestVersion` bump (or
 * `minWebAdminVersion` gating). manifestVersion 2 additionally RESERVES the
 * planned kind names (RESERVED_V2_KINDS): a reserved kind this build doesn't
 * implement is skipped per-kind with a visible reason while the manifest's
 * other kinds still load — so shipping a new kind never needs another version
 * bump. The schema must never grow a script or expression hook — anything not
 * expressible declaratively belongs in the extension's own Java servlet.
 */

// ─── Endpoint envelope: GET /extensions/_webadmin ─────────────────────────────

/** Response body of `GET /extensions/_webadmin` (plain JSON, not XStream). */
export interface WebAdminManifestList {
  entries: WebAdminManifestEntry[];
}

/**
 * One installed+enabled extension carrying a webadmin manifest. `name`,
 * `path`, and `version` are engine-authoritative (from the extension's
 * metadata, never from inside the manifest), so they can't disagree with
 * the server's view of the extension.
 */
export interface WebAdminManifestEntry {
  /** Extension name exactly as keyed by `GET /extensions/plugins/`. */
  name: string;
  /** Extension install directory — its `/extensions/<path>/` URL namespace. */
  path: string;
  /** Extension version string (informational, shown in status UI). */
  version: string;
  /** The extension's `webadmin/webadmin.json` contents, passed through verbatim. */
  manifest: unknown;
}

// ─── webadmin.json v1/v2 ──────────────────────────────────────────────────────

/**
 * Contribution-kind names reserved by manifestVersion 2. A v2 manifest may use
 * any of these as a top-level key; a build that doesn't implement one skips
 * that kind with a visible reason (its value is deliberately NOT inspected —
 * a future grammar surprise must degrade to a skip, never to a whole-manifest
 * reject). Non-reserved unknown keys still reject the whole manifest at every
 * version (typo safety).
 */
export const RESERVED_V2_KINDS = [
  "transmissionModes",
  "dataTypes",
  "connectorSections",
  "transformerSteps",
] as const;

export type ReservedV2Kind = (typeof RESERVED_V2_KINDS)[number];

/**
 * Reserved kinds whose grammar THIS build validates and renders. All four
 * reserved kinds are now implemented completed the set), so
 * RESERVED_V2_KINDS − IMPLEMENTED_V2_KINDS is currently empty. The per-kind
 * skip machinery is retained dormant: it is the version-evolution mechanism for
 * any future manifestVersion that reserves further kinds (a build that predates
 * such a kind skips it per-kind with a visible reason instead of rejecting the
 * whole manifest).
 */
export const IMPLEMENTED_V2_KINDS: ReadonlySet<ReservedV2Kind> = new Set<ReservedV2Kind>([
  "transmissionModes",
  "dataTypes",
  "connectorSections",
  "transformerSteps",
]);

export interface WebAdminManifest {
  /**
   * Literal 1, 2, or 3. Any other value is skipped as an unsupported manifest
   * version. v2 = v1 plus the reserved contribution kinds (RESERVED_V2_KINDS);
   * v3 = v2 plus the collection field types + variableToggle + section
   * `presentation` — a within-kind grammar addition, so it requires
   * the version bump.
   */
  manifestVersion: 1 | 2 | 3;
  /** Minimum WebAdmin build version (compared with compareVersions). */
  minWebAdminVersion?: string;
  connectorPanels?: ConnectorPanelContribution[];
  settingsPanels?: SettingsPanelContribution[];
  /** v2 only. */
  transmissionModes?: TransmissionModeContribution[];
  /** v2 only. */
  dataTypes?: DataTypeContribution[];
  /** v2 only. */
  connectorSections?: ConnectorSectionContribution[];
  /** v2 only. */
  transformerSteps?: TransformerStepContribution[];
}

/**
 * A declared TCP transmission mode (v2). Compiled into the host's
 * TransmissionModeDefinition and registered through the same first-wins sink
 * compiled-in plugin modes use — so a runtime mode can never shadow the
 * built-in MLLP/Basic modes.
 *
 * Wire format (strict XStream, like connector panels): `propertiesClass` is
 * written as the `class` attribute of `<transmissionModeProperties>`, `name`
 * as its `<pluginPointName>` child, and each declared field key as a text
 * child element. All of them must be real members of the extension's Java
 * TransmissionModeProperties subclass, and the engine only knows the mode at
 * deploy time once the extension's server jar is installed — otherwise deploy
 * fails with "Unable to find transmission mode plugin".
 *
 * Unlike connector panels, `defaultValue` IS allowed on fields: the client
 * builds the element from scratch (there are no engine-served defaults for
 * this element, even for built-in modes — the Swing client does the same).
 */
export interface TransmissionModeContribution {
  /** Mode identifier → `<pluginPointName>`; the dropdown registry key. */
  name: string;
  /** Dropdown display label. */
  displayName: string;
  /** FQN of the mode's TransmissionModeProperties subclass → `class` attribute. */
  propertiesClass: string;
  /** Default SOM bytes (uppercase hex, may be ""). */
  defaultStartBytes: string;
  /** Default EOM bytes (uppercase hex, may be ""). */
  defaultEndBytes: string;
  /**
   * Validation rules for the host-owned `<startOfMessageBytes>` element (v3).
   *
   * The SOM/EOM rows are rendered and serialized by the dialog itself, so they
   * are not `fields` and their keys are reserved — which left a mode no way to
   * express a byte rule stricter than the shared frame-mode default (valid hex,
   * blanks allowed). A mode whose Java handler requires exactly one byte (the
   * ASTM case, declares that here instead. Rules are evaluated as if
   * against a `text` field, so `min`/`max` are rejected.
   */
  startBytesValidation?: ValidationRule[];
  /** Validation rules for the host-owned `<endOfMessageBytes>` element (v3). */
  endBytesValidation?: ValidationRule[];
  /**
   * Mode-specific fields rendered in the transmission-mode dialog below the
   * shared SOM/EOM rows. Keys become text children of
   * `<transmissionModeProperties>` (the MLLP useMLLPv2/ackBytes pattern) and
   * must not name the elements the shared writer owns (pluginPointName,
   * startOfMessageBytes, endOfMessageBytes).
   */
  fields?: FieldDescriptor[];
}

/**
 * Property groups a declared data type may contribute fields to (v2). The
 * group's XML element name is `${group}Properties` — a class-attributed child
 * of `<inboundProperties>`/`<outboundProperties>` (one level of nesting; the
 * delta from connector panels' flat direct children). Which groups render for
 * a given connector context is HOST-derived from the Java
 * DataTypePropertiesTableModel gating — see PLAN-RuntimeDataTypes-BusinessLogic.md §4.
 *
 * "batch" is declarable like the rest — its script-bearing member
 * (Java BatchProperties.getBatchScript(), PropertyEditorType.JAVASCRIPT) maps
 * to the "javascript" field type, whose value is user-authored channel data.
 */
export const DATA_TYPE_GROUP_NAMES = [
  "serialization",
  "deserialization",
  "batch",
  "responseGeneration",
  "responseValidation",
] as const;

export type DataTypeGroupName = (typeof DATA_TYPE_GROUP_NAMES)[number];

export interface DataTypePropertyGroup {
  group: DataTypeGroupName;
  /**
   * Field keys become text children of the group's element. defaultValue is
   * NOT allowed — the engine's datatype-defaults endpoint is the single
   * source of truth (same rule as connector panels). Conditions may reference
   * keys of the SAME group only.
   */
  fields: FieldDescriptor[];
}

/**
 * A declared data type (v2). Compiled into the host's DataTypeDefinition and
 * registered through the same first-wins sink compiled-in data types use — so
 * a runtime data type can never shadow a built-in (HL7V2, XML, ...).
 *
 * Wire format (strict XStream, like connector panels): the stored element is
 * `<inboundProperties>`/`<outboundProperties>` with a `class` attribute naming
 * the extension's Java DataTypeProperties subclass, containing five
 * class-attributed group elements whose text children are the fields. The
 * element is seeded from the engine's datatype-defaults endpoint
 * (`GET /extensions/{name}/webadmin/datatype-defaults/{dataTypeName}`), so
 * every class attribute is engine-authoritative; the manifest never declares
 * a class name for the properties tree. The engine only knows the type at
 * deserialization/deploy once the extension's server jar is installed.
 */
export interface DataTypeContribution {
  /**
   * The data type key: engine getPluginPointName(), the channel XML
   * `<inboundDataType>` value, the registry/dropdown key, and the
   * datatype-defaults URL segment.
   */
  name: string;
  /** Dropdown display label (defaults to name). */
  displayName?: string;
  /** Binary/opaque content type (Message Trees shows an info note). */
  isBinary?: boolean;
  /**
   * FQN of an attachment-handler provider class, auto-selected when a source
   * inbound type switches to this data type (the DICOM pattern). An FQN this
   * WebAdmin build doesn't know is a graceful no-op.
   */
  defaultAttachmentHandler?: string;
  /** Property groups rendered in the Set Data Types dialog. */
  propertyGroups?: DataTypePropertyGroup[];
}

/**
 * A section an extension injects into OTHER connectors' panels when applicable
 * (v2) — the declarative form of the compiled-in ConnectorPluginDefinition
 * (Java ConnectorPropertiesPlugin: HTTP Authentication, the commercial SSL
 * plugin). Compiled into the host's source/destination connector-plugin
 * registries; see PLAN-RuntimeConnectorSections-BusinessLogic.md.
 *
 * Wire format (strict XStream, like transmission modes): the section owns ONE
 * element — `<{propertiesClass}>` as a direct child of the host connector's
 * direct-child `<pluginProperties>` — with each declared field key as a text
 * child and a `version` attribute copied from the host `<properties>`. The
 * element is built client-side, complete, from the declared fields (the Swing
 * client does the same via panel.getDefaults()), so `defaultValue` IS allowed
 * and every member of the extension's Java ConnectorPluginProperties subclass
 * must be declared as a field (an undeclared member deserializes to null on
 * the engine). The host connector's own fields are unreachable by
 * construction — a runtime section can never edit properties it doesn't own.
 */
export interface ConnectorSectionContribution {
  mode: "source" | "destination";
  /** Section identifier (error paths, status UI); unique across the array. */
  name: string;
  /**
   * FQN of the extension's ConnectorPluginProperties subclass — the element
   * tag under `<pluginProperties>`. (mode, propertiesClass) pairs are unique;
   * the same class on both modes is allowed (the SSL source/destination
   * mirror). Classes owned by compiled-in sections (SSL, HTTP Auth) are
   * rejected — two writers on one element silently corrupt each other.
   */
  propertiesClass: string;
  /**
   * Transport names the section applies to (Java isSupported parity — a pure
   * name match, evaluated per connector type). A transport the same manifest
   * declares as a connectorPanel with the same mode is rejected (ambiguous
   * double-render).
   */
  appliesTo: string[];
  /** defaultValue allowed (client-built element); "javascript" forbidden. */
  sections: PanelSection[];
  actions?: ActionButton[];
  /**
   * When the section "secures the transport" (the ConnectorTypeDecoration
   * boolean): literal true = always while the section applies (the SSL
   * destination precedent), or a Condition over this contribution's field
   * keys evaluated against the section's effective values (the SSL source
   * sslEnabled precedent). Omit for no decoration (the HttpAuth precedent).
   */
  securesTransportWhen?: true | Condition;
}

/**
 * A declared filter/transformer step type (v2) — the declarative form of the
 * compiled-in transformer-step registry entry (Java TransformerStepPlugin, e.g.
 * Mapper, JavaScript, XSLT). Compiled into the host's TransformerStepDefinition
 * and registered through the same first-wins sink compiled-in steps use — so a
 * runtime step can never shadow a built-in.
 *
 * NOTE: a grammar-side type distinct from the registry-side
 * `TransformerStepContribution` in lib/plugin-manifest.ts (which is the compiled
 * `TransformerStepDefinition<TransformerStepBase>`). Same name for kind-symmetry
 * with the other contribution kinds; different module, different shape.
 *
 * Wire format (strict XStream, like transmission modes): the step is stored as
 * `<{stepClass} version="…">` in the channel's `<elements>` list, with `<name>`,
 * `<sequenceNumber>`, `<enabled>` written by the shared step registry and each
 * declared field key as a text child. The element is built client-side, complete,
 * from the declared fields (the client never fetches step defaults — the engine
 * regenerates the deployed script from the persisted properties). So
 * `defaultValue` IS allowed, and every member of the extension's Java Step
 * subclass must be declared as a field (an undeclared member deserializes to null
 * on the engine).
 *
 * No script hook: the WebUI's emitScript is display-only and the engine's Java
 * plugin regenerates the step's script at deploy, so a runtime step renders a
 * server-generation stub (a comment) in the read-only Generated Script tab.
 * The "javascript" field type IS allowed (unlike transmission modes) — it is the
 * Java PropertyEditorType.JAVASCRIPT editor, whose value is user-authored channel
 * data executed by the engine, not manifest-supplied code (see FieldType below).
 */
export interface TransformerStepContribution {
  /**
   * Step type → the registry key AND the display label everywhere in the host
   * (Add dropdown, step-list table, detail pane). Should match the server
   * plugin's getPluginPointName(). Unique across the array.
   */
  name: string;
  /**
   * FQN of the extension's Java Step subclass — the channel-XML element tag.
   * Unique across the array; the seven built-in step classes are rejected (a
   * runtime step can never redefine a built-in's element).
   */
  stepClass: string;
  /**
   * Contexts the step appears in ("Add" dropdown) — the Java onlySourceConnector
   * analog. Required; 1-2 unique entries.
   */
  contexts: ("source" | "destination")[];
  /**
   * Step fields rendered in the detail pane; keys become text children of the
   * step element. defaultValue is allowed (client-built element) EXCEPT on
   * "javascript" fields (a default script would be manifest-supplied code). Keys
   * must not name the elements the step registry owns (name, sequenceNumber,
   * enabled).
   */
  fields?: FieldDescriptor[];
}

/** A declared connector type with its schema-rendered properties panel. */
export interface ConnectorPanelContribution {
  mode: "source" | "destination";
  /** Connector registry key + Connector Type dropdown entry. */
  transportName: string;
  sections: PanelSection[];
  actions?: ActionButton[];
}

/**
 * A declared Settings tab. Field keys map to entries of the extension's
 * `/extensions/{name}/properties` Record<string, string>.
 */
export interface SettingsPanelContribution {
  /** Slug (^[a-z0-9-]+$); namespaced with the extension name at registration. */
  tabKey: string;
  tabLabel: string;
  sections: PanelSection[];
  actions?: ActionButton[];
}

export interface PanelSection {
  title: string;
  fields: FieldDescriptor[];
  /**
   * v3. "dialog" renders the section's fields behind an Advanced
   * button in a modal (the FTP/SFTP/S3-advanced pattern); "inline" (default)
   * renders them in place. A hint only — the field grammar and binding are
   * identical either way.
   */
  presentation?: "inline" | "dialog";
}

/**
 * One column of a `table` field (v3). Each column is a text child element of the
 * row's nested class element, keyed by `element` (a valid field key). Columns
 * are the COMPLETE row: a new row always writes every declared column (empty
 * when unset) so strict XStream never sees a partial object.
 */
export interface TableColumn {
  /** Row-element child tag name (e.g. "name", "mimeType"). */
  element: string;
  label: string;
  placeholder?: string;
}

/**
 * The "use variable" mode toggle paired with a collection field (v3). Mirrors the
 * compiled-in SMTP/HTTP/WS panels: a radio switches between the collection editor
 * and a single channel-variable name that supplies the collection at runtime.
 * Both companion element names are explicit because the wire naming is
 * inconsistent (`isUseHeadersVariable` on SMTP/WS vs `useHeadersVariable` on HTTP).
 * The toggle writes ONLY the boolean and the variable name — never the collection
 * element — so table content is preserved while in variable mode.
 */
export interface VariableToggleDescriptor {
  /** Sibling element holding the variable name (e.g. "headersVariable"). */
  variableKey: string;
  /** Sibling boolean element gating variable mode (e.g. "isUseHeadersVariable"). */
  useVariableKey: string;
  /** Radio label for collection mode (default "Use Table"). */
  tableLabel?: string;
  /** Radio label for variable mode (default "Use Variable"). */
  variableLabel?: string;
  variablePlaceholder?: string;
  variableTooltip?: string;
}

/**
 * "javascript" is allowed on DATA TYPE and TRANSFORMER STEP fields only (the
 * Java PropertyEditorType.JAVASCRIPT editor): it renders the host's Monaco
 * script editor dialog, and the VALUE is user-authored channel data executed by
 * the ENGINE at message time — exactly like editing the element in the XML tab.
 * This is an editor type, not a script hook: no code ever travels in the
 * manifest (defaultValue is forbidden on javascript fields, so even the default
 * script comes from the engine's own Java class), and WebAdmin never executes
 * the value.
 */
export type FieldType =
  | "text"
  | "secret"
  | "number"
  | "checkbox"
  | "select"
  | "radio"
  | "textarea"
  | "javascript"
  // Collection field types (v3,. Values are repeated child structure,
  // not a single string — bound directly to the properties XML (connector panels)
  // or as canonical JSON (settings panels), never via the scalar value model.
  | "map"
  | "multimap"
  | "stringList"
  | "table";

/** The v3 collection field types (repeated-structure, not scalar). */
export const COLLECTION_FIELD_TYPES = ["map", "multimap", "stringList", "table"] as const;
export type CollectionFieldType = (typeof COLLECTION_FIELD_TYPES)[number];

/**
 * One form field. The value model is strings throughout: checkbox fields
 * read/write the literal strings "true"/"false" (XStream boolean text) and
 * number fields are numeric-validated strings.
 */
export interface FieldDescriptor {
  /**
   * Connector panels: the name of a direct child element of the connector's
   * `<properties>` XML. Settings panels: the property record key.
   */
  key: string;
  type: FieldType;
  label: string;
  tooltip?: string;
  /** text/secret/number/textarea only. */
  placeholder?: string;
  /** REQUIRED for select/radio; forbidden on other types. */
  options?: FieldOption[];
  /** Settings panels only — connector defaults come from the engine's defaults endpoint. */
  defaultValue?: string;
  visibleWhen?: Condition;
  enabledWhen?: Condition;
  validation?: ValidationRule[];

  // ─── Collection field grammar (v3, ───────────────────────────────
  // Present only on collection-typed fields; validation forbids each on the
  // scalar types (and forbids scalar-only keys — placeholder/options/
  // defaultValue/validation — on collection types).
  /** map/multimap: header for the key column (default "Name"). */
  keyLabel?: string;
  /** map/multimap: header for the value column (default "Value"). */
  valueLabel?: string;
  /** stringList: header for the single column. */
  itemLabel?: string;
  /** All collections: the add-row button label (default "Add"). */
  addLabel?: string;
  /** table: FQN of the row's nested class element. */
  rowElement?: string;
  /** table: the row's column set (the complete row shape). */
  columns?: TableColumn[];
  /** map/multimap/stringList/table: the paired "use variable" mode toggle. */
  variableToggle?: VariableToggleDescriptor;
}

export interface FieldOption {
  value: string;
  label: string;
}

// ─── Conditions ───────────────────────────────────────────────────────────────

export type LeafCondition =
  | { field: string; op: "eq"; value: string }
  | { field: string; op: "ne"; value: string }
  | { field: string; op: "in"; values: string[] }
  /** True when the value is "true", or non-empty and not "false". */
  | { field: string; op: "truthy" };

/** Composites may nest LEAF conditions only (max depth 2 by construction). */
export type Condition = LeafCondition | { allOf: LeafCondition[] } | { anyOf: LeafCondition[] };

// ─── Validation rules ─────────────────────────────────────────────────────────

export type ValidationRule =
  | { rule: "required"; message?: string }
  /** JS RegExp source, tested unanchored via RegExp.test; length-capped (ReDoS). */
  | { rule: "pattern"; pattern: string; message?: string }
  /** number fields only. */
  | { rule: "min"; value: number; message?: string }
  /** number fields only. */
  | { rule: "max"; value: number; message?: string };

// ─── Action buttons ───────────────────────────────────────────────────────────

/**
 * A declared button that calls one of the contributing extension's OWN REST
 * endpoints on the user's existing session. The validator enforces that
 * `endpoint` starts with `/extensions/<entry.path>/` — an extension can never
 * point a button at another extension or at a core endpoint.
 */
export interface ActionButton {
  label: string;
  endpoint: string;
  method: "GET" | "POST";
  /** Optional plain-text confirmation prompt shown before the call. */
  confirm?: string;
}

// ─── Validated shapes (produced only by the validator) ───────────────────────

/** A manifest entry that passed strict validation; `manifest` is fully typed. */
export interface ValidatedManifestEntry {
  name: string;
  path: string;
  version: string;
  manifest: WebAdminManifest;
}

// ─── Complexity caps (validator-enforced; violations name the cap) ───────────

export const MANIFEST_CAPS = {
  /** JSON.stringify length gate applied before deep validation. */
  MAX_MANIFEST_BYTES: 65_536,
  /**
   * connectorPanels + settingsPanels + transmissionModes + dataTypes +
   * connectorSections + transformerSteps combined.
   */
  MAX_PANELS: 8,
  /** Transport names per connectorSections[].appliesTo. */
  MAX_SECTION_TRANSPORTS: 16,
  MAX_SECTIONS_PER_PANEL: 8,
  /** Summed across all of a panel's sections. */
  MAX_FIELDS_PER_PANEL: 64,
  MAX_OPTIONS_PER_FIELD: 32,
  MAX_ACTIONS_PER_PANEL: 4,
  MAX_RULES_PER_FIELD: 8,
  /** Composite conditions may contain leaf conditions only. */
  MAX_CONDITION_DEPTH: 2,
  /** Terms per allOf/anyOf, and values per `in` condition. */
  MAX_CONDITION_TERMS: 8,
  /** Labels, section titles, option labels, tab labels. */
  MAX_LABEL_LENGTH: 120,
  /** Tooltips, messages, confirm prompts, placeholders, option/default/condition values. */
  MAX_TEXT_LENGTH: 500,
  /** Field keys, tabKey, transportName. */
  MAX_KEY_LENGTH: 64,
  /** Extension name / path / version strings in the envelope. */
  MAX_NAME_LENGTH: 128,
  MAX_ENDPOINT_LENGTH: 256,
  /** Regex source cap (validation-time compile check too). */
  MAX_PATTERN_LENGTH: 256,
  /** Runtime input cap for boundedRegexTest — inputs longer than this fail closed. */
  MAX_PATTERN_INPUT_LENGTH: 4_096,
  /** Manifest-list entries processed per load — excess is dropped with a warning. */
  MAX_MANIFEST_ENTRIES: 64,
  /** Byte ceiling on one engine-served defaults XML body. */
  MAX_DEFAULTS_XML_BYTES: 524_288,
  // ─── Collection field caps (v3, ───────────────────────────────────
  /** Rows the renderer lets the user ADD to a collection; reads never truncate. */
  MAX_COLLECTION_ROWS: 128,
  /** maxLength of a collection cell input; reads never truncate. */
  MAX_COLLECTION_CELL_LENGTH: 4_096,
  /** Columns per `table` field. */
  MAX_TABLE_COLUMNS: 8,
} as const;

// ─── Per-extension load status (Extensions page "Web contributions") ─────────

/**
 * One contribution dropped at registration: by a first-wins registry collision
 *, or a data type whose engine defaults 404'd.
 */
export interface DroppedContribution {
  kind: string;
  key: string;
  reason: string;
}

/**
 * One reserved contribution kind skipped because this build doesn't implement
 * it. Orthogonal to droppedContributions: a skipped kind is an
 * expected version-window outcome, not a conflict — it coexists with "loaded"
 * and must not render as an error/amber state.
 */
export interface SkippedKind {
  kind: string;
  reason: string;
}

export interface RuntimePluginStatus {
  name: string;
  path: string;
  version: string;
  /**
   * "partial" = registered, but at least one contribution was dropped — by a
   * first-wins registry collision, or a data type whose engine defaults 404'd
   * (see droppedContributions).
   */
  status: "loaded" | "partial" | "skipped";
  /** Present when skipped — the single human-readable reason. */
  reason?: string;
  /** Contributions actually registered (accepted + still-deferred). */
  contributionCount: number;
  /** Present when status is "partial" — what was dropped, and why. */
  droppedContributions?: DroppedContribution[];
  /** Reserved kinds this build doesn't implement — skipped, other kinds loaded. */
  skippedKinds?: SkippedKind[];
}

/**
 * State of the manifest-list fetch itself. "unavailable" means the endpoint
 * failed or is absent (older Core) — boot proceeded with zero runtime plugins.
 */
export type RuntimeManifestListState = "idle" | "loaded" | "unavailable";
