/**
 * Types for destination-connector sections and the DESTINATION_CONNECTOR_REGISTRY.
 *
 * Destination connector sections receive a `DestinationConnectorSectionProps`
 * which is analogous to `ConnectorSectionProps` (source), but `onChange` is
 * typed to `Partial<DestinationConnectorState>` so a BottomSection can update
 * `propertiesXml` without source-connector type conflicts.
 */

import type { ComponentType } from "react";
import type { DestinationConnectorState } from "../../_lib/channel-xml";
import type { ValidationError } from "../shared/validate-utils";

/**
 * Props passed to every destination BottomSection component.
 *
 * - `propertiesXml`  Outer XML of the connector's `<properties>` element.
 *                    Contains both `<destinationConnectorProperties>` and
 *                    connector-specific children.
 * - `onChange`       Fires partial updates merged into DestinationConnectorState
 *                    by DestinationTab's per-destination change handler.
 *                    Typically only `{ propertiesXml: "..." }` is updated.
 * - `isDark`         Page-level dark-mode flag; forwarded to Monaco editors.
 */
export interface DestinationConnectorSectionProps {
  propertiesXml: string | null;
  onChange: (updates: Partial<DestinationConnectorState>) => void;
  isDark: boolean;
  /** Channel UUID — forwarded to connectors that need server-side API calls. */
  channelId?: string;
  /** Human-readable channel name — forwarded alongside channelId. */
  channelName?: string;
  /** Set of XML field names that failed validation — BottomSections highlight these fields. */
  invalidFields?: Set<string>;
  /** Transport name of the connector (e.g. "HTTP Sender") — used by plugin sections to derive unique sessionStorage keys. */
  transportName?: string;
  /**
   * True when an applicable connector plugin (e.g. SSL Settings) secures this destination's
   * transport with TLS for the current properties. Mirrors the Java client's
   * `ConnectorTypeDecoration`: the SSL plugin's `Mode.DESTINATION` decoration replaces the base
   * connector's "(SSL Not Configured)" warning whenever its section is present, so HTTP/WS Sender
   * suppress that warning on https URLs when this is true. Computed by DestinationTab from the
   * plugin registry — see `DestinationPluginDefinition.securesTransport`.
   */
  securesTransport?: boolean;
}

/**
 * Describes everything DestinationTab needs to know about one connector type.
 * One entry per transport name in DESTINATION_CONNECTOR_REGISTRY.
 *
 * - `BottomSection`        Connector-specific settings panel rendered below
 *                          the common Destination Settings section.
 *                          Falls back to "configure in XML tab" if absent.
 * - `defaultPropertiesXml` XML blob injected into propertiesXml when the user
 *                          switches to this connector type. If absent, the
 *                          existing propertiesXml is preserved.
 */
export interface DestinationConnectorDefinition {
  /**
   * The connector transport name (e.g. "HTTP Sender"). Used as the registry key and
   * required when calling registerDestinationConnector() so the definition is self-describing.
   */
  transportName?: string;
  BottomSection?: ComponentType<DestinationConnectorSectionProps>;
  defaultPropertiesXml?: string;
  /** Client-side validation. Returns array of field-level errors, or empty array if valid. */
  validate?: (propertiesXml: string | null) => ValidationError[];
  /**
   * Whether the "Validate Response" queue option applies to this connector.
   * Mirrors Java `DestinationConnectorPropertiesInterface.canValidateResponse()`.
   * Defaults to `true` when omitted; set `false` for connectors that cannot
   * validate a response (e.g. File Writer, Document Writer, DICOM/SMTP/JMS Sender).
   */
  canValidateResponse?: boolean;
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
 * into one or more destination connector panels at runtime.
 *
 * Mirrors the source-connector PluginDefinition (see ../types.ts) but uses
 * DestinationConnectorSectionProps so onChange updates DestinationConnectorState.
 *
 * - `pluginName`      Optional. When set, the section is rendered only if the named
 *                     BridgeLink server plugin is installed AND enabled on the server
 *                     (matches the gating used for settings tabs). Required for plugins
 *                     backed by a server-side BridgeLink plugin so the section stays
 *                     hidden when the plugin is missing — even if the channel XML still
 *                     carries plugin-specific tags from a different server.
 * - `isApplicable`    Called each render with the connector transport name and
 *                     raw propertiesXml. Return true only when the plugin is
 *                     both applicable to this connector type AND detectable in
 *                     the XML. Keep this fast — no network calls.
 * - `Section`         React component to render (receives DestinationConnectorSectionProps).
 * - `injectDefaults`  Optional. Called when connector type changes to inject plugin-
 *                     specific default XML. Return the modified XML string.
 */
export interface DestinationPluginDefinition {
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
  Section: ComponentType<DestinationConnectorSectionProps>;
  injectDefaults?: (transportName: string, propertiesXml: string) => string;
  /** Client-side validation. Returns array of field-level errors, or empty array if valid. */
  validate?: (propertiesXml: string | null) => ValidationError[];
  /**
   * True when this plugin secures the destination's transport with TLS for the given properties.
   * Mirrors the source `ConnectorPluginDefinition.securesTransport`. DestinationTab ORs this across
   * the applicable plugins into `DestinationConnectorSectionProps.securesTransport`, which HTTP/WS
   * Sender use to suppress the "(SSL Not Configured)" warning on https URLs.
   */
  securesTransport?: (propertiesXml: string | null) => boolean;
}
