/**
 * Pure helper functions for the Channels page.
 * Extracted from channels/page.tsx for readability.
 */

import type { Channel, ChannelGroup, DashboardStatus } from "@/lib/types";
import type { ChannelMetadata } from "@/lib/cache-store";
import type { ChanCol } from "./channel-columns";

/** Channel extended with dashboard status fields for display. */
export interface EnrichedChannel extends Channel {
  deployedState?: string;
  deployedDate?: string;
  received?: number;
  errored?: number;
}

/** Lookups the channel sort accessor needs that aren't on the channel object. */
export interface ChannelSortContext {
  metadataMap: Record<string, ChannelMetadata>;
  revisionDeltas: Map<string, number>;
  localIds: Map<string, number>;
  portMap: Map<string, string>;
}

/**
 * Returns the comparable value for a channel under the given sort column.
 * Mirrors the cell rendering in channel-row.tsx. Extracted from page.tsx to keep
 * that file under the max-lines budget; pure so it can be unit-tested directly.
 */
export function channelSortValue(
  ch: EnrichedChannel,
  key: ChanCol,
  ctx: ChannelSortContext
): string | number {
  switch (key) {
    case "status":
      return isChannelEnabled(ch, ctx.metadataMap) ? "enabled" : "disabled";
    case "name":
      return ch.name;
    case "id":
      return ch.id;
    case "localChannelId":
      // Undeployed channels have no local id; sort them to the numeric high-end
      // (matches the pruneMetaData/pruneContent blanks-last convention below).
      return ctx.localIds.get(ch.id) ?? Infinity;
    case "description":
      return ch.description ?? "";
    case "sourceType":
      return ch.sourceConnector?.transportName ?? "";
    case "dataType":
      return channelDataType(ch);
    case "dests":
      return ch.destinationConnectors?.length ?? 0;
    case "lastModified":
      return channelLastModified(ch, ctx.metadataMap) ?? "";
    case "revDelta":
      return ctx.revisionDeltas.get(ch.id) ?? 0;
    case "lastDeployed":
      return ch.deployedDate ?? "";
    case "port":
      return ctx.portMap.get(ch.id) ?? "";
    case "received":
      return ch.received ?? 0;
    case "errored":
      return ch.errored ?? 0;
    case "pruneMetaData":
      return ctx.metadataMap[ch.id]?.pruningSettings?.pruneMetaDataDays ?? Infinity;
    case "pruneContent":
      return ctx.metadataMap[ch.id]?.pruningSettings?.pruneContentDays ?? Infinity;
    case "archive":
      return ctx.metadataMap[ch.id]?.pruningSettings?.archiveEnabled ? 0 : 1;
    default:
      return ch.name;
  }
}

export function buildStatusMap(statuses: DashboardStatus[]): Map<string, DashboardStatus> {
  const map = new Map<string, DashboardStatus>();
  for (const s of statuses) map.set(s.channelId, s);
  return map;
}

export function statVal(s: DashboardStatus["statistics"] | undefined, key: string): number {
  if (!s) return 0;
  const upper = key.toUpperCase() as keyof typeof s;
  const lower = key.toLowerCase() as keyof typeof s;
  return (s[upper] ?? s[lower] ?? 0) as number;
}

/**
 * Returns the channels that belong to a group, in the **display** order determined by
 * the caller-supplied `channels` array (which reflects the current sort/filter state).
 * Used for rendering table rows.
 */
export function channelsInGroup(
  group: ChannelGroup,
  channels: EnrichedChannel[]
): EnrichedChannel[] {
  const ids = new Set((group.channels ?? []).map((c) => c.id));
  return channels.filter((ch) => ids.has(ch.id));
}

/**
 * Returns the channels that belong to a group in the **server-defined storage order**
 * (i.e. the order of `group.channels` as returned by GET /channelgroups).
 *
 * Mirrors the Java UI's handleExportGroups logic:
 *   for (Channel channel : group.getChannels()) {
 *       ChannelStatus status = channelStatuses.get(channel.getId());
 *       if (status != null) channels.add(status.getChannel());
 *   }
 * Used for export so the resulting XML matches what the Java UI produces.
 */
export function channelsInGroupServerOrder(
  group: ChannelGroup,
  channelMap: Map<string, EnrichedChannel>
): EnrichedChannel[] {
  return (group.channels ?? [])
    .map((stub) => channelMap.get(stub.id))
    .filter((ch): ch is EnrichedChannel => ch !== undefined);
}

/**
 * The enabled flag lives in server-side ChannelMetadata (GET /server/channelMetadata),
 * not in the Channel object itself. The Java client mirrors this via updateChannelMetadata()
 * which sets channel.getExportData().setMetadata(metadataMap.get(channel.getId())).
 * We read it directly from the metadata map returned by that endpoint.
 */
export function isChannelEnabled(
  ch: Channel,
  metadataMap: Record<string, ChannelMetadata>
): boolean {
  return metadataMap[ch.id]?.enabled ?? false;
}

/**
 * Last-modified date for a channel comes from GET /server/channelMetadata, not from
 * the Channel object (the server strips exportData before returning channels via _getSummary).
 * After normalizeXStream, ChannelMetadata.lastModified is an ISO string.
 */
export function channelLastModified(
  ch: Channel,
  metadataMap: Record<string, ChannelMetadata>
): string | undefined {
  return metadataMap[ch.id]?.lastModified;
}

/**
 * Map from BridgeLink internal data type keys to human-readable display names.
 * Mirrors Java's PlatformUI.MIRTH_FRAME.dataTypeToDisplayName map populated
 * from the loaded data type plugins.
 */
const DATA_TYPE_DISPLAY: Record<string, string> = {
  HL7V2: "HL7 v2.x",
  HL7V3: "HL7 v3.x",
  XML: "XML",
  JSON: "JSON",
  RAW: "Raw",
  DELIMITED: "Delimited Text",
  DICOM: "DICOM",
  // The EDI data type's registered key (EDIDataTypeDelegate.getDataType()) is the
  // literal "EDI/X12" — that string is what lands in channel.inboundDataType — so
  // the map key must match it (not "EDI"). Java's display name adds spaces.
  "EDI/X12": "EDI / X12",
  FHIR: "FHIR",
  NCPDP: "NCPDP",
};

/**
 * Extract the source inbound data type from channel.sourceConnector.transformer.inboundDataType.
 * Mirrors Java: channel.getSourceConnector().getTransformer().getInboundDataType()
 * Falls back to display name lookup; returns the raw key if no mapping exists.
 */
export function channelDataType(ch: Channel): string {
  const key = ch.sourceConnector?.transformer?.inboundDataType;
  if (key) {
    return DATA_TYPE_DISPLAY[key.toUpperCase()] ?? key;
  }
  const props = ch.sourceConnector?.properties as Record<string, unknown> | undefined;
  if (props) {
    const raw = props["dataTypeKey"] ?? props["inboundDataType"] ?? props["dataType"];
    if (raw) {
      const s = String(raw).toUpperCase();
      return DATA_TYPE_DISPLAY[s] ?? String(raw);
    }
  }
  return "\u2014";
}
