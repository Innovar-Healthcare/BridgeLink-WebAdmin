/**
 * API web-service-connector — WSDL operations for the Web Service Sender connector.
 *
 * Mirrors the Java WebServiceConnectorServletInterface:
 *   POST /connectors/ws/_cacheWsdlFromUrl
 *   POST /connectors/ws/_getDefinition
 *   POST /connectors/ws/_isWsdlCached
 *   POST /connectors/ws/_generateEnvelope
 *   POST /connectors/ws/_getSoapAction
 */

import { request, PROXY_BASE, getServerUrl, throwForStatus } from "./api-core";
import { assertNoUnresolvedVersion } from "@/lib/connector-props-guard";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WsPortInformation {
  /** Ordered list of operation names from the WSDL binding. */
  operations: string[];
  /** SOAP Action URIs, parallel-indexed with operations. May be empty strings. */
  actions: string[];
  locationURI: string;
}

/** Nested map: service QName → port QName → port info. */
export type WsdlDefinitionMap = Record<string, Record<string, WsPortInformation>>;

// ─── Normalization helpers ────────────────────────────────────────────────────

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string" && val) return [val];
  return [];
}

/**
 * Normalizes a raw WSDL definition map from the server so every port entry has
 * guaranteed string[] for operations/actions (XStream collapses single-element
 * Java Lists to a bare string, and empty Lists may be absent or null in JSON).
 */
export function normalizeWsdlDefinitionMap(
  raw: Record<string, Record<string, Partial<WsPortInformation>>> | null | undefined
): WsdlDefinitionMap {
  const result: WsdlDefinitionMap = {};
  for (const [svc, portMap] of Object.entries(raw ?? {})) {
    result[svc] = {};
    for (const [port, info] of Object.entries(portMap ?? {})) {
      result[svc][port] = {
        operations: toStringArray(info?.operations),
        actions: toStringArray(info?.actions),
        locationURI: typeof info?.locationURI === "string" ? info.locationURI : "",
      };
    }
  }
  return result;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function toForm(args: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) p.set(k, v ?? "");
  return p.toString();
}

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" } as const;

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * POST /connectors/ws/_cacheWsdlFromUrl
 * Fetches and caches the WSDL on the server. Must be called before getWsdlDefinition.
 * The request body is the full connector properties XML (as stored in the channel).
 */
export async function cacheWsdlFromUrl(
  propertiesXml: string,
  channelId?: string,
  channelName?: string
): Promise<void> {
  const qs = new URLSearchParams();
  if (channelId) qs.set("channelId", channelId);
  if (channelName) qs.set("channelName", channelName);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  // Send-boundary guard: this live call ships the in-memory props XML
  // straight to the server, bypassing serialize()'s {{VERSION}} resolution.
  assertNoUnresolvedVersion(propertiesXml, "connectors/ws/_cacheWsdlFromUrl");

  // request() defaults to JSON Content-Type; we need XML here so use fetch directly.
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/connectors/ws/_cacheWsdlFromUrl${suffix}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/xml",
      Accept: "application/json",
      ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
    },
    body: propertiesXml,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throwForStatus(res.status, text, "Failed to cache WSDL");
  }
}

/**
 * POST /connectors/ws/_getDefinition
 * Returns the cached WSDL definition map (service→port→operations).
 * Call cacheWsdlFromUrl first.
 */
export async function getWsdlDefinition(args: {
  channelId?: string;
  channelName?: string;
  wsdlUrl: string;
  username?: string;
  password?: string;
}): Promise<WsdlDefinitionMap> {
  const raw = await request<Record<string, Record<string, Partial<WsPortInformation>>>>(
    "/connectors/ws/_getDefinition",
    {
      method: "POST",
      headers: FORM_HEADERS,
      body: toForm({
        channelId: args.channelId,
        channelName: args.channelName,
        wsdlUrl: args.wsdlUrl,
        username: args.username,
        password: args.password,
      }),
    }
  );
  return normalizeWsdlDefinitionMap(raw);
}

/**
 * POST /connectors/ws/_isWsdlCached
 * Returns true if the WSDL is still cached on the server.
 * Used before generateEnvelope to guard against server LRU eviction.
 */
export async function isWsdlCached(args: {
  channelId?: string;
  channelName?: string;
  wsdlUrl: string;
  username?: string;
  password?: string;
}): Promise<boolean> {
  const raw = await request<boolean>("/connectors/ws/_isWsdlCached", {
    method: "POST",
    headers: FORM_HEADERS,
    body: toForm({
      channelId: args.channelId,
      channelName: args.channelName,
      wsdlUrl: args.wsdlUrl,
      username: args.username,
      password: args.password,
    }),
  });
  // normalizeXStream unwraps {"boolean": B} to B; raw JSON boolean passes through as-is.
  return raw === true;
}

/**
 * POST /connectors/ws/_generateEnvelope
 * Generates a SOAP envelope template for the given operation.
 * Returns the XML envelope string (text/plain).
 */
export async function generateWsEnvelope(args: {
  channelId?: string;
  channelName?: string;
  wsdlUrl: string;
  username?: string;
  password?: string;
  service: string;
  port: string;
  operation: string;
  buildOptional?: boolean;
}): Promise<string> {
  return request<string>("/connectors/ws/_generateEnvelope", {
    method: "POST",
    headers: { ...FORM_HEADERS, Accept: "*/*" },
    body: toForm({
      channelId: args.channelId,
      channelName: args.channelName,
      wsdlUrl: args.wsdlUrl,
      username: args.username,
      password: args.password,
      service: args.service,
      port: args.port,
      operation: args.operation,
      buildOptional: String(args.buildOptional ?? true),
    }),
    rawText: true,
  });
}

/**
 * POST /connectors/ws/_getSoapAction
 * Returns the SOAP action URI for the given operation (text/plain).
 */
export async function getWsSoapAction(args: {
  channelId?: string;
  channelName?: string;
  wsdlUrl: string;
  username?: string;
  password?: string;
  service: string;
  port: string;
  operation: string;
}): Promise<string> {
  return request<string>("/connectors/ws/_getSoapAction", {
    method: "POST",
    headers: { ...FORM_HEADERS, Accept: "*/*" },
    body: toForm({
      channelId: args.channelId,
      channelName: args.channelName,
      wsdlUrl: args.wsdlUrl,
      username: args.username,
      password: args.password,
      service: args.service,
      port: args.port,
      operation: args.operation,
    }),
    rawText: true,
  });
}
