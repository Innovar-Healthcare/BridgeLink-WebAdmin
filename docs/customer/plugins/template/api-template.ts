/**
 * Starter plugin — API client.
 *
 * ## Pattern A — property bag (this file's default)
 * Use when settings are simple key/value pairs with no read-only computed
 * fields. Communicates via the generic plugin-properties endpoints
 * (`getPluginProperties` / `setPluginProperties`). The `Properties` interface
 * mirrors your server-side properties class field-for-field — keep the two
 * halves in sync when you add fields.
 *
 * ## Pattern B — typed REST endpoints
 * Use when:
 *   - The response includes read-only computed fields (e.g. `connected`,
 *     `hasCredential`) that display live but are not part of the editable form.
 *   - Settings are saved via a custom PUT/POST endpoint rather than the generic
 *     property bag.
 *   - The plugin exposes action endpoints (e.g. POST /reconnect, POST /revoke).
 *
 * In that case, delete the fromRecord/toRecord helpers and the
 * getPluginProperties/setPluginProperties calls below. Instead, import `request`
 * from "@/lib/api-client" and write typed wrappers directly against your
 * plugin's REST endpoints.
 *
 * ### CRITICAL: PUT/POST bodies must use an XStream-aliased type
 *
 * BridgeLink reads request bodies through XStream, which only knows the types it
 * is told about at server startup. Plugin-defined DTOs are NOT registered —
 * sending one as a request body produces a silent empty HTTP 500 with no log
 * entry, because the body is rejected before your servlet method runs. Safe Java
 * body types:
 *   - `java.util.Properties` (the standard plugin config envelope)
 *   - `String` (for free-form JSON parsed inside the servlet)
 *   - BridgeLink core domain classes (`Channel`, `CodeTemplateLibrary`, etc.)
 *
 * Plugin-defined DTOs ARE fine as RETURN types — the asymmetry only applies to
 * inputs. See ../BUILD-A-PLUGIN.md ("Critical: REST request-body rule").
 *
 * Example Pattern B implementation:
 *
 *   function buildPropertiesBody(props: Record<string, string>): string {
 *     const entries = Object.entries(props).map(([k, v]) => ({ "@name": k, $: v }));
 *     const property = entries.length === 1 ? entries[0] : entries;
 *     return JSON.stringify({ properties: { property } });
 *   }
 *
 *   export async function updateStarterSettings(
 *     settings: Pick<StarterSettings, "enabled" | "endpoint">,
 *   ): Promise<StarterSettings> {
 *     return request<StarterSettings>("/plugins/starter/settings", {
 *       method: "PUT",
 *       headers: { "Content-Type": "application/json" },
 *       body: buildPropertiesBody({
 *         enabled: String(settings.enabled),
 *         endpoint: settings.endpoint,
 *       }),
 *     });
 *   }
 *
 * The matching Java signature MUST take `Properties` (not the DTO), and every
 * parameter must carry `@Param("name")`:
 *
 *   StarterSettings updateSettings(@Param("properties") Properties properties)
 *       throws ClientException;
 */

import { getPluginProperties, setPluginProperties } from "@/lib/api-client";

/** Must match your server plugin's plugin.xml <name> exactly. */
export const STARTER_PLUGIN_NAME = "My Plugin";

/** Mirrors your server-side StarterProperties class. */
export interface StarterProperties {
  enabled: boolean;
}

const KEY_ENABLED = "starter.enable";

export function fromRecord(record: Record<string, string>): StarterProperties {
  return {
    enabled: record[KEY_ENABLED] === "true",
  };
}

export function toRecord(form: StarterProperties): Record<string, string> {
  return {
    [KEY_ENABLED]: String(form.enabled),
  };
}

export async function getStarterProperties(): Promise<StarterProperties> {
  const record = await getPluginProperties(STARTER_PLUGIN_NAME);
  return fromRecord(record);
}

export async function setStarterProperties(form: StarterProperties): Promise<void> {
  await setPluginProperties(STARTER_PLUGIN_NAME, toRecord(form));
}
