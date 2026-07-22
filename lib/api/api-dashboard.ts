/**
 * API dashboard — dashboard statuses, server logs, connection logs,
 * global maps, channel/connector time-series statistics.
 */

import type {
  DashboardStatus,
  DashboardChannelInfo,
  ServerLogItem,
  ConnectionLogItem,
  MessageStatisticsTimeseries,
} from "../types";
import { request, type XStreamObject, type XStreamValue } from "./api-core";

/**
 * Number of statuses fetched per request, matching the Java client's
 * Frame.REFRESH_BLOCK_SIZE (100). The server's getChannelStatusList GET form is
 * only valid when the ID count does not exceed Client.MAX_QUERY_PARAM_COLLECTION_SIZE
 * (also 100), so keeping blocks at this size means the GET form is always valid
 * and the POST variant (POST /channels/statuses/_getChannelStatusList) is not
 * needed on this path.
 */
const REFRESH_BLOCK_SIZE = 100;

// ─── Connector state types ────────────────────────────────────────────────────

/**
 * XStream serialises java.awt.Color with the alias "awt-color" as RGBA components.
 * Known RGB → display colour mappings:
 *   {r:0,   g:255, b:0  } → green  (active: READING, WRITING, RECEIVING, SENDING, POLLING, CONNECTED)
 *   {r:255, g:255, b:0  } → yellow (transitional: IDLE, CONNECTING, WAITING_FOR_RESPONSE)
 *   {r:255, g:0,   b:0  } → red    (DISCONNECTED)
 *   {r:0,   g:0,   b:255} → blue   (INFO)
 *   otherwise              → gray   (other / unknown)
 */
export interface JavaColor {
  red: number;
  green: number;
  blue: number;
  alpha?: number;
}

/**
 * Map keyed by "{channelId}_{metaDataId}" → [JavaColor, stateLabel].
 * metaDataId 0 = source connector; ≥1 = destination connector id.
 * State label may contain HTML (e.g. "<font color='red'>(n)</font>") — strip before display.
 */
export type ConnectorStateMap = Record<string, [JavaColor, string]>;

/**
 * Mirrors the Java client's Frame.doRefreshStatuses() two-stage fetch exactly:
 *   1. GET /channels/statuses/initial?fetchSize=100  → first batch of statuses,
 *      the IDs of the remaining channels, and the deployed channel count
 *      (audit op: getChannelStatusListInitial).
 *   2. GET /channels/statuses?channelId=…            → remaining channels paged
 *      in blocks of REFRESH_BLOCK_SIZE (audit op: getChannelStatusList).
 *
 * This avoids over-fetching every deployed channel in a single response on large
 * deployments and emits the same audit operations the Java client does. All three
 * endpoints share the DASHBOARD_VIEW permission, so there is no authorization
 * difference versus the previous single-call form.
 */
export async function getDashboardStatuses(): Promise<DashboardStatus[]> {
  const info = await request<DashboardChannelInfo>(
    `/channels/statuses/initial?fetchSize=${REFRESH_BLOCK_SIZE}`
  );

  const statuses: DashboardStatus[] = Array.isArray(info?.dashboardStatuses)
    ? info.dashboardStatuses
    : [];
  const remaining = Array.isArray(info?.remainingChannelIds)
    ? info.remainingChannelIds.map(String)
    : [];

  for (let i = 0; i < remaining.length; i += REFRESH_BLOCK_SIZE) {
    const block = remaining.slice(i, i + REFRESH_BLOCK_SIZE);
    const qs = block.map((id) => `channelId=${encodeURIComponent(id)}`).join("&");
    const more = await request<DashboardStatus[]>(`/channels/statuses?${qs}`);
    if (Array.isArray(more)) statuses.push(...more);
  }

  return statuses;
}

/**
 * GET /extensions/dashboardstatus/connectorStates
 *
 * Returns the live connection-state for every deployed connector.
 * Key format: "{channelId}_{metaDataId}" (metaDataId 0 = source, ≥1 = destination).
 * Value: [JavaColor, stateLabel] where stateLabel may contain HTML tags.
 *
 * Non-fatal: returns {} if the DashboardStatus extension is not installed / no permission.
 *
 * Raw XStream format (skipNormalize):
 *   {"map": {"entry": [{"string": "<id>_<mid>", "object-array": {"awt-color": {red,green,blue,alpha}, "string": "<label>"}}, ...]}}
 * Single-entry maps: entry is an object (not array) — handled via Array.isArray check.
 */
export async function getConnectorStates(serverId?: string): Promise<ConnectorStateMap> {
  const qs = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  try {
    const data = await request<XStreamObject>(`/extensions/dashboardstatus/connectorStates${qs}`, {
      skipNormalize: true,
    });
    if (!data || typeof data !== "object") return {};
    // Navigate: data.map.entry (single object or array of objects)
    const rawEntries = (data.map as XStreamObject | undefined)?.entry;
    if (rawEntries == null) return {};
    const entries = (Array.isArray(rawEntries) ? rawEntries : [rawEntries]) as XStreamObject[];
    const result: ConnectorStateMap = {};

    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const stateKey = typeof e.string === "string" ? e.string : "";
      if (!stateKey) continue;
      const oa = e["object-array"] as XStreamObject;
      if (!oa || typeof oa !== "object") continue;
      const colorRaw = oa["awt-color"];
      const label = typeof oa.string === "string" ? oa.string : "";
      if (colorRaw && typeof colorRaw === "object" && !Array.isArray(colorRaw)) {
        const cr = colorRaw as XStreamObject;
        const color: JavaColor = {
          red: Number(cr.red ?? 0),
          green: Number(cr.green ?? 0),
          blue: Number(cr.blue ?? 0),
          alpha: Number(cr.alpha ?? 255),
        };
        result[stateKey] = [color, label];
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * GET /extensions/serverlog/?fetchSize=N&lastLogId=N&channelId=ID
 *
 * Fetches server log entries incrementally. Pass `lastLogId` to receive only
 * entries newer than that ID (the server keeps the last 100 entries max).
 *
 * Pass `channelIds` to narrow the log to those channels' rows plus system rows
 * (matching core PR #160's repeatable `channelId` query param — one entry per
 * selected channel, or every member channel of a selected group). Empty/omitted
 * → unified view. Against a server that does not implement the channel-aware
 * endpoint the params are simply ignored, so it is safe to always send them.
 */
export async function getServerLogs(
  fetchSize: number,
  lastLogId?: number,
  channelIds?: string[],
  signal?: AbortSignal
): Promise<ServerLogItem[]> {
  const params = new URLSearchParams({ fetchSize: String(fetchSize) });
  if (lastLogId !== undefined) params.set("lastLogId", String(lastLogId));
  for (const id of channelIds ?? []) params.append("channelId", id);
  const data = await request<XStreamObject>(`/extensions/serverlog/?${params}`, {
    skipNormalize: true,
    signal,
  });
  // Response: {"list": {"com.mirth.connect.plugins.serverlog.ServerLogItem": item | item[]}}
  const wrapper = data?.list as XStreamObject | undefined;
  const raw =
    wrapper?.[
      Object.keys(wrapper ?? {}).find(
        (k) => k.includes("ServerLogItem") || k === "serverLogItem"
      ) ?? ""
    ] ?? null;
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => {
    const it = item as XStreamObject;
    return {
      id: Number(it.id ?? 0),
      level: String(it.level ?? "").toUpperCase(),
      date: String(it.date ?? ""),
      category: String(it.category ?? ""),
      lineNumber: String(it.lineNumber ?? ""),
      message: String(it.message ?? ""),
      throwableInformation:
        it.throwableInformation != null ? String(it.throwableInformation) : null,
    };
  });
}

/**
 * GET /extensions/dashboardstatus/connectionLogs?fetchSize=N&lastLogId=N
 *
 * Fetches connection log entries for all channels incrementally.
 */
export async function getConnectionLogs(
  fetchSize: number,
  lastLogId?: number,
  channelId?: string,
  signal?: AbortSignal
): Promise<ConnectionLogItem[]> {
  const params = new URLSearchParams({ fetchSize: String(fetchSize) });
  if (lastLogId !== undefined) params.set("lastLogId", String(lastLogId));
  const path = channelId
    ? `/extensions/dashboardstatus/connectionLogs/${encodeURIComponent(channelId)}?${params}`
    : `/extensions/dashboardstatus/connectionLogs?${params}`;
  const data = await request<XStreamObject>(path, { skipNormalize: true, signal });
  // Response: {"linked-list": {"com.mirth.connect.plugins.dashboardstatus.ConnectionLogItem": item | item[]}}
  const outerKey = Object.keys(data ?? {}).find((k) => k === "linked-list" || k === "list") ?? "";
  const wrapper = data?.[outerKey] as XStreamObject | undefined;
  const innerKey =
    Object.keys(wrapper ?? {}).find(
      (k) => k.includes("ConnectionLogItem") || k === "connectionLogItem"
    ) ?? "";
  const raw = wrapper?.[innerKey] ?? null;
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => {
    const it = item as XStreamObject;
    return {
      logId: Number(it.logId ?? it.id ?? 0),
      channelId: String(it.channelId ?? ""),
      channelName: String(it.channelName ?? ""),
      connectorType: String(it.connectorType ?? ""),
      eventState: String(it.eventState ?? ""),
      information: it.information != null ? String(it.information) : "",
      dateAdded: String(it.dateAdded ?? ""),
    };
  });
}

/**
 * POST /extensions/globalmapviewer/maps/_getAllMaps?includeGlobalMap=true
 *
 * Returns global and per-channel map key/value pairs.
 * Response shape: Map<serverId, Map<channelId | "null", Map<key, value>>>
 * A null channelId in the response represents the server-wide global map.
 */
export async function getGlobalMaps(
  channelIds: string[],
  includeGlobalMap = true,
  signal?: AbortSignal
): Promise<Record<string, Record<string, Record<string, string>>>> {
  const params = new URLSearchParams({ includeGlobalMap: String(includeGlobalMap) });
  // The endpoint requires application/xml with an XStream <set> body.
  // JSON bodies result in 500. Empty <set/> returns global map only.
  const xmlBody =
    channelIds.length > 0
      ? `<set>${channelIds.map((id) => `<string>${id}</string>`).join("")}</set>`
      : "<set/>";
  const data = await request<XStreamObject>(
    `/extensions/globalmapviewer/maps/_getAllMaps?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlBody,
      skipNormalize: true,
      signal,
    }
  );

  // Response: {"map": {"entry": single-entry-or-array}}
  // Each entry: {"string": serverId, "map": {"entry": single-or-array}}
  //   Inner entry: {"string": channelId, "map": {"entry": {"string": [key, value]}}}
  //                {"null": null, "map": ...}  ← global map (null channel)
  const result: Record<string, Record<string, Record<string, string>>> = {};

  function toArray(v: XStreamValue | undefined): XStreamValue[] {
    return v == null ? [] : Array.isArray(v) ? v : [v];
  }

  const outerEntries = toArray((data?.map as XStreamObject | undefined)?.entry) as XStreamObject[];
  for (const outerEntry of outerEntries) {
    const serverId = String(outerEntry?.string ?? "unknown");
    result[serverId] = {};

    const innerEntries = toArray(
      (outerEntry?.map as XStreamObject | undefined)?.entry
    ) as XStreamObject[];
    for (const innerEntry of innerEntries) {
      // Null-keyed entries (global map) have a "null" property but no "string" property
      const actualKey =
        Object.prototype.hasOwnProperty.call(innerEntry, "null") &&
        !Object.prototype.hasOwnProperty.call(innerEntry, "string")
          ? "<Global Map>"
          : String(innerEntry?.string ?? "<Global Map>");
      result[serverId][actualKey] = {};

      const kvEntries = toArray(
        (innerEntry?.map as XStreamObject | undefined)?.entry
      ) as XStreamObject[];
      for (const kv of kvEntries) {
        const pair = toArray(kv?.string);
        if (pair.length >= 2) {
          result[serverId][actualKey][String(pair[0])] = String(pair[1]);
        } else if (pair.length === 1) {
          // Some entries serialize as {string: key} with a separate value
          result[serverId][actualKey][String(pair[0])] = String(
            kv?.value ?? kv?.int ?? kv?.double ?? ""
          );
        }
      }
    }
  }

  return result;
}

/**
 * GET /statistics/timeseries/channels/{channelId}
 *
 * Fetches time-series statistics for a single channel.
 * `startTime` and `endTime` are epoch seconds (UTC).
 * `interval` is one of: "1minute" | "5minute" | "15minute" | "60minute" | "daily"
 */
export async function getChannelTimeseries(
  channelId: string,
  startTime: number,
  endTime: number,
  interval: string,
  signal?: AbortSignal
): Promise<MessageStatisticsTimeseries[]> {
  const params = new URLSearchParams({
    startTime: String(Math.round(startTime)),
    endTime: String(Math.round(endTime)),
    interval,
  });
  const data = await request<XStreamObject | XStreamObject[]>(
    `/statistics/timeseries/channels/${encodeURIComponent(channelId)}?${params}`,
    { signal }
  );
  if (!data) return [];
  const items = (Array.isArray(data) ? data : [data]) as XStreamObject[];
  return items.map((it) => ({
    id: Number(it.id ?? 0),
    channelId: String(it.channelId ?? ""),
    connectorId: it.connectorId != null ? String(it.connectorId) : null,
    serverId: String(it.serverId ?? ""),
    ts: String(it.ts ?? ""),
    bucketSizeMinutes: Number(it.bucketSizeMinutes ?? 0),
    received: Number(it.received ?? 0),
    filtered: Number(it.filtered ?? 0),
    queued: Number(it.queued ?? 0),
    sent: Number(it.sent ?? 0),
    error: Number(it.error ?? 0),
  }));
}

/**
 * GET /statistics/timeseries/channels/{channelId}/connectors/{connectorId}
 *
 * Fetches time-series statistics for a specific connector within a channel.
 */
export async function getConnectorTimeseries(
  channelId: string,
  connectorId: string,
  startTime: number,
  endTime: number,
  interval: string,
  signal?: AbortSignal
): Promise<MessageStatisticsTimeseries[]> {
  const params = new URLSearchParams({
    startTime: String(Math.round(startTime)),
    endTime: String(Math.round(endTime)),
    interval,
  });
  const data = await request<XStreamObject | XStreamObject[]>(
    `/statistics/timeseries/channels/${encodeURIComponent(channelId)}/connectors/${encodeURIComponent(connectorId)}?${params}`,
    { signal }
  );
  if (!data) return [];
  const items = (Array.isArray(data) ? data : [data]) as XStreamObject[];
  return items.map((it) => ({
    id: Number(it.id ?? 0),
    channelId: String(it.channelId ?? ""),
    connectorId: it.connectorId != null ? String(it.connectorId) : null,
    serverId: String(it.serverId ?? ""),
    ts: String(it.ts ?? ""),
    bucketSizeMinutes: Number(it.bucketSizeMinutes ?? 0),
    received: Number(it.received ?? 0),
    filtered: Number(it.filtered ?? 0),
    queued: Number(it.queued ?? 0),
    sent: Number(it.sent ?? 0),
    error: Number(it.error ?? 0),
  }));
}

/**
 * GET /statistics/timeseries/server?startTime&endTime&interval
 *
 * Returns one bucket array spanning ALL channels in a single request.
 * Each bucket carries its own `channelId`, allowing the caller to group by
 * channel. This is the bulk alternative to calling `getChannelTimeseries`
 * once per channel.
 */
export async function getServerTimeseries(
  startTime: number,
  endTime: number,
  interval: string,
  signal?: AbortSignal
): Promise<MessageStatisticsTimeseries[]> {
  const params = new URLSearchParams({
    startTime: String(Math.round(startTime)),
    endTime: String(Math.round(endTime)),
    interval,
  });
  const data = await request<XStreamObject | XStreamObject[]>(
    `/statistics/timeseries/server?${params}`,
    { signal }
  );
  if (!data) return [];
  const items = (Array.isArray(data) ? data : [data]) as XStreamObject[];
  return items.map((it) => ({
    id: Number(it.id ?? 0),
    channelId: String(it.channelId ?? ""),
    connectorId: it.connectorId != null ? String(it.connectorId) : null,
    serverId: String(it.serverId ?? ""),
    ts: String(it.ts ?? ""),
    bucketSizeMinutes: Number(it.bucketSizeMinutes ?? 0),
    received: Number(it.received ?? 0),
    filtered: Number(it.filtered ?? 0),
    queued: Number(it.queued ?? 0),
    sent: Number(it.sent ?? 0),
    error: Number(it.error ?? 0),
  }));
}
