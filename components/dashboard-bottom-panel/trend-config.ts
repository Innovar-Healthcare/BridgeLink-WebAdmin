/**
 * Shared constants and utilities for the Message Trends tab.
 *
 * The range → interval filtering logic mirrors Java's TrendsControlsBar.java:
 * an interval is valid for a range only when
 *   points = ceil(rangeMinutes / intervalMinutes)
 * falls in [MIN_POINTS, MAX_POINTS] = [7, 90].
 */

export type TrendKey = "received" | "sent" | "filtered" | "queued" | "error";

export const VIEWS = ["All", "Received", "Sent", "Filtered", "Queued", "Errors"] as const;
export type TrendView = (typeof VIEWS)[number];

export const TREND_COLORS: Record<TrendKey, string> = {
  received: "#146eff",
  sent: "#28aa28",
  filtered: "#ff8c00",
  queued: "#9966ff",
  error: "#c82828",
};

export const TIME_RANGES: Array<{ code: string; label: string; minutes: number }> = [
  { code: "last_1h", label: "Last 1 Hour", minutes: 60 },
  { code: "last_3h", label: "Last 3 Hours", minutes: 180 },
  { code: "last_6h", label: "Last 6 Hours", minutes: 360 },
  { code: "last_12h", label: "Last 12 Hours", minutes: 720 },
  { code: "last_24h", label: "Last 24 Hours", minutes: 1440 },
  { code: "last_2d", label: "Last 2 Days", minutes: 2880 },
  { code: "last_7d", label: "Last 7 Days", minutes: 10080 },
  { code: "last_14d", label: "Last 14 Days", minutes: 20160 },
  { code: "last_30d", label: "Last Month", minutes: 43200 },
  { code: "last_60d", label: "Last 2 Months", minutes: 86400 },
  { code: "last_90d", label: "Last 3 Months", minutes: 129600 },
  { code: "last_180d", label: "Last 6 Months", minutes: 259200 },
  { code: "last_365d", label: "Last 1 Year", minutes: 525600 },
  { code: "last_730d", label: "Last 2 Years", minutes: 1051200 },
  { code: "last_1095d", label: "Last 3 Years", minutes: 1576800 },
];

export const INTERVALS: Array<{ code: string; label: string; minutes: number }> = [
  { code: "1minute", label: "1 Minute", minutes: 1 },
  { code: "5minute", label: "5 Minutes", minutes: 5 },
  { code: "15minute", label: "15 Minutes", minutes: 15 },
  { code: "60minute", label: "1 Hour", minutes: 60 },
  { code: "daily", label: "1 Day", minutes: 1440 },
];

const MIN_POINTS = 7;
const MAX_POINTS = 90;

/** Mirrors TrendsControlsBar.java pointsForRange() */
export function pointsForRange(rangeMinutes: number, intervalMinutes: number): number {
  return Math.ceil(rangeMinutes / intervalMinutes);
}

/**
 * Returns the intervals valid for a given range code, sorted ascending by minutes.
 * Mirrors TrendsControlsBar.java computeAllowedIntervalsForPreset().
 */
export function allowedIntervalsForRange(
  rangeCode: string
): Array<{ code: string; label: string; minutes: number }> {
  const range = TIME_RANGES.find((r) => r.code === rangeCode);
  if (!range) return [];
  return INTERVALS.filter((interval) => {
    const pts = pointsForRange(range.minutes, interval.minutes);
    return pts >= MIN_POINTS && pts <= MAX_POINTS;
  });
}

/** Ranges that have at least one valid interval — these are shown in the Range dropdown. */
export const VISIBLE_TIME_RANGES = TIME_RANGES.filter(
  (r) => allowedIntervalsForRange(r.code).length > 0
);

export const DEFAULT_RANGE = "last_1h";
/** Java's index-0 pick for last_1h: allowed = [1minute, 5minute], so first = 1minute. */
export const DEFAULT_INTERVAL = "1minute";
