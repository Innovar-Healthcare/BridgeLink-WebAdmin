"use client";

import { startTransition, useState, useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectorMessage, Message, MessageContent, Attachment } from "@/lib/types";
import { getMessageAttachments, getAttachment, getDicomMessage } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { ValueDetailDialog } from "@/components/value-detail-dialog";
import dynamic from "next/dynamic";
import { formatContent } from "@/lib/format-content";
import { formatMapValue } from "@/lib/format-map-value";
import {
  CELL_PREVIEW_CHARS,
  detectLanguage,
  dataTypeToLanguage,
  truncate,
} from "@/lib/value-format";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { registerHl7v2Language, hl7v2Theme } from "@/lib/monaco-hl7v2";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="p-4 text-sm text-gray-400 dark:text-gray-500">Loading editor…</div>
  ),
});

const DicomViewer = dynamic(() => import("./dicom-viewer").then((m) => m.DicomViewer), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
      Loading DICOM viewer…
    </div>
  ),
});
import { useTheme } from "@/lib/hooks/use-theme";
import { useCompactMode, type ViewDensity } from "@/lib/hooks/use-compact-mode";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { AttachmentViewerHost } from "./attachment-viewers";
import { resolveContentType } from "./content-type-utils";
import { resolveTab } from "./tab-utils";
import { AttachmentTypeDialog } from "./attachment-type-dialog";
import {
  mimeToViewer,
  normalizeImageMime,
  type AttachmentViewerType,
} from "./attachment-viewer-types";
import { buildAttachmentRows, type AttachmentDisplayRow } from "./attachment-grouping";
import { loadAdminPrefs, saveAdminPref } from "@/lib/admin-prefs";
import { DataTable } from "@/components/data-table";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";
import { getCache } from "@/lib/cache-store";

/** Vertical padding for table body cells in the content viewer. */
function cvBodyPy(d: ViewDensity): string {
  return d === "comfortable" ? "py-1.5" : d === "compact" ? "py-0.5" : "py-1";
}
/** Vertical padding for tab/chip bar containers. */
function cvBarPy(d: ViewDensity): string {
  return d === "comfortable" ? "py-1.5" : d === "compact" ? "py-0.5" : "py-1";
}

// ─── Column definitions ──────────────────────────────────────────────────────

type MappingCol = "scope" | "variable" | "value";

const MAPPING_COLS: ColDef<MappingCol>[] = [
  { key: "scope", label: "Scope", defaultWidth: 100, minWidth: 60, defaultVisible: true },
  { key: "variable", label: "Variable", defaultWidth: 160, minWidth: 80, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 320, minWidth: 80, defaultVisible: true },
];

type AttachmentCol = "num" | "type" | "id" | "actions";

const ATTACHMENT_COLS: ColDef<AttachmentCol>[] = [
  { key: "num", label: "#", defaultWidth: 40, minWidth: 30, defaultVisible: true },
  { key: "type", label: "Type", defaultWidth: 110, minWidth: 60, defaultVisible: true },
  {
    key: "id",
    label: "Attachment Id",
    defaultWidth: 240,
    minWidth: 100,
    defaultVisible: true,
  },
  { key: "actions", label: "Actions", defaultWidth: 130, minWidth: 100, defaultVisible: true },
];

interface MappingRow {
  scope: string;
  variable: string;
  value: string;
}

// ─── Content Types ───────────────────────────────────────────────────────────

const MESSAGE_CONTENT_TYPES = [
  { key: "raw", apiKey: "RAW", label: "Raw" },
  { key: "processedRaw", apiKey: "PROCESSED_RAW", label: "Processed Raw" },
  { key: "transformed", apiKey: "TRANSFORMED", label: "Transformed" },
  { key: "encoded", apiKey: "ENCODED", label: "Encoded" },
  { key: "sent", apiKey: "SENT", label: "Sent" },
  { key: "response", apiKey: "RESPONSE", label: "Response" },
  { key: "responseTransformed", apiKey: "RESPONSE_TRANSFORMED", label: "Response Transformed" },
  { key: "processedResponse", apiKey: "PROCESSED_RESPONSE", label: "Processed Response" },
] as const;

type ContentTypeKey = (typeof MESSAGE_CONTENT_TYPES)[number]["key"];

// Content types that contain XStream-serialized Response objects
const RESPONSE_CONTENT_TYPES: ContentTypeKey[] = ["response", "processedResponse"];

// ─── Error Types ─────────────────────────────────────────────────────────────

const ERROR_TYPES = [
  { key: "processingError" as const, label: "Processing Error" },
  { key: "postProcessorError" as const, label: "Postprocessor Error" },
  { key: "responseError" as const, label: "Response Error" },
] as const;

type ErrorTypeKey = (typeof ERROR_TYPES)[number]["key"];

// ─── Mapping Scopes ──────────────────────────────────────────────────────────

const MAPPING_SCOPES = [
  { key: "sourceMap" as const, label: "Source" },
  { key: "connectorMap" as const, label: "Connector" },
  { key: "channelMap" as const, label: "Channel" },
  { key: "responseMap" as const, label: "Response" },
] as const;

// ─── Viewer Tabs ─────────────────────────────────────────────────────────────

type ViewerTab = "messages" | "mappings" | "errors" | "attachments";

// ─── Parsed Response Object ─────────────────────────────────────────────────

interface ParsedResponse {
  status: string;
  message: string;
  statusMessage: string;
  error: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContentForType(
  cm: ConnectorMessage | null,
  ct: (typeof MESSAGE_CONTENT_TYPES)[number]
): MessageContent | null {
  if (!cm) return null;
  const field = cm[ct.key as keyof ConnectorMessage] as MessageContent | undefined;
  if (field && typeof field === "object" && "content" in field) return field;
  const fromMap = cm.content?.[ct.apiKey] ?? cm.content?.[ct.key];
  if (fromMap) return fromMap;
  return null;
}

/** Unescape XML entities back to plain text. */
function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xd;/g, "\r")
    .replace(/&#xa;/g, "\n")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Extract text content of an XML tag via regex. Returns raw (still XML-escaped) text. */
function getXmlTagContent(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : "";
}

/**
 * Parse an XStream-serialized Response XML string.
 * Format: <response><status>SENT</status><message>...</message><statusMessage>...</statusMessage><error>...</error></response>
 */
function parseResponseXml(xml: string): ParsedResponse | null {
  if (!xml || !xml.trim().startsWith("<")) return null;
  try {
    const status = getXmlTagContent(xml, "status");
    // If we can't find a <status> tag, this isn't a Response XML
    if (!status) return null;
    return {
      status,
      message: unescapeXml(getXmlTagContent(xml, "message")),
      statusMessage: unescapeXml(getXmlTagContent(xml, "statusMessage")),
      error: unescapeXml(getXmlTagContent(xml, "error")),
    };
  } catch {
    return null;
  }
}

/**
 * Format Sent content for destination connectors.
 * The raw content is an XStream-serialized ConnectorProperties XML blob.
 * We extract key fields and produce a structured human-readable summary
 * matching the Java UI's ConnectorProperties.toFormattedString() pattern.
 */
export function formatSentProperties(xml: string): string {
  if (!xml || !xml.trim().startsWith("<")) return xml;

  const get = (tag: string): string => unescapeXml(getXmlTagContent(xml, tag));
  const lines: string[] = [];

  // Detect connector type from root element
  const rootMatch = xml.match(/^<([\w.]+)/);
  const rootClass = rootMatch ? rootMatch[1] : "";

  if (rootClass.includes("HttpDispatcherProperties")) {
    const host = get("host");
    const method = get("method");
    const username = get("username");
    if (host) lines.push(`URL: ${host}`);
    if (method) lines.push(`METHOD: ${method}`);
    if (username) lines.push(`USERNAME: ${username}`);
    // Extract headers
    const headersBlock = xml.match(/<headers[\s\S]*?>([\s\S]*?)<\/headers>/);
    if (headersBlock) {
      const headerEntries = headersBlock[1].matchAll(
        /<entry>\s*<string>([\s\S]*?)<\/string>\s*<list>([\s\S]*?)<\/list>\s*<\/entry>/g
      );
      const headerLines: string[] = [];
      for (const m of headerEntries) {
        const vals = [...m[2].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((v) =>
          unescapeXml(v[1])
        );
        headerLines.push(`${unescapeXml(m[1])}: ${vals.join(", ")}`);
      }
      if (headerLines.length > 0) {
        lines.push("", "[HEADERS]", ...headerLines);
      }
    }
    // Extract parameters
    const paramsBlock = xml.match(/<parameters[\s\S]*?>([\s\S]*?)<\/parameters>/);
    if (paramsBlock) {
      const paramEntries = paramsBlock[1].matchAll(
        /<entry>\s*<string>([\s\S]*?)<\/string>\s*<list>([\s\S]*?)<\/list>\s*<\/entry>/g
      );
      const paramLines: string[] = [];
      for (const m of paramEntries) {
        const vals = [...m[2].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((v) =>
          unescapeXml(v[1])
        );
        paramLines.push(`${unescapeXml(m[1])}: ${vals.join(", ")}`);
      }
      if (paramLines.length > 0) {
        lines.push("", "[PARAMETERS]", ...paramLines);
      }
    }
    const content = get("content");
    if (content) lines.push("", "[CONTENT]", content);
  } else if (rootClass.includes("TcpDispatcherProperties")) {
    const host = get("remoteAddress");
    const port = get("remotePort");
    const localAddr = get("localAddress");
    const localPort = get("localPort");
    if (host || port) lines.push(`REMOTE ADDRESS: ${host || ""}:${port || ""}`);
    if (localAddr || localPort) lines.push(`LOCAL ADDRESS: ${localAddr || ""}:${localPort || ""}`);
    const template = get("template");
    if (template) lines.push("", "[CONTENT]", template);
  } else if (
    rootClass.includes("FileDispatcherProperties") ||
    rootClass.includes("FileReceiverProperties")
  ) {
    const scheme = get("scheme");
    const host = get("host");
    const outputPattern = get("outputPattern") || get("outputFileName");
    const username = get("username");
    const anonymous = get("anonymous");
    const secure = get("secure") === "true";

    // Build the URI exactly like Java FileDispatcherProperties.appendURIString():
    // a scheme-specific prefix, with the FILE scheme getting NO prefix. The <scheme>
    // value may serialize as the enum name (FTP) or its display value (ftp / "Amazon
    // S3"), so normalize before matching.
    const s = scheme.trim().toLowerCase();
    let prefix = "";
    if (s === "ftp") prefix = "ftp://";
    else if (s === "sftp") prefix = "sftp://";
    else if (s === "s3" || s === "amazon s3") prefix = "s3://";
    else if (s === "smb") prefix = "smb://";
    else if (s === "webdav") prefix = secure ? "https://" : "http://";
    // FILE (or unknown) → no prefix.

    //: for the local FILE scheme, normalize Windows backslashes to forward
    // slashes so the URI doesn't show mixed separators (e.g. C:\training\out/1.hl7).
    // Leave network hosts untouched (e.g. SMB \\server\share).
    const isFile = s === "file" || s === "";
    const displayHost = isFile ? host.replace(/\\/g, "/") : host;

    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    if (displayHost) parts.push(displayHost);
    if (outputPattern) {
      if (displayHost && !displayHost.endsWith("/")) parts.push("/");
      parts.push(outputPattern);
    }
    const uri = parts.join("");
    if (uri) lines.push(`URI: ${uri}`);
    if (username && anonymous !== "true") lines.push(`USERNAME: ${username}`);
    const template = get("template");
    if (template) lines.push("", "[CONTENT]", template);
  } else if (rootClass.includes("DatabaseDispatcherProperties")) {
    const url = get("url");
    const username = get("username");
    if (url) lines.push(`URL: ${url}`);
    if (username) lines.push(`USERNAME: ${username}`);
    const query = get("query");
    if (query) lines.push("", "[QUERY]", query);
  } else if (rootClass.includes("SmtpDispatcherProperties")) {
    const smtpHost = get("smtpHost");
    const smtpPort = get("smtpPort");
    const username = get("username");
    const to = get("to");
    const from = get("from");
    const cc = get("cc");
    const subject = get("subject");
    if (smtpHost) lines.push(`HOST: ${smtpHost}${smtpPort ? ":" + smtpPort : ""}`);
    if (username) lines.push(`USERNAME: ${username}`);
    if (to) lines.push(`TO: ${to}`);
    if (from) lines.push(`FROM: ${from}`);
    if (cc) lines.push(`CC: ${cc}`);
    if (subject) lines.push(`SUBJECT: ${subject}`);
    const body = get("body");
    if (body) lines.push("", "[CONTENT]", body);
  } else if (rootClass.includes("WebServiceDispatcherProperties")) {
    const wsdlUrl = get("wsdlUrl");
    const username = get("username");
    const service = get("service");
    const port = get("port");
    const locationURI = get("locationURI");
    const soapAction = get("soapAction");
    if (wsdlUrl) lines.push(`WSDL URL: ${wsdlUrl}`);
    if (username) lines.push(`USERNAME: ${username}`);
    if (service) lines.push(`SERVICE: ${service}`);
    if (port) lines.push(`PORT: ${port}`);
    if (locationURI) lines.push(`LOCATION URI: ${locationURI}`);
    if (soapAction) lines.push(`SOAP ACTION: ${soapAction}`);
    const envelope = get("envelope");
    if (envelope) lines.push("", "[CONTENT]", envelope);
  } else if (rootClass.includes("JavaScriptDispatcherProperties")) {
    lines.push("Script Executed");
  } else if (
    rootClass.includes("ChannelWriterDispatcherProperties") ||
    rootClass.includes("VmDispatcherProperties")
  ) {
    const channelId = get("channelId");
    if (channelId) lines.push(`CHANNEL ID: ${channelId}`);
    const template = get("channelTemplate") || get("template");
    if (template) lines.push("", "[CONTENT]", template);
    const mapVariables = get("mapVariables");
    if (mapVariables) lines.push("", "[MAP VARIABLES]", mapVariables);
  } else if (rootClass.includes("DICOMDispatcherProperties")) {
    const host = get("host");
    const port = get("port");
    const localHost = get("localHost");
    const localPort = get("localPort");
    const appEntity = get("applicationEntity");
    const localAppEntity = get("localApplicationEntity");
    if (host || port) lines.push(`REMOTE ADDRESS: ${host || ""}:${port || ""}`);
    if (localHost || localPort) lines.push(`LOCAL ADDRESS: ${localHost || ""}:${localPort || ""}`);
    if (appEntity) lines.push(`REMOTE APPLICATION ENTITY: ${appEntity}`);
    if (localAppEntity) lines.push(`LOCAL APPLICATION ENTITY: ${localAppEntity}`);
    const template = get("template");
    if (template) lines.push("", "[CONTENT]", template);
  } else if (rootClass.includes("DocumentDispatcherProperties")) {
    const outputType = get("output");
    const uri = get("uri") || get("host");
    const docType = get("documentType");
    if (outputType) lines.push(`OUTPUT: ${outputType}`);
    if (uri) lines.push(`URI: ${uri}`);
    if (docType) lines.push(`DOCUMENT TYPE: ${docType}`);
    const template = get("template");
    if (template) lines.push("", "[CONTENT]", template);
  }

  // If we extracted some meaningful content, return the formatted version
  if (lines.length > 0) {
    return lines.join("\n");
  }

  // Fallback — unrecognized connector type, return raw XML
  return xml;
}

/**
 * Determine the display content and optional status line for a content type.
 * Response and Processed Response types need special handling — the raw content
 * is an XStream-serialized Response object that must be parsed to extract
 * the actual message body and status info.
 */
function getDisplayContent(
  contentTypeKey: ContentTypeKey,
  rawText: string,
  metaDataId: number
): { statusLine: string; displayText: string } {
  // Response tab: always parse as Response object
  if (contentTypeKey === "response") {
    const parsed = parseResponseXml(rawText);
    if (parsed) {
      const statusLine = parsed.statusMessage
        ? `${parsed.status}: ${parsed.statusMessage}`
        : parsed.status;
      return { statusLine, displayText: parsed.message };
    }
    // Fallback — couldn't parse, show raw
    return { statusLine: "", displayText: rawText };
  }

  // Processed Response tab: parse for destinations (metaDataId > 0), plain for source
  if (contentTypeKey === "processedResponse") {
    if (metaDataId > 0) {
      const parsed = parseResponseXml(rawText);
      if (parsed) {
        const statusLine = parsed.statusMessage
          ? `${parsed.status}: ${parsed.statusMessage}`
          : parsed.status;
        return { statusLine, displayText: parsed.message };
      }
    }
    // Source connector or parse failure — show as-is
    return { statusLine: "", displayText: rawText };
  }

  // Sent tab: format ConnectorProperties XML for destinations
  if (contentTypeKey === "sent" && metaDataId > 0) {
    const formatted = formatSentProperties(rawText);
    return { statusLine: "", displayText: formatted };
  }

  // All other content types: display as-is
  return { statusLine: "", displayText: rawText };
}

function hasErrors(cm: ConnectorMessage): boolean {
  return cm.processingError != null || cm.postProcessorError != null || cm.responseError != null;
}

// ─── Component Props ─────────────────────────────────────────────────────────

export type ContentViewerLayout = "right" | "bottom";

interface ContentViewerProps {
  /** The specific connector message to display (selected by clicking a table row). */
  connectorMessage: ConnectorMessage | null;
  /** Full message — needed for attachments (channelId, messageId). */
  fullMessage: Message | null;
  contentLoading: boolean;
  layout?: ContentViewerLayout;
  onClose?: () => void;
  /** Content fetch or PHI audit error to display in place of the viewer body. */
  error?: string;
}

export function ContentViewer({
  connectorMessage,
  fullMessage,
  contentLoading,
  onClose,
  error,
}: ContentViewerProps) {
  const { viewDensity } = useCompactMode();

  // ── State ──
  const [activeTab, setActiveTab] = useState<ViewerTab>("messages");
  const [activeContentType, setActiveContentType] = useState<ContentTypeKey>("raw");
  const [activeErrorType, setActiveErrorType] = useState<ErrorTypeKey>("processingError");
  // Mirror Java MessageBrowser: the Format toggle reads/writes the
  // `messageBrowserFormat` admin preference (shared with Settings → Administrator).
  const [formatEnabled, setFormatEnabled] = useState(() =>
    typeof window === "undefined" ? true : loadAdminPrefs().messageBrowserFormat
  );
  const [wordWrap, setWordWrap] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("bl-editor-wordwrap");
    return stored === null ? true : stored === "true";
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  // Pre-fetch attachment metadata when message changes (mirrors Java: eagerly fetched)
  useEffect(() => {
    if (!fullMessage) {
      startTransition(() => {
        setAttachments([]);
        setAttachmentsLoading(true); // guard reconciliation until new message's fetch completes
      });
      return;
    }
    let cancelled = false;
    startTransition(() => {
      setAttachmentsLoading(true);
    });
    getMessageAttachments(fullMessage.channelId, fullMessage.messageId, false)
      .then((atts) => {
        if (!cancelled) setAttachments(atts ?? []);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      })
      .finally(() => {
        if (!cancelled) setAttachmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when message identity (channelId+messageId) changes; fullMessage object ref changes don't warrant a new fetch
  }, [fullMessage?.channelId, fullMessage?.messageId]);

  // ── Available content types for Messages tab ──
  const availableContentTypes = MESSAGE_CONTENT_TYPES.filter((ct) => {
    const c = getContentForType(connectorMessage, ct);
    return c != null && c.content != null && c.content !== "";
  });

  // Keep the selected content type sticky across message/connector changes when
  // that type still has content; otherwise fall back to Raw. Keyed on a
  // stable signature of the available keys so manual selection isn't clobbered.
  const availableContentTypeKeys = availableContentTypes.map((ct) => ct.key);
  // Adjust the active content type during render (no effect) so the sticky
  // selection reconciles in the same pass the available types change. Guarded by
  // an equality check so it only fires when the resolved type actually differs,
  // avoiding an update loop. Skip during the loading gap when no types are
  // available — otherwise the empty-list case resets to "raw" before the new
  // message loads, destroying the sticky selection.
  if (availableContentTypeKeys.length > 0) {
    const resolvedContentType = resolveContentType(
      activeContentType,
      availableContentTypeKeys
    ) as ContentTypeKey;
    if (resolvedContentType !== activeContentType) {
      setActiveContentType(resolvedContentType);
    }
  }

  // ── Available error types for Errors tab ──
  const availableErrorTypes = ERROR_TYPES.filter((et) => {
    if (!connectorMessage) return false;
    return connectorMessage[et.key] != null;
  });

  // ── Tab visibility ──
  const showErrors = connectorMessage != null && hasErrors(connectorMessage);
  const showAttachments = attachments.length > 0;

  // Keep the active tab sticky across message/connector changes when the tab is
  // still available; fall back to "messages" only when it isn't.
  // Messages and Mappings are always available, so the list is never empty.
  // Guard against the loading gap: errors arrive with connector content and
  // attachments are fetched async, so both flags are transiently false during a
  // message switch — reconciling mid-load would incorrectly drop a valid tab.
  const availableTabs: ViewerTab[] = ["messages", "mappings"];
  if (showErrors) availableTabs.push("errors");
  if (showAttachments) availableTabs.push("attachments");
  // Reconcile the active tab during render (no effect) so the sticky selection
  // settles in the same pass the available tabs change. Guarded by an equality
  // check so it only fires when the resolved tab actually differs. Skip during
  // the loading gap: errors arrive with connector content and attachments are
  // fetched async, so both flags are transiently false during a message switch —
  // reconciling mid-load would incorrectly drop a valid tab.
  if (!contentLoading && !attachmentsLoading) {
    const resolvedTab = resolveTab(activeTab, availableTabs) as ViewerTab;
    if (resolvedTab !== activeTab) {
      setActiveTab(resolvedTab);
    }
  }

  // ── Get current content + special formatting ──
  const activeCtDef =
    MESSAGE_CONTENT_TYPES.find((ct) => ct.key === activeContentType) ?? MESSAGE_CONTENT_TYPES[0];
  const currentContent = getContentForType(connectorMessage, activeCtDef);
  const rawContentText = currentContent?.encrypted
    ? "[Encrypted content]"
    : (currentContent?.content ?? "");

  // Apply Response/Processed Response special formatting
  const metaDataId = connectorMessage?.metaDataId ?? 0;
  const { statusLine, displayText } = getDisplayContent(
    activeContentType,
    rawContentText,
    metaDataId
  );

  // Response body highlighting follows the connector's dataType, not a content
  // sniff (mirrors Java MessageBrowser.java:2017): the source connector uses its
  // raw inbound dataType; destinations use the response message's dataType.
  // Consumed only for Response/Processed Response content types.
  const responseDataType =
    metaDataId === 0 ? connectorMessage?.raw?.dataType : currentContent?.dataType;

  // ── Get current error text ──
  const currentErrorText = connectorMessage?.[activeErrorType] ?? "";

  // ── AI "Explain this error" launcher (commercial plugin, ──
  // Rendered at the viewer scope so the launcher appears whenever the viewed
  // connector message has errors — not only while the Errors sub-tab is active.
  const ErrorAiOverlay = pluginSlots["message-browser.errors.overlay"];
  const errorAiEnabled = useSlotEnabled("message-browser.errors.overlay");
  // `activeErrorType` defaults to processingError and is not reconciled against
  // availability (a message whose only error is a responseError would otherwise
  // hand the AI an empty error text). Resolve to the first available type when
  // the active one has no content on this message.
  const effectiveErrorType = availableErrorTypes.some((et) => et.key === activeErrorType)
    ? activeErrorType
    : (availableErrorTypes[0]?.key ?? activeErrorType);

  const wrapperClass = "flex-1 bg-white dark:bg-gray-900 flex flex-col overflow-hidden";

  return (
    <div className={wrapperClass} data-testid="message-content-viewer">
      {/* Header: connector name + status + close button */}
      <div
        className={`border-b border-border px-3 ${cvBarPy(viewDensity)} flex items-center justify-between shrink-0`}
      >
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {connectorMessage ? (
            <>
              {connectorMessage.connectorName}
              <span
                className={`ml-1.5 font-normal ${
                  connectorMessage.status === "ERROR"
                    ? "text-red-500"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                ({connectorMessage.status})
              </span>
            </>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">No connector selected</span>
          )}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-1.5 py-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors shrink-0"
            title="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {contentLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : connectorMessage ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Viewer tabs (Messages | Mappings | Errors | Attachments) */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ViewerTab)}>
            <TabsList>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
              {showErrors && <TabsTrigger value="errors">Errors</TabsTrigger>}
              {showAttachments && <TabsTrigger value="attachments">Attachments</TabsTrigger>}
            </TabsList>
          </Tabs>

          {/* Tab content */}
          {activeTab === "messages" && (
            <MessagesTabContent
              availableContentTypes={availableContentTypes}
              activeContentType={activeContentType}
              onContentTypeChange={setActiveContentType}
              formatEnabled={formatEnabled}
              onFormatChange={(v) => {
                setFormatEnabled(v);
                saveAdminPref("messageBrowserFormat", v);
              }}
              wordWrap={wordWrap}
              onWordWrapChange={(v) => {
                setWordWrap(v);
                localStorage.setItem("bl-editor-wordwrap", String(v));
              }}
              statusLine={statusLine}
              contentText={displayText}
              responseDataType={responseDataType}
            />
          )}

          {activeTab === "mappings" && (
            <MappingsTabContent connectorMessage={connectorMessage} wordWrap={wordWrap} />
          )}

          {activeTab === "errors" && (
            <ErrorsTabContent
              availableErrorTypes={availableErrorTypes}
              activeErrorType={activeErrorType}
              onErrorTypeChange={setActiveErrorType}
              errorText={currentErrorText as string}
            />
          )}

          {activeTab === "attachments" && fullMessage && (
            <AttachmentsTabContent
              attachments={attachments}
              loading={attachmentsLoading}
              channelId={fullMessage.channelId}
              messageId={fullMessage.messageId}
              wordWrap={wordWrap}
            />
          )}
        </div>
      ) : error ? (
        <div className="p-4">
          <ApiErrorAlert error={error} className="" />
        </div>
      ) : (
        <div className="p-4 text-sm text-gray-400 dark:text-gray-500">
          Select a message to view content.
        </div>
      )}

      {ErrorAiOverlay && errorAiEnabled && showErrors && connectorMessage && (
        <ErrorAiOverlay
          channelId={connectorMessage.channelId}
          channelName={getCache().channelMap.get(connectorMessage.channelId)?.name}
          metaDataId={connectorMessage.metaDataId}
          connectorName={connectorMessage.connectorName}
          errorType={effectiveErrorType}
          errorText={(connectorMessage[effectiveErrorType] ?? "") as string}
          messageContent={
            connectorMessage.raw && !connectorMessage.raw.encrypted
              ? connectorMessage.raw.content || undefined
              : undefined
          }
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// ─── Messages Tab ────────────────────────────────────────────────────────────

function MessagesTabContent({
  availableContentTypes,
  activeContentType,
  onContentTypeChange,
  formatEnabled,
  onFormatChange,
  wordWrap,
  onWordWrapChange,
  statusLine,
  contentText,
  responseDataType,
}: {
  availableContentTypes: (typeof MESSAGE_CONTENT_TYPES)[number][];
  activeContentType: string;
  onContentTypeChange: (key: ContentTypeKey) => void;
  formatEnabled: boolean;
  onFormatChange: (enabled: boolean) => void;
  wordWrap: boolean;
  onWordWrapChange: (enabled: boolean) => void;
  statusLine: string;
  contentText: string;
  /** dataType driving Response-body highlighting (see outer component). */
  responseDataType?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { isDark } = useTheme();
  const { viewDensity } = useCompactMode();

  const isResponseType = RESPONSE_CONTENT_TYPES.includes(activeContentType as ContentTypeKey);
  const formattedText = useMemo(
    () => formatContent(contentText, formatEnabled),
    [contentText, formatEnabled]
  );
  const language = useMemo(() => {
    // Response bodies highlight per the connector's dataType (Java
    // MessageBrowser.java:2017); fall back to a content sniff when the dataType
    // is absent or maps to plaintext.
    if (isResponseType && responseDataType) {
      const mapped = dataTypeToLanguage(responseDataType);
      if (mapped !== "plaintext") return mapped;
    }
    return detectLanguage(formattedText);
  }, [isResponseType, responseDataType, formattedText]);

  // The Format toggle only affects XML/JSON bodies, so disable it for anything
  // else (mirrors Java MessageBrowser.updateXmlCheckBoxEnabled, which tests the
  // first non-whitespace char of the displayed/deserialized content).
  const formatToggleable = useMemo(() => {
    const c = contentText.trim();
    return c.length > 0 && (c[0] === "<" || c[0] === "{" || c[0] === "[");
  }, [contentText]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API not available
    }
  };

  if (availableContentTypes.length === 0) {
    return <div className="p-4 text-sm text-gray-400">No content available.</div>;
  }

  return (
    <>
      <div
        className={`px-3 ${viewDensity === "comfortable" ? "pt-2 pb-1" : viewDensity === "compact" ? "pt-0.5 pb-0.5" : "pt-1.5 pb-0.5"} flex items-center gap-1 flex-wrap shrink-0`}
      >
        {availableContentTypes.map((ct) => (
          <button
            key={ct.key}
            onClick={() => onContentTypeChange(ct.key)}
            className={`px-2.5 ${cvBodyPy(viewDensity)} text-xs rounded-md transition-colors ${
              activeContentType === ct.key
                ? "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 font-medium"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {ct.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={`px-2 ${cvBodyPy(viewDensity)} text-xs rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors`}
            title="Copy content to clipboard"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <FormCheckbox label="Wrap" checked={wordWrap} onChange={onWordWrapChange} size="xs" />
          <FormCheckbox
            label="Format"
            checked={formatEnabled}
            onChange={onFormatChange}
            disabled={!formatToggleable}
            size="xs"
            tooltip="Pretty print messages that are XML."
          />
        </div>
      </div>
      {/* Status line for Response/Processed Response types */}
      {isResponseType && statusLine && (
        <div
          className={`mx-3 mb-1 px-3 ${cvBarPy(viewDensity)} bg-gray-100 dark:bg-gray-800 border border-border rounded text-xs font-mono text-gray-700 dark:text-gray-300`}
        >
          {statusLine}
        </div>
      )}
      <div className="bl-msg-editor flex-1 overflow-hidden">
        <Editor
          value={formattedText}
          language={language}
          theme={language === "hl7v2" ? hl7v2Theme(isDark) : isDark ? "vs-dark" : "vs"}
          beforeMount={registerHl7v2Language}
          options={{
            ...MONACO_BASE_OPTIONS,
            readOnly: true,
            fontSize: 12,
            wordWrap: wordWrap ? "on" : "off",
            wrappingIndent: "same",
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            padding: { top: 8, bottom: 8 },
            folding: true,
            // Small gap between the line-number gutter and content so the line
            // number isn't mistaken for part of the content.
            lineDecorationsWidth: 6,
            lineNumbersMinChars: 3,
            glyphMargin: false,
            contextmenu: false,
            domReadOnly: true,
          }}
          loading={<div className="p-4 text-xs text-gray-400">Loading editor…</div>}
        />
      </div>
    </>
  );
}

// ─── Mappings Tab ────────────────────────────────────────────────────────────

function MappingsTabContent({
  connectorMessage,
  wordWrap,
}: {
  connectorMessage: ConnectorMessage;
  wordWrap: boolean;
}) {
  const [dialogRow, setDialogRow] = useState<{
    scope: string;
    variable: string;
    value: string;
  } | null>(null);
  const mappingColConfig = useColumnConfig(MAPPING_COLS, "bl-content-viewer-mappings-cols-v1");
  const mappingSortState = useSortable<MappingCol>("scope", "asc");

  const rows = useMemo(() => {
    const result: { scope: string; variable: string; value: string }[] = [];
    for (const scope of MAPPING_SCOPES) {
      const map = connectorMessage[scope.key] as Record<string, unknown> | undefined;
      if (!map || typeof map !== "object") continue;
      for (const [key, val] of Object.entries(map)) {
        result.push({
          scope: scope.label,
          variable: key,
          value: formatMapValue(val),
        });
      }
    }
    return result;
  }, [connectorMessage]);

  if (rows.length === 0) {
    return <div className="p-4 text-sm text-gray-400">No mappings available.</div>;
  }

  return (
    <>
      <DataTable<MappingRow, MappingCol>
        variant="sortable"
        cols={MAPPING_COLS}
        rows={mappingSortState.sorted(rows, (r) => {
          switch (mappingSortState.sort.key) {
            case "scope":
              return r.scope;
            case "variable":
              return r.variable;
            case "value":
              return r.value;
            default:
              return undefined;
          }
        })}
        colConfig={mappingColConfig}
        sortState={mappingSortState}
        rowKey={(_r, i) => i}
        onRowDoubleClick={(row) => setDialogRow(row)}
        cellMono={{ variable: true }}
        // Safari shows a native tooltip over text clipped by `text-overflow: ellipsis`,
        // even with no title attribute (WebKit-only; Chrome never does). The empty title
        // is a best-effort suppression; the real safeguard is truncate() below, which
        // bounds the rendered value — and therefore any Safari tooltip — to a small
        // preview. Full values are viewed by double-clicking into the dialog.
        cellTitle={() => ""}
        empty="No mappings available."
        containerClassName="flex-1 min-h-0"
        renderCell={(row, col) => {
          if (col === "scope") return row.scope;
          if (col === "variable") return row.variable;
          // Bound the rendered text so WebKit doesn't lay out a giant single-line
          // run and leave the cell blank; full value is available on double-click.
          return truncate(row.value, CELL_PREVIEW_CHARS);
        }}
      />

      {/* Mapping value detail dialog */}
      <ValueDetailDialog
        open={dialogRow !== null}
        onOpenChange={(open) => {
          if (!open) setDialogRow(null);
        }}
        title={dialogRow?.variable ?? ""}
        subtitle={dialogRow ? `(${dialogRow.scope})` : undefined}
        value={dialogRow?.value ?? ""}
        wordWrap={wordWrap}
      />
    </>
  );
}

// ─── Errors Tab ──────────────────────────────────────────────────────────────

function ErrorsTabContent({
  availableErrorTypes,
  activeErrorType,
  onErrorTypeChange,
  errorText,
}: {
  availableErrorTypes: (typeof ERROR_TYPES)[number][];
  activeErrorType: ErrorTypeKey;
  onErrorTypeChange: (key: ErrorTypeKey) => void;
  errorText: string;
}) {
  const [copied, setCopied] = useState(false);
  const { viewDensity } = useCompactMode();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API not available
    }
  };

  if (availableErrorTypes.length === 0) {
    return <div className="p-4 text-sm text-gray-400">No errors.</div>;
  }

  return (
    <>
      <div
        className={`px-3 ${viewDensity === "comfortable" ? "pt-2 pb-1" : viewDensity === "compact" ? "pt-0.5 pb-0.5" : "pt-1.5 pb-0.5"} flex items-center gap-1 flex-wrap shrink-0`}
      >
        {availableErrorTypes.map((et) => (
          <button
            key={et.key}
            onClick={() => onErrorTypeChange(et.key)}
            className={`px-2.5 ${cvBodyPy(viewDensity)} text-xs rounded-md transition-colors ${
              activeErrorType === et.key
                ? "bg-red-100 text-red-800 font-medium"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {et.label}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={handleCopy}
            className={`px-2 ${cvBodyPy(viewDensity)} text-xs rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors`}
            title="Copy error to clipboard"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <pre className="px-4 pb-4 text-xs font-mono text-red-700 whitespace-pre-wrap break-all leading-5">
          {errorText || "No error content."}
        </pre>
      </div>
    </>
  );
}

// ─── Attachments Tab ─────────────────────────────────────────────────────────

/** Convert base64 string to ArrayBuffer. */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/**
 * Decode attachment content, handling BridgeLink's double-base64 encoding.
 * Java byte[] fields are base64-encoded by XStream, but BridgeLink stores attachment
 * content as base64 internally, so the API returns base64(base64(raw bytes)).
 * We detect this by checking if the first decode produces valid base64 text.
 */
function decodeAttachmentContent(b64: string): ArrayBuffer {
  const firstDecode = atob(b64);
  // Check if the result of the first decode is itself valid base64
  // (only contains A-Z, a-z, 0-9, +, /, =, and whitespace)
  const isBase64 = /^[A-Za-z0-9+/\s]+=*\s*$/.test(firstDecode);
  if (isBase64 && firstDecode.length > 4) {
    try {
      return base64ToArrayBuffer(firstDecode);
    } catch {
      // Not actually double-encoded, fall through
    }
  }
  return base64ToArrayBuffer(b64);
}

/** Returns true when buf looks like a DICOM Part-10 file (has "DICM" at bytes 128–131). */
function hasDicomMagic(buf: ArrayBuffer): boolean {
  const v = new Uint8Array(buf);
  return (
    v.length > 132 &&
    v[128] === 0x44 && // D
    v[129] === 0x49 && // I
    v[130] === 0x43 && // C
    v[131] === 0x4d // M
  );
}

/**
 * Decode a DICOM attachment using DICOM-aware byte-checking to determine
 * whether the content is single or double base64 encoded.
 *
 * The regex heuristic in decodeAttachmentContent can misfire for DICOM because
 * some DICOM preambles are all-ASCII (base64-valid) bytes. Instead we look for
 * the concrete "DICM" magic at bytes 128-131 (DICOM Part 10 header) after each
 * decode attempt, which is unambiguous.
 *
 * Fix over the prior version:
 *  - Strip whitespace from the outer base64 before decoding (BridgeLink may add
 *    line-breaks every 76 chars; atob tolerates them but the extra bytes can
 *    shift offsets in the decoded output in some environments).
 *  - Use a more permissive regex for the double-decode check: the old regex
 *    `/^[A-Za-z0-9+/\r\n]+=*\s*$/` fails whenever the inner base64 has
 *    per-line `=` padding (e.g. "...AAAA=\nAAAA..."), because `=` is only
 *    allowed at the end of the pattern. The new regex allows `=` anywhere
 *    (standard for multi-line base64) and strips whitespace before decoding.
 *  - Emit console.debug output so the browser console shows exactly what bytes
 *    we received — helps diagnose encoding issues without guessing.
 *
 * Fallback handling:
 *  - If neither decode produces "DICM" magic, use the single-decoded buffer.
 *    dwv can still attempt to parse legacy ACR-NEMA DICOM files without it.
 */
function decodeDicomAttachment(b64: string): ArrayBuffer {
  // Strip all whitespace — BridgeLink may wrap base64 at 76 chars.
  const clean = b64.replace(/\s/g, "");

  // Attempt 1: single decode (the normal case after _getDICOMMessage).
  const singleBuf = base64ToArrayBuffer(clean);
  if (hasDicomMagic(singleBuf)) return singleBuf;

  // Attempt 2: double decode — some BridgeLink configurations double-encode attachments.
  // Strip whitespace from the inner string before testing; per-line `=` padding
  // would otherwise break the base64-alphabet check.
  try {
    const inner = atob(clean);
    const innerClean = inner.replace(/\s/g, "");
    if (innerClean.length > 4 && /^[A-Za-z0-9+/]+=*$/.test(innerClean)) {
      const doubleBuf = base64ToArrayBuffer(innerClean);
      if (hasDicomMagic(doubleBuf)) return doubleBuf;
    }
  } catch {
    /* inner was binary, not base64 — single-decode is correct */
  }

  // Fallback: trust single decode (dwv can attempt legacy ACR-NEMA DICOM).
  return singleBuf;
}

/** Check if an ArrayBuffer contains text (no binary control chars). */
function isTextContent(buf: ArrayBuffer): boolean {
  const view = new Uint8Array(buf);
  const checkLen = Math.min(view.length, 512);
  for (let i = 0; i < checkLen; i++) {
    const c = view[i];
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return false;
  }
  return true;
}

/** Decode attachment content to a UTF-8 string. Returns null if binary. */
function attachmentToText(b64: string): string | null {
  try {
    const buf = decodeAttachmentContent(b64);
    if (!isTextContent(buf)) return null;
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return null;
  }
}

/** Trigger a browser file download for an already-built Blob. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Trigger a browser file download from base64 attachment content. */
function downloadAttachment(b64: string, filename: string, mimeType: string) {
  downloadBlob(
    new Blob([decodeAttachmentContent(b64)], { type: mimeType || "application/octet-stream" }),
    filename
  );
}

/** Guess a file extension from a MIME type / attachment type string. */
function guessExtension(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("xml") || t.includes("hl7v2")) return ".xml";
  if (t.includes("json")) return ".json";
  if (t.includes("pdf")) return ".pdf";
  if (t.includes("html")) return ".html";
  if (t.includes("csv")) return ".csv";
  if (t.includes("text") || t.includes("plain")) return ".txt";
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg") || t.includes("jpg")) return ".jpg";
  if (t.includes("gif")) return ".gif";
  if (t.includes("dicom")) return ".dcm";
  return ".bin";
}

function AttachmentsTabContent({
  attachments,
  loading,
  channelId,
  messageId,
  wordWrap,
}: {
  attachments: Attachment[];
  loading: boolean;
  channelId: string;
  messageId: number;
  wordWrap: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState<string | null>(null);
  /** Raw stored attachment content (base64) — shown when "Decode Base64 Data" is off. */
  const [viewRawBase64, setViewRawBase64] = useState<string | null>(null);
  /** Whether the text viewer shows decoded text (true) or the raw stored base64 (false). */
  const [decodeBase64, setDecodeBase64] = useState(true);
  const [viewBlobUrl, setViewBlobUrl] = useState<string | null>(null);
  const [viewDicomBlob, setViewDicomBlob] = useState<Blob | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "pdf" | "image" | "dicom" | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /** Attachment awaiting a viewer choice — drives the AttachmentTypeDialog. */
  const [pickerAtt, setPickerAtt] = useState<Attachment | null>(null);
  const { isDark } = useTheme();
  const attachmentColConfig = useColumnConfig(
    ATTACHMENT_COLS,
    "bl-content-viewer-attachments-cols-v1"
  );
  const attachmentSortState = useSortable<AttachmentCol>("id", "asc");

  // Cleanup blob URL on unmount or change
  const cleanupBlobUrl = useCallback(() => {
    setViewBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  // Close the inline viewer and clear all view state.
  const closeViewer = useCallback(() => {
    setSelectedId(null);
    setViewContent(null);
    setViewRawBase64(null);
    setViewDicomBlob(null);
    setViewMode(null);
    setViewError(null);
    cleanupBlobUrl();
  }, [cleanupBlobUrl]);

  // Reset view when the message changes. closeViewer() also revokes the blob URL
  // (a real side effect on URL), so this stays in an effect; the synchronous
  // state resets are wrapped in startTransition to avoid cascading renders.
  useEffect(() => {
    startTransition(() => {
      closeViewer();
      setPickerAtt(null);
    });
  }, [channelId, messageId, closeViewer]);

  // Cleanup on unmount
  useEffect(() => cleanupBlobUrl, [cleanupBlobUrl]);

  /** Fetch and render an attachment using an explicitly chosen viewer. */
  const performView = useCallback(
    async (att: Attachment, viewer: AttachmentViewerType) => {
      setSelectedId(att.id);
      setViewContent(null);
      setViewRawBase64(null);
      setViewDicomBlob(null);
      setViewMode(null);
      setViewError(null);
      setDecodeBase64(true);
      cleanupBlobUrl();
      setViewLoading(true);
      try {
        const full = await getAttachment(channelId, messageId, att.id);
        if (!full.content) {
          setViewError("Attachment has no content.");
          return;
        }

        if (viewer === "dicom") {
          // Use the dedicated DICOM message endpoint which reassembles the complete
          // Part-10 DICOM file (128-byte preamble + "DICM" header + metadata +
          // pixel data).  The standard attachment endpoint only stores the raw
          // pixel-data blob — no DICOM headers — so dwv cannot parse it correctly
          // and reports "Invalid DICM prefix".  Mirrors Java getDICOMMessage().
          let dicomBuf: ArrayBuffer;
          try {
            const b64 = await getDicomMessage(channelId, messageId);
            // Route through decodeDicomAttachment which handles whitespace stripping,
            // single/double base64 detection, DICM magic checking, and dev logging.
            dicomBuf = decodeDicomAttachment(b64);
          } catch {
            // Fallback: use the attachment pixel-data blob directly.
            // This won't have DICM headers so the viewer will likely show a blank
            // canvas, but it's better than throwing an unhandled error.
            dicomBuf = decodeDicomAttachment(full.content);
          }
          setViewDicomBlob(new Blob([dicomBuf], { type: "application/dicom" }));
          setViewMode("dicom");
          return;
        }
        if (viewer === "pdf") {
          // Security: never trust full.type for the blob MIME. Hard-code
          // application/pdf so a text/html payload can't be interpreted as HTML and
          // executed in the (blob-URL, same-origin) preview iframe.
          const blob = new Blob([decodeAttachmentContent(full.content)], {
            type: "application/pdf",
          });
          setViewBlobUrl(URL.createObjectURL(blob));
          setViewMode("pdf");
          return;
        }
        if (viewer === "image") {
          // Security: only render images whose MIME is on the allowlist,
          // using the normalized canonical type for the blob rather than full.type.
          const imgType = normalizeImageMime(full.type);
          if (imgType) {
            const blob = new Blob([decodeAttachmentContent(full.content)], { type: imgType });
            setViewBlobUrl(URL.createObjectURL(blob));
            setViewMode("image");
            return;
          }
          // Non-allowlisted image MIME (SVG, spoofed text/html, …) — fall through to
          // the text viewer so the raw content is still inspectable without an
          // HTML-capable render surface.
        }

        // Text viewer: keep both the decoded text and the raw stored base64 so the
        // "Decode Base64 Data" toggle can switch between them (mirrors Java TextViewer).
        const text = attachmentToText(full.content);
        setViewRawBase64(full.content);
        setViewContent(text);
        // Default to the decoded view when the content decodes to text; otherwise show
        // the raw base64 (so wrong-MIME / binary content can still be inspected).
        setDecodeBase64(text !== null);
        setViewMode("text");
      } catch (err) {
        setViewError(err instanceof Error ? err.message : "Failed to load attachment content.");
      } finally {
        setViewLoading(false);
      }
    },
    [channelId, messageId, cleanupBlobUrl]
  );

  /**
   * Open an attachment. Toggles the viewer off if it's already showing. Otherwise,
   * when the Administrator "attachment type dialog" setting is on, prompts for the
   * viewer; when off, picks the viewer from the MIME type.
   */
  const openAttachment = useCallback(
    (att: Attachment) => {
      if (selectedId === att.id) {
        closeViewer();
        return;
      }
      if (loadAdminPrefs().messageBrowserShowAttachmentTypeDialog) {
        setPickerAtt(att);
      } else {
        performView(att, mimeToViewer(att.type));
      }
    },
    [selectedId, closeViewer, performView]
  );

  const handleDownload = useCallback(
    async (row: AttachmentDisplayRow) => {
      setDownloadingId(row.key);
      try {
        if (row.isGroup) {
          // Collapsed DICOM group: download the reassembled Part-10 file (the same
          // bytes the DICOM viewer renders) rather than a single pixel-data blob.
          const b64 = await getDicomMessage(channelId, messageId);
          const buf = decodeDicomAttachment(b64);
          downloadBlob(
            new Blob([buf], { type: "application/dicom" }),
            `dicom-message-${messageId}.dcm`
          );
          return;
        }
        const att = row.attachments[0];
        const full = await getAttachment(channelId, messageId, att.id);
        if (!full.content) return;
        const ext = guessExtension(full.type);
        const filename = `attachment-${att.id}${ext}`;
        downloadAttachment(full.content, filename, full.type);
      } catch {
        // Silently fail download — could add toast later
      } finally {
        setDownloadingId(null);
      }
    },
    [channelId, messageId]
  );

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-full" />
        ))}
      </div>
    );
  }

  if (attachments.length === 0) {
    return <div className="p-4 text-sm text-gray-400">No attachments.</div>;
  }

  // Text-viewer display value honors the "Decode Base64 Data" toggle: decoded text
  // when on, the raw stored base64 string when off.
  const textValue = decodeBase64 ? (viewContent ?? "") : (viewRawBase64 ?? "");
  const viewLanguage = decodeBase64 && viewContent ? detectLanguage(viewContent) : "plaintext";

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Attachment list table */}
      <div className={`${selectedId ? "shrink-0 max-h-40" : "flex-1"} overflow-hidden flex`}>
        <DataTable<AttachmentDisplayRow, AttachmentCol>
          variant="sortable"
          cols={ATTACHMENT_COLS}
          rows={attachmentSortState.sorted(buildAttachmentRows(attachments), (row) => {
            switch (attachmentSortState.sort.key) {
              case "num":
                return row.sortIndex;
              case "type":
                return row.type;
              case "id":
                return row.idLabel;
              default:
                return undefined;
            }
          })}
          colConfig={attachmentColConfig}
          sortState={attachmentSortState}
          rowKey={(row) => row.key}
          selectedRowId={selectedId}
          onRowDoubleClick={(row) => openAttachment(row.attachments[0])}
          cellMono={{ id: true }}
          empty="No attachments."
          containerClassName="flex-1 min-h-0"
          renderCell={(row, col) => {
            if (col === "num") return row.numLabel;
            if (col === "type") return row.type;
            if (col === "id") return row.idLabel;
            const selected = selectedId === row.key;
            return (
              <>
                <button
                  onClick={() => openAttachment(row.attachments[0])}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors mr-1 ${
                    selected
                      ? "bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300"
                  }`}
                  title="View attachment content"
                >
                  {selected ? "Hide" : "View"}
                </button>
                <button
                  onClick={() => handleDownload(row)}
                  disabled={downloadingId === row.key}
                  className="px-2 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900/40 hover:text-green-700 dark:hover:text-green-300 transition-colors disabled:opacity-50"
                  title={row.isGroup ? "Download reassembled DICOM file" : "Download attachment"}
                >
                  {downloadingId === row.key ? "…" : "Download"}
                </button>
              </>
            );
          }}
        />
      </div>

      {/* Inline content viewer */}
      {selectedId && (
        <div className="flex-1 border-t border-border flex flex-col overflow-hidden min-h-0">
          <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-border text-xs text-gray-500 dark:text-gray-400 shrink-0 flex items-center justify-between gap-2">
            <span className="truncate">
              Attachment:{" "}
              <span className="font-mono text-gray-700 dark:text-gray-300">{selectedId}</span>
            </span>
            <div className="flex items-center gap-3 shrink-0">
              {viewMode === "text" && (
                <FormCheckbox
                  label="Decode Base64 Data"
                  checked={decodeBase64}
                  onChange={setDecodeBase64}
                  disabled={viewContent === null}
                  size="xs"
                />
              )}
              <button
                onClick={closeViewer}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm leading-none px-1"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>
          {viewLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          ) : viewError ? (
            <div className="p-4 text-xs text-gray-500">{viewError}</div>
          ) : viewMode === "pdf" && viewBlobUrl ? (
            <iframe
              src={viewBlobUrl}
              // Defense-in-depth: fully sandboxed — no allow-scripts, so even a
              // mis-typed blob can't execute script. A blob PDF still renders via the
              // browser's built-in PDF plugin without scripting.
              sandbox=""
              className="flex-1 w-full border-0"
              title="PDF attachment preview"
            />
          ) : viewMode === "image" && viewBlobUrl ? (
            <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewBlobUrl}
                alt="Attachment preview"
                className="max-w-full max-h-full object-contain rounded shadow-sm"
              />
            </div>
          ) : viewMode === "dicom" && viewDicomBlob ? (
            <div className="flex-1 overflow-hidden min-h-[300px]">
              <DicomViewer blob={viewDicomBlob} />
            </div>
          ) : viewMode === "text" ? (
            <AttachmentViewerHost
              attachment={
                attachments.find((a) => a.id === selectedId) ?? { id: selectedId ?? "", type: "" }
              }
              channelId={channelId}
              messageId={messageId}
              fallback={
                <div className="bl-msg-editor flex-1 overflow-hidden">
                  <Editor
                    value={textValue}
                    language={viewLanguage}
                    theme={
                      viewLanguage === "hl7v2" ? hl7v2Theme(isDark) : isDark ? "vs-dark" : "vs"
                    }
                    beforeMount={registerHl7v2Language}
                    options={{
                      ...MONACO_BASE_OPTIONS,
                      readOnly: true,
                      fontSize: 12,
                      wordWrap: wordWrap ? "on" : "off",
                      wrappingIndent: "same",
                      renderLineHighlight: "none",
                      overviewRulerLanes: 0,
                      hideCursorInOverviewRuler: true,
                      overviewRulerBorder: false,
                      scrollbar: {
                        vertical: "auto",
                        horizontal: "auto",
                        verticalScrollbarSize: 8,
                        horizontalScrollbarSize: 8,
                      },
                      padding: { top: 8, bottom: 8 },
                      folding: true,
                      // Gutter gap so line numbers read as a gutter, not content.
                      lineDecorationsWidth: 6,
                      lineNumbersMinChars: 3,
                      glyphMargin: false,
                      contextmenu: false,
                      domReadOnly: true,
                    }}
                    loading={<div className="p-4 text-xs text-gray-400">Loading editor…</div>}
                  />
                </div>
              }
            />
          ) : null}
        </div>
      )}

      {/* Viewer-type picker (shown only when the Administrator setting is on) */}
      {pickerAtt && (
        <AttachmentTypeDialog
          key={pickerAtt.id}
          open
          contentType={pickerAtt.type}
          onConfirm={(viewer) => {
            const att = pickerAtt;
            setPickerAtt(null);
            performView(att, viewer);
          }}
          onCancel={() => setPickerAtt(null)}
        />
      )}
    </div>
  );
}
