/**
 * Seed data + shared constants for the Manifest Preview page Slice 3,
 * extended. Extracted from page.tsx so the page component stays
 * focused on state/layout and this module holds the (large) example manifest.
 *
 * The seed exercises every contribution kind so the page renders a preview tab
 * for each one out of the box — connector panel, settings panel, transmission
 * mode, data type, connector section, and transformer step (six panels, under
 * the MANIFEST_CAPS.MAX_PANELS ceiling of 8).
 */

import type { PreviewEnvelope } from "./preview-model";
import {
  COLLECTION_FIELD_TYPES,
  type DataTypeContribution,
} from "@/lib/runtime-plugins/manifest-types";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

/** The published v3 schema URI (also the manifest `$schema` value). */
export const SCHEMA_URI = "https://schemas.bridgelink.online/webadmin-plugin/v3.json";

/** Seed Defaults XML for a connector panel that has no author-supplied XML yet. */
export const SEED_PROPERTIES_XML =
  '<properties class="com.example.PreviewSenderProperties" version="1.0.0">\n</properties>';

/** Shared Monaco options for the editors on this page. */
export const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  fontSize: 12,
} as const;

export const DEFAULT_ENVELOPE: PreviewEnvelope = {
  name: "Preview Extension",
  path: "preview-ext",
  version: "1.0.0",
};

export const SEED_MANIFEST = {
  $schema: SCHEMA_URI,
  manifestVersion: 3,
  connectorPanels: [
    {
      mode: "destination",
      transportName: "Preview Sender",
      sections: [
        {
          title: "Connection",
          fields: [
            {
              key: "host",
              type: "text",
              label: "Host",
              tooltip: "Hostname or IP address of the remote server.",
              validation: [{ rule: "required" }],
            },
            { key: "port", type: "number", label: "Port", validation: [{ rule: "min", value: 1 }] },
            {
              key: "encryption",
              type: "select",
              label: "Encryption",
              options: [
                { value: "none", label: "None" },
                { value: "TLS", label: "TLS" },
              ],
            },
            { key: "useAuth", type: "checkbox", label: "Use Authentication" },
            {
              key: "username",
              type: "text",
              label: "Username",
              visibleWhen: { field: "useAuth", op: "truthy" },
              validation: [{ rule: "required" }],
            },
          ],
        },
        {
          title: "Headers",
          fields: [
            {
              key: "headers",
              type: "map",
              label: "Headers",
              keyLabel: "Name",
              valueLabel: "Value",
              addLabel: "Add Header",
              variableToggle: {
                variableKey: "headersVariable",
                useVariableKey: "isUseHeadersVariable",
                tableLabel: "Use Table",
                variableLabel: "Use Map",
                variablePlaceholder: "Map variable name",
              },
            },
          ],
        },
      ],
      actions: [
        {
          label: "Test Connection",
          endpoint: "/extensions/preview-ext/webadmin/actions/test-connection",
          method: "POST",
        },
      ],
    },
  ],
  settingsPanels: [
    {
      tabKey: "preview-ext",
      tabLabel: "Preview Extension",
      sections: [
        {
          title: "Defaults",
          fields: [
            {
              key: "defaultHost",
              type: "text",
              label: "Default Host",
              defaultValue: "example.com",
            },
            {
              key: "auditEnabled",
              type: "checkbox",
              label: "Audit Enabled",
              defaultValue: "false",
            },
          ],
        },
      ],
    },
  ],
  transmissionModes: [
    {
      name: "Preview Framing",
      displayName: "Preview Framing",
      propertiesClass: "com.example.PreviewFramingModeProperties",
      defaultStartBytes: "0B",
      defaultEndBytes: "1C0D",
      fields: [
        {
          key: "useChecksum",
          type: "checkbox",
          label: "Use Checksum",
          defaultValue: "false",
        },
        {
          key: "checksumAlgorithm",
          type: "select",
          label: "Checksum Algorithm",
          defaultValue: "crc32",
          visibleWhen: { field: "useChecksum", op: "truthy" },
          options: [
            { value: "crc32", label: "CRC-32" },
            { value: "adler32", label: "Adler-32" },
          ],
        },
      ],
    },
  ],
  dataTypes: [
    {
      name: "PreviewType",
      displayName: "Preview Type",
      propertyGroups: [
        {
          group: "serialization",
          fields: [
            {
              key: "parseMode",
              type: "select",
              label: "Parse Mode",
              options: [
                { value: "strict", label: "Strict" },
                { value: "lenient", label: "Lenient" },
              ],
            },
            {
              key: "stripWhitespace",
              type: "checkbox",
              label: "Strip Whitespace",
            },
          ],
        },
        {
          group: "batch",
          fields: [
            {
              key: "splitType",
              type: "select",
              label: "Split Batch By",
              options: [
                { value: "Record", label: "Record" },
                { value: "JavaScript", label: "JavaScript" },
              ],
            },
          ],
        },
      ],
    },
  ],
  connectorSections: [
    {
      mode: "source",
      name: "Preview Audit",
      propertiesClass: "com.example.PreviewAuditPluginProperties",
      appliesTo: ["TCP Listener", "HTTP Listener"],
      sections: [
        {
          title: "Audit",
          fields: [
            {
              key: "auditEnabled",
              type: "checkbox",
              label: "Enable Auditing",
              defaultValue: "false",
            },
            {
              key: "auditEndpoint",
              type: "text",
              label: "Audit Endpoint",
              visibleWhen: { field: "auditEnabled", op: "truthy" },
              validation: [{ rule: "required" }],
            },
          ],
        },
      ],
    },
  ],
  transformerSteps: [
    {
      name: "Preview Note",
      stepClass: "com.example.PreviewNoteStep",
      contexts: ["source", "destination"],
      fields: [
        {
          key: "noteVariable",
          type: "text",
          label: "Variable",
          defaultValue: "note",
          validation: [
            { rule: "required" },
            {
              rule: "pattern",
              pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
              message: "Variable must be a valid identifier.",
            },
          ],
        },
        {
          key: "scope",
          type: "select",
          label: "Scope",
          defaultValue: "channel",
          options: [
            { value: "channel", label: "Channel Map" },
            { value: "global", label: "Global Map" },
          ],
        },
      ],
    },
  ],
};

export const SEED_MANIFEST_TEXT = JSON.stringify(SEED_MANIFEST, null, 2);

/**
 * Synthesizes a plausible engine `datatype-defaults` document for a declared
 * data type, used as the zero-config seed for its Defaults XML editor in the
 * preview. `compileDataType` retags this root to inbound/outboundProperties
 * (copying the `class`/`version` attributes verbatim), so only the attributes
 * and the per-group child elements are load-bearing. Data-type fields carry no
 * `defaultValue` (the engine owns defaults), so scalar field elements are
 * seeded empty — the author can paste the real engine defaults over this to
 * test round-trip fidelity.
 */
export function synthesizeDataTypeDefaultsXml(dataType: DataTypeContribution): string {
  const cls = `com.example.${dataType.name.replace(/[^A-Za-z0-9]/g, "")}Properties`;
  const groups = dataType.propertyGroups ?? [];
  const groupXml = groups
    .map((group) => {
      const children = group.fields
        // Collections materialize on first edit; only scalar text elements seed.
        .filter((f) => !COLLECTION_TYPES.has(f.type))
        .map((f) => `    <${f.key}></${f.key}>`)
        .join("\n");
      const inner = children ? `\n${children}\n  ` : "";
      return `  <${group.group}Properties>${inner}</${group.group}Properties>`;
    })
    .join("\n");
  const body = groupXml ? `\n${groupXml}\n` : "\n";
  return `<dataTypeProperties class="${cls}" version="1.0.0">${body}</dataTypeProperties>`;
}
