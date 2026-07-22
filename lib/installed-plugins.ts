"use client";

/**
 * Installed-plugins store — tracks which BridgeLink server-side plugins are
 * installed AND enabled on the currently connected server.
 *
 * Used by plugin UI surfaces (connector form sections, etc.) to hide
 * themselves when the underlying server plugin is missing or disabled, even
 * when client-side detection (XML tag presence, etc.) would otherwise show
 * them. This mirrors the gating already applied to settings tabs by
 * `app/(app)/settings/page.tsx`.
 *
 * Loader semantics:
 *   - First read triggers a single fetch combining GET /extensions/plugins/
 *     (installed list) with GET /extensions/{name}/enabled (per-plugin enabled
 *     state). The two together match the "installed AND enabled" check used
 *     for settings tabs.
 *   - While loading, `useInstalledPluginEnabled` returns false so UI stays
 *     hidden rather than briefly flashing stale state.
 *   - After load completes, components re-render with the real value.
 *   - `clearInstalledPluginsCache()` invalidates the cache on logout.
 */

import { useSyncExternalStore } from "react";
import { getPluginMetaData, isExtensionEnabled } from "@/lib/api/api-extensions";
import { getServerUrl } from "@/lib/api/api-core";
import { logWarn } from "@/lib/dev-logger";

type LoadState = "idle" | "loading" | "loaded" | "error";

let enabled: Set<string> = new Set();
let state: LoadState = "idle";
let inflight: Promise<void> | null = null;
// Bumped by clearInstalledPluginsCache() so a load that started before the clear
// discards its result instead of resurrecting the previous session's enabled set
// (or a terminal error state) after the reset.
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
  // entry point uniformly: ensureLoaded()'s render-time call AND
  // loadInstalledPlugins()'s async non-hook call (the latter is reachable
  // during logout via lib/version-history.ts's own load(), which awaits it
  // before checking Version History's enablement). Without this, a
  // still-mounted subscriber's re-render during logout teardown
  // (clearInstalledPluginsCache() resets state to "idle" and notify()s)
  // re-fires a fetch that's guaranteed to 400 ("no server configured"),
  // leaving state stuck at "error" — since there's no retry and client-side
  // login navigation doesn't reset this module's state, the *next* login's
  // fetch is silently skipped too.
  if (!getServerUrl()) return;
  state = "loading";
  const gen = generation;
  // Deliberately no notify() here. `ensureLoaded()` runs during render (from
  // the use* hooks below), so a synchronous notify would invoke the
  // useSyncExternalStore listeners — i.e. schedule setState — mid-render,
  // which React rejects ("Cannot update a component while rendering a
  // different component"). The idle→loading transition changes neither
  // snapshot (the Set is untouched, ready stays false), so there is nothing
  // to deliver anyway. The finally-block notify below runs post-await in a
  // later microtask and safely delivers the resolved value.
  inflight = (async () => {
    try {
      const meta = await getPluginMetaData();
      const installedNames = Object.keys(meta ?? {});
      const results = await Promise.all(
        installedNames.map(async (name) => {
          try {
            const isEnabled = await isExtensionEnabled(name);
            return isEnabled ? name : null;
          } catch {
            return null;
          }
        })
      );
      if (gen !== generation) return; // cleared mid-flight (logout) — discard
      enabled = new Set(results.filter((n): n is string => n !== null));
      state = "loaded";
    } catch (err) {
      if (gen !== generation) return; // cleared mid-flight — discard the error too
      logWarn("InstalledPlugins", "Failed to load installed-plugins metadata", err);
      enabled = new Set();
      state = "error";
    } finally {
      // A stale (pre-clear) load must not null out a newer session's in-flight
      // fetch or emit a notify for state it didn't write.
      if (gen === generation) {
        inflight = null;
        notify();
      }
    }
  })();
  return inflight;
}

function ensureLoaded(): void {
  // (The no-active-session guard lives in load() itself, so it covers every
  // entry point uniformly — see load()'s comment.)
  if (state === "idle") {
    // fire-and-forget; subscribers will re-render via notify()
    void load();
  }
}

function getEnabledSnapshot(): Set<string> {
  return enabled;
}

function getReadySnapshot(): boolean {
  return state === "loaded" || state === "error";
}

function getErrorSnapshot(): boolean {
  return state === "error";
}

/**
 * Returns the set of plugin names installed AND enabled on the server.
 * Triggers a lazy fetch on first call. Returns the same Set instance until
 * the cache is replaced, so referential equality is safe.
 */
export function useEnabledPluginNames(): Set<string> {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getEnabledSnapshot, getEnabledSnapshot);
}

/**
 * Returns true once the installed-plugins fetch has resolved (either
 * successfully or with an error). Components can use this to distinguish
 * "still loading" from "loaded but plugin not enabled".
 */
export function useInstalledPluginsReady(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getReadySnapshot, getReadySnapshot);
}

/**
 * Returns true when the installed-plugins fetch has terminally failed (the
 * "error" state). The Settings page uses it to surface a "Failed to load
 * plugin settings tabs" toast (L34) instead of silently hiding every gated
 * tab. Recovery from a transient failure is a page refresh / re-login (the
 * store fetches once per session and fails closed — a deliberately simple
 * contract; see PLAN-PluginLicenseGating-BusinessLogic.md).
 */
export function useInstalledPluginsError(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getErrorSnapshot, getErrorSnapshot);
}

/**
 * True iff the named plugin is installed AND enabled on the server.
 * While the cache is still loading, returns false so plugin UI stays hidden.
 */
export function useInstalledPluginEnabled(pluginName: string): boolean {
  const names = useEnabledPluginNames();
  return names.has(pluginName);
}

/**
 * Trigger the lazy installed-plugins fetch without subscribing to it.
 *
 * For non-React consumers (e.g. the Monaco completion provider) that need the
 * enabled-plugins snapshot warm but can't call the `use*` hooks. Safe to call
 * repeatedly — it's a no-op once a fetch is in flight or complete.
 */
export function ensureInstalledPluginsLoaded(): void {
  ensureLoaded();
}

/**
 * Await the installed-plugins fetch, then resolve.
 *
 * Returns immediately when the cache is already resolved (loaded or error),
 * otherwise awaits the in-flight (or freshly started) fetch. For non-React
 * consumers that must read an accurate `isPluginEnabledSnapshot()` value rather
 * than the "false while loading" default — e.g. the version-history post-save
 * handler, which must not skip the repo write while the plugin is in fact
 * enabled but the cache simply hasn't loaded yet.
 */
export async function loadInstalledPlugins(): Promise<void> {
  if (state === "loaded" || state === "error") return;
  await load();
}

/**
 * Non-hook read of "is this plugin installed AND enabled on the server".
 *
 * Reads the current module-level snapshot synchronously. While the cache is
 * still loading it returns false (matching `useInstalledPluginEnabled`), so
 * gated UI stays hidden rather than flashing. Call `ensureInstalledPluginsLoaded()`
 * first so the snapshot becomes populated.
 */
export function isPluginEnabledSnapshot(pluginName: string): boolean {
  return enabled.has(pluginName);
}

/**
 * Clear the cache. Called on logout so the next user's session re-fetches.
 */
export function clearInstalledPluginsCache(): void {
  generation++;
  enabled = new Set();
  state = "idle";
  inflight = null;
  notify();
}

// ─── Test-only helpers ──────────────────────────────────────────────────────
// Exported for unit tests; do not call from production code.
export const __testing = {
  forceState(nextEnabled: Set<string>, nextState: LoadState): void {
    generation++; // discard any in-flight load so it can't clobber forced state
    enabled = nextEnabled;
    state = nextState;
    inflight = null;
    notify();
  },
  reset(): void {
    clearInstalledPluginsCache();
  },
};
