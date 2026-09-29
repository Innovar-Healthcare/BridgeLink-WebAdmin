/**
 * enable-validation.ts
 *
 * Pre-enable channel validation, mirroring the Java Swing client's
 * `ChannelSetup.checkAllForms(channel)` — the subset that
 * `ChannelPanel.doEnableChannel` runs against each selected channel before
 * calling `setChannelEnabled` (ChannelPanel.java:2353-2434,
 * ChannelSetup.java:1619-1670).
 *
 * `checkAllForms` validates exactly:
 *   1. Filter rules + transformer steps for every connector.
 *   2. Connector properties for the source and each ENABLED destination.
 *   3. The four channel scripts (deploy / preprocessing / postprocessing /
 *      undeploy) — Java `validateScripts`.
 * It does NOT run the editor's summary/pruning/metadata-column/queue-storage/
 * port-conflict checks; those live in `ChannelSetup.saveChanges`, not the
 * enable path, so they are intentionally excluded here.
 *
 * This module re-uses the exact leaf validators the editor's save path uses
 * (`use-channel-editor.ts:898-978`); no validation logic is re-implemented.
 *
 * Documented remainder (see: Java flags a channel whose connector
 * extension isn't loaded as an `InvalidChannel`. In the WebUI an unknown
 * `transportName` simply has no registry `validate`, so we skip it (treat as
 * valid) rather than block — the WebUI does not ship validators for every
 * commercial connector, and the server still validates at deploy time.
 */

import {
  parseSourceConnectorFromXml,
  parseDestinationConnectorsFromXml,
  parseScriptsFromXml,
} from "./channel-xml";
import {
  collectChannelFtSlots,
  resolveScriptSlots,
  type ScriptSlot,
} from "./filter-transformer-validation";
import { CONNECTOR_REGISTRY } from "../_connectors";
import { DESTINATION_CONNECTOR_REGISTRY } from "../_connectors/destinations";
import { PLUGIN_REGISTRY } from "../_connectors/plugins";
import { DESTINATION_PLUGIN_REGISTRY } from "../_connectors/destinations/plugins";
import { surfaceGateEnabledSnapshot } from "@/lib/plugin-gating";
import type { ConnectorPluginDefinition } from "../_connectors/types";
import type { DestinationPluginDefinition } from "../_connectors/destinations/types";
import type { ValidationError } from "../_connectors/shared/validate-utils";

/**
 * Validate a channel (given its full XML) the way the Java client does before
 * enabling it. Returns an array of human-readable error messages — an empty
 * array means the channel is valid and may be enabled.
 */
export async function validateChannelForEnable(channelXml: string): Promise<string[]> {
  const errors: string[] = [];

  // ── Connector properties: source + enabled destinations ──────────────────
  // Connector `validate` is structural-only and synchronous. Connector *plugins* may carry a
  // JavaScript script (HTTP Auth), whose parse is deferred to the server batch below via the
  // validateNonScript/getScript split. Both connector and plugin checks are collected
  // in tree order into `connectorChecks` and formatted after the one batch resolves — so a
  // plugin's structural errors and its (server-resolved) script error land in a single block, in
  // the same order they'd appear today, and every script rides the same round-trip as the
  // filter/transformer and channel scripts.
  const pluginSlots: ScriptSlot[] = [];
  const pluginScripts: Record<string, string> = {};
  const connectorChecks: { label: string; structuralMessages: string[]; slot?: ScriptSlot }[] = [];

  /** Push a connector's structural errors (from `validate`) as one deferred check, no script. */
  function pushConnectorCheck(label: string, structural: ValidationError[]) {
    if (structural.length > 0) {
      connectorChecks.push({ label, structuralMessages: structural.map((e) => e.message) });
    }
  }

  /** Collect a plugin's structural errors + optional script slot as one deferred check. */
  function collectPlugin(
    plugin: ConnectorPluginDefinition | DestinationPluginDefinition,
    propertiesXml: string | null,
    label: string
  ) {
    const structural = (plugin.validateNonScript ?? plugin.validate)?.(propertiesXml) ?? [];
    const script = plugin.getScript?.(propertiesXml) ?? null;
    let slot: ScriptSlot | undefined;
    if (script != null) {
      const id = `plugin-${pluginSlots.length}`;
      pluginScripts[id] = script;
      slot = { location: "", elementName: "", elementType: "", message: null, scriptId: id };
      pluginSlots.push(slot);
    }
    if (structural.length > 0 || slot) {
      connectorChecks.push({ label, structuralMessages: structural.map((e) => e.message), slot });
    }
  }

  const src = parseSourceConnectorFromXml(channelXml);
  const srcValidate = CONNECTOR_REGISTRY[src.transportName]?.validate;
  if (srcValidate) {
    pushConnectorCheck(`Source (${src.transportName})`, srcValidate(src.propertiesXml));
  }
  for (const plugin of PLUGIN_REGISTRY) {
    // Skip plugins whose config section the UI gate hides (disabled/unlicensed):
    // validating them would block enable with errors pointing at hidden UI. Same
    // enablement+license gate the render sites use item 2). Caches are
    // warmed by runEnableWithValidation before this runs.
    if (!surfaceGateEnabledSnapshot(plugin)) continue;
    if (!plugin.validate && !plugin.validateNonScript && !plugin.getScript) continue;
    if (!plugin.isApplicable(src.transportName, src.propertiesXml)) continue;
    collectPlugin(plugin, src.propertiesXml, `Source (${src.transportName})`);
  }

  const dests = parseDestinationConnectorsFromXml(channelXml);
  for (let i = 0; i < dests.length; i++) {
    const d = dests[i];
    // Java `checkAllForms` only validates enabled destinations.
    if (!d.enabled) continue;
    const destLabel = `Destination ${i + 1} "${d.name}" (${d.transportName})`;
    const destValidate = DESTINATION_CONNECTOR_REGISTRY[d.transportName]?.validate;
    if (destValidate) {
      pushConnectorCheck(destLabel, destValidate(d.propertiesXml));
    }
    for (const plugin of DESTINATION_PLUGIN_REGISTRY) {
      if (!surfaceGateEnabledSnapshot(plugin)) continue;
      if (!plugin.validate && !plugin.validateNonScript && !plugin.getScript) continue;
      if (!plugin.isApplicable(d.transportName, d.propertiesXml)) continue;
      collectPlugin(plugin, d.propertiesXml, destLabel);
    }
  }

  // ── Filter rules + transformer steps ─────────────────────────────────────
  // Java `checkAllForms` validates filter/transformer only for the source and
  // ENABLED destinations. `validateChannelFiltersAndTransformers` walks every
  // destination, and its error locations are "Source …" or `Destination
  // "<name>" …`. So keep the source errors, and keep a destination error only
  // when its name matches an ENABLED destination. Matching enabled (rather than
  // dropping disabled) is collision-safe: if an enabled and a disabled
  // destination share a name we still surface the error, which is the faithful
  // direction since Java validates the enabled one. The trailing quote in the
  // prefix prevents partial-name matches (e.g. "Foo" vs "FooBar").
  const enabledDestPrefixes = dests.filter((d) => d.enabled).map((d) => `Destination "${d.name}"`);

  // Collect the filter/transformer script slots, then append the four channel scripts to the
  // SAME batch so the whole enable check is a single server round-trip. Channel
  // scripts use string ids ("channel-*") that never collide with the numeric ft ids.
  const { slots: ftSlots, scripts } = collectChannelFtSlots(channelXml);

  const channelScripts = parseScriptsFromXml(channelXml);
  const channelScriptChecks: [string, string][] = [
    ["Deploy", channelScripts.deploy],
    ["Preprocessor", channelScripts.preprocessing],
    ["Postprocessor", channelScripts.postprocessing],
    ["Undeploy", channelScripts.undeploy],
  ];
  const channelSlots: ScriptSlot[] = channelScriptChecks.map(([label, script], i) => {
    const id = `channel-${i}`;
    scripts[id] = script;
    return { location: "", elementName: label, elementType: "", message: null, scriptId: id };
  });

  // One batch resolves every script slot — connector plugins, filter/transformer, and
  // the four channel scripts — in a single server round-trip (mutates the slot objects in place,
  // so every array sees the resolved message).
  await resolveScriptSlots([...pluginSlots, ...ftSlots, ...channelSlots], {
    ...scripts,
    ...pluginScripts,
  });

  // Connector + connector-plugin errors, in tree order, formatted now that plugin scripts have
  // resolved. Each check's structural messages and its (server-resolved) script message combine
  // into one block, matching the pre- grouping.
  for (const check of connectorChecks) {
    const messages = [...check.structuralMessages];
    if (check.slot?.message) messages.push(check.slot.message);
    if (messages.length > 0) {
      errors.push(`${check.label}:\n${messages.map((m) => `  - ${m}`).join("\n")}`);
    }
  }

  // Filter/transformer errors: Java validates only the source + ENABLED destinations, so drop a
  // destination error unless its name matches an enabled destination.
  for (const s of ftSlots) {
    if (!s.message) continue;
    const isDest = s.location.startsWith('Destination "');
    if (isDest && !enabledDestPrefixes.some((prefix) => s.location.startsWith(prefix))) continue;
    errors.push(`${s.location} — ${s.elementType} "${s.elementName}": ${s.message}`);
  }

  // Channel scripts (Java validateScripts).
  for (const s of channelSlots) {
    if (s.message) errors.push(`${s.elementName} script:\n  - ${s.message}`);
  }

  return errors;
}
