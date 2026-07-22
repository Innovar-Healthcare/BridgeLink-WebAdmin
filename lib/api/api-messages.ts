/**
 * API messages — message search/CRUD + events.
 */

import type {
  Attachment,
  ContentSearchElement,
  Message,
  MessageImportResult,
  MessageWriterOptions,
  MetaDataSearchElement,
  ServerEvent,
} from "../types";
import {
  normalizeXStream,
  request,
  PROXY_BASE,
  getServerUrl,
  escXml,
  extractApiErrorMessage,
} from "./api-core";
import { startOfDay, endOfDay } from "date-fns";

// ─── Messages ────────────────────────────────────────────────────────────────

/**
 * MessageFilter — mirrors Java's com.mirth.connect.model.filters.MessageFilter.
 *
 * Used as the JSON body for POST /{channelId}/messages/_search and
 * POST /{channelId}/messages/count/_search.
 *
 * Dates are sent as XStream Calendar format: { time: epochMs, timezone: "..." }
 */
export interface MessageFilter {
  maxMessageId?: number;
  minMessageId?: number;
  originalIdUpper?: number;
  originalIdLower?: number;
  importIdUpper?: number;
  importIdLower?: number;
  startDate?: { time: number; timezone: string };
  endDate?: { time: number; timezone: string };
  textSearch?: string;
  textSearchRegex?: boolean;
  statuses?: string[];
  includedMetaDataIds?: number[];
  excludedMetaDataIds?: number[];
  serverId?: string;
  contentSearch?: ContentSearchElement[];
  metaDataSearch?: MetaDataSearchElement[];
  textSearchMetaDataColumns?: string[];
  sendAttemptsLower?: number;
  sendAttemptsUpper?: number;
  attachment?: boolean;
  error?: boolean;
}

/** Helper to convert a JS Date to XStream Calendar format */
export function toXStreamCalendar(date: Date): { time: number; timezone: string } {
  return { time: date.getTime(), timezone: "UTC" };
}

/**
 * Maximum metadata NUMBER value, mirroring Java
 * `MetaDataColumnType.MAX_NUMBER_VALUE = new BigDecimal(10^16)`.
 */
export const MAX_METADATA_NUMBER = 1e16;

/**
 * Validate + normalize a metadata-search value for its column type, mirroring
 * Java `MetaDataColumnType.castValue` (donkey `MetaDataColumnType.java`):
 *
 * - NUMBER  — must parse as a number and be `< 10^16` (Java rejects `>=`).
 * - STRING  — truncated to 255 characters.
 * - TIMESTAMP — must be a parseable date/time.
 * - BOOLEAN — normalized to `"true"`/`"false"`.
 *
 * Returns the normalized value on success, or a user-facing error on failure
 * (mirrors Java's blocking `alertError` on invalid input).
 */
export function castMetaDataValue(
  value: string,
  columnType?: string
): { ok: true; value: string } | { ok: false; error: string } {
  const str = String(value);
  switch (columnType) {
    case "NUMBER": {
      const trimmed = str.trim();
      const n = Number(trimmed);
      if (trimmed === "" || Number.isNaN(n)) {
        return { ok: false, error: "Value must be a number." };
      }
      if (n >= MAX_METADATA_NUMBER) {
        return {
          ok: false,
          error: "Number is greater than or equal to the maximum allowed value of 10^16.",
        };
      }
      return { ok: true, value: trimmed };
    }
    case "BOOLEAN": {
      const lower = str.trim().toLowerCase();
      if (lower !== "true" && lower !== "false") {
        return { ok: false, error: 'Value must be "true" or "false".' };
      }
      return { ok: true, value: lower };
    }
    case "TIMESTAMP": {
      const d = new Date(str);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: "Value must be a valid date/time." };
      }
      return { ok: true, value: str };
    }
    default: {
      // STRING (and anything unrecognised) — Java truncates to 255 chars.
      return { ok: true, value: str.length > 255 ? str.slice(0, 255) : str };
    }
  }
}

/**
 * Wrap a metadata search value with the XStream class attribute so Staxon
 * produces `<value class="...">text</value>` which XStream can deserialize
 * into an Object field.
 *
 * - STRING  → { "@class": "string",             "$": value }
 * - NUMBER  → { "@class": "java.math.BigDecimal","$": value }
 * - BOOLEAN → { "@class": "boolean",             "$": value }
 * - TIMESTAMP → { "@class": "calendar", "time": epochMs, "timezone": "UTC" }
 *
 * The `$` key is Staxon's convention for the text content of an element that
 * also has XML attributes (the `@class` produces a `class="..."` attribute).
 */
function serializeMetaDataValue(value: unknown, columnType?: string): Record<string, unknown> {
  const str = String(value);
  switch (columnType) {
    case "NUMBER":
      return { "@class": "java.math.BigDecimal", $: str };
    case "BOOLEAN":
      return { "@class": "boolean", $: str.toLowerCase() };
    case "TIMESTAMP": {
      const d = new Date(str);
      return { "@class": "calendar", time: d.getTime(), timezone: "UTC" };
    }
    default: // STRING (and anything unrecognised)
      return { "@class": "string", $: str };
  }
}

/**
 * Build the XStream-compatible JSON body for a MessageFilter.
 * XStream wraps collections/sets with FQN class names for correct deserialization.
 */
function buildMessageFilterBody(filter: MessageFilter): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (filter.maxMessageId != null) body.maxMessageId = filter.maxMessageId;
  if (filter.minMessageId != null) body.minMessageId = filter.minMessageId;
  if (filter.originalIdUpper != null) body.originalIdUpper = filter.originalIdUpper;
  if (filter.originalIdLower != null) body.originalIdLower = filter.originalIdLower;
  if (filter.importIdUpper != null) body.importIdUpper = filter.importIdUpper;
  if (filter.importIdLower != null) body.importIdLower = filter.importIdLower;
  if (filter.startDate) body.startDate = filter.startDate;
  if (filter.endDate) body.endDate = filter.endDate;
  if (filter.textSearch) body.textSearch = filter.textSearch;
  if (filter.textSearchRegex) body.textSearchRegex = filter.textSearchRegex;
  if (filter.statuses?.length) {
    // XStream Set<Status>: {"com.mirth.connect.donkey.model.message.Status": ...}
    body.statuses = {
      "com.mirth.connect.donkey.model.message.Status":
        filter.statuses.length === 1 ? filter.statuses[0] : filter.statuses,
    };
  }
  if (filter.includedMetaDataIds?.length) {
    body.includedMetaDataIds = {
      int:
        filter.includedMetaDataIds.length === 1
          ? filter.includedMetaDataIds[0]
          : filter.includedMetaDataIds,
    };
  }
  if (filter.excludedMetaDataIds?.length) {
    body.excludedMetaDataIds = {
      int:
        filter.excludedMetaDataIds.length === 1
          ? filter.excludedMetaDataIds[0]
          : filter.excludedMetaDataIds,
    };
  }
  if (filter.serverId) body.serverId = filter.serverId;
  if (filter.contentSearch?.length) {
    body.contentSearch = {
      "com.mirth.connect.model.filters.elements.ContentSearchElement":
        filter.contentSearch.length === 1
          ? {
              contentCode: filter.contentSearch[0].contentCode,
              searches: {
                string:
                  filter.contentSearch[0].searches.length === 1
                    ? filter.contentSearch[0].searches[0]
                    : filter.contentSearch[0].searches,
              },
            }
          : filter.contentSearch.map((cs) => ({
              contentCode: cs.contentCode,
              searches: { string: cs.searches.length === 1 ? cs.searches[0] : cs.searches },
            })),
    };
  }
  if (filter.metaDataSearch?.length) {
    const serialized = filter.metaDataSearch.map((el) => ({
      columnName: el.columnName,
      operator: el.operator,
      value: serializeMetaDataValue(el.value, el.columnType),
      ignoreCase: el.ignoreCase,
    }));
    body.metaDataSearch = {
      metaDataSearchCriteria: serialized.length === 1 ? serialized[0] : serialized,
    };
  }
  if (filter.textSearchMetaDataColumns?.length) {
    body.textSearchMetaDataColumns = {
      string:
        filter.textSearchMetaDataColumns.length === 1
          ? filter.textSearchMetaDataColumns[0]
          : filter.textSearchMetaDataColumns,
    };
  }
  if (filter.sendAttemptsLower != null) body.sendAttemptsLower = filter.sendAttemptsLower;
  if (filter.sendAttemptsUpper != null) body.sendAttemptsUpper = filter.sendAttemptsUpper;
  if (filter.attachment) body.attachment = filter.attachment;
  if (filter.error) body.error = filter.error;
  // MessageFilter is @XStreamAlias("messageFilter"), so the root JSON key must be "messageFilter"
  return { messageFilter: body };
}

/**
 * Search messages using POST /_search with a MessageFilter body.
 * This is the full-featured search that supports contentSearch, metaDataSearch, etc.
 */
export async function searchMessages(
  channelId: string,
  filter: MessageFilter,
  options?: { offset?: number; limit?: number; includeContent?: boolean }
): Promise<Message[]> {
  const query = new URLSearchParams();
  if (options?.offset !== undefined) query.set("offset", String(options.offset));
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  if (options?.includeContent) query.set("includeContent", "true");

  return request<Message[]>(`/channels/${channelId}/messages/_search?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify(buildMessageFilterBody(filter)),
  });
}

/**
 * Count messages matching a filter using POST /count/_search.
 * This is the lazy count operation — only called when user clicks "Count" button.
 */
export async function searchMessageCount(
  channelId: string,
  filter: MessageFilter
): Promise<number> {
  return request<number>(`/channels/${channelId}/messages/count/_search`, {
    method: "POST",
    body: JSON.stringify(buildMessageFilterBody(filter)),
  });
}

/** Get the maximum message ID for a channel (used to bound search results). */
export async function getMaxMessageId(channelId: string): Promise<number> {
  return request<number>(`/channels/${channelId}/messages/maxMessageId`);
}

/**
 * Normalize ConnectorMessage map fields.
 * Java field names are `sourceMapContent`, `connectorMapContent`, etc. — each is a
 * MapContent object wrapping a TreeMap<String, Object>.
 *
 * The raw XStream JSON looks like:
 *   sourceMapContent: { content: { "@class": "sorted-map", "entry": [...] }, encrypted: false }
 *
 * After the first normalizeXStream pass the map entries may or may not have been fully
 * flattened, depending on whether the @class="sorted-map" was recognized.
 * This function:
 *   1. Extracts the inner content from the MapContent wrapper
 *   2. Re-runs normalizeXStream on the extracted data to ensure map entries are flattened
 *   3. Renames from Java field name (sourceMapContent) to TS field name (sourceMap)
 */
function normalizeConnectorMessage(cm: Record<string, unknown>): void {
  if (!cm || typeof cm !== "object") return;

  // ── Map content fields (sourceMapContent → sourceMap, etc.) ──
  const MAP_FIELDS = [
    { java: "sourceMapContent", ts: "sourceMap" },
    { java: "connectorMapContent", ts: "connectorMap" },
    { java: "channelMapContent", ts: "channelMap" },
    { java: "responseMapContent", ts: "responseMap" },
  ] as const;
  for (const { java, ts } of MAP_FIELDS) {
    const wrapper = cm[java];
    if (wrapper && typeof wrapper === "object") {
      const wrapperObj = wrapper as Record<string, unknown>;
      // MapContent has a "content" field that holds the actual map.
      // The "content" may be a normalized plain object, or still an XStream map
      // (with entry/@@class) if the first normalize pass didn't fully process it.
      const inner = wrapperObj.content ?? wrapper;
      // If inner still looks like an XStream map structure, re-normalize it
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const innerObj = inner as Record<string, unknown>;
        let normalized: unknown = innerObj;
        if (innerObj["@class"] || innerObj["entry"] != null) {
          normalized = normalizeXStream(innerObj);
        }
        cm[ts] = normalized;
      }
    }
    if (java in cm) delete cm[java];
  }

  // ── Error content fields (processingErrorContent → processingError, etc.) ──
  // Server sends ErrorContent wrappers: { content: "error text", persisted: bool }
  // Extract the inner string so hasErrors() in content-viewer can detect them.
  const ERROR_FIELDS = [
    { java: "processingErrorContent", ts: "processingError" },
    { java: "postProcessorErrorContent", ts: "postProcessorError" },
    { java: "responseErrorContent", ts: "responseError" },
  ] as const;
  for (const { java, ts } of ERROR_FIELDS) {
    const wrapper = cm[java];
    if (wrapper && typeof wrapper === "object") {
      const wrapperObj = wrapper as Record<string, unknown>;
      const text = wrapperObj.content ?? null;
      if (text != null) cm[ts] = text;
    }
    if (java in cm) delete cm[java];
  }
}

export async function getMessage(
  channelId: string,
  messageId: number,
  metaDataIds?: number[]
): Promise<Message> {
  // GET /channels/{channelId}/messages/{messageId} (getMessageContent) always returns full
  // content; its only query param is metaDataId (repeated per connector). When no ids are
  // supplied the server returns all connectors. (The includeContent param belongs to the
  // message-list endpoint GET /channels/{channelId}/messages, not this single-message path.)
  const query =
    metaDataIds && metaDataIds.length > 0
      ? `?${metaDataIds.map((id) => `metaDataId=${id}`).join("&")}`
      : "";
  const raw = await request<unknown>(`/channels/${channelId}/messages/${messageId}${query}`);
  // Unwrap the {"message": {...}} XStream wrapper if present
  let msg: Record<string, unknown>;
  if (
    raw &&
    typeof raw === "object" &&
    "message" in (raw as Record<string, unknown>) &&
    !("messageId" in (raw as Record<string, unknown>))
  ) {
    msg = (raw as Record<string, unknown>).message as Record<string, unknown>;
  } else {
    msg = raw as Record<string, unknown>;
  }
  // Normalize map fields in each connector message
  if (msg?.connectorMessages && typeof msg.connectorMessages === "object") {
    for (const cm of Object.values(msg.connectorMessages as Record<string, unknown>)) {
      normalizeConnectorMessage(cm as Record<string, unknown>);
    }
  }
  return msg as unknown as Message;
}

/**
 * Get a single message as its raw XStream `<message>` XML document.
 *
 * GET /channels/{channelId}/messages/{messageId} (Accept: application/xml)
 *
 * Returns the exact `<message>…</message>` form the `_import` endpoint consumes, so the output
 * round-trips through the Import dialog. Used by "My Computer" XML-serialized export. The server's
 * XStream serializer owns the format — we return the body verbatim (no JSON parse / normalization).
 * Mirrors the Accept: application/xml pattern used to recover literal values for.
 */
export async function getMessageXml(channelId: string, messageId: number): Promise<string> {
  return request<string>(`/channels/${channelId}/messages/${messageId}`, {
    headers: { Accept: "application/xml" },
    rawText: true,
  });
}

/** Get attachments for a message (metadata only by default). */
export async function getMessageAttachments(
  channelId: string,
  messageId: number,
  includeContent = false
): Promise<Attachment[]> {
  const query = `?includeContent=${includeContent}`;
  return request<Attachment[]>(`/channels/${channelId}/messages/${messageId}/attachments${query}`);
}

/**
 * Get a message's attachments as their raw XStream XML list (`<list>…</list>` or `<list/>`).
 *
 * GET /channels/{channelId}/messages/{messageId}/attachments?includeContent=true
 * (Accept: application/xml)
 *
 * The inner `<attachment>` blocks — including the double-base64 `<content>` — are produced by the
 * same XStream serializer that writes them inside `<message>`, so they can be spliced into a
 * `<message>` document verbatim (see `embedAttachmentsXml`). Used by attachment-including local
 * XML-serialized export.
 */
export async function getMessageAttachmentsXml(
  channelId: string,
  messageId: number
): Promise<string> {
  return request<string>(
    `/channels/${channelId}/messages/${messageId}/attachments?includeContent=true`,
    { headers: { Accept: "application/xml" }, rawText: true }
  );
}

/** Get a single attachment with content. */
export async function getAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string
): Promise<Attachment> {
  return request<Attachment>(
    `/channels/${channelId}/messages/${messageId}/attachments/${attachmentId}`
  );
}

/**
 * POST /channels/{channelId}/messages/{messageId}/_getDICOMMessage
 *
 * Returns the fully reassembled DICOM file as a base64-encoded string.
 * Mirrors Java MirthClient.getDICOMMessage() / DICOMMessageUtil.getDICOMRawData().
 *
 * Server-side assembly requires the ConnectorMessage body to include the raw
 * DICOM header bytes (DICOM without pixel data) — the server loads pixel-data
 * attachments from its DB using channelId+messageId, then splices them with
 * the provided header via DICOMConverter to produce a complete Part-10 file.
 *
 * Therefore we first GET the message with content to obtain the raw header,
 * then POST it back as the ConnectorMessage body.
 *
 * @see MessageServletInterface#getDICOMMessage
 * @see DICOMMessageUtil#getDICOMRawData
 */
export async function getDicomMessage(channelId: string, messageId: number): Promise<string> {
  const serverUrl = getServerUrl();
  const blHeader: Record<string, string> = serverUrl ? { "x-bl-server": serverUrl } : {};

  // ── Step 1: GET the message with content to obtain the raw DICOM header ──
  // The source connector (metaDataId=0) stores the DICOM file without pixel
  // data in its "raw" content field (base64-encoded DICOM binary).
  const msg = await getMessage(channelId, messageId);

  // Find raw DICOM content — try source connector (key "0") first, then others
  const connMsgs = msg.connectorMessages ?? {};
  const sortedKeys = Object.keys(connMsgs).sort((a, b) => Number(a) - Number(b));

  let rawB64: string | null = null;
  let rawDataType = "DICOM";
  let metaDataId = 0;

  for (const key of sortedKeys) {
    const cm = connMsgs[key];
    const raw = cm?.raw;
    if (raw && raw.content && (raw.dataType === "DICOM" || Number(key) === 0)) {
      rawB64 = raw.content;
      rawDataType = raw.dataType ?? "DICOM";
      metaDataId = cm.metaDataId ?? Number(key);
      break;
    }
  }

  if (!rawB64) {
    throw new Error("No raw DICOM content found in message — cannot assemble DICOM file");
  }

  // ── Step 2: POST ConnectorMessage XML to _getDICOMMessage ─────────────────
  // The server calls DICOMMessageUtil.getDICOMRawData(message), which:
  //   1. Loads pixel-data attachments from DB using message.channelId + messageId
  //   2. Calls mergeHeaderAttachments(message, attachments) which reads
  //      message.getRaw().getContent() for the DICOM header bytes
  //   3. Merges header + pixel data via DICOMConverter
  //   4. Returns Base64-encoded complete DICOM file as text/plain
  //
  // Field names come from Java class structure (verified from source):
  //   ConnectorMessage: channelId, messageId, metaDataId, raw (MessageContent)
  //   MessageContent:   contentType (ContentType enum), dataType, content, encrypted
  const xmlBody = [
    `<connectorMessage>`,
    `  <channelId>${channelId}</channelId>`,
    `  <messageId>${messageId}</messageId>`,
    `  <metaDataId>${metaDataId}</metaDataId>`,
    `  <raw>`,
    `    <contentType>RAW</contentType>`,
    `    <dataType>${rawDataType}</dataType>`,
    `    <content>${rawB64}</content>`,
    `    <encrypted>false</encrypted>`,
    `  </raw>`,
    `</connectorMessage>`,
  ].join("\n");

  const res = await fetch(
    `${PROXY_BASE}/channels/${channelId}/messages/${messageId}/_getDICOMMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Accept: "text/plain",
        ...blHeader,
      },
      body: xmlBody,
      credentials: "include",
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => String(res.status));
    console.error("[DICOM] _getDICOMMessage error:", res.status, errBody.substring(0, 400));
    throw new Error(extractApiErrorMessage(errBody));
  }

  const text = await res.text();
  if (!text) throw new Error("Empty _getDICOMMessage response");
  // Response is plain-text base64. If the server also wraps it as a JSON string,
  // unwrap it transparently.
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* not JSON — plain base64 text */
  }
  return text.trim();
}

/** Build reprocess query string with replace, filterDestinations, and metaDataId params. */
function buildReprocessQuery(replace: boolean, reprocessMetaDataIds: number[] | null): string {
  const params = new URLSearchParams();
  params.set("replace", String(replace));
  if (reprocessMetaDataIds !== null) {
    params.set("filterDestinations", "true");
    for (const id of reprocessMetaDataIds) {
      params.append("metaDataId", String(id));
    }
  } else {
    params.set("filterDestinations", "false");
  }
  return params.toString();
}

/** Reprocess a single message. */
export async function reprocessMessage(
  channelId: string,
  messageId: number,
  replace = true,
  reprocessMetaDataIds: number[] | null = null
): Promise<void> {
  const qs = buildReprocessQuery(replace, reprocessMetaDataIds);
  await request<void>(`/channels/${channelId}/messages/${messageId}/_reprocess?${qs}`, {
    method: "POST",
  });
}

/**
 * Remove a single message, scoped to the selected connector. Mirrors Java
 * Frame.doRemoveMessage → MessageServlet, which sets `includedMetaDataIds=[metaDataId]`
 * only when `metaDataId != null`.
 *
 * @param metaDataId The selected connector's metaDataId. `0` = source = removes the entire
 *   message (source + all destinations, via the server's source cascade); a destination's
 *   metaDataId removes only that connector message. Omit to delete the whole message.
 * @param patientId When CURES PHI logging is on, the selected connector's PATIENT_ID. The
 *   server uses it only for the PHI delete-audit interceptor, not the delete filter.
 */
export async function removeMessage(
  channelId: string,
  messageId: number,
  metaDataId?: number,
  patientId?: string
): Promise<void> {
  const params = new URLSearchParams();
  if (metaDataId !== undefined) params.set("metaDataId", String(metaDataId));
  if (patientId) params.set("patientId", patientId);
  const qs = params.toString();
  await request<void>(`/channels/${channelId}/messages/${messageId}${qs ? `?${qs}` : ""}`, {
    method: "DELETE",
  });
}

/** Remove messages matching a filter. POST /{channelId}/messages/_remove */
export async function removeMessagesByFilter(
  channelId: string,
  filter: MessageFilter
): Promise<void> {
  await request<void>(`/channels/${channelId}/messages/_remove`, {
    method: "POST",
    body: JSON.stringify(buildMessageFilterBody(filter)),
  });
}

/** Reprocess messages matching a filter. POST /{channelId}/messages/_reprocessWithFilter */
export async function reprocessMessagesWithFilter(
  channelId: string,
  filter: MessageFilter,
  replace = true,
  reprocessMetaDataIds: number[] | null = null
): Promise<void> {
  const qs = buildReprocessQuery(replace, reprocessMetaDataIds);
  await request<void>(`/channels/${channelId}/messages/_reprocessWithFilter?${qs}`, {
    method: "POST",
    body: JSON.stringify(buildMessageFilterBody(filter)),
  });
}

/**
 * Send/process a new message through a channel.
 *
 * Always uses POST /channels/{channelId}/messagesWithObj with an XStream XML
 * RawMessage body — this is the same endpoint the Java thick client uses via
 * Client.processMessage(channelId, rawMessage) → MessageServletInterface
 * .processMessage(channelId, rawMessage) → @Path("/{channelId}/messagesWithObj").
 *
 * The plain-text POST /channels/{channelId}/messages endpoint also works but
 * only accepts query-param-based destination/sourceMap filtering, and in
 * practice the Java client never uses it for the UI "Send Message" flow.
 */
export async function sendMessage(
  channelId: string,
  rawContent: string,
  options?: {
    destinationMetaDataIds?: number[];
    sourceMap?: Record<string, string>;
    binary?: boolean;
  }
): Promise<void> {
  const destIds = options?.destinationMetaDataIds ?? [];
  const sourceMap = options?.sourceMap ?? {};
  const binary = options?.binary ?? false;

  const destXml =
    destIds.length > 0
      ? `<destinationMetaDataIds class="set">${destIds
          .map((id) => `<int>${id}</int>`)
          .join("")}</destinationMetaDataIds>`
      : "";

  const entries = Object.entries(sourceMap);
  const sourceMapXml =
    entries.length > 0
      ? `<sourceMap>${entries
          .map(
            ([k, v]) => `<entry><string>${escXml(k)}</string><string>${escXml(v)}</string></entry>`
          )
          .join("")}</sourceMap>`
      : "<sourceMap/>";

  const xml = [
    `<com.mirth.connect.donkey.model.message.RawMessage>`,
    `<rawData><![CDATA[${rawContent}]]></rawData>`,
    destXml,
    sourceMapXml,
    `<binary>${binary}</binary>`,
    `</com.mirth.connect.donkey.model.message.RawMessage>`,
  ].join("");

  await request<void>(`/channels/${channelId}/messagesWithObj`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
}

/**
 * Fire-and-forget dispatch of one or more messages through a channel.
 *
 * Mirrors the Java client's EditMessageDialog, which calls processMessage() on a
 * background SwingWorker and disposes the dialog immediately. The processMessage
 * endpoint blocks until the channel finishes handling the message, so callers MUST
 * NOT await this — invoke it with `void` and let the callbacks report the outcome.
 * The returned promise resolves only after every send settles (so tests can await
 * completion); awaiting it in the UI would reintroduce the dialog-spin/tab-freeze
 * this helper exists to avoid.
 */
export async function sendMessagesInBackground(
  channelId: string,
  contents: string[],
  options: {
    destinationMetaDataIds?: number[];
    sourceMap?: Record<string, string>;
    onSuccess?: (count: number) => void;
    onError?: (message: string) => void;
    onSettled?: () => void;
  }
): Promise<void> {
  const { onSuccess, onError, onSettled, ...sendOptions } = options;
  try {
    for (const content of contents) {
      await sendMessage(channelId, content, sendOptions);
    }
    onSuccess?.(contents.length);
  } catch (e) {
    onError?.(e instanceof Error ? e.message : String(e));
  } finally {
    onSettled?.();
  }
}

// ─── Message Import / Export ──────────────────────────────────────────────────

/**
 * Import messages from a server-side file path.
 *
 * POST /channels/{channelId}/messages/_importFromPath
 * Body: text/plain (the absolute path on the BridgeLink server)
 * Query: ?includeSubfolders=true|false
 *
 * Mirrors Java: Client.importMessagesServer(channelId, path, includeSubfolders)
 * Permission: MESSAGES_IMPORT
 */
export async function importMessagesFromPath(
  channelId: string,
  path: string,
  includeSubfolders: boolean
): Promise<MessageImportResult> {
  const serverUrl = getServerUrl();
  const blHeader: Record<string, string> = serverUrl ? { "x-bl-server": serverUrl } : {};

  const res = await fetch(
    `${PROXY_BASE}/channels/${channelId}/messages/_importFromPath?includeSubfolders=${includeSubfolders}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
        ...blHeader,
      },
      body: path,
      credentials: "include",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(extractApiErrorMessage(text));
  }

  const text = await res.text();
  if (!text) return { totalCount: 0, successCount: 0 };
  const data = JSON.parse(text);
  return normalizeXStream(data) as MessageImportResult;
}

/**
 * Import a single message (XML body).
 *
 * POST /channels/{channelId}/messages/_import
 * Body: application/xml (XStream-serialized Message)
 *
 * Used by "My Computer" import — one call per message file.
 * Mirrors Java: Client.importMessage(channelId, message)
 * Permission: MESSAGES_IMPORT
 */
export async function importMessage(channelId: string, messageXml: string): Promise<void> {
  await request<void>(`/channels/${channelId}/messages/_import`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: messageXml,
  });
}

/**
 * Export messages from the server to a server-side directory.
 *
 * POST /channels/{channelId}/messages/_exportUsingFilter
 * Content-Type: multipart/form-data
 * Form parts: "filter" (MessageFilter JSON), "writerOptions" (MessageWriterOptions JSON)
 * Query: ?pageSize=N
 *
 * Mirrors Java: Client.exportMessagesServer(channelId, filter, pageSize, writerOptions)
 * Permission: MESSAGES_EXPORT_SERVER
 */
export async function exportMessagesServer(
  channelId: string,
  filter: MessageFilter,
  pageSize: number,
  writerOptions: MessageWriterOptions
): Promise<number> {
  const serverUrl = getServerUrl();
  const blHeader: Record<string, string> = serverUrl ? { "x-bl-server": serverUrl } : {};

  const formData = new FormData();
  formData.append(
    "filter",
    new Blob([JSON.stringify(buildMessageFilterBody(filter))], { type: "application/json" })
  );
  formData.append(
    "writerOptions",
    new Blob([JSON.stringify({ messageWriterOptions: writerOptions })], {
      type: "application/json",
    })
  );

  const res = await fetch(
    `${PROXY_BASE}/channels/${channelId}/messages/_exportUsingFilter?pageSize=${pageSize}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...blHeader,
        // Do NOT set Content-Type — let the browser set the multipart boundary
      },
      body: formData,
      credentials: "include",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(extractApiErrorMessage(text));
  }

  const text = await res.text();
  if (!text) return 0;
  const data = JSON.parse(text);
  return normalizeXStream(data) as number;
}

/**
 * Audit: log that a message export was initiated.
 *
 * POST /channels/_auditExportMessages
 * Mirrors Java: Client.auditExportMessages(attributesMap)
 * Called before the actual export begins.
 */
export async function auditExportMessages(attributes: Record<string, string>): Promise<void> {
  await request<void>("/channels/_auditExportMessages", {
    method: "POST",
    body: buildStringMapBody(attributes),
  });
}

/**
 * Audit: log that a message export completed successfully.
 *
 * POST /channels/_auditExportMessagesSuccess
 * Mirrors Java: Client.auditExportMessagesSuccess(attributesMap)
 * Called after the export succeeds with detailed attributes.
 */
export async function auditExportMessagesSuccess(
  attributes: Record<string, string>
): Promise<void> {
  await request<void>("/channels/_auditExportMessagesSuccess", {
    method: "POST",
    body: buildStringMapBody(attributes),
  });
}

// ─── CURES PHI Audit ─────────────────────────────────────────────────────────

/**
 * Serialize a Record<string, string> as XStream Map<String, String> JSON.
 *
 * XStream linked-hash-map format:
 *   {"map": {"entry": [{"string": ["k1","v1"]}, {"string": ["k2","v2"]}]}}
 * Single entry:
 *   {"map": {"entry": {"string": ["k","v"]}}}
 *
 * Same pattern used by setGlobalScripts() in api-settings.ts.
 */
function buildStringMapBody(attributes: Record<string, string>): string {
  const entries = Object.entries(attributes).map(([k, v]) => ({ string: [k, v] }));
  if (entries.length === 0) return JSON.stringify({ map: {} });
  if (entries.length === 1) return JSON.stringify({ map: { entry: entries[0] } });
  return JSON.stringify({ map: { entry: entries } });
}

/**
 * POST /channels/_auditAccessedPHIMessage
 *
 * Mirrors Java MessageBrowser.java — fires when a user views message content
 * for a channel that has PATIENT_ID metadata.
 *
 * @see MessageServletInterface#auditAccessedPHIMessage
 */
export async function auditAccessedPHIMessage(attributes: Record<string, string>): Promise<void> {
  await request<void>("/channels/_auditAccessedPHIMessage", {
    method: "POST",
    body: buildStringMapBody(attributes),
  });
}

/**
 * POST /channels/_auditQueriedPHIMessage
 *
 * Mirrors Java MessageBrowser.java — fires when a user searches messages
 * for a channel that has PATIENT_ID metadata (not on initial load).
 *
 * @see MessageServletInterface#auditQueriedPHIMessage
 */
export async function auditQueriedPHIMessage(attributes: Record<string, string>): Promise<void> {
  await request<void>("/channels/_auditQueriedPHIMessage", {
    method: "POST",
    body: buildStringMapBody(attributes),
  });
}

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Mirrors Java's EventFilter model used by EventBrowser.generateEventFilter().
 * maxEventId is always fetched first via GET /events/maxEventId and included in
 * every search — the server uses it to bound the result set to events that existed
 * when the search started (prevents new events from shifting pages mid-search).
 */
export interface EventFilter {
  maxEventId?: number;
  minEventId?: number;
  offset?: number;
  limit?: number;
  level?: string[];
  startDate?: string;
  endDate?: string;
  name?: string;
  outcome?: string;
  userId?: number;
  ipAddress?: string;
  serverId?: string;
  attributeSearch?: string;
  /**
   * UI-only flag (not a server field). When true, `startDate` snaps to the
   * start of its day and `endDate` to the end (23:59:59.999) so a whole-day
   * range includes the entire end day — mirrors EventBrowser.java's "All Day"
   * checkbox (`add(DATE,+1); add(MILLISECOND,-1)` at :244-249). Consumed by
   * buildEventFilterBody; never emitted into the request body.
   */
  allDay?: boolean;
}

/**
 * GET /events/maxEventId
 * Mirrors Java's Client.getMaxEventId() — returns the highest event ID currently
 * in the database. Called before every search to bound result sets, exactly as
 * EventBrowser.generateEventFilter() does (lines 315-316 in EventBrowser.java).
 *
 * Errors propagate to the caller: a failed maxEventId must surface (and abort the
 * search) rather than silently leaving the search unbounded.
 */
export async function getMaxEventId(): Promise<number> {
  return request<number>("/events/maxEventId");
}

/**
 * POST /events/_search  (body: EventFilter)
 * Mirrors Java's Client.getEvents(EventFilter filter, Integer offset, Integer limit).
 * The Java client uses the POST /_search variant (not GET /events) so the full
 * filter — including maxEventId — is sent as a request body, not query params.
 *
 * XStream serializes EventFilter as an XML/JSON object. The server reads it via
 * ObjectXMLSerializer, so we send it as a plain JSON object (Staxon converts it).
 * offset/limit are query params (not in the body) per the servlet interface.
 */
export async function getEvents(filter?: EventFilter): Promise<ServerEvent[]> {
  const query = new URLSearchParams();
  if (filter?.offset !== undefined) query.set("offset", String(filter.offset));
  if (filter?.limit !== undefined) query.set("limit", String(filter.limit));
  const qs = query.toString();

  const body = buildEventFilterBody(filter);
  return request<ServerEvent[]>(`/events/_search${qs ? `?${qs}` : ""}`, {
    method: "POST",
    body,
  });
}

/**
 * POST /events/count/_search  (body: EventFilter as JSON)
 * Mirrors Java's Client.getEventCount(EventFilter filter).
 * The GET /events/count endpoint 500s in practice because the server-side
 * Calendar deserialization of startDate/endDate query params fails without a
 * specific format. The POST /_search variant avoids this entirely.
 */
export async function getEventCount(filter?: EventFilter): Promise<number> {
  const body = buildEventFilterBody(filter);
  return request<number>("/events/count/_search", { method: "POST", body });
}

/**
 * Serialize an EventFilter to the JSON body expected by POST /events/_search and
 * POST /events/count/_search.
 *
 * The server uses XStream + Staxon (JSON→XML→XStream) to deserialize the body.
 * EventFilter is @XStreamAlias("eventFilter"), so the root JSON key is "eventFilter".
 *
 * Set<ServerEvent.Level> serializes as:
 *   {"levels": {"com.mirth.connect.model.ServerEvent_-Level": "INFORMATION"}}
 * (single level = scalar; multiple levels = array — Staxon's autoArray handles both)
 *
 * Calendar/Date fields use XStream's GregorianCalendarConverter format:
 *   {"time": epochMillis, "timezone": "America/New_York"}
 *
 * offset/limit are NOT in the body — they are sent as query params.
 */
export function buildEventFilterBody(filter?: EventFilter): string {
  const f: Record<string, unknown> = {};

  if (filter?.maxEventId != null) f.maxEventId = filter.maxEventId;
  if (filter?.minEventId != null) f.minEventId = filter.minEventId;

  if (filter?.level?.length) {
    // XStream inner enum: Set<ServerEvent.Level> → FQN key "com.mirth.connect.model.ServerEvent_-Level"
    // Single value → scalar string; multiple → array (Staxon autoArray)
    f.levels = {
      "com.mirth.connect.model.ServerEvent_-Level":
        filter.level.length === 1 ? filter.level[0] : filter.level,
    };
  }

  // Date fields: XStream GregorianCalendarConverter format {time, timezone} via the
  // shared toXStreamCalendar helper. When allDay, snap to whole-day bounds
  // (startOfDay / endOfDay → 23:59:59.999) so the end day is fully included —
  // matching EventBrowser.java's All Day adjustment.
  if (filter?.startDate) {
    const d = new Date(filter.startDate);
    f.startDate = toXStreamCalendar(filter.allDay ? startOfDay(d) : d);
  }
  if (filter?.endDate) {
    const d = new Date(filter.endDate);
    f.endDate = toXStreamCalendar(filter.allDay ? endOfDay(d) : d);
  }

  if (filter?.name) f.name = filter.name;
  if (filter?.outcome) f.outcome = filter.outcome;
  if (filter?.userId != null) f.userId = filter.userId;
  if (filter?.ipAddress) f.ipAddress = filter.ipAddress;
  if (filter?.serverId) f.serverId = filter.serverId;
  if (filter?.attributeSearch) f.attributeSearch = filter.attributeSearch;

  return JSON.stringify({ eventFilter: f });
}

/**
 * POST /events/_export
 * Exports all events to the application data directory on the server.
 * Returns the file path on the server where the export was written.
 * Mirrors Java's mirthClient.exportAllEvents() → Client.exportAllEvents().
 */
export async function exportAllEvents(): Promise<string> {
  return request<string>("/events/_export", {
    method: "POST",
    rawText: true,
  });
}
