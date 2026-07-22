/**
 * Source connector registry.
 *
 * Built-in connectors are pre-loaded at module initialisation. Commercial plugins
 * call registerSourceConnector() from plugins/index.ts to add their own types.
 *
 * ─── Adding a built-in connector ─────────────────────────────────────────────
 *
 *   1. Create `<connector-name>.tsx` in this directory exporting a ConnectorDefinition.
 *   2. Add one entry to CONNECTOR_REGISTRY below.
 *   3. Add the transport name to SOURCE_CONNECTOR_TYPES in _lib/channel-xml.ts.
 *   4. SourceTab requires no further changes.
 *
 * ─── Adding a commercial plugin connector ─────────────────────────────────────
 *
 *   1. Create `plugins/<name>/index.ts` exporting a ConnectorDefinition with transportName.
 *   2. Call registerSourceConnector() from that index.ts (imported by plugins/index.ts).
 *   3. The connector will be available to SourceTab on next registry read.
 *      Also register the transport name via SOURCE_CONNECTOR_TYPES or equivalent.
 */

export type { ConnectorDefinition, ConnectorSectionProps } from "./types";

import { connectContributionSink, warnDuplicateContribution } from "@/lib/plugin-manifest";
import type { ConnectorDefinition } from "./types";
import { ChannelReaderConnector } from "./channel-reader";
import { DatabaseReaderConnector } from "./database-reader";
import { DICOMListenerConnector } from "./dicom-listener";
import { FileReaderConnector } from "./file-reader";
import { HttpListenerConnector } from "./http-listener";
import { JavaScriptReaderConnector } from "./javascript-reader";
import { JmsListenerConnector } from "./jms-listener";
import { TcpListenerConnector } from "./tcp-listener";
import { WebServiceListenerConnector } from "./web-service-listener";

/** Mutable source connector registry. Commercial plugins self-register here. */
export let CONNECTOR_REGISTRY: Record<string, ConnectorDefinition> = {
  "Channel Reader": ChannelReaderConnector,
  "Database Reader": DatabaseReaderConnector,
  "DICOM Listener": DICOMListenerConnector,
  "File Reader": FileReaderConnector,
  "HTTP Listener": HttpListenerConnector,
  "JavaScript Reader": JavaScriptReaderConnector,
  "JMS Listener": JmsListenerConnector,
  "TCP Listener": TcpListenerConnector,
  "WebService Listener": WebServiceListenerConnector,
};

/** Register a source connector. Called by commercial plugins at startup. */
export function registerSourceConnector(
  def: ConnectorDefinition & { transportName: string }
): void {
  CONNECTOR_REGISTRY = { ...CONNECTOR_REGISTRY, [def.transportName]: def };
}

// Receive definePlugin() manifest contributions (first-wins by transportName).
connectContributionSink("sourceConnectors", (def, pluginId) => {
  if (CONNECTOR_REGISTRY[def.transportName]) {
    warnDuplicateContribution(pluginId, "source connector", def.transportName);
    return false;
  }
  registerSourceConnector(def);
  return true;
});

/**
 * Source connector transport names to show in the Connector Type dropdown,
 * in registry (built-ins-first) order, filtered by server-enablement gating
 *. Built-ins carry no `pluginName` so `isEnabled(undefined)` keeps
 * them always visible; a plugin connector appears only when its server
 * extension is installed AND enabled. Lookup-by-transportName is never gated,
 * so a channel already using a gated connector still renders — SourceTab pins
 * its current value into the dropdown separately.
 */
export function visibleSourceConnectorTypes(
  isEnabled: (pluginName: string | undefined) => boolean
): string[] {
  return Object.entries(CONNECTOR_REGISTRY)
    .filter(([, def]) => isEnabled(def.pluginName))
    .map(([name]) => name);
}
