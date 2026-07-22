/**
 * Column type and definitions for the Channels table.
 * Shared by page.tsx, group-row.tsx, and channel-row.tsx.
 */

import type { ColDef } from "@/lib/hooks/use-column-config";

export type ChanCol =
  | "status"
  | "name"
  | "id"
  | "localChannelId"
  | "description"
  | "sourceType"
  | "dataType"
  | "dests"
  | "lastModified"
  | "revDelta"
  | "lastDeployed"
  | "port"
  | "received"
  | "errored"
  | "pruneMetaData"
  | "pruneContent"
  | "archive";

export const CHAN_COLS: ColDef<ChanCol>[] = [
  {
    key: "status",
    label: "Status",
    tooltip:
      "The status of this channel. Possible values are enabled and disabled. Only enabled channels can be deployed.",
    defaultWidth: 110,
    compactWidth: 82,
    tightWidth: 70,
    minWidth: 110,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "name",
    label: "Name",
    tooltip: "The name of this channel.",
    defaultWidth: 300,
    minWidth: 60,
    defaultVisible: true,
    canHide: false,
    align: "left",
    flexible: true,
  },
  {
    key: "id",
    label: "ID",
    tooltip: "The unique id of this channel.",
    defaultWidth: 310,
    tightWidth: 270,
    minWidth: 270,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    // Numeric local channel id (used in message-table names). Mirrors Java's
    // LOCAL_CHANNEL_ID column: fixed-width, center-aligned NumberCellRenderer.
    // Sourced from ChannelStatus.localChannelId via _getSummary. Default-hidden.
    key: "localChannelId",
    label: "Local Id",
    tooltip: "The local id of this channel used as part of the names for the message tables.",
    defaultWidth: 70,
    tightWidth: 60,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
    align: "center",
    resizable: false,
  },
  {
    // Channel description. Mirrors Java's DESCRIPTION column (text, min-width only).
    // Default-hidden in the WebUI to keep the already-wide table uncrowded.
    key: "description",
    label: "Description",
    tooltip: "The description of this channel.",
    defaultWidth: 240,
    minWidth: 80,
    defaultVisible: false,
    canHide: true,
    align: "left",
  },
  {
    key: "sourceType",
    label: "Source Type",
    defaultWidth: 130,
    compactWidth: 120,
    tightWidth: 104,
    minWidth: 130,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "dataType",
    label: "Data Type",
    tooltip: "The inbound data type of this channel's source connector.",
    defaultWidth: 120,
    compactWidth: 106,
    tightWidth: 90,
    minWidth: 120,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "dests",
    label: "Dests",
    defaultWidth: 85,
    compactWidth: 78,
    tightWidth: 64,
    minWidth: 85,
    defaultVisible: true,
    canHide: true,
    align: "center",
    resizable: false,
  },
  {
    key: "lastModified",
    label: "Last Modified",
    tooltip: "The time this channel was last modified.",
    defaultWidth: 150,
    compactWidth: 140,
    tightWidth: 124,
    minWidth: 150,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "revDelta",
    label: "Rev Δ",
    tooltip:
      "The number of times this channel was saved since it was deployed. Rev Δ = Channel Revision − Deployed Revision. This value will be highlighted if it is greater than 0, or if any code templates linked to this channel have changed.",
    defaultWidth: 90,
    compactWidth: 72,
    tightWidth: 66,
    minWidth: 90,
    defaultVisible: true,
    canHide: true,
    align: "center",
    resizable: false,
  },
  {
    key: "lastDeployed",
    label: "Last Deployed",
    tooltip:
      "The time this channel was last deployed. This value will be highlighted if it is within the last two minutes.",
    defaultWidth: 150,
    compactWidth: 140,
    tightWidth: 124,
    minWidth: 150,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "port",
    label: "Port",
    defaultWidth: 70,
    compactWidth: 65,
    tightWidth: 54,
    minWidth: 70,
    defaultVisible: false,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "received",
    label: "Received",
    defaultWidth: 110,
    compactWidth: 96,
    minWidth: 70,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "errored",
    label: "Errored",
    defaultWidth: 100,
    compactWidth: 90,
    minWidth: 70,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "pruneMetaData",
    label: "Prune Meta",
    defaultWidth: 100,
    tightWidth: 84,
    minWidth: 75,
    defaultVisible: false,
    canHide: true,
    align: "right",
  },
  {
    key: "pruneContent",
    label: "Prune Content",
    defaultWidth: 110,
    tightWidth: 90,
    minWidth: 75,
    defaultVisible: false,
    canHide: true,
    align: "right",
  },
  {
    key: "archive",
    label: "Archive",
    defaultWidth: 80,
    tightWidth: 66,
    minWidth: 65,
    defaultVisible: false,
    canHide: true,
    align: "center",
  },
];

/** Mirrors Java's ChannelGroup default ID constant. */
export const DEFAULT_GROUP_ID = "Default Group";
