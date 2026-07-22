import type { Channel } from "@/lib/types";
import type { ChannelMetadata } from "@/lib/cache-store";
import type { ColDef } from "@/lib/hooks/use-column-config";
import { format } from "date-fns";
import { downloadCsv } from "@/lib/download";
import type { ChanCol } from "./channel-columns";

// ─── Enriched channel type (matches page.tsx) ────────────────────────────────

interface EnrichedChannel extends Channel {
  deployedState?: string;
  deployedDate?: string;
  received?: number;
  errored?: number;
}

// ─── Data-type display map (mirrors page.tsx) ────────────────────────────────

const DATA_TYPE_DISPLAY: Record<string, string> = {
  HL7V2: "HL7 v2.x",
  HL7V3: "HL7 v3.x",
  XML: "XML",
  JSON: "JSON",
  RAW: "Raw",
  DELIMITED: "Delimited Text",
  DICOM: "DICOM",
  // Key matches EDIDataTypeDelegate.getDataType() ("EDI/X12"); display adds spaces.
  "EDI/X12": "EDI / X12",
  FHIR: "FHIR",
  NCPDP: "NCPDP",
};

// ─── Options for cell text extraction ────────────────────────────────────────

export interface ChanCsvOpts {
  metadataMap: Record<string, ChannelMetadata>;
  revisionDeltas: Map<string, number>;
  codeTemplatesChanged: Map<string, boolean>;
  localIds: Map<string, number>;
  portMap: Map<string, string>;
}

// ─── Helpers (mirrors page.tsx helpers) ──────────────────────────────────────

function isChannelEnabled(ch: Channel, meta: Record<string, ChannelMetadata>): boolean {
  return meta[ch.id]?.enabled ?? false;
}

function channelLastModified(
  ch: Channel,
  meta: Record<string, ChannelMetadata>
): string | undefined {
  return meta[ch.id]?.lastModified;
}

function channelDataType(ch: Channel): string {
  const key = ch.sourceConnector?.transformer?.inboundDataType;
  if (key) return DATA_TYPE_DISPLAY[key.toUpperCase()] ?? key;
  const props = ch.sourceConnector?.properties as Record<string, unknown> | undefined;
  if (props) {
    const raw = props["dataTypeKey"] ?? props["inboundDataType"] ?? props["dataType"];
    if (raw) return DATA_TYPE_DISPLAY[String(raw).toUpperCase()] ?? String(raw);
  }
  return "";
}

// ─── Cell text extraction (mirrors ChannelRow cell rendering) ────────────────

export function getChanCellText(col: ChanCol, ch: EnrichedChannel, opts: ChanCsvOpts): string {
  switch (col) {
    case "status":
      return isChannelEnabled(ch, opts.metadataMap) ? "Enabled" : "Disabled";
    case "name":
      return ch.name;
    case "id":
      return ch.id;
    case "localChannelId": {
      const lid = opts.localIds.get(ch.id);
      return lid != null ? String(lid) : "";
    }
    case "description":
      return ch.description ?? "";
    case "sourceType":
      return ch.sourceConnector?.transportName ?? "";
    case "dataType":
      return channelDataType(ch);
    case "dests":
      return String(ch.destinationConnectors?.length ?? 0);
    case "lastModified": {
      const lm = channelLastModified(ch, opts.metadataMap);
      return lm ? format(new Date(lm), "yyyy-MM-dd HH:mm") : "";
    }
    case "revDelta": {
      const delta = opts.revisionDeltas.get(ch.id);
      return delta != null ? String(delta) : "";
    }
    case "lastDeployed":
      return ch.deployedDate ? format(new Date(ch.deployedDate), "yyyy-MM-dd HH:mm") : "";
    case "port": {
      const port = opts.portMap.get(ch.id);
      return port != null ? String(port) : "";
    }
    case "received":
      return ch.received != null ? String(ch.received) : "";
    case "errored":
      return ch.errored != null ? String(ch.errored) : "";
    case "pruneMetaData": {
      const days = opts.metadataMap[ch.id]?.pruningSettings?.pruneMetaDataDays;
      return days != null ? `${days}d` : "";
    }
    case "pruneContent": {
      const days = opts.metadataMap[ch.id]?.pruningSettings?.pruneContentDays;
      return days != null ? `${days}d` : "";
    }
    case "archive": {
      const ps = opts.metadataMap[ch.id]?.pruningSettings;
      if (ps == null) return "";
      return ps.archiveEnabled ? "Yes" : "No";
    }
    default:
      return "";
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** Export the channels table as CSV. */
export function exportChannelsCsv(
  visibleCols: ColDef<ChanCol>[],
  channels: EnrichedChannel[],
  opts: ChanCsvOpts
): void {
  const headers = visibleCols.map((c) => c.label);
  const rows = channels.map((ch) => visibleCols.map((c) => getChanCellText(c.key, ch, opts)));
  downloadCsv("bridgelink-channels", headers, rows);
}
