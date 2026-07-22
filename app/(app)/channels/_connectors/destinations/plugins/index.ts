/**
 * Destination-connector plugin registry.
 *
 * Mirrors the source-connector PLUGIN_REGISTRY (see ../../plugins/index.ts) but
 * uses DestinationPluginDefinition so that plugin sections can update
 * DestinationConnectorState via their onChange callback.
 *
 * ─── Render position ──────────────────────────────────────────────────────────
 *
 *   DestinationTab renders plugin sections in the following slot:
 *
 *     [Connector Type dropdown]
 *     [Destination Settings]       ← always present (queue, retry, validate…)
 *     [Plugin sections] ◄────────── HERE, one per matching DestinationPluginDefinition
 *     [BottomSection]              ← connector-specific UI
 *
 * ─── Adding a built-in plugin ─────────────────────────────────────────────────
 *
 *   1. Export a DestinationPluginDefinition from the appropriate plugin file.
 *   2. Call registerDestinationPlugin() below.
 *
 * ─── Adding a commercial plugin ───────────────────────────────────────────────
 *
 *   1. Export a DestinationPluginDefinition from plugins/<name>/.
 *   2. Call registerDestinationPlugin() from that plugin's index.ts.
 */

import { connectContributionSink } from "@/lib/plugin-manifest";
import type { DestinationPluginDefinition } from "../types";

/** Mutable destination connector plugin registry. Commercial plugins self-register here. */
export let DESTINATION_PLUGIN_REGISTRY: DestinationPluginDefinition[] = [];

/** Register a destination connector plugin. Called by commercial plugins at startup. */
export function registerDestinationPlugin(plugin: DestinationPluginDefinition): void {
  DESTINATION_PLUGIN_REGISTRY = [...DESTINATION_PLUGIN_REGISTRY, plugin];
}

// Receive definePlugin() manifest contributions. Sections have no natural
// registry key — duplicate protection is the manifest's plugin-id guard.
connectContributionSink("destinationConnectorPlugins", (plugin) => {
  registerDestinationPlugin(plugin);
  return true;
});
