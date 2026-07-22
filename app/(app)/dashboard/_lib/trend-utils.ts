import { getServerTimeseries } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendEntry {
  receivedPerHour: number;
  sentPerHour: number;
  errPerHour: number;
  queueDelta: number; // last_bucket.queued - first_bucket.queued
}

export type TrendWindow = "1h" | "4h" | "1d" | "1w" | "1mo";

export interface TrendWindowDef {
  key: TrendWindow;
  label: string;
  seconds: number;
  interval: string;
  unitLabel: string;
}

export const TREND_WINDOWS: TrendWindowDef[] = [
  { key: "1h", label: "Last Hour", seconds: 3600, interval: "5minute", unitLabel: "/ hr" },
  { key: "4h", label: "Last 4 Hrs", seconds: 14400, interval: "15minute", unitLabel: "/ 4h" },
  { key: "1d", label: "Last Day", seconds: 86400, interval: "60minute", unitLabel: "/ day" },
  { key: "1w", label: "Last Week", seconds: 604800, interval: "daily", unitLabel: "/ wk" },
  { key: "1mo", label: "Last Month", seconds: 2592000, interval: "daily", unitLabel: "/ mo" },
];

// ─── Per-channel trend column labels ──────────────────────────────────────────

// The per-channel trend columns are a WebUI-only addition (no Java baseline —
// DashboardPanel.java has no per-hour trend column). They show the window TOTAL, so the
// header must track the active window's unit label to stay consistent with the summary
// cards — never a fixed "/hr" for non-1h windows.
export const TREND_COL_PREFIX: Record<"rcvPerHr" | "errPerHr" | "queueDelta", string> = {
  rcvPerHr: "Rcv",
  errPerHr: "Err",
  queueDelta: "Queue Δ",
};

/** Build a per-channel trend column header, e.g. trendColLabel("Rcv", "/ 4h") → "Rcv / 4h". */
export function trendColLabel(prefix: string, unitLabel: string): string {
  return `${prefix} ${unitLabel}`;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function fetchTrendSummaries(
  channelIds: string[],
  window: TrendWindow = "1h",
  signal?: AbortSignal
): Promise<Map<string, TrendEntry>> {
  const win = TREND_WINDOWS.find((w) => w.key === window) ?? TREND_WINDOWS[0];
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - win.seconds;

  // One bulk request for all channels instead of one request per channel.
  const allBuckets = await getServerTimeseries(startSec, nowSec, win.interval, signal);

  // Group channel-level buckets by channelId. Filter out per-connector rows
  // (non-empty connectorId) to avoid double-counting aggregates.
  const grouped = new Map<string, typeof allBuckets>();
  for (const bucket of allBuckets) {
    if (bucket.connectorId !== null && bucket.connectorId !== "") continue;
    let list = grouped.get(bucket.channelId);
    if (!list) {
      list = [];
      grouped.set(bucket.channelId, list);
    }
    list.push(bucket);
  }

  // Seed every requested channel with zeros so callers always get a full Map.
  const map = new Map<string, TrendEntry>();
  for (const id of channelIds) {
    map.set(id, { receivedPerHour: 0, sentPerHour: 0, errPerHour: 0, queueDelta: 0 });
  }

  // Overwrite with real data for channels present in the response.
  for (const id of channelIds) {
    const buckets = grouped.get(id);
    if (!buckets || buckets.length === 0) continue;
    map.set(id, {
      receivedPerHour: buckets.reduce((s, b) => s + b.received, 0),
      sentPerHour: buckets.reduce((s, b) => s + b.sent, 0),
      errPerHour: buckets.reduce((s, b) => s + b.error, 0),
      queueDelta: buckets[buckets.length - 1].queued - buckets[0].queued,
    });
  }

  return map;
}
