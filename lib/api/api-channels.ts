/**
 * API channels — channel CRUD, operations, runtime state, groups, metadata.
 */

import type { Channel, ChannelGroup, ChannelHeader, ChannelSummary } from "../types";
import { PROXY_BASE, escXml, getServerUrl, request, throwForStatus } from "./api-core";
import { parseChannelTagsFromXml } from "./parse-channel-tags-xml";

// ─── Channels ────────────────────────────────────────────────────────────────

/**
 * GET /channels/idsAndNames
 * Mirrors Java client's getChannelIdsAndNames() — returns a lightweight
 * Map<channelId, channelName> for all channels (including undeployed).
 * XStream normalizes the linked-hash-map to a plain object; we convert to Map.
 */
export async function getChannelIdsAndNames(): Promise<Map<string, string>> {
  const raw = await request<Record<string, string>>("/channels/idsAndNames");
  // Coerce values to strings — Staxon auto-converts numeric-looking channel names
  // (e.g. "12345") to JSON numbers, so the raw map value may be a number at runtime.
  return new Map(Object.entries(raw ?? {}).map(([k, v]) => [k, String(v)] as [string, string]));
}

/**
 * POST /channels/_getSummary
 * Mirrors Java client's getChannelSummary(cachedChannels, ignoreNewChannels).
 *
 * The server uses XStream for JSON serialization (Object→XML→JSON via Staxon), so the
 * request body must be in XStream's linked-hash-map envelope format, NOT plain JSON.
 *
 * XStream serializes Map<String, ChannelHeader> as:
 * {
 *   "map": {
 *     "entry": [
 *       { "string": "<channelId>", "channelHeader": { "revision": N, "deployedDate": {"time": <millis>, "timezone": "UTC"} | null, "codeTemplatesChanged": false } },
 *       ...
 *     ]
 *   }
 * }
 * deployedDate uses XStream's GregorianCalendarConverter format: {"time": epochMillis, "timezone": "<tz>"}.
 * NOT an ISO string — the server deserializes via JSON→XML→XStream which uses GregorianCalendarConverter.
 *
 * On first load pass {"map": {}} (empty HashMap) — the server treats all channels as new and
 * returns full Channel objects. Do NOT pass "{}" — Staxon requires the "map" root key to
 * reconstruct the <map/> XML element that XStream deserializes as an empty HashMap.
 * On refresh, pass one entry per cached channel.
 */
export async function getChannelSummary(
  cachedChannels: Record<string, ChannelHeader>,
  ignoreNewChannels = false
): Promise<ChannelSummary[]> {
  // Build XStream-compatible linked-hash-map JSON envelope
  const entries = Object.entries(cachedChannels).map(([id, header]) => ({
    string: id,
    channelHeader: header,
  }));
  const body =
    entries.length === 0
      ? JSON.stringify({ map: {} }) // empty HashMap: XStream serializes as <map/> → {"map": {}}
      : JSON.stringify({ map: { entry: entries } });

  const raw = await request<ChannelSummary[]>(
    `/channels/_getSummary?ignoreNewChannels=${ignoreNewChannels}`,
    { method: "POST", body }
  );
  return Array.isArray(raw) ? raw : [];
}

/**
 * GET /channels — returns full Channel objects.
 * The Java client does NOT use this during normal channel panel refresh;
 * it uses getChannelIdsAndNames + getChannelSummary instead.
 * Kept here for ad-hoc use (e.g. fetching a single channel by ID).
 */
export async function getChannels(): Promise<Channel[]> {
  return request<Channel[]>("/channels");
}

export async function getChannelGroups(): Promise<ChannelGroup[]> {
  return request<ChannelGroup[]>("/channelgroups");
}

// ─── Channel operations ───────────────────────────────────────────────────────

/** Deploy one or more channels. Single channel uses the per-channel path; bulk uses /_deploy. */
export async function deployChannels(ids: string[]): Promise<void> {
  if (ids.length === 1) {
    return request<void>(`/channels/${ids[0]}/_deploy`, { method: "POST" });
  }
  return request<void>("/channels/_deploy", {
    method: "POST",
    body: JSON.stringify({ set: { string: ids } }),
  });
}

/** Redeploy ALL channels (POST /channels/_redeployAll). */
export async function redeployAllChannels(): Promise<void> {
  return request<void>("/channels/_redeployAll", { method: "POST" });
}

/** Delete one or more channels. */
export async function deleteChannels(ids: string[]): Promise<void> {
  if (ids.length === 1) {
    return request<void>(`/channels/${ids[0]}`, { method: "DELETE" });
  }
  return request<void>("/channels/_removeChannels", {
    method: "POST",
    body: JSON.stringify({ set: { string: ids } }),
  });
}

/** Enable or disable one or more channels via form-encoded POST /_setEnabled. */
export async function setChannelsEnabled(ids: string[], enabled: boolean): Promise<void> {
  const serverUrl = getServerUrl();
  const form = new URLSearchParams();
  for (const id of ids) form.append("channelId", id);
  form.append("enabled", String(enabled));
  const res = await fetch(`${PROXY_BASE}/channels/_setEnabled`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: form.toString(),
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
}

// ─── Channel runtime state (start / stop / pause / resume / halt / undeploy) ──
//
// Batch endpoints use form-encoded channelId params (same pattern as _setEnabled).
// Single-channel endpoints use the per-channel path.

async function channelStatusAction(action: string, ids: string[]): Promise<void> {
  if (ids.length === 1) {
    return request<void>(`/channels/${ids[0]}/${action}`, { method: "POST" });
  }
  const serverUrl = getServerUrl();
  const form = new URLSearchParams();
  for (const id of ids) form.append("channelId", id);
  const r = await fetch(`${PROXY_BASE}/channels/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: form.toString(),
  });
  if (!r.ok) throwForStatus(r.status, await r.text().catch(() => ""));
}

/** Undeploy one or more channels.
 *  _undeploy is on EngineServletInterface (not ChannelStatusServletInterface),
 *  so it expects JSON with a Set body — NOT form-urlencoded.
 */
export async function undeployChannels(ids: string[]): Promise<void> {
  if (ids.length === 1) {
    return request<void>(`/channels/${ids[0]}/_undeploy`, { method: "POST" });
  }
  return request<void>("/channels/_undeploy", {
    method: "POST",
    body: JSON.stringify({ set: { string: ids } }),
  });
}

/** Start one or more channels. */
export async function startChannels(ids: string[]): Promise<void> {
  return channelStatusAction("_start", ids);
}

/** Stop one or more channels. */
export async function stopChannels(ids: string[]): Promise<void> {
  return channelStatusAction("_stop", ids);
}

/** Pause one or more channels. */
export async function pauseChannels(ids: string[]): Promise<void> {
  return channelStatusAction("_pause", ids);
}

/** Resume one or more paused channels. */
export async function resumeChannels(ids: string[]): Promise<void> {
  return channelStatusAction("_resume", ids);
}

/** Halt one or more channels (force-stops; use with caution). */
export async function haltChannels(ids: string[]): Promise<void> {
  return channelStatusAction("_halt", ids);
}

/** Stop a single connector (source or destination) on a channel.
 *  POST /channels/{channelId}/connector/{metaDataId}/_stop
 *  metaDataId: 0 = source, 1+ = destinations
 */
export async function stopConnector(channelId: string, metaDataId: number): Promise<void> {
  return request<void>(`/channels/${channelId}/connector/${metaDataId}/_stop`, { method: "POST" });
}

/** Start a single connector (source or destination) on a channel.
 *  POST /channels/{channelId}/connector/{metaDataId}/_start
 *  metaDataId: 0 = source (resumes/starts the channel), 1+ = destinations
 */
export async function startConnector(channelId: string, metaDataId: number): Promise<void> {
  return request<void>(`/channels/${channelId}/connector/${metaDataId}/_start`, { method: "POST" });
}

/** Clear statistics for a channel and/or specific connectors.
 *  POST /channels/_clearStatistics
 *  channelConnectorMap: { channelId -> metaDataIds[] | null }
 *    null means clear all connectors for that channel.
 *  At least one of received/filtered/sent/error must be true.
 */
export async function clearStatistics(
  channelConnectorMap: Record<string, (number | null)[]>,
  opts: { received: boolean; filtered: boolean; sent: boolean; error: boolean }
): Promise<void> {
  const entries = Object.entries(channelConnectorMap).map(([channelId, mids]) => {
    // XStream list format: null elements use {"null": null}, int elements use {"int": N}
    // Java client always sends explicit metaDataIds: [null, 0, 1, ...] where null = channel-level
    const nullCount = mids.filter((m) => m === null).length;
    const ints = mids.filter((m): m is number => m !== null);
    const listVal: Record<string, unknown> = {};
    if (nullCount > 0) listVal["null"] = null;
    if (ints.length === 1) listVal["int"] = ints[0];
    else if (ints.length > 1) listVal["int"] = ints;
    return { string: channelId, list: listVal };
  });
  const body =
    entries.length === 0
      ? JSON.stringify({ map: {} })
      : entries.length === 1
        ? JSON.stringify({ map: { entry: entries[0] } })
        : JSON.stringify({ map: { entry: entries } });
  const qs = new URLSearchParams({
    received: String(opts.received),
    filtered: String(opts.filtered),
    sent: String(opts.sent),
    error: String(opts.error),
  });
  await request<void>(`/channels/_clearStatistics?${qs}`, { method: "POST", body });
}

/** Reset current AND lifetime statistics for ALL channels (including undeployed).
 *  POST /channels/_clearAllStatistics  (no body)
 *  Mirrors SettingsPanelServer.doClearAllStats() → mirthClient.clearAllStatistics().
 */
export async function clearAllStatistics(): Promise<void> {
  return request<void>("/channels/_clearAllStatistics", { method: "POST" });
}

/** Remove all messages for one or more channels.
 *  DELETE /channels/_removeAllMessages?channelId=A&channelId=B&...
 *  Mirrors the Java client's mirthClient.removeAllMessages(Set<String>, ...) bulk call
 *  (Frame.doRemoveAllMessages, Frame.java:3920-3952), which is used for both single- and
 *  multi-channel removal — a single-channel removal just sends a one-element set.
 *  restartRunningChannels: stop+restart running channels in the set (to clear queued msgs)
 *  clearStatistics: also clear stats after removing messages
 */
export async function removeAllMessagesForChannels(
  channelIds: string[],
  opts: { restartRunningChannels: boolean; clearStatistics: boolean }
): Promise<void> {
  const qs = new URLSearchParams({
    restartRunningChannels: String(opts.restartRunningChannels),
    clearStatistics: String(opts.clearStatistics),
  });
  for (const id of channelIds) qs.append("channelId", id);
  await request<void>(`/channels/_removeAllMessages?${qs}`, { method: "DELETE" });
}

/** Fetch a single channel as XML text (for export / clone). */
export async function getChannelXml(channelId: string): Promise<string> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/channels/${channelId}`, {
    headers: {
      Accept: "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return res.text();
}

/**
 * Fetch a single channel as XML text, including linked code template libraries.
 * Uses GET /channels/{id}?includeCodeTemplateLibraries=true with Accept: application/xml.
 * The server embeds linked libraries inside the channel's <exportData> element.
 */
export async function getChannelXmlWithLibraries(channelId: string): Promise<string> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/channels/${channelId}?includeCodeTemplateLibraries=true`, {
    headers: {
      Accept: "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return res.text();
}

/**
 * Fetch channel XML (with libraries) and return both the XML text and the list of
 * linked library names parsed from it. Single API call — parse names from the XML
 * rather than making a separate JSON request.
 *
 * Returns { xml, libraryNames } where libraryNames is empty when no libraries are linked.
 */
export async function getChannelExportData(channelId: string): Promise<{
  xml: string;
  libraryNames: string[];
}> {
  const xml = await getChannelXmlWithLibraries(channelId);
  // Parse library names out of the returned XML using DOMParser.
  // The server embeds linked libraries in <exportData><codeTemplateLibraries><codeTemplateLibrary>
  // Each <codeTemplateLibrary> has a direct <name> child.
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const libEls = doc.querySelectorAll("exportData > codeTemplateLibraries > codeTemplateLibrary");
  const libraryNames: string[] = [];
  libEls.forEach((el) => {
    // Direct <name> child only (not nested names inside code templates)
    const name = el.querySelector(":scope > name")?.textContent?.trim();
    if (name) libraryNames.push(name);
  });
  return { xml, libraryNames };
}

/** Extract a user-friendly error message from a server error response body. */
function extractServerError(body: string): string {
  if (!body.trim()) return "Unknown server error";
  // Strip XML tags if present (server may wrap errors in XML)
  let cleaned = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Truncate if excessively long
  if (cleaned.length > 200) cleaned = cleaned.slice(0, 200) + "…";
  return cleaned || "Unknown server error";
}

/** Create a channel from raw XML text (import / clone). POST /channels/ with Content-Type: application/xml. */
export async function createChannelFromXml(xml: string): Promise<void> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: xml,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throwForStatus(res.status, extractServerError(body), "Save failed");
  }
}

/**
 * Parse the bare boolean returned by endpoints like `PUT /channels/{id}` and
 * `POST /channelgroups/_bulkUpdate`. Depending on the negotiated content type the body arrives
 * as plain text (`"true"`/`"false"`) or an XStream/Staxon JSON wrapper (`{"boolean": false}`).
 * An unrecognized 2xx body means the server accepted the request, so we treat it as success
 * rather than a phantom conflict.
 */
function parseServerBoolean(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  try {
    const parsed = JSON.parse(trimmed) as { boolean?: boolean } | boolean;
    if (typeof parsed === "boolean") return parsed;
    if (parsed && typeof parsed.boolean === "boolean") return parsed.boolean;
  } catch {
    // Non-JSON, non-"true"/"false" body — treat as success.
  }
  return true;
}

/**
 * Format an epoch-millis instant into the shape the server's `updateChannel` parses for its
 * `startEdit` query param: `SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ")`. We emit UTC (offset
 * `+0000`) to avoid local-offset computation bugs — the server converts to a Calendar instant and
 * compares by instant, so any timezone-correct representation works. The `Z` (RFC-822) token
 * accepts `+0000`, and the format's absent milliseconds field is tolerated by lenient parsing.
 */
export function formatStartEdit(epochMillis: number): string {
  return new Date(epochMillis).toISOString().replace(/\.\d{3}Z$/, "+0000");
}

/**
 * Update an existing channel from raw XML (edit page).
 * PUT /channels/{channelId}?override=<bool>[&startEdit=<time>] with Content-Type: application/xml.
 *
 * Concurrency (mirrors Java `Frame.updateChannel` / `DefaultChannelController.updateChannel`):
 * when `override` is false the server compares `startEdit` (when the user began editing) against
 * the channel's stored `lastModified`; if the channel was modified after editing began it returns
 * HTTP 200 with a boolean `false` WITHOUT applying the change. When `override` is true the check is
 * skipped and the update is force-applied. `startEditMillis` MUST be supplied for the `false` path
 * to detect anything — omitting it makes the server default the timestamp to "now", which never
 * predates `lastModified`, so no conflict is ever reported.
 *
 * @returns `true` when the update was applied, `false` when rejected as a concurrent-edit conflict
 *   (only possible with `override=false`). Throws on genuine API errors.
 */
export async function updateChannelFromXml(
  channelId: string,
  xml: string,
  override = true,
  startEditMillis?: number
): Promise<boolean> {
  const serverUrl = getServerUrl();
  const startEditParam =
    startEditMillis != null
      ? `&startEdit=${encodeURIComponent(formatStartEdit(startEditMillis))}`
      : "";
  const res = await fetch(
    `${PROXY_BASE}/channels/${encodeURIComponent(channelId)}?override=${override}${startEditParam}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/xml",
        ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
      },
      credentials: "include",
      body: xml,
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throwForStatus(res.status, extractServerError(body), "Save failed");
  }
  return parseServerBoolean(await res.text().catch(() => ""));
}

// ─── Channel group operations ─────────────────────────────────────────────────

/**
 * Serialize a ChannelGroup to an XML string fragment.
 * Only id, name, revision, and channel ids are needed by the server.
 */
function groupToXml(g: ChannelGroup): string {
  const chs = (g.channels ?? []).filter((c) => c.id);
  const channelsXml =
    chs.length === 0
      ? "<channels/>"
      : `<channels>${chs.map((c) => `<channel><id>${c.id}</id></channel>`).join("")}</channels>`;
  return [
    `<channelGroup>`,
    `<id>${g.id}</id>`,
    `<name>${escXml(g.name)}</name>`,
    `<revision>${g.revision ?? 1}</revision>`,
    typeof g.description === "string" && g.description
      ? `<description>${escXml(g.description)}</description>`
      : `<description/>`,
    channelsXml,
    `</channelGroup>`,
  ].join("");
}

/**
 * Bulk-update channel groups via multipart POST /channelgroups/_bulkUpdate.
 * Handles create, rename, reassign channels, and delete (via removedGroupIds).
 *
 * IMPORTANT: The server's @FormDataParam parts are read by XmlMessageBodyReader
 * (class-level @Consumes is application/xml). Each part MUST be sent as a Blob
 * with type "application/xml" so the multipart boundary includes Content-Type: application/xml.
 * JSON parts cause the server to receive null for channelGroups → NPE at line 825.
 * Confirmed by live API testing: <linked-hash-set> wrapper works; <list> wrapper fails.
 *
 * Concurrency (mirrors Java ChannelPanel.attemptUpdate): when `override` is false the
 * server runs an out-of-sync pre-check and, if the client's group set is stale (a group
 * was renamed/reassigned/created/deleted server-side since the last refresh), it returns
 * HTTP 200 with a boolean `false` WITHOUT applying the change. When `override` is true the
 * pre-check is skipped and the update is force-applied. Callers should attempt `false` first
 * and only retry with `true` after confirming the overwrite with the user.
 *
 * @returns `true` when the update was applied, `false` when the server rejected it as
 *   out-of-sync (only possible with `override=false`). Throws on genuine API errors.
 */
export async function bulkUpdateChannelGroups(
  groups: ChannelGroup[],
  removedGroupIds: string[],
  override = false
): Promise<boolean> {
  const serverUrl = getServerUrl();
  const form = new FormData();

  const groupsXml =
    groups.length === 0
      ? "<linked-hash-set/>"
      : `<linked-hash-set>${groups.map(groupToXml).join("")}</linked-hash-set>`;

  const removedXml =
    removedGroupIds.length === 0
      ? "<linked-hash-set/>"
      : `<linked-hash-set>${removedGroupIds.map((id) => `<string>${id}</string>`).join("")}</linked-hash-set>`;

  form.append("channelGroups", new Blob([groupsXml], { type: "application/xml" }), "channelGroups");
  form.append(
    "removedChannelGroupIds",
    new Blob([removedXml], { type: "application/xml" }),
    "removedChannelGroupIds"
  );

  const res = await fetch(`${PROXY_BASE}/channelgroups/_bulkUpdate?override=${override}`, {
    method: "POST",
    headers: { ...(serverUrl ? { "x-bl-server": serverUrl } : {}) },
    credentials: "include",
    body: form,
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));

  // The endpoint returns a bare boolean (see parseServerBoolean).
  return parseServerBoolean(await res.text().catch(() => ""));
}

/** Fetch all channel groups as XML text (for export). */
export async function getChannelGroupsXml(): Promise<string> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/channelgroups`, {
    headers: {
      Accept: "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return res.text();
}

export async function getChannelMetadata(): Promise<
  Record<string, import("../cache-store").ChannelMetadata>
> {
  return request<Record<string, import("../cache-store").ChannelMetadata>>(
    "/server/channelMetadata"
  );
}

export async function getChannelDependencies(): Promise<
  import("../cache-store").ChannelDependency[]
> {
  // normalizeXStream returns a plain object (not an array) when there is only one
  // dependency — same single-vs-array XStream behaviour seen throughout the API.
  // Normalise here so callers always receive ChannelDependency[].
  const raw = await request<unknown>("/server/channelDependencies");
  const arr: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // Filter out malformed entries. When the server has NO dependencies it returns
  // {"set": null} (Staxon's encoding of XStream's <set/>), which normalizeXStream
  // passes through unchanged. The ternary above would then wrap it in [{"set":null}],
  // producing a fake ChannelDependency whose fields are all undefined. Filtering to
  // only valid objects prevents downstream escXml(undefined) crashes.
  return arr.filter(
    (d): d is import("../cache-store").ChannelDependency =>
      d !== null &&
      typeof d === "object" &&
      typeof (d as Record<string, unknown>).dependentId === "string" &&
      typeof (d as Record<string, unknown>).dependencyId === "string"
  );
}

/**
 * PUT /server/channelDependencies — replaces the entire global dependency set.
 *
 * Sends XStream XML directly (Content-Type: application/xml) rather than relying
 * on Staxon JSON→XML conversion, which is unreliable for Java collection types
 * (HashSet serialised as <set>). This mirrors the approach used by updateChannelFromXml
 * and avoids 500 errors caused by Staxon mishandling empty or single-element sets.
 *
 * XStream format:
 *   empty  → <set/>
 *   1 dep  → <set><channelDependency>...</channelDependency></set>
 *   n deps → <set><channelDependency>...</channelDependency>...</set>
 */
export async function setChannelDependencies(
  dependencies: import("../cache-store").ChannelDependency[]
): Promise<void> {
  const serverUrl = getServerUrl();

  let xmlBody: string;
  if (dependencies.length === 0) {
    xmlBody = "<set/>";
  } else {
    const items = dependencies
      .map(
        (d) =>
          `<channelDependency>` +
          `<dependentId>${escXml(d.dependentId)}</dependentId>` +
          `<dependencyId>${escXml(d.dependencyId)}</dependencyId>` +
          `</channelDependency>`
      )
      .join("");
    xmlBody = `<set>${items}</set>`;
  }

  const res = await fetch(`${PROXY_BASE}/server/channelDependencies`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/xml",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    credentials: "include",
    body: xmlBody,
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
}

/**
 * GET /server/channelTags — all channel tags with their color and channelId sets.
 * Mirrors Java client's getCachedChannelTags() which loads from ConfigurationController.
 *
 * Fetched as XML, not JSON, on purpose: the server's JSON serialization runs through
 * Staxon with autoPrimitive enabled, which coerces any numeric-looking tag name (e.g.
 * "10e33") into a BigDecimal — rewriting it to scientific notation ("1.0E+34") before it
 * reaches the client and destroying the original string. XML carries the
 * literal text content intact. `rawText: true` returns the response body verbatim, before
 * JSON parsing / the numeric-quoting regex / normalizeXStream — none of which can recover
 * the mangled value. The `Accept: application/xml` header overrides request()'s default.
 */
export async function getChannelTags(): Promise<import("../types").ChannelTag[]> {
  const xml = await request<string>("/server/channelTags", {
    headers: { Accept: "application/xml" },
    rawText: true,
  });
  if (!xml) return [];
  return parseChannelTagsFromXml(xml);
}

/**
 * GET /channels/{channelId}/metaDataColumns
 * Returns the custom metadata columns configured for a specific channel.
 * Mirrors Java's mirthClient.getMetaDataColumns(channelId).
 * The server returns List<MetaDataColumn> — each has name, type, and mappingName.
 */
export async function getMetaDataColumns(
  channelId: string
): Promise<import("../types").MetaDataColumn[]> {
  const raw = await request<import("../types").MetaDataColumn[]>(
    `/channels/${channelId}/metaDataColumns`
  );
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/** One connector entry from GET /channels/{id}/connectorNames (metaDataId → display name). */
export interface ConnectorName {
  metaDataId: number;
  name: string;
}

/**
 * Parse the raw (un-normalized) XStream JSON for a `Map<Integer, String>` connector-name map.
 *
 * Wire shape:
 *   {"linked-hash-map":{"entry":[{"int":0,"string":"Source"},{"int":2,"string":"Destination 1"}]}}
 *
 * This deliberately does NOT go through `normalizeXStream`: that helper's "string always wins as
 * the map key" rule would invert each `{int, string}` entry to `{name: metaDataId}` — exactly
 * backwards for a Map<Integer,String>. Staxon collapses a single entry to an object (not an array),
 * so both shapes are handled. Returned sorted ascending by metaDataId (source 0 first).
 */
export function parseConnectorNamesMap(raw: unknown): ConnectorName[] {
  const inner = (raw as { "linked-hash-map"?: { entry?: unknown } } | null)?.["linked-hash-map"];
  const rawEntries = inner?.entry;
  if (rawEntries == null) return [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
  const result: ConnectorName[] = [];
  for (const entry of entries) {
    if (entry == null || typeof entry !== "object") continue;
    const e = entry as { int?: unknown; string?: unknown };
    if (e.int == null) continue;
    result.push({ metaDataId: Number(e.int), name: String(e.string ?? "") });
  }
  return result.sort((a, b) => a.metaDataId - b.metaDataId);
}

/**
 * GET /channels/{channelId}/connectorNames
 * Returns the channel's authoritative connector roster (metaDataId → name; source is 0, positive
 * ids are destinations). Mirrors Java's mirthClient.getConnectorNames(channelId) — audited op
 * `getConnectorNames`, permission MESSAGES_VIEW — used by the Message Browser advanced filter so the
 * connector checkboxes reflect the whole channel, not just connectors present on the current page.
 */
export async function getConnectorNames(channelId: string): Promise<ConnectorName[]> {
  const raw = await request<unknown>(`/channels/${channelId}/connectorNames`, {
    skipNormalize: true,
  });
  return parseConnectorNamesMap(raw);
}
