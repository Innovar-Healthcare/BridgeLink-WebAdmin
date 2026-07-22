import type { DashboardStatus, ChannelStatistics } from "@/lib/types";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import type { ConnectorStateMap } from "@/lib/api/api-dashboard";
import type { TrendEntry } from "./trend-utils";
import type { DashCol } from "../_components/dashboard-row";
import { stat } from "../_components/dashboard-row";
import { format } from "date-fns";
import { downloadCsv } from "@/lib/download";

// ─── Options for cell text extraction ────────────────────────────────────────

export interface DashCsvOpts {
  statsMode: StatsMode;
  portMap: Map<string, string>;
  connectorStates: ConnectorStateMap;
  trendSummary: Map<string, TrendEntry>;
}

// ─── Cell text extraction (mirrors DashboardRow cell rendering) ──────────────

function effectiveStats(s: DashboardStatus, mode: StatsMode): ChannelStatistics | undefined {
  return mode === "lifetime" ? s.lifetimeStatistics : s.statistics;
}

export function getDashCellText(col: DashCol, s: DashboardStatus, opts: DashCsvOpts): string {
  const isChannel = s.statusType === "CHANNEL" || s.statusType == null;
  const stats = effectiveStats(s, opts.statsMode);

  switch (col) {
    case "state":
      return s.state ?? "";
    case "name":
      return s.name;
    case "channelId":
      return isChannel ? s.channelId : "";
    case "revDelta":
      return isChannel && s.deployedRevisionDelta != null ? String(s.deployedRevisionDelta) : "";
    case "lastDeployed":
      return isChannel && s.deployedDate
        ? format(new Date(s.deployedDate), "yyyy-MM-dd HH:mm")
        : "";
    case "port":
      return isChannel ? (opts.portMap.get(s.channelId) ?? "") : "";
    case "connection": {
      const metaDataId = isChannel ? 0 : (s.metaDataId ?? 0);
      const entry = opts.connectorStates[`${s.channelId}_${metaDataId}`];
      if (!entry) return "";
      // Strip HTML tags from connection label
      return entry[1].replace(/<[^>]+>/g, "").trim();
    }
    case "received":
      return String(stat(stats, "RECEIVED"));
    case "filtered":
      return String(stat(stats, "FILTERED"));
    case "queued":
      return String(s.queued ?? 0);
    case "sent":
      return String(stat(stats, "SENT"));
    case "errored":
      return String(stat(stats, "ERROR"));
    case "rcvPerHr": {
      if (!isChannel) return "";
      const e = opts.trendSummary.get(s.channelId);
      return e ? String(e.receivedPerHour) : "";
    }
    case "queueDelta": {
      if (!isChannel) return "";
      const e = opts.trendSummary.get(s.channelId);
      return e ? String(e.queueDelta) : "";
    }
    case "errPerHr": {
      if (!isChannel) return "";
      const e = opts.trendSummary.get(s.channelId);
      return e ? String(e.errPerHour) : "";
    }
    default:
      return "";
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Export the dashboard table as CSV.
 * Exports channel-level rows only (not connector sub-rows).
 */
export function exportDashboardCsv(
  visibleCols: ColDef<DashCol>[],
  statuses: DashboardStatus[],
  opts: DashCsvOpts
): void {
  // Only export channel-level rows
  const channelRows = statuses.filter((s) => s.statusType === "CHANNEL" || s.statusType == null);
  const headers = visibleCols.map((c) => c.label);
  const rows = channelRows.map((s) => visibleCols.map((c) => getDashCellText(c.key, s, opts)));
  downloadCsv("bridgelink-dashboard", headers, rows);
}
