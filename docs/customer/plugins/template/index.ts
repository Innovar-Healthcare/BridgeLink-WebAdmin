/**
 * Starter plugin — Web Administrator entry point.
 *
 * Default-exports a definePlugin() manifest describing every contribution the
 * plugin makes to BridgeLink's extension points. The generated plugins/index.ts
 * registers it at startup, before any React component renders; the base
 * application reads from its registries at render time and never imports plugin
 * source directly. The entry point performs no other module-scope side effects.
 *
 * When you create a plugin from this template, replace:
 *   - id               "starter"
 *   - serverPluginName "My Plugin"  (MUST match your server plugin's <name> exactly)
 *   - tabLabel         "Starter"
 *   - tabKey           "starter"
 *   - permissionKey    "Settings.Starter"
 *   - the imported component path
 *
 * See ../ARCHITECTURE.md for the full manifest field reference (every extension
 * point you can declare into) and ../BUILD-A-PLUGIN.md for a worked build.
 */

import { definePlugin } from "@/lib/plugin-manifest";
import { StarterSettingsTab } from "./template-tab";

export default definePlugin({
  id: "starter",
  serverPluginName: "My Plugin", // must match your server plugin's plugin.xml <name>

  settingsTabs: [
    {
      tabLabel: "Starter",
      tabKey: "starter",
      component: StarterSettingsTab,
      actionPanel: null,
      permissionKey: "Settings.Starter",
    },
  ],
});
