"use client";

import { MutableRefObject } from "react";
import dynamic from "next/dynamic";
import { RefreshCw, ChevronDown } from "lucide-react";
import type { MessageStatisticsTimeseries } from "@/lib/types";
import {
  TREND_COLORS,
  VIEWS,
  TIME_RANGES,
  VISIBLE_TIME_RANGES,
  INTERVALS,
  allowedIntervalsForRange,
} from "./trend-config";
import type { TrendKey, TrendView } from "./trend-config";

export type { TrendView };

const DashboardTrendsChart = dynamic(() => import("@/components/dashboard-trends-chart"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
      Loading chart…
    </div>
  ),
});

// ─── Timestamp formatters ─────────────────────────────────────────────────────

function formatChartTs(ts: string, rangeMinutes: number): string {
  try {
    const d = new Date(ts);
    if (rangeMinutes <= 1440) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return ts;
  }
}

/**
 * Format a time window for the summary title, matching Java's RangeTextFormatter.
 *   Same day:  "2026/03/09 22:22 → 23:22"
 *   Cross-day: "2026/03/09 22:22 → 2026/03/10 01:22"
 */
function formatRangeText(startMs: number, endMs: number): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const datePart = (d: Date) => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const timePart = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (datePart(s) === datePart(e)) {
    return `${datePart(s)} ${timePart(s)} → ${timePart(e)}`;
  }
  return `${datePart(s)} ${timePart(s)} → ${datePart(e)} ${timePart(e)}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TrendsTabProps {
  selectedChannelId?: string;
  chartTitle?: string;
  trendData: MessageStatisticsTimeseries[];
  trendInterval: string;
  onTrendIntervalChange: (interval: string) => void;
  trendRange: string;
  onTrendRangeChange: (range: string) => void;
  trendView: TrendView;
  onTrendViewChange: (view: TrendView) => void;
  trendChartType: "line" | "stacked";
  onTrendChartTypeChange: (type: "line" | "stacked") => void;
  trendLoading: boolean;
  trendError: string | null;
  isLive: boolean;
  trendWindowRef: MutableRefObject<{ start: number; end: number } | null>;
  onRefresh: () => void;
  onShiftWindow: (direction: -1 | 1) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TrendsTab({
  selectedChannelId,
  chartTitle,
  trendData,
  trendInterval,
  onTrendIntervalChange,
  trendRange,
  onTrendRangeChange,
  trendView,
  onTrendViewChange,
  trendChartType,
  onTrendChartTypeChange,
  trendLoading,
  trendError,
  isLive,
  trendWindowRef,
  onRefresh,
  onShiftWindow,
}: TrendsTabProps) {
  // ── Derived values ──────────────────────────────────────────────────────────

  const rangeMinutes = TIME_RANGES.find((r) => r.code === trendRange)?.minutes ?? 60;
  const allowedIntervals = allowedIntervalsForRange(trendRange);

  // ── Chart data preparation ──────────────────────────────────────────────────

  const chartData = trendData.map((d) => ({
    ts: d.ts,
    label: formatChartTs(d.ts, rangeMinutes),
    received: d.received,
    sent: d.sent,
    filtered: d.filtered,
    queued: d.queued,
    error: d.error,
  }));

  // Active series based on view
  const activeSeries: Array<{ key: TrendKey; label: string }> =
    trendView === "All"
      ? [
          { key: "received", label: "Received" },
          { key: "sent", label: "Sent" },
          { key: "filtered", label: "Filtered" },
          { key: "queued", label: "Queued" },
          { key: "error", label: "Errors" },
        ]
      : [
          {
            key: (trendView === "Errors" ? "error" : trendView.toLowerCase()) as TrendKey,
            label: trendView,
          },
        ];

  // Summary stats — "All" view: simple totals; single-metric: full stats table
  const allSummary =
    trendView === "All"
      ? {
          received: trendData.reduce((s, d) => s + d.received, 0),
          sent: trendData.reduce((s, d) => s + d.sent, 0),
          filtered: trendData.reduce((s, d) => s + d.filtered, 0),
          queued: trendData.length > 0 ? trendData[trendData.length - 1].queued : 0,
          error: trendData.reduce((s, d) => s + d.error, 0),
        }
      : null;

  const singleMetricStats =
    trendView !== "All"
      ? (() => {
          const key = (trendView === "Errors" ? "error" : trendView.toLowerCase()) as TrendKey;
          const isQueued = key === "queued";
          const vals = trendData.map((d) => d[key]);
          const total = isQueued
            ? trendData.length > 0
              ? trendData[trendData.length - 1].queued
              : 0
            : vals.reduce((s, v) => s + v, 0);
          const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
          const min = vals.length ? Math.min(...vals) : 0;
          const max = vals.length ? Math.max(...vals) : 0;
          const peakIdx = vals.indexOf(max);
          const peakTs =
            peakIdx >= 0 && trendData[peakIdx]
              ? new Date(trendData[peakIdx].ts).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "—";
          // Avg rate: total / minutes spanning first..last bucket
          let avgRate: string;
          if (isQueued) {
            avgRate = "—";
          } else if (trendData.length > 1) {
            const startMs = new Date(trendData[0].ts).getTime();
            const endMs = new Date(trendData[trendData.length - 1].ts).getTime();
            const minutes = (endMs - startMs) / 60000;
            avgRate = minutes > 0 ? `${(total / minutes).toFixed(1)} msg/min` : "—";
          } else {
            avgRate = "—";
          }
          return {
            label: trendView === "Errors" ? "Errors" : trendView,
            isQueued,
            total,
            avg,
            min,
            max,
            peakTs,
            avgRate,
            color: TREND_COLORS[key],
          };
        })()
      : null;

  // Summary title header text
  const summaryTitle =
    trendView === "All"
      ? "All Statistics Summary"
      : `${trendView === "Errors" ? "Errors" : trendView} Statistics Summary`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Controls bar — left: Range/Interval/Prev/Next, right: View/Chart/Refresh/Live */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-white dark:bg-gray-900">
        {/* Left group: time navigation */}
        <div className="flex items-center gap-2">
          {/* Time range */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Range:</span>
            <div className="relative">
              <select
                value={trendRange}
                onChange={(e) => onTrendRangeChange(e.target.value)}
                className="text-xs border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded px-2 py-0.5 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {VISIBLE_TIME_RANGES.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          {/* Interval — options filtered by selected range */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Interval:</span>
            <div className="relative">
              <select
                value={
                  allowedIntervals.some((i) => i.code === trendInterval)
                    ? trendInterval
                    : (allowedIntervals[0]?.code ?? "")
                }
                onChange={(e) => onTrendIntervalChange(e.target.value)}
                className="text-xs border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded px-2 py-0.5 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                disabled={allowedIntervals.length === 0}
              >
                {allowedIntervals.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.label}
                  </option>
                ))}
                {/* Show unavailable intervals as disabled options when the list is empty (shouldn't happen with visible ranges) */}
                {allowedIntervals.length === 0 &&
                  INTERVALS.map((i) => (
                    <option key={i.code} value={i.code} disabled>
                      {i.label}
                    </option>
                  ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          {/* Nav buttons */}
          <button
            onClick={() => onShiftWindow(-1)}
            disabled={!selectedChannelId}
            className="px-2 py-0.5 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            title="Previous window"
          >
            ◀ Prev
          </button>
          <button
            onClick={() => onShiftWindow(1)}
            disabled={!selectedChannelId || isLive}
            className="px-2 py-0.5 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            title="Next window"
          >
            Next ▶
          </button>
        </div>
        {/* Right group: display controls */}
        <div className="flex items-center gap-2">
          {/* View */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">View:</span>
            <div className="relative">
              <select
                value={trendView}
                onChange={(e) => onTrendViewChange(e.target.value as TrendView)}
                className="text-xs border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded px-2 py-0.5 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {v === "All" ? "All Message Types" : v + " Only"}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          {/* Chart type */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Chart:</span>
            <div className="relative">
              <select
                value={trendChartType}
                onChange={(e) => onTrendChartTypeChange(e.target.value as "line" | "stacked")}
                className="text-xs border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded px-2 py-0.5 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="line">Line</option>
                <option value="stacked">Stacked</option>
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 dark:text-gray-500" />
            </div>
          </div>
          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={!selectedChannelId || trendLoading}
            className="flex items-center gap-1 px-2 py-0.5 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${trendLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {/* Live / Paused badge */}
          {selectedChannelId && (
            <span
              className="text-xs px-2 py-0.5 rounded border"
              style={{
                fontWeight: isLive ? 700 : 400,
                color: isLive ? "#1B5E20" : "#424242",
                backgroundColor: isLive ? "#E8F5E9" : "#FFCCCC",
                borderColor: isLive ? "#66BB6A" : "#9E9E9E",
              }}
              title={
                isLive ? "Following real-time data" : "Paused view; use Next or Refresh to catch up"
              }
            >
              {isLive ? "Live" : "Paused"}
            </span>
          )}
        </div>
      </div>

      {/* No selection state */}
      {!selectedChannelId ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          Select a channel or connector in the table above to view message trends.
        </div>
      ) : trendError ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-500 dark:text-red-400 px-4">
          {trendError}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Chart (lazy-loaded) */}
          <div className="flex-1 min-h-0 flex flex-col px-2 pt-1.5 pb-1">
            {chartTitle && (
              <p className="text-center text-[11px] font-semibold text-gray-700 dark:text-gray-300 shrink-0 pb-0.5">
                {chartTitle}
              </p>
            )}
            <div className="flex-1 min-h-0">
              <DashboardTrendsChart
                chartType={trendChartType}
                chartData={chartData}
                activeSeries={activeSeries}
              />
            </div>
          </div>

          {/* Summary panel — conditional "All" grid vs single-metric table */}
          <div className="shrink-0 border-t border-border">
            {/* Title bar */}
            <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-border">
              {summaryTitle}
              {
                // eslint-disable-next-line react-hooks/refs -- trendWindowRef is parent-owned; reading .current during render is intentional
                trendWindowRef.current && (
                  <span className="font-normal text-gray-400 dark:text-gray-500">
                    {" — "}
                    {formatRangeText(
                      // eslint-disable-next-line react-hooks/refs
                      trendWindowRef.current.start * 1000,
                      // eslint-disable-next-line react-hooks/refs
                      trendWindowRef.current.end * 1000
                    )}
                  </span>
                )
              }
            </div>

            {/* "All" view: 2×3 color-coded grid */}
            {allSummary && (
              <div className="grid grid-cols-3 gap-x-8 gap-y-0.5 px-4 py-1.5 text-xs">
                <span style={{ color: TREND_COLORS.received }}>
                  Total Received:{" "}
                  <span className="font-semibold font-mono">
                    {allSummary.received.toLocaleString()}
                  </span>
                </span>
                <span style={{ color: TREND_COLORS.sent }}>
                  Total Sent:{" "}
                  <span className="font-semibold font-mono">
                    {allSummary.sent.toLocaleString()}
                  </span>
                </span>
                <span style={{ color: TREND_COLORS.filtered }}>
                  Total Filtered:{" "}
                  <span className="font-semibold font-mono">
                    {allSummary.filtered.toLocaleString()}
                  </span>
                </span>
                <span style={{ color: TREND_COLORS.queued }}>
                  Last Queued:{" "}
                  <span className="font-semibold font-mono">
                    {allSummary.queued.toLocaleString()}
                  </span>
                </span>
                <span style={{ color: TREND_COLORS.error }}>
                  Total Errors:{" "}
                  <span className="font-semibold font-mono">
                    {allSummary.error.toLocaleString()}
                  </span>
                </span>
                <span />
              </div>
            )}

            {/* Single-metric view: stats display */}
            {singleMetricStats && (
              <dl className="grid grid-cols-6 text-xs text-center">
                <dt className="py-0.5 font-medium text-gray-500 dark:text-gray-400 border-b border-border">
                  {singleMetricStats.isQueued ? "Last" : "Total"}
                </dt>
                <dt className="py-0.5 font-medium text-gray-500 dark:text-gray-400 border-b border-border">
                  Average
                </dt>
                <dt className="py-0.5 font-medium text-gray-500 dark:text-gray-400 border-b border-border">
                  Minimum
                </dt>
                <dt className="py-0.5 font-medium text-gray-500 dark:text-gray-400 border-b border-border">
                  Maximum
                </dt>
                <dt className="py-0.5 font-medium text-gray-500 dark:text-gray-400 border-b border-border">
                  Peak Time
                </dt>
                <dt className="py-0.5 font-medium text-gray-500 dark:text-gray-400 border-b border-border">
                  Avg Rate
                </dt>
                <dd
                  className="py-1 text-gray-700 dark:text-gray-300 font-mono"
                  style={{ color: singleMetricStats.color }}
                >
                  {singleMetricStats.total.toLocaleString()}
                </dd>
                <dd className="py-1 text-gray-700 dark:text-gray-300 font-mono">
                  {singleMetricStats.avg.toFixed(1)}
                </dd>
                <dd className="py-1 text-gray-700 dark:text-gray-300 font-mono">
                  {singleMetricStats.min.toLocaleString()}
                </dd>
                <dd className="py-1 text-gray-700 dark:text-gray-300 font-mono">
                  {singleMetricStats.max.toLocaleString()}
                </dd>
                <dd className="py-1 text-gray-700 dark:text-gray-300 font-mono">
                  {singleMetricStats.peakTs}
                </dd>
                <dd className="py-1 text-gray-700 dark:text-gray-300 font-mono">
                  {singleMetricStats.avgRate}
                </dd>
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
