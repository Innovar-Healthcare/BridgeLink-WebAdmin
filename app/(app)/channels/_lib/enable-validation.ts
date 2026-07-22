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
import { validateChannelFiltersAndTransformers } from "./filter-transformer-validation";
import { tryParseJs } from "@/lib/js-validation";
import { CONNECTOR_REGISTRY } from "../_connectors";
import { DESTINATION_CONNECTOR_REGISTRY } from "../_connectors/destinations";
import { PLUGIN_REGISTRY } from "../_connectors/plugins";
import { DESTINATION_PLUGIN_REGISTRY } from "../_connectors/destinations/plugins";
import { surfaceGateEnabledSnapshot } from "@/lib/plugin-gating";

/**
 * Validate a channel (given its full XML) the way the Java client does before
 * enabling it. Returns an array of human-readable error messages — an empty
 * array means the channel is valid and may be enabled.
 */
export function validateChannelForEnable(channelXml: string): string[] {
  const errors: string[] = [];

  // ── Connector properties: source + enabled destinations ──────────────────
  const src = parseSourceConnectorFromXml(channelXml);
  const srcValidate = CONNECTOR_REGISTRY[src.transportName]?.validate;
  if (srcValidate) {
    const srcErrors = srcValidate(src.propertiesXml);
    if (srcErrors.length > 0) {
      errors.push(
        `Source (${src.transportName}):\n${srcErrors.map((e) => `  - ${e.message}`).join("\n")}`
      );
    }
  }
  for (const plugin of PLUGIN_REGISTRY) {
    // Skip plugins whose config section the UI gate hides (disabled/unlicensed):
    // validating them would block enable with errors pointing at hidden UI. Same
    // enablement+license gate the render sites use item 2). Caches are
    // warmed by runEnableWithValidation before this runs.
    if (!surfaceGateEnabledSnapshot(plugin)) continue;
    if (!plugin.validate) continue;
    if (!plugin.isApplicable(src.transportName, src.propertiesXml)) continue;
    const pluginErrors = plugin.validate(src.propertiesXml);
    if (pluginErrors.length > 0) {
      errors.push(
        `Source (${src.transportName}):\n${pluginErrors.map((e) => `  - ${e.message}`).join("\n")}`
      );
    }
  }

  const dests = parseDestinationConnectorsFromXml(channelXml);
  for (let i = 0; i < dests.length; i++) {
    const d = dests[i];
    // Java `checkAllForms` only validates enabled destinations.
    if (!d.enabled) continue;
    const destValidate = DESTINATION_CONNECTOR_REGISTRY[d.transportName]?.validate;
    if (destValidate) {
      const destErrors = destValidate(d.propertiesXml);
      if (destErrors.length > 0) {
        errors.push(
          `Destination ${i + 1} "${d.name}" (${d.transportName}):\n${destErrors
            .map((e) => `  - ${e.message}`)
            .join("\n")}`
        );
      }
    }
    for (const plugin of DESTINATION_PLUGIN_REGISTRY) {
      if (!surfaceGateEnabledSnapshot(plugin)) continue;
      if (!plugin.validate) continue;
      if (!plugin.isApplicable(d.transportName, d.propertiesXml)) continue;
      const pluginErrors = plugin.validate(d.propertiesXml);
      if (pluginErrors.length > 0) {
        errors.push(
          `Destination ${i + 1} "${d.name}" (${d.transportName}):\n${pluginErrors
            .map((e) => `  - ${e.message}`)
            .join("\n")}`
        );
      }
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
  const ftErrors = validateChannelFiltersAndTransformers(channelXml);
  for (const e of ftErrors) {
    const isDest = e.location.startsWith('Destination "');
    if (isDest && !enabledDestPrefixes.some((prefix) => e.location.startsWith(prefix))) continue;
    errors.push(`${e.location} — ${e.elementType} "${e.elementName}": ${e.message}`);
  }

  // ── Channel scripts (Java validateScripts) ───────────────────────────────
  const scripts = parseScriptsFromXml(channelXml);
  const scriptChecks: [string, string][] = [
    ["Deploy", scripts.deploy],
    ["Preprocessor", scripts.preprocessing],
    ["Postprocessor", scripts.postprocessing],
    ["Undeploy", scripts.undeploy],
  ];
  for (const [label, script] of scriptChecks) {
    const parseError = tryParseJs(script);
    if (parseError) {
      errors.push(`${label} script:\n  - ${parseError}`);
    }
  }

  return errors;
}
