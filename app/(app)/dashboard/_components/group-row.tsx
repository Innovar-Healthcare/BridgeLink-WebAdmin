"use client";

import { FolderOpen, FolderClosed } from "lucide-react";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import type { DashboardStatus, ChannelGroup } from "@/lib/types";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { TrendEntry } from "../_lib/trend-utils";
import { TableRow, TableCell } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { rollupGroupStatus } from "../_lib/group-status";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { stat, type DashCol, type ChannelAction } from "./dashboard-row";

export function GroupRow({
  group,
  channels,
  expanded,
  onToggle,
  onSelect,
  selected = false,
  visibleCols,
  statsMode,
  trendSummary,
  trendLoading,
  onGroupAction,
  onGroupClearStats,
  globalDensity,
}: {
  group: ChannelGroup;
  channels: DashboardStatus[];
  expanded: boolean;
  onToggle: () => void;
  onSelect?: () => void;
  selected?: boolean;
  visibleCols: ColDef<DashCol>[];
  statsMode?: StatsMode;
  trendSummary?: Map<string, TrendEntry>;
  trendLoading?: boolean;
  onGroupAction?: (channelIds: string[], action: ChannelAction) => void;
  onGroupClearStats?: (channelIds: string[], groupName: string) => void;
  globalDensity?: ViewDensity;
}) {
  const groupFont = globalDensity === "compact" ? "text-xs" : "text-sm";
  const groupStatFont = globalDensity === "compact" ? "text-xs" : "text-sm";
  const started = channels.filter((c) => c.state === "STARTED").length;
  const stopped = channels.filter((c) => c.state === "STOPPED").length;
  const paused = channels.filter((c) => c.state === "PAUSED").length;

  const startableIds = channels
    .filter((c) => c.state === "STOPPED" || c.state === "PAUSED")
    .map((c) => c.channelId);
  const stoppableIds = channels
    .filter((c) => c.state === "STARTED" || c.state === "PAUSED")
    .map((c) => c.channelId);
  const pausableIds = channels.filter((c) => c.state === "STARTED").map((c) => c.channelId);
  const resumableIds = channels.filter((c) => c.state === "PAUSED").map((c) => c.channelId);
  // No group-level Halt: Java force-gates Halt to a single channel (DashboardPanel.java:537-542),
  // so a "Halt All Channels" group action would be exactly the mass force-halt the guardrail forbids.
  const allIds = channels.map((c) => c.channelId);

  const groupStat = (key: string) =>
    channels.reduce((s, c) => {
      const src = statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics;
      return s + stat(src, key);
    }, 0);

  const groupQueued = channels.reduce((s, c) => s + (c.queued ?? 0), 0);

  const groupTrendStat = (fn: (e: TrendEntry) => number) =>
    channels.reduce(
      (s, c) => s + (trendSummary?.get(c.channelId) ? fn(trendSummary.get(c.channelId)!) : 0),
      0
    );

  function groupCell(col: ColDef<DashCol>) {
    switch (col.key) {
      case "state": {
        // Rolled-up group status bullet, mirroring Java updateGroupStatusRow.
        const { label, colorStatus } = rollupGroupStatus(channels);
        return (
          <TableCell key={col.key} align={globalDensity !== "comfortable" ? "center" : "left"}>
            <StatusBadge
              status={label}
              colorStatus={colorStatus}
              variant="channel"
              density={globalDensity}
            />
          </TableCell>
        );
      }
      case "name":
        return (
          <TableCell key={col.key}>
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                className="shrink-0 text-amber-500 hover:text-amber-600 focus:outline-none"
                aria-label={expanded ? "Collapse group" : "Expand group"}
              >
                {expanded ? (
                  <FolderOpen className="w-3.5 h-3.5" />
                ) : (
                  <FolderClosed className="w-3.5 h-3.5" />
                )}
              </button>
              <span
                className={`${groupFont} font-semibold text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate`}
              >
                {group.name}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 font-normal shrink-0">
                ({channels.length})
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-1">
                {started > 0 && (
                  <span
                    className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"
                    title={`${started} started`}
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    {started}
                  </span>
                )}
                {paused > 0 && (
                  <span
                    className="flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-400"
                    title={`${paused} paused`}
                  >
                    <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                    {paused}
                  </span>
                )}
                {stopped > 0 && (
                  <span
                    className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
                    title={`${stopped} stopped`}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    {stopped}
                  </span>
                )}
              </div>
            </div>
          </TableCell>
        );
      case "received":
      case "filtered":
      case "sent": {
        const statKey =
          col.key === "received" ? "RECEIVED" : col.key === "filtered" ? "FILTERED" : "SENT";
        const val = groupStat(statKey);
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${groupStatFont} text-gray-400 dark:text-gray-500`}
          >
            {val.toLocaleString()}
          </TableCell>
        );
      }
      case "queued":
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${groupStatFont} text-gray-400 dark:text-gray-500`}
          >
            {groupQueued.toLocaleString()}
          </TableCell>
        );
      case "errored": {
        const val = groupStat("ERROR");
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${groupStatFont} ${val > 0 ? "text-red-500 dark:text-red-400 font-medium" : "text-gray-400 dark:text-gray-500"}`}
          >
            {val.toLocaleString()}
          </TableCell>
        );
      }
      case "rcvPerHr": {
        if (trendLoading)
          return (
            <TableCell
              key={col.key}
              mono
              align="right"
              className={`${groupStatFont} text-gray-400 dark:text-gray-500`}
            >
              …
            </TableCell>
          );
        const val = groupTrendStat((e) => e.receivedPerHour);
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${groupStatFont} text-gray-400 dark:text-gray-500`}
          >
            {val > 0 ? val.toLocaleString() : ""}
          </TableCell>
        );
      }
      case "errPerHr": {
        if (trendLoading)
          return (
            <TableCell
              key={col.key}
              mono
              align="right"
              className={`${groupStatFont} text-gray-400 dark:text-gray-500`}
            >
              …
            </TableCell>
          );
        const val = groupTrendStat((e) => e.errPerHour);
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${groupStatFont} ${val > 0 ? "text-red-500 dark:text-red-400 font-medium" : "text-gray-400 dark:text-gray-500"}`}
          >
            {val > 0 ? val.toLocaleString() : ""}
          </TableCell>
        );
      }
      case "queueDelta": {
        if (trendLoading)
          return (
            <TableCell
              key={col.key}
              mono
              align="right"
              className={`${groupStatFont} text-gray-400 dark:text-gray-500`}
            >
              …
            </TableCell>
          );
        const val = groupTrendStat((e) => e.queueDelta);
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${groupStatFont} ${val > 0 ? "text-yellow-600 dark:text-yellow-400" : val < 0 ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-gray-500"}`}
          >
            {val !== 0 ? (val > 0 ? `+${val.toLocaleString()}` : val.toLocaleString()) : ""}
          </TableCell>
        );
      }
      default:
        return <TableCell key={col.key} />;
    }
  }

  const rowEl = (
    <TableRow
      variant={selected ? "selected" : "group"}
      className="cursor-pointer"
      onClick={onSelect ?? onToggle}
    >
      {visibleCols.map((c) => groupCell(c))}
    </TableRow>
  );

  if (!onGroupAction) return rowEl;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowEl}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => onGroupAction(startableIds, "start")}
          disabled={startableIds.length === 0}
        >
          Start All Channels
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onGroupAction(stoppableIds, "stop")}
          disabled={stoppableIds.length === 0}
        >
          Stop All Channels
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onGroupAction(pausableIds, "pause")}
          disabled={pausableIds.length === 0}
        >
          Pause All Channels
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onGroupAction(resumableIds, "resume")}
          disabled={resumableIds.length === 0}
        >
          Resume All Channels
        </ContextMenuItem>
        <ContextMenuSeparator />
        {statsMode !== "lifetime" && (
          <>
            <ContextMenuItem
              onSelect={() => onGroupClearStats?.(allIds, group.name)}
              disabled={allIds.length === 0}
            >
              Clear Statistics
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem
          onSelect={() => onGroupAction(allIds, "undeploy")}
          disabled={allIds.length === 0}
          className="text-orange-600 focus:text-orange-600"
        >
          Undeploy All Channels
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
