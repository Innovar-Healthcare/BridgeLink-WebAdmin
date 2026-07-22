/**
 * Shared types for the source-connector and plugin registries.
 *
 * Kept in a thin module so that connector files, plugin files, and shared
 * components can all import from here without creating circular dependencies
 * through index.ts or plugins/index.ts.
 */

import type { ComponentType } from "react";
import type { SourceConnectorState } from "../_lib/channel-xml";
import type { ValidationError } from "./shared/validate-utils";

/**
 * Props passed into every connector section component AND every plugin section
 * component. Both registries share this interface so that SourceTab can render
 * sections from either registry without any special-casing.
 *
 * - `propertiesXml`  The raw outer `<properties>` XML for the current connector.
 *                    Holds both the common `<sourceConnectorProperties>` and any
 *                    connector-specific children (poll settings, scripts, etc.).
 * - `onChange`       Fires partial updates that get merged into SourceConnectorState
 *                    by SourceTab's handleSourceConnectorChange callback.
 * - `isDark`         Page-level dark-mode flag; forwarded to Monaco editors.
 */
export interface ConnectorSectionProps {
  propertiesXml: string | null;
  onChange: (updates: Partial<SourceConnectorState>) => void;
  isDark: boolean;
  /** Channel UUID — forwarded to connectors that need server-side API calls (e.g. DB metadata). */
  channelId?: string;
  /** Human-readable channel name — forwarded alongside channelId for API calls. */
  channelName?: string;
  /** Set of XML field names that failed validation — BottomSections highlight these fields. */
  invalidFields?: Set<string>;
  /** Transport name of the connector (e.g. "HTTP Listener") — used by plugin sections to derive unique sessionStorage keys. */
  transportName?: string;
  /** Outer XML of <transformer> for the source connector — passed so connectors can update the inbound template. */
  transformerXml?: string | null;
  /**
   * True when an applicable connector plugin (e.g. SSL Settings) secures this
   * connector's transport with TLS for the current properties. Mirrors the Java
   * client's `ConnectorTypeDecoration` / `usingHttps` flag: listener connectors
   * use it to render an `https://` URL preview (and a "HTTPS URL:" label) instead
   * of `http://`. Computed by SourceTab from the plugin registry — see
   * `ConnectorPluginDefinition.securesTransport`.
   */
  securesTransport?: boolean;
}

/**
 * Describes everything SourceTab needs to know about one connector type.
 * One entry per transport name in CONNECTOR_REGISTRY.
 *
 * Render order inside SourceTab:
 *   1. Connector Type dropdown
 *   2. TopSection   (optional) — e.g. "Polling Settings" for polling connectors
 *   3. Source Settings          — always rendered, common to all connectors
 *   4. Plugin sections          — zero or more, from PLUGIN_REGISTRY (see plugins/index.ts)
 *   5. BottomSection (optional) — e.g. script editor, HTTP settings, …
 *      Falls back to "configure in XML tab" if absent.
 *
 * - `TopSection`           Rendered ABOVE Source Settings.
 *                          Typically wraps PollingSection for polling connectors.
 * - `BottomSection`        Rendered BELOW Source Settings (and below any plugins).
 *                          Connector-specific UI (script editor, listener config, …).
 * - `defaultPropertiesXml` XML blob injected into SourceConnectorState.propertiesXml
 *                          when the user switches to this connector type. Required for
 *                          any connector whose `<properties>` structure differs from the
 *                          Channel Reader (e.g. JavaScript Reader, File Reader, …).
 */
export interface ConnectorDefinition {
  /**
   * The connector transport name (e.g. "TCP Listener"). Used as the registry key and
   * required when calling registerSourceConnector() so the definition is self-describing.
   */
  transportName?: string;
  TopSection?: ComponentType<ConnectorSectionProps>;
  BottomSection?: ComponentType<ConnectorSectionProps>;
  defaultPropertiesXml?: string;
  /** Client-side validation. Returns array of field-level errors, or empty array if valid. */
  validate?: (propertiesXml: string | null) => ValidationError[];
  /**
   * Returns the inbound data type this connector requires, or null if any type is allowed.
   * Mirrors Java ConnectorSettingsPanel.getRequiredInboundDataType().
   * When non-null, the source inbound data type is auto-set and locked everywhere it appears.
   */
  getRequiredInboundDataType?: (propertiesXml: string | null) => string | null;
  /**
   * Whether this source connector supports batch processing. Mirrors Java
   * `SourceConnectorPropertiesInterface.canBatch()`. When `false`, the Process Batch control is
   * disabled (e.g. DICOM Listener). Absent/`true` → batching allowed (the default for every other
   * source connector).
   */
  canBatch?: boolean;
  /**
   * Server plugin name (must match `GET /extensions/plugins/`) used for
   * server-enablement gating. When set, this connector type is
   * hidden from the Connector Type dropdown unless that plugin is installed
   * AND enabled on the connected server. Stamped from the definition's
   * `serverPluginName` by `registerPlugin()`. Lookup-by-transportName is never
   * gated, so a channel already using this connector still renders. Omit for
   * built-in connectors (always shown).
   */
  pluginName?: string;
}

/**
 * Describes an optional server plugin that injects an extra settings section
 * into one or more connector panels at runtime.
 *
 * Plugins are separate from connectors because they are:
 *   - Optional commercial add-ons (may or may not be installed on the server).
 *   - Cross-cutting (one plugin can apply to multiple connector types).
 *   - Detected from the channel XML, not from the transport name alone.
 *
 * Known plugins that need implementing:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ Plugin          │ Applies to                  │ Appears between     │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ SSL Settings    │ HTTP Listener, TCP Listener, │ Source Settings and │
 *   │                 │ WebService Listener          │ connector bottom    │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * How to detect whether a plugin is installed:
 *   BridgeLink stores plugin state inside the connector's `<pluginProperties>`
 *   element (a child of `<properties>`). When the SSL plugin is active, the
 *   element contains an `<com.mirth...SslSocketInitializerProperties>` entry.
 *   Parse `propertiesXml` with DOMParser and querySelector for that tag to
 *   determine presence.
 *
 * How to add a new plugin:
 *   1. Create `_connectors/plugins/<plugin-name>.tsx` exporting a ConnectorPluginDefinition.
 *   2. Push it into the PLUGIN_REGISTRY array in `_connectors/plugins/index.ts`.
 *   3. SourceTab requires no changes — it already filters and renders the array.
 *
 * - `pluginName`       Optional. When set, the section is rendered only if the named
 *                      BridgeLink server plugin is installed AND enabled on the server
 *                      (matches the gating used for settings tabs). Required for plugins
 *                      backed by a server-side BridgeLink plugin so the section stays
 *                      hidden when the plugin is missing — even if the channel XML still
 *                      carries plugin-specific tags from a different server.
 * - `isApplicable`     Called on every render with the current transportName and
 *                      propertiesXml. Return true only when the plugin is both
 *                      relevant to this connector type AND detectable in the XML.
 *                      Keep this fast — no network calls, pure XML inspection.
 * - `Section`          The React component to render (receives ConnectorSectionProps).
 * - `injectDefaults`   Optional. Called when the user switches to a new connector type
 *                      to inject plugin-specific default XML into the connector's
 *                      propertiesXml. Return the modified XML string.
 * - `securesTransport` Optional. Return true when this plugin secures the connector's
 *                      transport with TLS for the given properties (e.g. SSL enabled).
 *                      Mirrors the Java client's `ConnectorTypeDecorator`: lets a
 *                      listener connector render an `https://` URL preview. Keep this
 *                      pure — no network calls, pure XML inspection.
 */
export interface ConnectorPluginDefinition {
  pluginName?: string;
  /**
   * License-entitlement gate. The License Manager `pluginId` string
   * for the owning plugin; when set, the section is hidden (and injectDefaults
   * skipped) unless the server reports it licensed (Active/Expiring Soon), in
   * addition to any `pluginName` enablement gate. Stamped from the definition's
   * `licensedPluginId` by `registerPlugin()`. Omit for core / unlicensed sections.
   */
  licensedPluginId?: string;
  isApplicable: (transportName: string, propertiesXml: string | null) => boolean;
  Section: ComponentType<ConnectorSectionProps>;
  injectDefaults?: (transportName: string, propertiesXml: string) => string;
  validate?: (propertiesXml: string | null) => ValidationError[];
  securesTransport?: (propertiesXml: string | null) => boolean;
}
