/**
 * Declarative runtime plugin UI — manifest schema v1.
 *
 * A BridgeLink engine extension may ship a `webadmin/webadmin.json` file: a
 * pure-JSON description of the UI it contributes (connector properties panels
 * and settings panels). The engine serves those manifests from
 * `GET /extensions/_webadmin`, and WebAdmin renders them with its own
 * components — no third-party code ever executes in the browser.
 *
 * These types are the single TypeScript source of truth for the frozen
 * contract in `docs/WEBADMIN-PLUGIN-CONTRACT.md`. The schema is deliberately
 * small and additive-only: unknown keys are REJECTED by the validator, so any
 * future addition requires a `manifestVersion` bump. The schema must never
 * grow a script or expression hook — anything not expressible declaratively
 * belongs in the extension's own Java servlet.
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

// ─── webadmin.json v1 ─────────────────────────────────────────────────────────

export interface WebAdminManifest {
  /** Literal 1. Any other value is skipped as an unsupported manifest version. */
  manifestVersion: 1;
  /** Minimum WebAdmin build version (compared with compareVersions). */
  minWebAdminVersion?: string;
  connectorPanels?: ConnectorPanelContribution[];
  settingsPanels?: SettingsPanelContribution[];
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
}

export type FieldType = "text" | "secret" | "number" | "checkbox" | "select" | "radio" | "textarea";

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
  /** connectorPanels + settingsPanels combined. */
  MAX_PANELS: 8,
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
} as const;

// ─── Per-extension load status (Extensions page "Web contributions") ─────────

/** One contribution dropped by a first-wins registry collision. */
export interface DroppedContribution {
  kind: string;
  key: string;
  reason: string;
}

export interface RuntimePluginStatus {
  name: string;
  path: string;
  version: string;
  /**
   * "partial" = registered, but at least one contribution was dropped by a
   * first-wins registry collision (see droppedContributions).
   */
  status: "loaded" | "partial" | "skipped";
  /** Present when skipped — the single human-readable reason. */
  reason?: string;
  /** Contributions actually registered (accepted + still-deferred). */
  contributionCount: number;
  /** Present when status is "partial" — what was dropped, and why. */
  droppedContributions?: DroppedContribution[];
}

/**
 * State of the manifest-list fetch itself. "unavailable" means the endpoint
 * failed or is absent (older Core) — boot proceeded with zero runtime plugins.
 */
export type RuntimeManifestListState = "idle" | "loaded" | "unavailable";
