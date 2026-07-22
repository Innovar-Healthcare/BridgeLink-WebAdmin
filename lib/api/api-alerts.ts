/**
 * API alerts — alert CRUD, enable/disable, status.
 */

import type { AlertInfo, AlertStatus } from "../types";
import { request } from "./api-core";

/**
 * GET /alerts/statuses
 * Mirrors Java's mirthClient.getAlertStatusList() → AlertPanel.updateAlertTable().
 * Returns AlertStatus[] with id, name, enabled, alertedCount (only when enabled).
 */
export async function getAlertStatuses(): Promise<AlertStatus[]> {
  return request<AlertStatus[]>("/alerts/statuses");
}

/**
 * POST /alerts/_getInfo (no alertId)
 * Returns protocol options + changed channels for a NEW alert dialog.
 * model will be null (no existing alert).
 * Mirrors Java's mirthClient.getAlertInfo(null).
 * Body: XStream empty Map<String, ChannelHeader> — must use {"map":{}} envelope (same pattern
 * as getChannelSummary). Sending "{}" or "" causes a 500; XStream requires the "map" key.
 * Response wrapped as {"alertInfo": {...}} — unwrapped by normalizeXStream via XSTREAM_ALIASES.
 */
export async function getAlertInfo(): Promise<AlertInfo> {
  return request<AlertInfo>("/alerts/_getInfo", {
    method: "POST",
    body: JSON.stringify({ map: {} }),
  });
}

/**
 * POST /alerts/{alertId}/_getInfo
 * Returns the full AlertModel + protocol options for an EXISTING alert (edit dialog).
 * Mirrors Java's mirthClient.getAlertInfo(alertId).
 * Body: XStream empty Map<String, ChannelHeader> → {"map":{}} (same as getAlertInfo above).
 * Response wrapped as {"alertInfo": {...}} — unwrapped by normalizeXStream via XSTREAM_ALIASES.
 */
export async function getAlertInfoById(alertId: string): Promise<AlertInfo> {
  return request<AlertInfo>(`/alerts/${alertId}/_getInfo`, {
    method: "POST",
    body: JSON.stringify({ map: {} }),
  });
}

/**
 * PUT /alerts/{alertId}
 * Creates or updates an alert. Body must be a pre-serialized XStream JSON string
 * ({"alertModel": {...}}) — the server requires XStream-specific collection wrappers
 * ({"set": {...}}, {"alertActionGroup": {...}}, etc.) that plain JSON.stringify cannot produce.
 * Mirrors Java's mirthClient.updateAlert(alertModel), which the Java client uses for both new
 * and existing alerts (the server's createAlert/updateAlert run the identical controller method).
 */
export async function updateAlert(alertId: string, xstreamBody: string): Promise<void> {
  return request<void>(`/alerts/${alertId}`, {
    method: "PUT",
    body: xstreamBody,
  });
}

/**
 * DELETE /alerts/{alertId}
 * Removes an alert. Mirrors Java's mirthClient.removeAlert(alertId).
 */
export async function deleteAlert(alertId: string): Promise<void> {
  return request<void>(`/alerts/${alertId}`, { method: "DELETE" });
}

/**
 * POST /alerts/{alertId}/_enable
 * Enables an alert. Mirrors Java's mirthClient.enableAlert(alertId).
 */
export async function enableAlert(alertId: string): Promise<void> {
  return request<void>(`/alerts/${alertId}/_enable`, { method: "POST" });
}

/**
 * POST /alerts/{alertId}/_disable
 * Disables an alert. Mirrors Java's mirthClient.disableAlert(alertId).
 */
export async function disableAlert(alertId: string): Promise<void> {
  return request<void>(`/alerts/${alertId}/_disable`, { method: "POST" });
}

/**
 * GET /alerts/{alertId} as XML — for export.
 * Mirrors Java's mirthClient.getAlert(alertId) + ObjectXMLSerializer.serialize(alert).
 * Uses Accept: application/xml so the server returns the XStream XML directly.
 */
export async function getAlertXml(alertId: string): Promise<string> {
  return request<string>(`/alerts/${alertId}`, {
    rawText: true,
    headers: { Accept: "application/xml" },
  });
}

/**
 * GET /alerts/ as XML — for "Export All".
 * Op getAlerts; returns a single XStream `<list>` of `<alertModel>` elements. Mirrors Java's
 * mirthClient.getAlerts() (one call) rather than fetching each alert individually.
 * Uses Accept: application/xml so the server returns the XStream XML directly.
 */
export async function getAllAlertsXml(): Promise<string> {
  return request<string>("/alerts/", {
    rawText: true,
    headers: { Accept: "application/xml" },
  });
}

/**
 * PUT /alerts/{alertId} with raw XML body — for import (create or overwrite).
 * Mirrors Java's mirthClient.updateAlert(alertModel) using XML serialization.
 */
export async function updateAlertFromXml(alertId: string, xml: string): Promise<void> {
  return request<void>(`/alerts/${alertId}`, {
    method: "PUT",
    body: xml,
    headers: { "Content-Type": "application/xml", Accept: "application/xml" },
  });
}
