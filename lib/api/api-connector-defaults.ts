/**
 * Server-side connector default properties.
 *
 * The Java Swing client builds a new connector's default `<properties>` blob from the
 * no-arg constructor of each `*ReceiverProperties` / `*DispatcherProperties` (plus the
 * connector-property plugins that inject httpauth / transmission-mode defaults). The
 * WebUI has historically approximated this by hardcoding 20 `DEFAULT_*_PROPERTIES_XML`
 * templates in `app/(app)/channels/_lib/channel-xml.ts` and stamping the product
 * `{{VERSION}}` into them client-side — the source of the `{{VERSION}}` → XStream-500
 * bug class/1270). `GET /connectors/{type}/defaults` returns the real
 * server-instantiated, already-version-stamped defaults, one round-trip per transport.
 *
 * Gated by {@link MIN_SERVER_CONNECTOR_DEFAULTS}: callers use the server when the
 * connected Core is new enough and fall back to the hardcoded template otherwise, so
 * older servers keep working (the fallback is removed in a later cleanup release once
 * `MIN_SUPPORTED_SERVER_VERSION` clears the floor). See for the approach.
 *
 * The endpoint returns raw XML (not the XStream envelope), so this uses `rawText`.
 *
 * This is a WebAdmin-only endpoint — no `Client.java` wrapper); there is no
 * Java-client call to mirror, matching how/1662 adopted their new endpoints.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import { request } from "./api-core";

/** Core release that first shipped `GET /connectors/{type}/defaults`. */
export const MIN_SERVER_CONNECTOR_DEFAULTS = "26.9.0";

/**
 * Built-in connector transports whose bare server-side instantiation is missing
 * plugin-contributed defaults, so the endpoint's output diverges from the full client's
 * byte-parity diff, confirmed live in Phase 0). These stay on the
 * hardcoded template until a Core defaults-assembler enhancement fills the gap:
 *
 *   - HTTP Listener / Web Service Listener — empty `<pluginProperties/>` instead of the
 *     httpauth `NoneHttpAuthProperties` default.
 *   - TCP Listener / TCP Sender — `FrameModeProperties` instead of the MLLP
 *     `MLLPModeProperties` default (dropping `useMLLPv2`/`ackBytes`/`nackBytes`/`maxRetries`).
 *
 * Keyed by transport name (the endpoint's `type` path segment).
 */
export const CONNECTOR_DEFAULTS_SERVER_UNSAFE: ReadonlySet<string> = new Set([
  "HTTP Listener",
  // The WebUI's source transport string is "WebService Listener" (no space); the
  // server knows it as "Web Service Listener". Irrelevant here — it is excluded from
  // the fetch either way — but the set keys the WebUI (seam) string space.
  "WebService Listener",
  "TCP Listener",
  "TCP Sender",
]);

/**
 * True when the connected Core is new enough to serve `/connectors/{type}/defaults`.
 * Missing or unparseable server versions return `false` (via {@link isVersionAtLeast}),
 * so callers route to the hardcoded fallback rather than a doomed request.
 */
export function serverSupportsConnectorDefaults(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_CONNECTOR_DEFAULTS);
}

/**
 * Fetch the server-instantiated default `<properties>` XML for a built-in connector
 * transport (e.g. `"HTTP Sender"`, `"DICOM Listener"`, `"Channel Reader"`), already
 * version-stamped by Core.
 *
 * `type` is a path segment. No transport name contains a slash (unlike the datatype
 * names in, so a segment is safe; spaces are `%20`-encoded by
 * `encodeURIComponent`.
 *
 * Throws `ApiError` (404) for an unknown or disabled transport — callers should treat a
 * throw as "fall back to the hardcoded template", never as a hard failure.
 */
export async function connectorDefaults(type: string): Promise<string> {
  return request<string>(`/connectors/${encodeURIComponent(type)}/defaults`, {
    rawText: true,
  });
}
