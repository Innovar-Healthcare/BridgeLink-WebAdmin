/**
 * Web UI Plugin Settings Registry
 *
 * This is the web equivalent of Java's SettingsPanelPlugin / AbstractSettingsPanel system.
 *
 * In the Java client, plugins contribute settings tabs at runtime via classloading.
 * In the web UI, built-in plugin tabs are declared here. Commercial plugin tabs are
 * registered at app startup by each plugin's index module (via plugins/index.ts →
 * plugins/<name>/index.ts → registerSettingsTab()).
 *
 * A tab is shown only if:
 *   1. The plugin tab is in this registry (built-in) OR in pluginRegistry.settingsTabs
 *      (registered by a commercial plugin), AND
 *   2. The server reports the plugin as enabled (pluginMetaData[pluginName].enabled === true)
 *
 * ## Adding a Built-in Plugin Settings Tab
 *
 * 1. Create the component: webui/components/settings/plugins/{plugin-key}-tab.tsx
 * 2. Import it below and add an entry to BUILTIN_PLUGIN_TABS
 *
 * ## Adding a Commercial Plugin Settings Tab
 *
 * 1. Create plugins/<name>/index.ts and call registerSettingsTab() from lib/plugin-registry
 */

import { MessageTrendsSettingsTab } from "@/components/settings/plugins/message-trends-tab";
import { DataPrunerSettingsTab } from "@/components/settings/plugins/data-pruner-tab";
import { VersionHistorySettingsTab } from "@/components/settings/plugins/version-history-tab";
import { DataPrunerActionPanel } from "@/components/settings/plugins/data-pruner-action-panel";
import { MessageTrendsActionPanel } from "@/components/settings/plugins/message-trends-action-panel";
import { VersionHistoryActionPanel } from "@/components/settings/plugins/version-history-action-panel";
import { pluginRegistry } from "@/lib/plugin-registry";
import type { SettingsPluginTab } from "@/lib/plugin-registry";
import { VERSION_HISTORY_PLUGIN_NAME } from "@/lib/version-history";

// Re-export types that consumers expect from this module
export type { SettingsPluginTab, PluginTabProps } from "@/lib/plugin-registry";

/**
 * Built-in plugin tabs — always present in open-source BridgeLink.
 * Commercial plugin tabs are contributed via pluginRegistry.settingsTabs.
 */
const BUILTIN_PLUGIN_TABS: SettingsPluginTab[] = [
  {
    tabLabel: "Data Pruner",
    tabKey: "data-pruner",
    pluginName: "Data Pruner",
    component: DataPrunerSettingsTab,
    actionPanel: DataPrunerActionPanel,
    permissionKey: "Settings.Data Pruner",
  },
  {
    tabLabel: "Message Trends",
    tabKey: "message-trends",
    pluginName: "Message Trends Management System",
    component: MessageTrendsSettingsTab,
    actionPanel: MessageTrendsActionPanel,
    permissionKey: "Settings.Message Trends",
  },
  {
    tabLabel: "Version History",
    tabKey: "version-history",
    pluginName: VERSION_HISTORY_PLUGIN_NAME,
    component: VersionHistorySettingsTab,
    actionPanel: VersionHistoryActionPanel,
    permissionKey: "Settings.Version History",
  },
];

/**
 * All plugin settings tabs — built-in tabs merged with commercial plugin tabs.
 *
 * This is a getter (not a constant) so that it reflects tabs registered after
 * module evaluation (i.e., after plugins/index.ts has run).
 */
export function getPluginSettingsTabs() {
  return [...BUILTIN_PLUGIN_TABS, ...pluginRegistry.settingsTabs];
}

/**
 * @deprecated Use getPluginSettingsTabs() instead. Kept for compatibility with
 * any code that imported PLUGIN_SETTINGS_TABS before the plugin registry was added.
 */
export const PLUGIN_SETTINGS_TABS = BUILTIN_PLUGIN_TABS;
