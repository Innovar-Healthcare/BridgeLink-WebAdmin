"use client";

/**
 * Version History "feature enabled" store + gating helpers.
 *
 * The Version History plugin contributes UI across many surfaces (channel-editor
 * tab, sidebar page, Code Templates / Global Scripts history + import, Channels
 * import, uncommitted-change indicators, the auto-commit prompt). Every one of
 * those must hide / no-op when Version History is OFF.
 *
 * "OFF" has two independent causes, and both must gate the UI:
 *   1. The server extension is disabled (`GET /extensions/{name}/enabled`), OR
 *   2. The plugin's own "Enable" setting (the `versionHistory.enable` property,
 *      toggled in the Version History settings tab) is "false".
 *
 * The first pass of only checked (1). This store checks BOTH and
 * exposes the combined signal so every surface gates identically.
 *
 * Loader semantics mirror lib/installed-plugins.ts: lazy single fetch, false
 * while loading (so UI stays hidden rather than flashing), and an explicit
 * cache-clear used on logout and after the setting is saved.
 */

import { useSyncExternalStore } from "react";
import { getPluginProperties } from "@/lib/api/api-extensions";
import { getServerUrl } from "@/lib/api/api-core";
import {
  useEnabledPluginNames,
  useInstalledPluginsReady,
  loadInstalledPlugins,
  isPluginEnabledSnapshot,
} from "@/lib/installed-plugins";
import { useLicensedPluginIds, useLicensedPluginsReady } from "@/lib/plugin-license";
import { logWarn } from "@/lib/dev-logger";

/**
 * Server plugin name exactly as reported by `GET /extensions/plugins/`. Shared
 * with the settings-tab gate (lib/plugin-settings.ts) and the plugin's own
 * registrations (plugins/version-history/index.ts).
 */
export const VERSION_HISTORY_PLUGIN_NAME = "Version History Plugin";

/** Property key for the "Enable" toggle (from VersionHistoryProperties.java). */
const ENABLE_PROPERTY_KEY = "versionHistory.enable";

type LoadState = "idle" | "loading" | "loaded" | "error";

let enabled = false;
let state: LoadState = "idle";
let inflight: Promise<void> | null = null;
// Bumped by clearVersionHistoryEnabledCache() so a load that started before the
// clear discards its result instead of resurrecting the previous session's
// enabled flag (or a terminal error state) after the reset.
let generation = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

async function load(): Promise<void> {
  if (inflight) return inflight;
  // No active session (sessionStorage cleared) → don't fetch. Guards every
  // entry point uniformly (ensureLoaded()'s render-time call). Without this, a
  // still-mounted subscriber's re-render during the logout teardown
  // (clearVersionHistoryEnabledCache() resets state to "idle" and notify()s)
  // re-fires a fetch — via the awaited loadInstalledPlugins()/getPluginProperties()
  // calls below — that's guaranteed to fail with sessionStorage already
  // cleared, leaving state stuck at "error" with no retry to recover it.
  if (!getServerUrl()) return;
  state = "loading";
  const gen = generation;
  // Deliberately no notify() here. `ensureLoaded()` runs during render (from
  // the use* hooks below), so a synchronous notify would invoke the
  // useSyncExternalStore listeners — i.e. schedule setState — mid-render,
  // which React rejects ("Cannot update a component while rendering a
  // different component"). The idle→loading transition changes neither
  // snapshot (both stay false), so there is nothing to deliver anyway. The
  // finally-block notify below runs post-await in a later microtask and
  // safely delivers the resolved value.
  inflight = (async () => {
    try {
      // Extension must be installed AND enabled first — if not, the feature is
      // off regardless of the stored property (and the properties endpoint may
      // be unavailable).
      await loadInstalledPlugins();
      if (gen !== generation) return; // cleared mid-flight (logout) — discard
      if (!isPluginEnabledSnapshot(VERSION_HISTORY_PLUGIN_NAME)) {
        enabled = false;
        state = "loaded";
        return;
      }
      const props = await getPluginProperties(VERSION_HISTORY_PLUGIN_NAME);
      if (gen !== generation) return; // cleared mid-flight — discard
      enabled = props[ENABLE_PROPERTY_KEY] === "true";
      state = "loaded";
    } catch (err) {
      if (gen !== generation) return; // cleared mid-flight — discard the error too
      logWarn("VersionHistory", "Failed to load version-history enabled state", err);
      enabled = false;
      state = "error";
    } finally {
      // A stale (pre-clear) load must not null out a newer session's in-flight
      // fetch or emit a notify for state it didn't write. Also covers the early
      // return above (its finally still runs).
      if (gen === generation) {
        inflight = null;
        notify();
      }
    }
  })();
  return inflight;
}

function ensureLoaded(): void {
  if (state === "idle") void load();
}

function getEnabledSnapshot(): boolean {
  return enabled;
}

function getReadySnapshot(): boolean {
  return state === "loaded" || state === "error";
}

/**
 * True when Version History is installed, the extension is enabled, AND its
 * "Enable" setting is on. Returns false while the cache is still loading so
 * gated UI stays hidden rather than flashing.
 */
export function useVersionHistoryEnabled(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getEnabledSnapshot, getEnabledSnapshot);
}

/** True once the version-history feature fetch has resolved (loaded or error). */
export function useVersionHistoryReady(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getReadySnapshot, getReadySnapshot);
}

/** Non-hook snapshot read of the version-history enabled state. */
export function isVersionHistoryEnabledSnapshot(): boolean {
  return enabled;
}

/**
 * Await the version-history feature fetch, then resolve. Returns immediately
 * when already resolved. For non-React consumers (the plugin's always-run save
 * handlers) that must read an accurate snapshot rather than the loading default.
 */
export async function loadVersionHistoryEnabled(): Promise<void> {
  if (state === "loaded" || state === "error") return;
  await load();
}

/**
 * Clear the cache so the next read re-fetches. Called on logout and after the
 * Version History "Enable" setting is saved, so gated UI reflects the change
 * without requiring a re-login.
 */
export function clearVersionHistoryEnabledCache(): void {
  generation++;
  enabled = false;
  state = "idle";
  inflight = null;
  notify();
}

// ─── Generic plugin-surface gating ────────────────────────────────────────────
//
// The channel-editor tab, sidebar page, and /p/[slug] route gate generic
// plugin surfaces by the tags on their registry definition. A surface has up to
// two independent gates, AND-composed:
//   - `pluginName`        — server-enablement (installed AND enabled; Version
//                           History layers its own "Enable" setting on top).
//   - `licensedPluginId`  — license entitlement. Needed because the
//                           enablement gate does NOT reflect licensing: an
//                           installed-but-unlicensed plugin still reports enabled
//                           server-side, so without this a commercial plugin's UI
//                           would show even when unlicensed.
// These helpers centralize both so the generic render sites stay uniform.

/**
 * A surface's gate tags. Either may be absent (that gate doesn't apply). A bare
 * string is accepted as shorthand for `{ pluginName }` so existing call sites
 * that pass only a plugin name keep working unchanged.
 */
export interface SurfaceGate {
  pluginName?: string;
  licensedPluginId?: string;
}

function toGate(gate: SurfaceGate | string | undefined): SurfaceGate {
  return typeof gate === "string" ? { pluginName: gate } : (gate ?? {});
}

/**
 * Returns a predicate: given a surface's gate tags, should it appear? A surface
 * with neither tag always shows. `pluginName` must be installed+enabled (Version
 * History additionally requires its feature setting); `licensedPluginId` must be
 * licensed. Both are required when both are set.
 */
export function usePluginSurfaceEnabled(): (gate: SurfaceGate | string | undefined) => boolean {
  const enabledPlugins = useEnabledPluginNames();
  const vhEnabled = useVersionHistoryEnabled();
  const licensed = useLicensedPluginIds();
  return (gate) => {
    const { pluginName, licensedPluginId } = toGate(gate);
    if (pluginName) {
      const serverOk =
        pluginName === VERSION_HISTORY_PLUGIN_NAME ? vhEnabled : enabledPlugins.has(pluginName);
      if (!serverOk) return false;
    }
    if (licensedPluginId && !licensed.has(licensedPluginId)) return false;
    return true;
  };
}

/**
 * Whether the gating signals for a surface have resolved. Used by the /p/[slug]
 * route to avoid flashing notFound (or mounting a page that fails its API calls)
 * while a relevant cache is still loading. Awaits whichever gates the surface
 * declares.
 */
export function usePluginSurfaceReady(gate: SurfaceGate | string | undefined): boolean {
  const installedReady = useInstalledPluginsReady();
  const vhReady = useVersionHistoryReady();
  const licenseReady = useLicensedPluginsReady();
  const { pluginName, licensedPluginId } = toGate(gate);
  if (!pluginName && !licensedPluginId) return true;
  if (pluginName) {
    const enablementReady = pluginName === VERSION_HISTORY_PLUGIN_NAME ? vhReady : installedReady;
    if (!enablementReady) return false;
  }
  if (licensedPluginId && !licenseReady) return false;
  return true;
}

// ─── Test-only helpers ──────────────────────────────────────────────────────
// Exported for unit tests; do not call from production code.
export const __testing = {
  forceState(nextEnabled: boolean, nextState: LoadState): void {
    generation++; // discard any in-flight load so it can't clobber forced state
    enabled = nextEnabled;
    state = nextState;
    inflight = null;
    notify();
  },
  reset(): void {
    clearVersionHistoryEnabledCache();
  },
};
