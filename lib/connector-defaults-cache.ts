/**
 * Prefetched built-in connector default properties.
 *
 * The connector default-properties seams (source-tab type-change, destination-tab
 * type-change, `addDestinationToXml` / `defaultQueueForType` in `channel-xml.ts`) resolve
 * a transport's default `<properties>` XML **synchronously**. To source those defaults
 * from `GET /connectors/{type}/defaults` without turning the whole XML-transform layer
 * async, we prefetch them once per session into this module-singleton map (mirroring the
 * runtime-plugin loader's `defaultsByTransport`, `lib/runtime-plugins/loader.ts`), then the
 * seams read synchronously via {@link getConnectorDefaultXml}.
 *
 * Fail-soft: a miss (server too old, fetch failed, or a group-C transport) returns `null`
 * and the caller falls back to its hardcoded template — so the app is fully functional
 * before the prefetch resolves and against a Core below {@link MIN_SERVER_CONNECTOR_DEFAULTS}.
 *
 * The map is reset on login/logout/401 via `registerCacheTeardown` (defaults are
 * server-specific: a different Core may stamp a different version or gate connectors
 * differently).
 */

import { registerCacheTeardown } from "@/lib/logout";
import {
  connectorDefaults,
  serverSupportsConnectorDefaults,
} from "@/lib/api/api-connector-defaults";

/**
 * The 16 built-in transports whose bare server-side instantiation matches (group A /
 * identical) or improves on (group B) the WebUI's hardcoded template, per the
 * byte-parity diff and confirmed live in Phase 0. The other 4 built-ins
 * (`CONNECTOR_DEFAULTS_SERVER_UNSAFE`) are excluded because bare instantiation drops their
 * plugin-contributed defaults (httpauth / MLLP transmission-mode) — they stay on the
 * hardcoded template + the client-side `injectDefaults` that fills that gap.
 *
 * These are the WebUI transport strings (`SOURCE_/DESTINATION_CONNECTOR_TYPES`), which
 * equal the server transport names for all 16 (Phase 0). Hardcoded here rather than
 * imported from `channel-xml.ts` so that `channel-xml → this module` stays a one-way
 * import (channel-xml reads {@link getConnectorDefaultXml}).
 */
const SERVER_SAFE_BUILTIN_TRANSPORTS = [
  // Source (6)
  "Channel Reader",
  "Database Reader",
  "DICOM Listener",
  "File Reader",
  "JavaScript Reader",
  "JMS Listener",
  // Destination (10)
  "Channel Writer",
  "Database Writer",
  "DICOM Sender",
  "Document Writer",
  "File Writer",
  "HTTP Sender",
  "JavaScript Writer",
  "JMS Sender",
  "SMTP Sender",
  "Web Service Sender",
] as const;

/** Guard against an implausibly large body (a proxy/HTML error page, not real defaults). */
const MAX_DEFAULTS_XML_BYTES = 64 * 1024;

let cache = new Map<string, string>();
let loadPromise: Promise<void> | null = null;
// Bumped by resetConnectorDefaultsCache so an in-flight prefetch that started against
// a since-torn-down session (logout → login to a DIFFERENT Core mid-fetch) discards its
// result instead of overwriting the new session's cache with the old server's defaults.
let generation = 0;

/** A server default is usable only if it is the expected `<properties …>` root, not an error page. */
function isConnectorPropertiesXml(xml: string | null | undefined): xml is string {
  return (
    typeof xml === "string" &&
    xml.length > 0 &&
    xml.length <= MAX_DEFAULTS_XML_BYTES &&
    /^\s*(?:<\?xml[^>]*\?>\s*)?<properties[\s>]/.test(xml)
  );
}

/**
 * The prefetched server default `<properties>` XML for a built-in transport, or `null`
 * when it was not fetched (server too old, fetch failed, group-C transport, or the
 * prefetch has not resolved yet). Callers MUST fall back to their hardcoded template on
 * `null`. Pure synchronous map read — safe to call from the sync XML-transform seams.
 */
export function getConnectorDefaultXml(transport: string): string | null {
  return cache.get(transport) ?? null;
}

/** Drop all prefetched defaults. Registered as a cache teardown (login/logout/401). */
export function resetConnectorDefaultsCache(): void {
  cache = new Map();
  loadPromise = null;
  generation++;
}

registerCacheTeardown(resetConnectorDefaultsCache);

/**
 * Prefetch the server defaults for all {@link SERVER_SAFE_BUILTIN_TRANSPORTS}, once per
 * session. Idempotent (memoized) and fail-soft: individual fetch failures are swallowed
 * (that transport keeps using its hardcoded template), and an old server is a no-op.
 * Call at app-shell boot, next to `loadRuntimePlugins()`; never gate UI readiness on it.
 */
export function ensureConnectorDefaultsLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  if (!serverSupportsConnectorDefaults()) return Promise.resolve();

  const startGeneration = generation;
  loadPromise = (async () => {
    const entries = await Promise.all(
      SERVER_SAFE_BUILTIN_TRANSPORTS.map(async (transport) => {
        try {
          const xml = await connectorDefaults(transport);
          return isConnectorPropertiesXml(xml) ? ([transport, xml] as const) : null;
        } catch {
          return null; // fall back to the hardcoded template for this transport
        }
      })
    );
    // A reset (logout/login/401) fired while this fetch was in flight — discard the
    // result rather than repopulating the cache with a since-torn-down session's data.
    if (generation !== startGeneration) return;
    const next = new Map<string, string>();
    for (const entry of entries) if (entry) next.set(entry[0], entry[1]);
    cache = next;
  })();

  return loadPromise;
}
