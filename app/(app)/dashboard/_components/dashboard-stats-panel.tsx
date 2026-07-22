"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compactNumber } from "@/lib/utils";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

interface DashboardStatsPanelProps {
  statsCollapsed: boolean;
  setStatsCollapsed: (v: boolean) => void;
  statsMode: StatsMode;
  messageTrendsEnabled: boolean;
  trendLoading: boolean;
  unitLabel: string;
  totalReceived: number;
  totalSent: number;
  totalErrored: number;
  totalQueued: number;
  hrReceived: number;
  hrSent: number;
  hrErrored: number;
  hrQueue: number;
}

/** Collapsible summary stats bar at the top of the Dashboard page. */
export function DashboardStatsPanel({
  statsCollapsed,
  setStatsCollapsed,
  messageTrendsEnabled,
  trendLoading,
  unitLabel,
  totalReceived,
  totalSent,
  totalErrored,
  totalQueued,
  hrReceived,
  hrSent,
  hrErrored,
  hrQueue,
}: DashboardStatsPanelProps) {
  const { viewDensity } = useCompactMode();
  const px = viewDensity === "comfortable" ? "px-6" : viewDensity === "compact" ? "px-2" : "px-4";
  const pyCollapsed =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";
  const pyExpanded =
    viewDensity === "comfortable" ? "py-4" : viewDensity === "compact" ? "py-2" : "py-3";
  const cardPadding =
    viewDensity === "comfortable"
      ? "px-4 py-3"
      : viewDensity === "compact"
        ? "px-2 py-1.5"
        : "px-3 py-2";
  const gridGap =
    viewDensity === "comfortable" ? "gap-4" : viewDensity === "compact" ? "gap-2" : "gap-3";
  const mainValueSize =
    viewDensity === "comfortable" ? "text-2xl" : viewDensity === "compact" ? "text-lg" : "text-xl";
  const trendValueSize =
    viewDensity === "comfortable" ? "text-xl" : viewDensity === "compact" ? "text-base" : "text-lg";

  return (
    <div
      className={`relative border-b border-border bg-white dark:bg-gray-900 ${px} ${statsCollapsed ? pyCollapsed : pyExpanded}`}
    >
      {/* Collapsed: compact inline bar */}
      {statsCollapsed && (
        <div className="flex items-center gap-5 text-xs pr-8">
          <span className="text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide text-[10px]">
            Stats
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Received:{" "}
            <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {totalReceived.toLocaleString()}
            </span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Sent:{" "}
            <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
              {totalSent.toLocaleString()}
            </span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Errored:{" "}
            <span
              className={`font-semibold tabular-nums ${totalErrored > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}
            >
              {totalErrored.toLocaleString()}
            </span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Queued:{" "}
            <span
              className={`font-semibold tabular-nums ${totalQueued > 0 ? "text-yellow-700 dark:text-yellow-400" : "text-gray-900 dark:text-gray-100"}`}
            >
              {totalQueued.toLocaleString()}
            </span>
          </span>
          {messageTrendsEnabled && (
            <>
              <span className="border-l border-border h-3 self-center" />
              <span className="text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide text-[10px]">
                {unitLabel}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Received:{" "}
                <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {trendLoading ? "…" : hrReceived.toLocaleString()}
                </span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Sent:{" "}
                <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                  {trendLoading ? "…" : hrSent.toLocaleString()}
                </span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Errored:{" "}
                <span
                  className={`font-semibold tabular-nums ${hrErrored > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"}`}
                >
                  {trendLoading ? "…" : hrErrored.toLocaleString()}
                </span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Queue Δ:{" "}
                <span
                  className={`font-semibold tabular-nums ${hrQueue > 0 ? "text-yellow-700 dark:text-yellow-400" : hrQueue < 0 ? "text-green-700 dark:text-green-400" : "text-gray-900 dark:text-gray-100"}`}
                >
                  {trendLoading
                    ? "…"
                    : hrQueue > 0
                      ? `+${hrQueue.toLocaleString()}`
                      : hrQueue.toLocaleString()}
                </span>
              </span>
            </>
          )}
        </div>
      )}

      {/* Expanded: full cards */}
      {!statsCollapsed && (
        <div className="flex flex-col gap-3">
          <div className={`grid grid-cols-4 ${gridGap} pr-8`}>
            {[
              {
                label: "Total Received",
                value: totalReceived,
                color: "text-gray-900 dark:text-gray-100",
              },
              {
                label: "Total Sent",
                value: totalSent,
                color: "text-green-700 dark:text-green-400",
              },
              {
                label: "Total Errored",
                value: totalErrored,
                color:
                  totalErrored > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-900 dark:text-gray-100",
              },
              {
                label: "Total Queued",
                value: totalQueued,
                color:
                  totalQueued > 0
                    ? "text-yellow-700 dark:text-yellow-400"
                    : "text-gray-900 dark:text-gray-100",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className={`min-w-0 overflow-hidden bg-gray-50 dark:bg-gray-800 rounded-lg border border-border ${cardPadding}`}
              >
                <div className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide truncate">
                  {label}
                </div>
                <div
                  className={`${mainValueSize} font-bold tabular-nums mt-1 truncate ${color}`}
                  title={value.toLocaleString()}
                >
                  {compactNumber(value)}
                </div>
              </div>
            ))}
          </div>
          {messageTrendsEnabled && (
            <div className={`grid grid-cols-4 ${gridGap} pr-8`}>
              {[
                {
                  label: `Received ${unitLabel}`,
                  value: hrReceived,
                  color: "text-gray-900 dark:text-gray-100",
                  signed: false,
                },
                {
                  label: `Sent ${unitLabel}`,
                  value: hrSent,
                  color: "text-green-700 dark:text-green-400",
                  signed: false,
                },
                {
                  label: `Errored ${unitLabel}`,
                  value: hrErrored,
                  color:
                    hrErrored > 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-gray-100",
                  signed: false,
                },
                {
                  label: `Queue Δ ${unitLabel}`,
                  value: hrQueue,
                  color:
                    hrQueue > 0
                      ? "text-yellow-700 dark:text-yellow-400"
                      : hrQueue < 0
                        ? "text-green-700 dark:text-green-400"
                        : "text-gray-500 dark:text-gray-400",
                  signed: true,
                },
              ].map(({ label, value, color, signed }) => (
                <div
                  key={label}
                  className={`min-w-0 overflow-hidden bg-gray-50 dark:bg-gray-800 rounded-lg border border-border ${cardPadding}`}
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide truncate">
                    {label}
                  </div>
                  {trendLoading ? (
                    <div className="h-7 mt-1 w-20 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  ) : (
                    <div
                      className={`${trendValueSize} font-bold tabular-nums mt-1 truncate ${color}`}
                      title={(signed && value > 0 ? `+` : "") + value.toLocaleString()}
                    >
                      {signed && value > 0 ? `+${compactNumber(value)}` : compactNumber(value)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toggle button — always visible at top-right */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1/2 -translate-y-1/2 right-4 h-6 w-6 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        onClick={() => setStatsCollapsed(!statsCollapsed)}
        title={statsCollapsed ? "Expand stats" : "Collapse stats"}
      >
        {statsCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5" />
        )}
      </Button>
    </div>
  );
}
