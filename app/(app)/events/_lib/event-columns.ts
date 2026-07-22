import { format } from "date-fns";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ServerEvent } from "@/lib/types";
import { loadAdminPrefs } from "@/components/settings/admin-tab";

/** localStorage key for the user's local Events-browser page-size override. */
export const LOCAL_STORAGE_EVENT_PAGE_SIZE_KEY = "bl-events-page-size";

/**
 * Resolve the Events-browser page size: a per-user localStorage override if set
 * (1–999, matching Java EventBrowser's 3-digit page-size field), otherwise the
 * global "Event browser page size" Administrator setting.
 * Mirrors the Messages browser's getStoredPageSize.
 */
export function getStoredEventPageSize(): number {
  if (typeof window === "undefined") return loadAdminPrefs().eventBrowserPageSize;
  const stored = localStorage.getItem(LOCAL_STORAGE_EVENT_PAGE_SIZE_KEY);
  if (stored) {
    const n = Number(stored);
    if (n > 0 && n <= 999) return n;
  }
  return loadAdminPrefs().eventBrowserPageSize;
}

export type EventCol =
  | "level"
  | "dateTime"
  | "name"
  | "serverId"
  | "user"
  | "outcome"
  | "ipAddress"
  | "channelMessageId"
  | "channelName"
  | "patientId";

export const EVENT_COLS: ColDef<EventCol>[] = [
  {
    key: "level",
    label: "Level",
    defaultWidth: 110,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "dateTime",
    label: "Date & Time",
    defaultWidth: 160,
    minWidth: 120,
    defaultVisible: true,
    canHide: false,
    align: "left",
  },
  {
    key: "name",
    label: "Name",
    defaultWidth: 240,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "serverId",
    label: "Server ID",
    defaultWidth: 290,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "user",
    label: "User",
    defaultWidth: 140,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "outcome",
    label: "Outcome",
    defaultWidth: 95,
    minWidth: 70,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "ipAddress",
    label: "IP Address",
    defaultWidth: 150,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "channelMessageId",
    label: "Channel ID - Message ID",
    defaultWidth: 260,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "channelName",
    label: "Channel Name",
    defaultWidth: 180,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
  {
    key: "patientId",
    label: "Patient ID",
    defaultWidth: 140,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
];

/**
 * channelId, channelName, messageId, and patientId are computed lazily from the
 * `attributes` map in Java and are never stored as top-level fields before XStream
 * serializes the object. The REST response only carries them inside `attributes`.
 *
 * channel attribute format: "[id=<uuid>, name=<channelName>]"
 * (mirrors ServerEvent.java getChannelId / getChannelName / getMessageId / getPatientId)
 */

export function getEventChannelId(ev: ServerEvent): string | null {
  const channel = ev.attributes?.["channel"]?.trim() ?? null;
  if (!channel?.includes("id")) return null;
  try {
    return channel.substring(channel.indexOf("id=") + 3, channel.indexOf(","));
  } catch {
    return null;
  }
}

export function getEventChannelName(ev: ServerEvent): string | null {
  const channel = ev.attributes?.["channel"] ?? null;
  if (!channel?.includes("name")) return null;
  try {
    return channel.substring(channel.indexOf("name=") + 5, channel.indexOf("]"));
  } catch {
    return null;
  }
}

export function getEventMessageId(ev: ServerEvent): string | null {
  return ev.attributes?.["messageId"]?.trim() ?? null;
}

export function getEventPatientId(ev: ServerEvent): string | null {
  return ev.attributes?.["patientId"]?.trim() ?? null;
}

/** Mirrors ServerEvent.getChannelIdWithMessageId() */
export function getEventChannelIdWithMessageId(ev: ServerEvent): string | null {
  const channelId = getEventChannelId(ev);
  if (!channelId) return null;
  const messageId = getEventMessageId(ev);
  return messageId ? `${channelId} - ${messageId}` : channelId;
}

/**
 * Format the event date/time.
 * The server returns `eventTime` as an XStream Calendar (normalized to ISO string by
 * normalizeXStream), and `dateTime` as a raw epoch-millis number.
 */
export function formatEventTime(ev: ServerEvent): string {
  const t = ev.eventTime;
  if (t) {
    try {
      return format(new Date(t), "yyyy-MM-dd HH:mm:ss.SSS");
    } catch {
      /* fall through */
    }
  }
  if (ev.dateTime) {
    try {
      return format(new Date(ev.dateTime), "yyyy-MM-dd HH:mm:ss.SSS");
    } catch {
      /* fall through */
    }
  }
  return "—";
}
