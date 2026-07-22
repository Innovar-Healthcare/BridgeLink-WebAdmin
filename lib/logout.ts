/**
 * Centralized client-side session/cache teardown.
 *
 * Every path that ends a session (explicit logout, idle-logout, and a 401 from
 * the server) must wipe all client-held state so no prior-user data survives on
 * a shared workstation. Keeping this in one place stops the paths from drifting
 * apart over time (they previously cleared different subsets).
 *
 * Beyond the always-present caches cleared directly below, other module-singleton
 * data caches (full channel XML in the global search index, dashboard trend
 * stats, code-template find-usage XML, pending channel imports, server theme
 * defaults) register a reset callback via `registerCacheTeardown`. That inverts
 * the dependency — those (sometimes heavy, sometimes app-layer) modules import
 * this file rather than the reverse — so none of them get pulled into this
 * module's graph (this file is reachable from `api-core`, even server-side).
 * A cache only registers when its module is loaded, which is exactly when it
 * could hold data, so the registry is self-correcting.
 */
import { clearSession } from "@/lib/auth";
import { clearServerInfoCache } from "@/lib/hooks/use-server-info";
import { clearCharsetCache } from "@/lib/hooks/use-charset-encodings";
import { clearPermissionsCache } from "@/lib/hooks/use-permissions";
import { clearCache } from "@/lib/cache-store";

/** Reset callbacks registered by module-singleton data caches. */
const dataCacheTeardowns = new Set<() => void>();

/**
 * Register a reset callback for a module-level data cache so it is cleared on
 * login, logout, idle-logout, and 401. Call at module top level; idempotent.
 */
export function registerCacheTeardown(fn: () => void): void {
  dataCacheTeardowns.add(fn);
}

/**
 * Clear all cached **server data** (not session/auth state). Safe to call on
 * login, where the just-established session must be preserved. Drops the core
 * data cache plus every registered module-singleton data cache.
 */
export function clearDataCaches(): void {
  clearCache(); // the core data cache (channels, stats, config map)
  for (const fn of dataCacheTeardowns) fn();
}

/**
 * Full session teardown: session/auth caches + all server data.
 *
 * Call on logout, idle-logout, and 401 so no prior-user data (channel names,
 * stats, deployment metadata, config-map values, cached channel XML held in
 * module singletons) survives the redirect to /login. A client-side navigation
 * does not reload the module singletons, so without this the previous user's
 * caches are still readable by the next person before they authenticate.
 *
 * Navigation stays with the caller — it differs per path (router.replace vs
 * window.location.href) and is not drift-prone.
 */
export function clearClientCaches(): void {
  clearSession(); // also clears installed-plugins + version-history caches
  clearServerInfoCache();
  clearCharsetCache();
  clearPermissionsCache();
  clearDataCaches();
}
