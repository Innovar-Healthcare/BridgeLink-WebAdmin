"use client";

/**
 * Plugin-license store — tracks which plugins are currently
 * entitled (licensed) on the connected server, per the License Manager's
 * `GET /plugins/license-manager/plugin-license-statuses` endpoint.
 *
 * Why the WebUI needs this at all: the installed-AND-enabled gate
 * (lib/installed-plugins.ts) does NOT reflect licensing. Verified against the
 * BridgeLink server source — `GET /extensions/{name}/enabled` reads a plain
 * admin flag (default "true") and is untouched when a plugin's server-side
 * `init()` throws on a failed license check. So an installed-but-unlicensed
 * commercial plugin still reports installed AND enabled, and the enablement
 * gate alone would leave its UI visible (then its API calls fail). The License
 * Manager's per-plugin status list is the only reliable client-side
 * entitlement signal, for both pure-client-side plugins (no server half) and
 * server-backed plugins.
 *
 * Loader semantics mirror lib/installed-plugins.ts:
 *   - Lazy single fetch on first read — but only when at least one registered
 *     plugin declares `licensedPluginId` (hasLicenseGatedPlugins()), so a
 *     core-only / open-source install never probes an absent License Manager.
 *   - "Entitled" = status Active or Expiring Soon (mirrors the server's own
 *     LicenseCheckService.checkPlugin). Expired / Unlicensed / absent → not
 *     entitled.
 *   - Fails closed: any fetch error (incl. License Manager not installed → 404)
 *     yields an empty set, so license-gated UI stays hidden. This matches the
 *     server, where LicenseCheck also fails closed when the License Manager is
 *     absent.
 *   - Empty while loading so gated UI stays hidden rather than flashing.
 *   - `clearPluginLicensesCache()` invalidates the cache on logout.
 */

import { useSyncExternalStore } from "react";
import { request, getServerUrl } from "@/lib/api/api-core";
import { hasLicenseGatedPlugins } from "@/lib/plugin-manifest";
import { logWarn } from "@/lib/dev-logger";

/**
 * Minimal shape of a License Manager `plugin-license-statuses` entry. Declared
 * locally (not imported from plugins/license-manager) so core never depends on
 * a plugin module — the endpoint is consumed by string, mirroring how the
 * enablement gate consumes plugin names. Full type lives in
 * plugins/license-manager/_lib/types.ts (RuntimePluginStatus).
 */
interface PluginLicenseStatus {
  pluginId: string;
  status: "Active" | "Expiring Soon" | "Expired" | "Unlicensed";
}

/** The four display-string license states the server reports per plugin. */
export type PluginLicenseStatusValue = PluginLicenseStatus["status"];

/** License states that count as entitled (mirrors server checkPlugin). */
const ENTITLED_STATUSES: ReadonlySet<PluginLicenseStatus["status"]> = new Set([
  "Active",
  "Expiring Soon",
]);

type LoadState = "idle" | "loading" | "loaded" | "error";

let licensed: Set<string> = new Set();
// Per-plugin raw status (Active/Expiring Soon/Expired/Unlicensed), kept
// alongside the entitled `licensed` set. The set answers "may this UI work?";
// this map answers "why not?" — the upgrade prompt needs the raw
// status to pick Expired vs Unlicensed copy. Empty while loading / on error /
// after clear, mirroring `licensed`. A plugin absent from the response has no
// entry here (server now reports every known plugin — see notes).
let statuses: Map<string, PluginLicenseStatusValue> = new Map();
let state: LoadState = "idle";
let inflight: Promise<void> | null = null;
// Bumped by clearPluginLicensesCache() so a load that started before the clear
// discards its result instead of resurrecting the previous session's
// entitlements (or a terminal error state) after the reset.
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
  // loadPluginLicenses()'s async non-hook call. Without this, a still-mounted
  // subscriber's re-render during the logout teardown (clearPluginLicensesCache()
  // resets state to "idle" and notify()s) re-fires a fetch that's guaranteed to
  // 400 ("no server configured"), leaving state stuck at "error" — since
  // there's no retry and client-side login navigation doesn't reset this
  // module's state, the *next* login's fetch is silently skipped too.
  if (!getServerUrl()) return;
  state = "loading";
  const gen = generation;
  // Deliberately no notify() here — same rationale as lib/installed-plugins.ts:
  // ensureLoaded() runs during render, and the idle→loading transition changes
  // neither snapshot (the Set is untouched, ready stays false). The finally
  // notify below runs post-await.
  inflight = (async () => {
    try {
      const statusList = await request<PluginLicenseStatus[]>(
        "/plugins/license-manager/plugin-license-statuses",
        { skipNormalize: true }
      );
      if (gen !== generation) return; // cleared mid-flight (logout) — discard
      const list = statusList ?? [];
      licensed = new Set(
        list.filter((s) => ENTITLED_STATUSES.has(s.status)).map((s) => s.pluginId)
      );
      statuses = new Map(list.map((s) => [s.pluginId, s.status]));
      state = "loaded";
    } catch (err) {
      if (gen !== generation) return; // cleared mid-flight — discard the error too
      // Fail closed: License Manager absent (404) or any error → no entitlements.
      logWarn("PluginLicense", "Failed to load plugin license statuses", err);
      licensed = new Set();
      statuses = new Map();
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
  // Skip the fetch entirely when nothing is license-gated — a core-only /
  // open-source install with no licensed plugins must not probe an absent
  // License Manager on every session. (The no-active-session guard lives in
  // load() itself, so it covers every entry point uniformly.)
  if (state === "idle" && hasLicenseGatedPlugins()) {
    void load();
  }
}

function getLicensedSnapshot(): Set<string> {
  return licensed;
}

function getStatusesSnapshot(): Map<string, PluginLicenseStatusValue> {
  return statuses;
}

function getReadySnapshot(): boolean {
  // When nothing is license-gated the store never loads; treat that as ready so
  // usePluginSurfaceReady doesn't hang on a fetch that will never fire.
  return state === "loaded" || state === "error" || !hasLicenseGatedPlugins();
}

/**
 * The set of plugin ids (License Manager `pluginId` strings) currently entitled
 * on the server. Triggers a lazy fetch on first call when any plugin is
 * license-gated. Returns the same Set instance until replaced (referential
 * equality safe). Empty while loading and on error (fail closed).
 */
export function useLicensedPluginIds(): Set<string> {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getLicensedSnapshot, getLicensedSnapshot);
}

/** True once the license-status fetch has resolved (or is not needed). */
export function useLicensedPluginsReady(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getReadySnapshot, getReadySnapshot);
}

/**
 * The full per-plugin license-status map (`pluginId` → status string). Internal
 * helper backing `usePluginLicenseStatus`; same lazy-fetch + referential-
 * stability guarantees as `useLicensedPluginIds`. A plugin absent from the
 * server's response has no entry (returns `undefined` via `.get`).
 */
function usePluginLicenseStatuses(): Map<string, PluginLicenseStatusValue> {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getStatusesSnapshot, getStatusesSnapshot);
}

/**
 * The raw license status for a single plugin id (or `undefined` when absent /
 * still loading). Used by the upgrade prompt to pick Expired vs Unlicensed copy
 * when the license fetch has succeeded. Prefer the boolean
 * `useLicensedPluginIds`/`usePluginSurfaceEnabled` for gating.
 */
export function usePluginLicenseStatus(pluginId: string): PluginLicenseStatusValue | undefined {
  return usePluginLicenseStatuses().get(pluginId);
}

/**
 * Await the license-status fetch, then resolve. Returns immediately when
 * already resolved or when no plugin is license-gated. For non-React consumers
 * (the async slot gate) that must read an accurate snapshot rather than the
 * empty-while-loading default.
 */
export async function loadPluginLicenses(): Promise<void> {
  if (state === "loaded" || state === "error" || !hasLicenseGatedPlugins()) return;
  await load();
}

/**
 * Non-hook read of "is this plugin id currently entitled". Empty while loading
 * (returns false) so gated UI stays hidden. Call loadPluginLicenses() first for
 * an accurate value in non-React contexts.
 */
export function isPluginLicensedSnapshot(pluginId: string): boolean {
  return licensed.has(pluginId);
}

/**
 * Trigger the lazy license fetch without subscribing to it.
 *
 * For non-React consumers (e.g. the Monaco completion provider) that need the
 * licensed snapshot warm but can't call the `use*` hooks. Safe to call
 * repeatedly — no-op once a fetch is in flight or complete, and a no-op when
 * nothing is license-gated.
 */
export function ensurePluginLicensesLoaded(): void {
  ensureLoaded();
}

/**
 * Clear the cache so the next read re-fetches. Called on logout (and after a
 * license is installed/removed in the License Manager tab, so gated UI reflects
 * the change without a re-login). Invalidates any in-flight load.
 */
export function clearPluginLicensesCache(): void {
  generation++;
  licensed = new Set();
  statuses = new Map();
  state = "idle";
  inflight = null;
  notify();
}

// ─── Test-only helpers ──────────────────────────────────────────────────────
// Exported for unit tests; do not call from production code.
export const __testing = {
  forceState(
    nextLicensed: Set<string>,
    nextState: LoadState,
    nextStatuses?: Map<string, PluginLicenseStatusValue>
  ): void {
    generation++; // discard any in-flight load so it can't clobber forced state
    licensed = nextLicensed;
    // Default to deriving entitled entries as "Active" when statuses omitted, so
    // existing tests that only pass a licensed set keep a consistent map.
    statuses = nextStatuses ?? new Map([...nextLicensed].map((id) => [id, "Active" as const]));
    state = nextState;
    inflight = null;
    notify();
  },
  reset(): void {
    clearPluginLicensesCache();
  },
};
