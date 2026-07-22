import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ConnectorMessage, Message } from "@/lib/types";
import type { AdvancedFilterState } from "@/components/messages/advanced-filter-panel";
import { loadAdminPrefs } from "@/components/settings/admin-tab";

// ─── Column Definitions (mirrors Java MessageBrowser column order) ──────────
// MsgCol is now `string` (not a union) because dynamic metadata columns are
// added at runtime.  Static column keys are kept as literal strings for readability.

export type MsgCol = string;

/** Metadata column keys are prefixed with "meta:" to avoid collisions with standard keys. */
export const META_COL_PREFIX = "meta:";

export const LOCAL_STORAGE_PAGE_SIZE_KEY = "bl-msg-page-size";

export function getStoredPageSize(): number {
  if (typeof window === "undefined") return 20;
  const stored = localStorage.getItem(LOCAL_STORAGE_PAGE_SIZE_KEY);
  if (stored) {
    const n = Number(stored);
    if (n > 0 && n <= 500) return n;
  }
  // Fall back to the admin preference, then the hard-coded default
  return loadAdminPrefs().messageBrowserPageSize;
}

/** Viewer layout (side-by-side vs top/bottom) — persisted across sessions per. */
export const LOCAL_STORAGE_VIEWER_LAYOUT_KEY = "bl-messages-viewer-layout";

export function getStoredViewerLayout(): "right" | "bottom" {
  if (typeof window === "undefined") return "right";
  const v = localStorage.getItem(LOCAL_STORAGE_VIEWER_LAYOUT_KEY);
  return v === "bottom" || v === "right" ? v : "right";
}

export const MESSAGE_STATUSES = [
  "RECEIVED",
  "TRANSFORMED",
  "FILTERED",
  "QUEUED",
  "SENT",
  "ERROR",
  "PENDING",
] as const;

export const STATIC_MSG_COLS: ColDef<MsgCol>[] = [
  {
    key: "id",
    label: "Id",
    tooltip: "The message id.",
    defaultWidth: 70,
    minWidth: 50,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "connector",
    label: "Connector",
    tooltip: "The historic name of the connector at the time the message was processed.",
    defaultWidth: 130,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "status",
    label: "Status",
    tooltip: "The message status after being processed by the connector.",
    defaultWidth: 100,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "origReceivedDate",
    label: "Orig. Received Date",
    tooltip:
      "The date and time the original message was received. This value is not updated when the message is reprocessed.",
    defaultWidth: 175,
    minWidth: 100,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "receivedDate",
    label: "Received Date",
    tooltip: "The date and time the message began processing through the connector.",
    defaultWidth: 175,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "sendAttempts",
    label: "Send Attempts",
    tooltip:
      "Source Connector: The number of times the connector attempted to send the response back to the point of origin. Destination Connector: The number of times the connector attempted to send the message to its recipient.",
    defaultWidth: 90,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
    align: "right",
  },
  {
    key: "sendDate",
    label: "Send Date",
    tooltip:
      "Source Connector: N/A. Destination Connector: The date and time immediately before the most recent send attempt.",
    defaultWidth: 175,
    minWidth: 100,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "responseDate",
    label: "Response Date",
    tooltip:
      "Source Connector: The date and time immediately before the connector attempted to send the response back to the point of origin. Destination Connector: The date and time immediately after the server receives a response from the connector, which may be empty.",
    defaultWidth: 175,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "errors",
    label: "Errors",
    tooltip:
      "Indicates whether an error exists for this message. It is possible for a message to have errors even if the message status is not ERROR.",
    defaultWidth: 70,
    minWidth: 50,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "serverId",
    label: "Server Id",
    tooltip: "The id of the server that processed the message through the connector.",
    defaultWidth: 120,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "origServerId",
    label: "Original Server Id",
    tooltip: "The id of the server that received the message.",
    defaultWidth: 120,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "origId",
    label: "Original Id",
    tooltip:
      "The original message id of a reprocessed message. This value only exists for reprocessed messages.",
    defaultWidth: 80,
    minWidth: 50,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "importId",
    label: "Import Id",
    tooltip:
      "The original message id of an imported message. This value only exists for imported messages.",
    defaultWidth: 80,
    minWidth: 50,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "importChannelId",
    label: "Import Channel Id",
    tooltip:
      "The original channel id of an imported message. This value only exists for messages imported from a different channel.",
    defaultWidth: 120,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
  },
  {
    key: "channelName",
    label: "Channel Name",
    tooltip: "The channel name of the channel that the message was passed through.",
    defaultWidth: 150,
    minWidth: 80,
    defaultVisible: false,
    canHide: true,
  },
];

/** Get the cell value for a column key from a ConnectorMessage + its parent Message. */
export function getCellValue(
  col: MsgCol,
  cm: ConnectorMessage,
  msg: Message
): string | number | undefined {
  // Dynamic metadata columns: key is "meta:<columnName>"
  if (col.startsWith(META_COL_PREFIX)) {
    const colName = col.slice(META_COL_PREFIX.length);
    // The metadata map is upper-case-keyed (mirrors Java
    // MessageBrowserTableNode#getMetaDataMap().get(columnName.toUpperCase())).
    const val = cm.metaDataMap?.[colName.toUpperCase()];
    if (val === null || val === undefined) return undefined;
    return String(val);
  }

  // Source-only fields are populated only on the source connector (metaDataId == 0);
  // destination child rows show blank — mirrors MessageBrowserTableNode.java:68-72.
  const isSource = cm.metaDataId === 0;

  switch (col) {
    case "id":
      return msg.messageId;
    case "connector":
      return cm.connectorName;
    case "status":
      return cm.status;
    case "origReceivedDate":
      // Java uses the message received date, not the connector field.
      return msg.receivedDate;
    case "receivedDate":
      return cm.receivedDate;
    case "sendAttempts":
      return cm.sendAttempts;
    case "sendDate":
      return cm.sendDate;
    case "responseDate":
      return cm.responseDate;
    case "errors":
      return getErrorString(cm.errorCode);
    case "serverId":
      return cm.serverId ?? msg.serverId;
    case "origServerId":
      // Java uses the message server id, not the connector field.
      return msg.serverId;
    case "origId":
      return isSource ? (cm.originalId ?? msg.originalId) : undefined;
    case "importId":
      return isSource ? (cm.importId ?? msg.importId) : undefined;
    case "importChannelId":
      return isSource ? (cm.importChannelId ?? msg.importChannelId) : undefined;
    case "channelName":
      return isSource ? (cm.channelName ?? msg.channelName) : undefined;
  }
}

/**
 * Map the connector error bitmask to the Java client's word
 * (mirrors MessageBrowserTableNode#getErrorString): a single error → its word,
 * more than one → "Multiple", none → undefined (blank).
 *
 * Bit values mirror donkey ContentType: 1 = Processing, 2 = Postprocessor,
 * 4 = Response.
 */
export function getErrorString(errorCode?: number): string | undefined {
  if (!errorCode) return undefined;
  const words: string[] = [];
  if (errorCode & 1) words.push("Processing");
  if (errorCode & 2) words.push("Postprocessor");
  if (errorCode & 4) words.push("Response");
  if (words.length === 0) return undefined;
  return words.length === 1 ? words[0] : "Multiple";
}

/** Check if advanced filter has any active criteria */
export function hasAdvancedCriteria(state: AdvancedFilterState): boolean {
  return (
    state.selectedConnectors !== null ||
    state.minMessageId !== "" ||
    state.maxMessageId !== "" ||
    state.originalIdLower !== "" ||
    state.originalIdUpper !== "" ||
    state.importIdLower !== "" ||
    state.importIdUpper !== "" ||
    state.serverId.trim() !== "" ||
    state.sendAttemptsLower !== "" ||
    state.sendAttemptsUpper !== "" ||
    state.hasAttachment ||
    state.hasError ||
    state.contentSearchRows.length > 0 ||
    state.metaDataSearchRows.length > 0
  );
}
