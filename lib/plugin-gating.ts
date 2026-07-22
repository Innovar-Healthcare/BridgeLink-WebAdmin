"use client";

/**
 * Uniform server-enablement gating for plugin extension points.
 *
 * The single import point read sites use to decide whether a plugin-contributed
 * surface should appear. A "batteries-included" build ships every approved
 * plugin's UI compiled-in but dormant; a surface must contribute zero visible
 * UI unless its server extension is installed AND enabled (and, for Version
 * History, its own "Enable" setting is on).
 *
 * Two rules the whole app follows:
 *   1. Enumeration / selection surfaces gate — dropdowns, add-menus, tabs,
 *      overlays, viewers, editor actions, single-fill slots.
 *   2. Lookups-by-key NEVER gate — resolving an existing channel's
 *      transportName / dataType / step xmlTag to its definition always works,
 *      so channel XML authored elsewhere still renders and round-trips without
 *      data loss even when the contributing plugin is dormant.
 *
 * The predicate itself lives in lib/version-history.ts (it layers Version
 * History's extra "Enable" setting on top of extension-enablement); this module
 * re-exports it so callers have one gating import, and adds slot-specific
 * helpers that resolve a slot's gate from the plugin that filled it.
 */

import {
  usePluginSurfaceEnabled,
  usePluginSurfaceReady,
  VERSION_HISTORY_PLUGIN_NAME,
  isVersionHistoryEnabledSnapshot,
  loadVersionHistoryEnabled,
  type SurfaceGate,
} from "@/lib/version-history";
import { isPluginEnabledSnapshot, loadInstalledPlugins } from "@/lib/installed-plugins";
import { isPluginLicensedSnapshot, loadPluginLicenses } from "@/lib/plugin-license";
import { getSlotOwner, type SlotName } from "@/lib/plugin-slots";
import { getPluginDefinition } from "@/lib/plugin-manifest";

// Re-exported so read sites import all gating from one place.
export { usePluginSurfaceEnabled, usePluginSurfaceReady };
export type { SurfaceGate };

/**
 * Synchronous, non-hook twin of `usePluginSurfaceEnabled()` for non-React read
 * sites (e.g. the Monaco completion providers). Reads the current enablement
 * and license snapshots — false-while-loading, so warm the caches first via
 * `ensureInstalledPluginsLoaded()` / `ensurePluginLicensesLoaded()`. Never
 * hand-roll this composition at a call site: a site that checks only one gate
 * is how license leaks happen.
 */
export function surfaceGateEnabledSnapshot(gate: SurfaceGate): boolean {
  const { pluginName, licensedPluginId } = gate;
  if (pluginName) {
    const serverOk =
      pluginName === VERSION_HISTORY_PLUGIN_NAME
        ? isVersionHistoryEnabledSnapshot()
        : isPluginEnabledSnapshot(pluginName);
    if (!serverOk) return false;
  }
  if (licensedPluginId && !isPluginLicensedSnapshot(licensedPluginId)) return false;
  return true;
}

/**
 * The gate tags for a filled slot: the `serverPluginName` and `licensedPluginId`
 * of the plugin that filled it. Fields are `undefined` when the slot is unowned
 * (e.g. filled via a legacy `register*()` shim with no plugin id) or its owner
 * declares no such gate — an all-undefined gate is treated as ungated (always
 * shown).
 */
function slotGate(name: SlotName): SurfaceGate {
  const owner = getSlotOwner(name);
  const def = owner ? getPluginDefinition(owner) : undefined;
  return { pluginName: def?.serverPluginName, licensedPluginId: def?.licensedPluginId };
}

/**
 * Reactive: is the plugin that filled this slot enabled AND licensed?
 * Ungated/unowned slots return true. Use at render time alongside the
 * `pluginSlots[name]` member-expression read — the component reference stays
 * outside a call expression (React Compiler static-components rule), and this
 * boolean gates whether it renders. Mirrors the precedent at
 * channels-action-panel.tsx.
 */
export function useSlotEnabled(name: SlotName): boolean {
  const surfaceEnabled = usePluginSurfaceEnabled();
  return surfaceEnabled(slotGate(name));
}

/**
 * Async, load-accurate variant for function-slot call sites (post-save
 * handlers, the repo-changes provider). Unlike the reactive hook — which
 * returns false while a cache is still loading so UI stays hidden — this awaits
 * the relevant fetches so a genuinely-enabled+licensed plugin's handler is never
 * skipped merely because a cache had not loaded yet.
 */
export async function slotSurfaceEnabled(name: SlotName): Promise<boolean> {
  const { pluginName, licensedPluginId } = slotGate(name);
  if (pluginName) {
    if (pluginName === VERSION_HISTORY_PLUGIN_NAME) {
      await loadVersionHistoryEnabled();
      if (!isVersionHistoryEnabledSnapshot()) return false;
    } else {
      await loadInstalledPlugins();
      if (!isPluginEnabledSnapshot(pluginName)) return false;
    }
  }
  if (licensedPluginId) {
    await loadPluginLicenses();
    if (!isPluginLicensedSnapshot(licensedPluginId)) return false;
  }
  return true;
}
