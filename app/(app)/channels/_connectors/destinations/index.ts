/**
 * Destination connector registry.
 *
 * Built-in connectors are pre-loaded at module initialisation. Commercial plugins
 * call registerDestinationConnector() from plugins/index.ts to add their own types.
 *
 * ─── Adding a built-in connector ─────────────────────────────────────────────
 *
 *   1. Create `<connector-name>.tsx` in this directory exporting a DestinationConnectorDefinition.
 *   2. Add one entry to DESTINATION_CONNECTOR_REGISTRY below.
 *   3. Add the transport name to DESTINATION_CONNECTOR_TYPES in _lib/channel-xml.ts.
 *   4. DestinationTab requires no further changes — it picks up the registry automatically.
 *
 * ─── Adding a commercial plugin connector ─────────────────────────────────────
 *
 *   1. Create `plugins/<name>/index.ts` exporting a DestinationConnectorDefinition with transportName.
 *   2. Call registerDestinationConnector() from that index.ts (imported by plugins/index.ts).
 *   3. The connector will be available to DestinationTab on next registry read.
 *      Also register the transport name via DESTINATION_CONNECTOR_TYPES or equivalent.
 *
 * See `types.ts` for the DestinationConnectorDefinition interface.
 */

export type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";

import { connectContributionSink, warnDuplicateContribution } from "@/lib/plugin-manifest";
import { DEFAULT_DEST_PROPERTIES_XML } from "../../_lib/channel-xml";
import type { DestinationConnectorDefinition } from "./types";

import { JavaScriptWriterConnector } from "./javascript-writer"; // Phase 5a
import { ChannelWriterConnector } from "./channel-writer"; // Phase 5b
import { HttpSenderConnector } from "./http-sender"; // Phase 5c
import { TcpSenderConnector } from "./tcp-sender"; // Phase 5d
import { DatabaseWriterConnector } from "./database-writer"; // Phase 5e
import { FileWriterConnector } from "./file-writer"; // Phase 5f
import { SmtpSenderConnector } from "./smtp-sender"; // Phase 5g
import { JmsSenderConnector } from "./jms-sender"; // Phase 5h
import { DocumentWriterConnector } from "./document-writer"; // Phase 5i
import { DICOMSenderConnector } from "./dicom-sender"; // Phase 5j
import { WebServiceSenderConnector } from "./web-service-sender"; // Phase 5k

/**
 * Mutable destination connector registry. Commercial plugins self-register here.
 *
 * Key order IS the Connector Type dropdown order made the dropdown
 * registry-driven), so this literal is kept in the same order as
 * DESTINATION_CONNECTOR_TYPES in _lib/channel-xml.ts — an order-lock unit test
 * enforces the match. The `// Phase 5x` tags mark original implementation order.
 */
export let DESTINATION_CONNECTOR_REGISTRY: Record<string, DestinationConnectorDefinition> = {
  "Channel Writer": ChannelWriterConnector, // Phase 5b
  "Database Writer": DatabaseWriterConnector, // Phase 5e
  "DICOM Sender": DICOMSenderConnector, // Phase 5j
  "Document Writer": DocumentWriterConnector, // Phase 5i
  "File Writer": FileWriterConnector, // Phase 5f
  "HTTP Sender": HttpSenderConnector, // Phase 5c
  "JavaScript Writer": JavaScriptWriterConnector, // Phase 5a
  "JMS Sender": JmsSenderConnector, // Phase 5h
  "SMTP Sender": SmtpSenderConnector, // Phase 5g
  "TCP Sender": TcpSenderConnector, // Phase 5d
  "Web Service Sender": WebServiceSenderConnector, // Phase 5k
};

/** Register a destination connector. Called by commercial plugins at startup. */
export function registerDestinationConnector(
  def: DestinationConnectorDefinition & { transportName: string }
): void {
  DESTINATION_CONNECTOR_REGISTRY = { ...DESTINATION_CONNECTOR_REGISTRY, [def.transportName]: def };
}

// Receive definePlugin() manifest contributions (first-wins by transportName).
connectContributionSink("destinationConnectors", (def, pluginId) => {
  if (DESTINATION_CONNECTOR_REGISTRY[def.transportName]) {
    warnDuplicateContribution(pluginId, "destination connector", def.transportName);
    return false;
  }
  registerDestinationConnector(def);
  return true;
});

/**
 * Default `<properties>` XML for a destination transport. Built-ins live in
 * the static DEFAULT_DEST_PROPERTIES_XML map; registered connectors (runtime
 * plugin manifests carrying engine-served defaults — — and any
 * plugin that sets `defaultPropertiesXml`) resolve from the registry. Without
 * the registry fallback a type-switch to a registered destination left
 * `propertiesXml` null, rendering its panel read-only.
 */
export function destinationDefaultPropertiesXml(transportName: string): string | null {
  return (
    DEFAULT_DEST_PROPERTIES_XML[transportName] ??
    DESTINATION_CONNECTOR_REGISTRY[transportName]?.defaultPropertiesXml ??
    null
  );
}

/**
 * Destination connector transport names to show in the Connector Type
 * dropdown, in registry (built-ins-first) order, filtered by server-enablement
 * gating. Mirrors `visibleSourceConnectorTypes` — built-ins are
 * always visible; a plugin connector appears only when its server extension is
 * installed AND enabled. DestinationTab pins a channel's current (possibly
 * gated) transport into the dropdown separately.
 */
export function visibleDestinationConnectorTypes(
  isEnabled: (pluginName: string | undefined) => boolean
): string[] {
  return Object.entries(DESTINATION_CONNECTOR_REGISTRY)
    .filter(([, def]) => isEnabled(def.pluginName))
    .map(([name]) => name);
}
