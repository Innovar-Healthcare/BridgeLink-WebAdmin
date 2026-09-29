/**
 * Loadable example manifests for the Manifest Preview page.
 *
 * Statically imports the shipped fixture manifests and a selection of the
 * validator corpus's valid entries. This module is itself loaded via a dynamic
 * `import()` from the examples menu, so all of this JSON lands in ONE lazily
 * fetched chunk — nothing here reaches the page's initial-load bundle (the
 * CLAUDE.md bundle rule). The manifests are tiny (≤ ~7 KB each).
 *
 * Fixture examples carry the real `extension.json` envelope; corpus examples
 * (bare manifests) synthesize one, deriving the path from the first action
 * endpoint so action-bearing entries validate.
 */

import type { PreviewEnvelope } from "./preview-model";
import { suggestEnvelopePath } from "./suggest-path";

// ── Shipped fixtures (fixtures/webadmin-plugins/<dir>/) ──
import mockSmtpEnvelope from "@/fixtures/webadmin-plugins/mock-smtp/extension.json";
import mockSmtpManifest from "@/fixtures/webadmin-plugins/mock-smtp/webadmin.json";
import sslEnvelope from "@/fixtures/webadmin-plugins/ssl-style/extension.json";
import sslManifest from "@/fixtures/webadmin-plugins/ssl-style/webadmin.json";
import syslogEnvelope from "@/fixtures/webadmin-plugins/mock-syslog-mode/extension.json";
import syslogManifest from "@/fixtures/webadmin-plugins/mock-syslog-mode/webadmin.json";
import dimseEnvelope from "@/fixtures/webadmin-plugins/mock-dimse-datatype/extension.json";
import dimseManifest from "@/fixtures/webadmin-plugins/mock-dimse-datatype/webadmin.json";
import auditEnvelope from "@/fixtures/webadmin-plugins/mock-audit-section/extension.json";
import auditManifest from "@/fixtures/webadmin-plugins/mock-audit-section/webadmin.json";
import noteEnvelope from "@/fixtures/webadmin-plugins/mock-note-step/extension.json";
import noteManifest from "@/fixtures/webadmin-plugins/mock-note-step/webadmin.json";
import invalidEnvelope from "@/fixtures/webadmin-plugins/invalid-sample/extension.json";
import invalidManifest from "@/fixtures/webadmin-plugins/invalid-sample/webadmin.json";

// ── Corpus (fixtures/webadmin-plugins/_corpus/valid/) ──
import corpusMinimal from "@/fixtures/webadmin-plugins/_corpus/valid/v3-minimal.json";
import corpusCollections from "@/fixtures/webadmin-plugins/_corpus/valid/v3-collections.json";
import corpusTable from "@/fixtures/webadmin-plugins/_corpus/valid/v3-table.json";
import corpusVariableToggle from "@/fixtures/webadmin-plugins/_corpus/valid/v3-variable-toggle.json";
import corpusSettingsActions from "@/fixtures/webadmin-plugins/_corpus/valid/settings-conditions-actions.json";

export interface PreviewExample {
  id: string;
  label: string;
  group: "Shipped fixtures" | "Corpus";
  envelope: PreviewEnvelope;
  manifestText: string;
}

const stringify = (manifest: unknown) => JSON.stringify(manifest, null, 2);

function fixtureExample(
  id: string,
  label: string,
  envelopeJson: unknown,
  manifest: unknown
): PreviewExample {
  const env = envelopeJson as { name: string; path: string; version: string };
  return {
    id,
    label,
    group: "Shipped fixtures",
    envelope: { name: env.name, path: env.path, version: env.version },
    manifestText: stringify(manifest),
  };
}

/**
 * Turns a label into a valid extension name (EXTENSION_NAME_PATTERN =
 * `^[A-Za-z0-9][A-Za-z0-9 ._()-]*$`): strips forbidden characters, collapses
 * whitespace, and falls back to `fallback` if the result is empty or doesn't
 * start with an alphanumeric.
 */
const toValidName = (label: string, fallback: string) => {
  const cleaned = label
    .replace(/[^A-Za-z0-9 ._()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
};

function corpusExample(id: string, label: string, manifest: unknown): PreviewExample {
  return {
    id,
    label,
    group: "Corpus",
    // Derive the path from the first action endpoint so action-bearing corpus
    // entries validate; fall back to the id for endpoint-less manifests. The
    // envelope name is the label sanitized to a valid extension name.
    envelope: {
      name: toValidName(label, id),
      path: suggestEnvelopePath(manifest) ?? id,
      version: "1.0.0",
    },
    manifestText: stringify(manifest),
  };
}

export const PREVIEW_EXAMPLES: PreviewExample[] = [
  fixtureExample(
    "mock-smtp",
    "Mock SMTP (connector + settings, v3)",
    mockSmtpEnvelope,
    mockSmtpManifest
  ),
  fixtureExample("ssl-style", "SSL-style connector (v1)", sslEnvelope, sslManifest),
  fixtureExample(
    "mock-syslog-mode",
    "Syslog transmission mode (v2)",
    syslogEnvelope,
    syslogManifest
  ),
  fixtureExample("mock-dimse-datatype", "DIMSE data type (v2)", dimseEnvelope, dimseManifest),
  fixtureExample(
    "mock-audit-section",
    "Audit connector section (v2)",
    auditEnvelope,
    auditManifest
  ),
  fixtureExample("mock-note-step", "Note transformer step (v2)", noteEnvelope, noteManifest),
  fixtureExample(
    "invalid-sample",
    "Invalid example — shows validation errors",
    invalidEnvelope,
    invalidManifest
  ),
  corpusExample("v3-minimal", "Minimal (v3)", corpusMinimal),
  corpusExample("v3-collections", "Collection fields (v3)", corpusCollections),
  corpusExample("v3-table", "Table field (v3)", corpusTable),
  corpusExample("v3-variable-toggle", "Variable toggle (v3)", corpusVariableToggle),
  corpusExample(
    "settings-conditions-actions",
    "Settings: conditions + actions",
    corpusSettingsActions
  ),
];
