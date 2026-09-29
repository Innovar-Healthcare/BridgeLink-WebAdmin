/**
 * XML parser for a single message returned by
 * GET /channels/{channelId}/messages/{messageId} (Accept: application/xml).
 *
 * The message is fetched as XML (not JSON) on purpose: the server serializes
 * XStream→JSON through Staxon with autoPrimitive enabled, which coerces any
 * numeric-looking `<content>` text (e.g. "10e33", "37.0", a leading-zero id
 * "007") into a JSON number — irreversibly rewriting it and, for long digit
 * strings, losing precision — before it ever reaches the client. This is the
 * same gotcha already fixed for channel tags and the
 * configuration map; here it is fixed for message content.
 * XML carries the literal text content intact, so parsing it preserves each
 * content field's exact bytes — matching what the Java Swing client consumes
 * (its SDK deserializes this same XStream XML into Message objects).
 *
 * The output is the post-normalization `Message` shape the Message Browser
 * expects: `connectorMessages` keyed by metaDataId (string), each content field
 * as `{ content, dataType, encrypted, contentType }`, map fields
 * (source/connector/channel/response) as plain objects, and error fields as
 * strings. Map subtrees reuse the shared `normalizeXStream` so map/entry
 * flattening stays on one code path (identical Mappings-tab output).
 */

import type { Message, ConnectorMessage, MessageContent } from "../types";
import { normalizeXStream, type XStreamRaw } from "./api-core";

// ─── DOM helpers (dot-safe: tag names like java.util.Collections$UnmodifiableMap
// and com.mirth.connect.* break CSS selectors, so we iterate children directly) ──

/** Direct child element with the given tag name, or undefined. */
function childEl(el: Element, tag: string): Element | undefined {
  for (const c of Array.from(el.children)) {
    if (c.tagName === tag) return c;
  }
  return undefined;
}

/** Literal text of a direct child element (XML entities auto-unescaped by the
 *  DOM), or undefined when the child is absent. Never trimmed. */
function childText(el: Element, tag: string): string | undefined {
  const c = childEl(el, tag);
  return c ? (c.textContent ?? "") : undefined;
}

/** Parse a numeric child; undefined when absent or non-numeric. */
function childNum(el: Element, tag: string): number | undefined {
  const t = childText(el, tag);
  if (t == null || t === "") return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

/** Parse an XStream Calendar `<x><time/><timezone/></x>` child. */
function childDate(el: Element, tag: string): { time: number; timezone: string } | undefined {
  const c = childEl(el, tag);
  if (!c) return undefined;
  const time = childNum(c, "time");
  if (time == null) return undefined;
  return { time, timezone: childText(c, "timezone") ?? "" };
}

// ─── Map-content handling ──────────────────────────────────────────────────────

/**
 * Convert an element subtree to the Staxon-style JS object `normalizeXStream`
 * expects: child elements become keys, repeated tags become arrays, the `class`
 * attribute becomes `@class`, and leaf text stays a literal string (NO
 * autoPrimitive — that is exactly the mangling we avoid). Fed only to
 * `normalizeXStream` for map subtrees, where values render via `formatMapValue`
 * (which `String()`s leaves), so string-vs-number leaves are display-identical.
 */
function domToXStreamJs(el: Element): unknown {
  const children = Array.from(el.children);
  if (children.length === 0) {
    // XStream serializes a null map value as <null/>; mirror Staxon's "null": null
    // so normalizeXStream + formatMapValue render it as "null" (Java parity), not "".
    if (el.tagName === "null") return null;
    // Other leaf elements — literal text (empty string for <x></x>).
    return el.textContent ?? "";
  }
  const obj: Record<string, unknown> = {};
  const cls = el.getAttribute("class");
  if (cls) obj["@class"] = cls;
  for (const child of children) {
    const key = child.tagName;
    const val = domToXStreamJs(child);
    if (key in obj) {
      const existing = obj[key];
      if (Array.isArray(existing)) (existing as unknown[]).push(val);
      else obj[key] = [existing, val];
    } else {
      obj[key] = val;
    }
  }
  return obj;
}

/**
 * Parse a `<*MapContent>` wrapper (`<encrypted/>` + `<content class="…">…`) into
 * a plain object. Empty/self-closing map content yields `{}`.
 */
function parseMapContent(wrapper: Element): Record<string, unknown> {
  const content = childEl(wrapper, "content");
  if (!content || content.children.length === 0) return {};
  const normalized = normalizeXStream(domToXStreamJs(content) as XStreamRaw);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? (normalized as Record<string, unknown>)
    : {};
}

// ─── Content / connector-message parsing ───────────────────────────────────────

/** Parse a `<raw>|<encoded>|…` MessageContent element (content read literally). */
function parseContent(el: Element): MessageContent {
  return {
    content: childText(el, "content") ?? "",
    dataType: childText(el, "dataType") ?? "",
    encrypted: childText(el, "encrypted") === "true",
    contentType: childText(el, "contentType"),
  };
}

/** MessageContent field name → ConnectorMessage key. */
const CONTENT_FIELDS = [
  "raw",
  "processedRaw",
  "transformed",
  "encoded",
  "sent",
  "response",
  "responseTransformed",
  "processedResponse",
] as const;

/** Map wrapper element name → ConnectorMessage key (mirrors the removed JSON-path normalizeConnectorMessage). */
const MAP_FIELDS = [
  { xml: "sourceMapContent", ts: "sourceMap" },
  { xml: "connectorMapContent", ts: "connectorMap" },
  { xml: "channelMapContent", ts: "channelMap" },
  { xml: "responseMapContent", ts: "responseMap" },
] as const;

/** Error wrapper element name → ConnectorMessage key (mirrors the removed JSON-path normalizeConnectorMessage). */
const ERROR_FIELDS = [
  { xml: "processingErrorContent", ts: "processingError" },
  { xml: "postProcessorErrorContent", ts: "postProcessorError" },
  { xml: "responseErrorContent", ts: "responseError" },
] as const;

function parseConnectorMessage(el: Element): ConnectorMessage {
  // Bag view for assigning the string-keyed map/error fields below.
  const bag = (cmObj: ConnectorMessage) => cmObj as unknown as Record<string, unknown>;

  const cm: ConnectorMessage = {
    messageId: childNum(el, "messageId") ?? 0,
    channelId: childText(el, "channelId") ?? "",
    metaDataId: childNum(el, "metaDataId") ?? 0,
    channelName: childText(el, "channelName") ?? "",
    connectorName: childText(el, "connectorName") ?? "",
    // Dates keep the XStream Calendar shape the JSON path also emitted; the
    // viewer's content tabs don't read them, the table uses search results.
    receivedDate: childDate(el, "receivedDate") as unknown as string,
    status: (childText(el, "status") ?? "") as ConnectorMessage["status"],
    sendAttempts: childNum(el, "sendAttempts") ?? 0,
  };

  const serverId = childText(el, "serverId");
  if (serverId != null) cm.serverId = serverId;
  const errorCode = childNum(el, "errorCode");
  if (errorCode != null) cm.errorCode = errorCode;
  const sendDate = childDate(el, "sendDate");
  if (sendDate) cm.sendDate = sendDate as unknown as string;
  const responseDate = childDate(el, "responseDate");
  if (responseDate) cm.responseDate = responseDate as unknown as string;

  // Content types (present only when the connector produced them).
  for (const field of CONTENT_FIELDS) {
    const contentEl = childEl(el, field);
    if (contentEl) cm[field] = parseContent(contentEl);
  }

  // Map fields → plain objects via the shared normalizer.
  for (const { xml, ts } of MAP_FIELDS) {
    const wrapper = childEl(el, xml);
    if (wrapper) {
      bag(cm)[ts] = parseMapContent(wrapper);
    }
  }

  // Custom metadata columns (Map<String, Object>).
  const metaDataMap = childEl(el, "metaDataMap");
  if (metaDataMap && metaDataMap.children.length > 0) {
    const normalized = normalizeXStream(domToXStreamJs(metaDataMap) as XStreamRaw);
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
      cm.metaDataMap = normalized as Record<string, unknown>;
    }
  }

  // Error fields → inner <content> text (only when that error exists).
  for (const { xml, ts } of ERROR_FIELDS) {
    const wrapper = childEl(el, xml);
    const text = wrapper ? childText(wrapper, "content") : undefined;
    if (text != null) bag(cm)[ts] = text;
  }

  return cm;
}

/**
 * Parse a `<message>` XStream XML document into the normalized `Message` shape
 * the Message Browser consumes. Throws on malformed XML or an unexpected root.
 */
export function parseMessageXml(xml: string): Message {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "parse error"}`);
  }

  const root = doc.documentElement;
  if (root.tagName !== "message") {
    throw new Error(`Unexpected root element <${root.tagName}>. Expected <message>.`);
  }

  const connectorMessages: Record<string, ConnectorMessage> = {};
  const cmsEl = childEl(root, "connectorMessages");
  if (cmsEl) {
    for (const entry of Array.from(cmsEl.children)) {
      if (entry.tagName !== "entry") continue;
      const cmEl = childEl(entry, "connectorMessage");
      if (!cmEl) continue;
      const cm = parseConnectorMessage(cmEl);
      connectorMessages[String(cm.metaDataId)] = cm;
    }
  }

  const msg: Message = {
    messageId: childNum(root, "messageId") ?? 0,
    channelId: childText(root, "channelId") ?? "",
    receivedDate: childDate(root, "receivedDate") as unknown as string,
    processed: childText(root, "processed") === "true",
    connectorMessages,
  };

  const serverId = childText(root, "serverId");
  if (serverId != null) msg.serverId = serverId;
  const originalId = childNum(root, "originalId");
  if (originalId != null) msg.originalId = originalId;
  const importId = childNum(root, "importId");
  if (importId != null) msg.importId = importId;
  const importChannelId = childText(root, "importChannelId");
  if (importChannelId != null) msg.importChannelId = importChannelId;

  return msg;
}
