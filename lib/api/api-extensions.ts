/**
 * API extensions — plugin/connector metadata, enable/disable, properties, data pruner.
 */

import type { PluginMetaData, ConnectorMetaData } from "../types";
import { PROXY_BASE, getServerUrl, request, throwForStatus } from "./api-core";

/**
 * Parses the XStream/Staxon serialization of java.util.Properties.
 *
 * PropertiesConverter.marshal() emits: <property name="key">value</property>
 * Staxon converts that to:
 *   { "properties": { "property": [ { "@name": "key", "$": value }, ... ] } }
 * (single entry collapses the array to a plain object — same @name/$  structure, no array)
 *
 * "$" values are auto-typed by Staxon's autoPrimitive: booleans arrive as boolean,
 * numbers as number, strings as string. We stringify all values for a uniform
 * Record<string, string> return type (e.g. boolean true → "true").
 */
function parsePropertiesResponse(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (raw === null || typeof raw !== "object") return result;

  // Unwrap outer "properties" element wrapper
  const outer = raw as Record<string, unknown>;
  const inner = outer["properties"];
  if (inner === null || typeof inner !== "object") return result;

  const propContainer = inner as Record<string, unknown>;
  const propEntries = propContainer["property"];
  if (propEntries == null) return result;

  // Staxon collapses single-item arrays to plain objects — normalize to array
  const entries = Array.isArray(propEntries) ? propEntries : [propEntries];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const key = e["@name"];
    const value = e["$"];
    if (typeof key === "string" && value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

export async function getPluginMetaData(): Promise<Record<string, PluginMetaData>> {
  return request<Record<string, PluginMetaData>>("/extensions/plugins/");
}

export async function getConnectorMetaData(): Promise<Record<string, ConnectorMetaData>> {
  return request<Record<string, ConnectorMetaData>>("/extensions/connectors/");
}

/**
 * GET /extensions/{extensionName}/enabled
 * Mirrors Java's ExtensionServlet.isExtensionEnabled().
 * Returns true if the named plugin is installed AND enabled on the server.
 * NOTE: GET /extensions/plugins/ returns ALL installed plugins regardless of
 * enabled status; this endpoint is required to check enabled state separately.
 */
export async function isExtensionEnabled(extensionName: string): Promise<boolean> {
  return request<boolean>(`/extensions/${encodeURIComponent(extensionName)}/enabled`);
}

/**
 * POST /extensions/{extensionName}/_setEnabled?enabled=<bool>
 * Mirrors Java's ExtensionManagerPanel enable/disable task.
 * enabled is a query parameter — the server ignores any request body.
 * Returns 204 No Content on success.
 */
export async function setExtensionEnabled(extensionName: string, enabled: boolean): Promise<void> {
  return request<void>(
    `/extensions/${encodeURIComponent(extensionName)}/_setEnabled?enabled=${String(enabled)}`,
    { method: "POST" }
  );
}

/**
 * POST /extensions/_uninstall
 * Mirrors Java's Frame.doUninstallExtension().
 * Body is a raw JSON string — the extension's path attribute (e.g. "/path/to/extension").
 * The server marks the extension for deletion on next restart.
 * Returns 204 No Content on success.
 */
export async function uninstallExtension(extensionPath: string): Promise<void> {
  return request<void>("/extensions/_uninstall", {
    method: "POST",
    body: JSON.stringify(extensionPath),
  });
}

/**
 * POST /extensions/_install
 * Mirrors Java's ExtensionManagerPanel install flow.
 * Uploads a ZIP file containing the extension.
 * Returns 204 No Content on success.
 * Note: uses fetch directly (not request()) because the body is FormData (multipart).
 */
export async function installExtension(file: File): Promise<void> {
  const serverUrl = getServerUrl();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${PROXY_BASE}/extensions/_install`, {
    method: "POST",
    headers: {
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
      // Note: do NOT set Content-Type — browser sets it with correct multipart boundary
    },
    credentials: "include",
    body: formData,
  });

  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
}

/**
 * GET /extensions/{pluginName}/properties
 * Mirrors Java's ClientPlugin.getPropertiesFromServer().
 *
 * The server serializes java.util.Properties via PropertiesConverter + Staxon, producing:
 *   { "properties": { "property": [ { "@name": "key", "$": value }, ... ] } }
 * We skip normalizeXStream (which doesn't know this format) and parse it directly.
 */
export async function getPluginProperties(pluginName: string): Promise<Record<string, string>> {
  const raw = await request<unknown>(`/extensions/${encodeURIComponent(pluginName)}/properties`, {
    skipNormalize: true,
  });
  return parsePropertiesResponse(raw);
}

/**
 * PUT /extensions/{pluginName}/properties
 * Mirrors Java's ClientPlugin.setPropertiesToServer(properties).
 *
 * The server uses XStream + Staxon to deserialize java.util.Properties.
 * PropertiesConverter.marshal() emits: <properties><property name="k">v</property></properties>
 * Staxon JSON equivalent:
 *   { "properties": { "property": [{"@name":"k","$":"v"}, ...] } }
 * Single-entry collapses the array to a plain object (no array) to match Staxon's collapsed form.
 *
 * The outer "properties" wrapper is required — without it the server returns 500.
 */
export async function setPluginProperties(
  pluginName: string,
  properties: Record<string, string>
): Promise<void> {
  const entries = Object.entries(properties).map(([k, v]) => ({ "@name": k, $: v }));
  const property = entries.length === 1 ? entries[0] : entries;
  const body = JSON.stringify({ properties: { property } });
  return request<void>(`/extensions/${encodeURIComponent(pluginName)}/properties`, {
    method: "PUT",
    body,
  });
}

/**
 * POST /plugins/version-history/validateSetting
 * Mirrors Java's GitSettingsDialog.validateGitRemoteRepository() → servlet.validateSetting(properties).
 *
 * Sends only the git-related property keys as java.util.Properties (same Staxon
 * format as setPluginProperties). The server validates the remote Git repository
 * connection and returns a plain-text result string (e.g. "Successfully connected
 * to the remote repository. Remember to save your changes."). Failures arrive as
 * an HTTP 400 with the failure message in the body, surfaced via throwForStatus.
 */
export async function validateVersionHistorySettings(
  gitSettings: Record<string, string>
): Promise<string> {
  const entries = Object.entries(gitSettings).map(([k, v]) => ({ "@name": k, $: v }));
  const property = entries.length === 1 ? entries[0] : entries;
  const body = JSON.stringify({ properties: { property } });
  const text = await request<string>("/plugins/version-history/validateSetting", {
    method: "POST",
    body,
    rawText: true,
  });
  return text.trim();
}

// ─── Data Pruner ─────────────────────────────────────────────────────────────

/**
 * GET /extensions/datapruner/status
 * Mirrors Java's DataPrunerServletInterface.getStatusMap().
 *
 * Actual server response (from live API testing):
 *   {"map":{"entry":[
 *     {"string":["lastProcess","-"]},
 *     {"string":["isRunning",false]},       ← NOTE: boolean, not string "false"
 *     {"string":["currentState","Not running"]},
 *     {"string":["nextProcess","Scheduled Wednesday, Feb 25, 12:00:00 PM"]},
 *     {"string":["currentProcess","-"]}
 *   ]}}
 *
 * normalizeXStream converts the map/entry format to a plain object.
 * However, "isRunning" value is a raw JSON boolean (false/true), not a string.
 * We stringify all values so callers can use === "true" / === "false" consistently.
 *
 * Keys returned: currentState, currentProcess, lastProcess, nextProcess, isRunning
 */
export async function getDataPrunerStatus(): Promise<Record<string, string>> {
  const raw = await request<Record<string, unknown>>("/extensions/datapruner/status");
  if (!raw || typeof raw !== "object") return {};
  // Stringify all values (isRunning may be boolean, others are strings)
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])
  );
}

/**
 * POST /extensions/datapruner/_start
 * Mirrors Java's DataPrunerServletInterface.start().
 * Starts the data pruner on-demand. Returns a Calendar (ignored by UI).
 */
export async function startDataPruner(): Promise<void> {
  await request<void>("/extensions/datapruner/_start", { method: "POST" });
}

/**
 * POST /extensions/datapruner/_stop
 * Mirrors Java's DataPrunerServletInterface.stop().
 * Stops the data pruner if currently running.
 */
export async function stopDataPruner(): Promise<void> {
  await request<void>("/extensions/datapruner/_stop", { method: "POST" });
}

// ─── Directory Resource Libraries ────────────────────────────────────────────

/**
 * GET /extensions/directoryresource/resources/{resourceId}/libraries
 * Mirrors Java's DirectoryResourcePropertiesPanel → getLibraries(resourceId).
 * Returns a list of library filenames loaded from the resource's directory.
 */
export async function getResourceLibraries(resourceId: string): Promise<string[]> {
  const raw = await request<string[]>(
    `/extensions/directoryresource/resources/${encodeURIComponent(resourceId)}/libraries`
  );
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw as unknown as string];
}
