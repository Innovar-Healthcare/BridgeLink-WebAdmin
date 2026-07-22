/**
 * Source-connector plugin registry.
 *
 * A "plugin" here corresponds to an optional BridgeLink server-side plugin
 * (typically a commercial add-on) that injects an additional settings section
 * into one or more connector panels. Plugins differ from connectors in three ways:
 *
 *   1. Optional — the section only appears if the plugin is installed on the server.
 *   2. Cross-cutting — a single plugin can apply to several connector types.
 *   3. XML-detected — presence is inferred by inspecting the channel's propertiesXml,
 *      not by matching the transport name alone.
 *
 * ─── Render position ──────────────────────────────────────────────────────────
 *
 *   SourceTab renders plugin sections in the following slot:
 *
 *     [Connector Type dropdown]
 *     [TopSection]           ← connector-specific (e.g. Polling Settings)
 *     [Source Settings]      ← always present, common to all connectors
 *     [Plugin sections] ◄─── HERE, one per matching ConnectorPluginDefinition
 *     [BottomSection]        ← connector-specific (e.g. script editor, HTTP config)
 *
 * ─── Adding a built-in plugin ─────────────────────────────────────────────────
 *
 *   1. Create `_connectors/plugins/<plugin-name>.tsx` exporting a ConnectorPluginDefinition.
 *   2. Call registerSourcePlugin() below. SourceTab picks it up automatically.
 *
 * ─── Adding a commercial plugin ───────────────────────────────────────────────
 *
 *   1. Declare a `sourceConnectorPlugins` entry in the plugin's definePlugin()
 *      manifest (see lib/plugin-manifest.ts). The generated plugins/index.ts
 *      registers it at startup.
 */

import { connectContributionSink } from "@/lib/plugin-manifest";
import type { ConnectorPluginDefinition } from "../types";

import { HttpAuthPlugin } from "./http-auth";

/** Mutable source connector plugin registry. Commercial plugins self-register here. */
export let PLUGIN_REGISTRY: ConnectorPluginDefinition[] = [
  // HTTP Authentication renders between Source Settings and the connector's
  // BottomSection — matching the Java UI panel order (Source Settings →
  // HTTP Authentication → Web Service / HTTP Listener Settings).
  HttpAuthPlugin,
];

/** Register a source connector plugin. Called by commercial plugins at startup. */
export function registerSourcePlugin(plugin: ConnectorPluginDefinition): void {
  PLUGIN_REGISTRY = [...PLUGIN_REGISTRY, plugin];
}

// Receive definePlugin() manifest contributions. Sections have no natural
// registry key — duplicate protection is the manifest's plugin-id guard.
connectContributionSink("sourceConnectorPlugins", (plugin) => {
  registerSourcePlugin(plugin);
  return true;
});
