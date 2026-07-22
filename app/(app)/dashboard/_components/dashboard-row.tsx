"use client";

import { memo, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, Cable, Copy } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { TagChip } from "@/components/tag-chip";
import type { TagDisplayMode } from "@/lib/hooks/use-tag-display-mode";
import { type ViewDensity, tightenDensity } from "@/lib/hooks/use-compact-mode";
import type { DashboardStatus, ChannelStatistics, ChannelTag } from "@/lib/types";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { TrendEntry } from "../_lib/trend-utils";
import { allDescendantsStarted } from "../_lib/group-status";
import type { ConnectorStateMap } from "@/lib/api/api-dashboard";
import { TableRow, TableCell } from "@/components/data-table";
import { isRecentlyDeployed, RECENT_DEPLOY_CELL_CLASS } from "@/lib/recent-deploy";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashCol =
  | "state"
  | "name"
  | "channelId"
  | "revDelta"
  | "lastDeployed"
  | "port"
  | "connection"
  | "received"
  | "filtered"
  | "queued"
  | "sent"
  | "errored"
  | "rcvPerHr"
  | "queueDelta"
  | "errPerHr";

export type ChannelAction = "start" | "stop" | "pause" | "resume" | "halt" | "undeploy";

export function rowKey(s: DashboardStatus) {
  return `${s.channelId}-${s.metaDataId ?? "ch"}-${s.statusType ?? "CHANNEL"}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function stat(s: ChannelStatistics | undefined, key: string): number {
  if (!s) return 0;
  const upper = key.toUpperCase() as keyof ChannelStatistics;
  const lower = key.toLowerCase() as keyof ChannelStatistics;
  return (s[upper] ?? s[lower] ?? 0) as number;
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

export function StatCell({
  value,
  highlight,
  bgHighlight,
  density,
}: {
  value: number;
  highlight?: boolean;
  bgHighlight?: boolean;
  density?: ViewDensity;
}) {
  const d = density ?? "default";
  const fontCls = d === "compact" ? "text-xs" : "text-sm";
  const isBgLit = bgHighlight && value > 0;
  return (
    <TableCell
      mono
      align="right"
      className={`${fontCls} ${
        isBgLit
          ? "bg-[rgb(240,230,140)] dark:bg-yellow-900/40 text-black dark:text-black"
          : highlight && value > 0
            ? // Errored cell: pink background + black text, matching Java DashboardPanel.java:766 (Color.PINK, Color.BLACK).
              "bg-[rgb(255,175,175)] dark:bg-red-900/40 text-black dark:text-red-200"
            : "text-gray-700 dark:text-gray-300"
      }`}
    >
      {value.toLocaleString()}
    </TableCell>
  );
}

// ─── Dashboard row ────────────────────────────────────────────────────────────

export interface RowProps {
  status: DashboardStatus;
  depth: number;
  inGroup?: boolean;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  tagMap: Map<string, ChannelTag[]>;
  visibleCols: ColDef<DashCol>[];
  mounted: boolean;
  selectedIds?: Set<string>;
  selectedConnector?: { channelId: string; metaDataId: number } | null;
  onRowClick?: (channelId: string, connectorId: string | undefined, e: MouseEvent) => void;
  statsMode?: StatsMode;
  portMap?: Map<string, string>;
  connectorStates?: ConnectorStateMap;
  trendSummary?: Map<string, TrendEntry>;
  trendLoading?: boolean;
  onChannelAction?: (channelId: string, action: ChannelAction) => void;
  onGroupAction?: (channelIds: string[], action: ChannelAction) => void;
  onViewMessages?: (channelId: string, metaDataId?: number) => void;
  onSendMessage?: (channelId: string, channelName: string) => void;
  onClearStats?: (channelId: string, metaDataId: number | null, channelName: string) => void;
  onRemoveAllMessages?: (
    channels: { channelId: string; channelName: string; channelState: string }[]
  ) => void;
  /** Clear statistics for a whole set of channels (used when the right-clicked row
   *  is part of a multi-selection). */
  onGroupClearStats?: (channelIds: string[]) => void;
  /** Remove all messages for a whole set of channels (used when the right-clicked
   *  row is part of a multi-selection). */
  onGroupRemoveAllMessages?: (channelIds: string[]) => void;
  onStopConnector?: (channelId: string, metaDataId: number) => void;
  onStopConnectorQueueDisabled?: () => void;
  onStartConnector?: (channelId: string, metaDataId: number) => void;
  tagDisplayMode?: TagDisplayMode;
  globalDensity?: ViewDensity;
  /**
   * State of the parent channel, threaded down to connector child rows. Java hides
   * the Start/Stop Connector tasks entirely unless the parent channel is STARTED or
   * PAUSED (`DashboardPanel.java:547-550`); the connector's own state alone is not
   * sufficient. Undefined for top-level channel rows (they don't need it).
   */
  parentChannelState?: string;
}

function DashboardRowImpl({
  status,
  depth,
  inGroup,
  expanded,
  onToggle,
  tagMap,
  visibleCols,
  mounted,
  selectedIds,
  selectedConnector,
  onRowClick,
  statsMode,
  portMap,
  connectorStates,
  trendSummary,
  trendLoading,
  onChannelAction,
  onGroupAction,
  onViewMessages,
  onSendMessage,
  onClearStats,
  onRemoveAllMessages,
  onGroupClearStats,
  onGroupRemoveAllMessages,
  onStopConnector,
  onStopConnectorQueueDisabled,
  onStartConnector,
  tagDisplayMode,
  globalDensity,
  parentChannelState,
}: RowProps) {
  const effectiveStats = statsMode === "lifetime" ? status.lifetimeStatistics : status.statistics;
  const key = rowKey(status);
  const hasChildren = (status.childStatuses?.length ?? 0) > 0;
  const isExpanded = expanded.has(key);
  const isConnector =
    status.statusType === "SOURCE_CONNECTOR" || status.statusType === "DESTINATION_CONNECTOR";
  const isChain = status.statusType === "CHAIN";
  const isChannel = !isConnector && !isChain;
  // Connectors and chain rows are always one level tighter than the parent channel row
  const effectiveDensity =
    isConnector || isChain
      ? tightenDensity(globalDensity ?? "default")
      : (globalDensity ?? "default");
  const gd = globalDensity ?? "default";
  const cellFont = gd === "compact" ? "text-xs" : "text-sm";
  const tags = isChannel ? (tagMap.get(status.channelId) ?? []) : [];

  function cell(col: ColDef<DashCol>) {
    switch (col.key) {
      case "state": {
        // STARTED downgrades to orange when a child connector isn't fully
        // started (mirrors Java DashboardTableNode.isStarted).
        const colorStatus =
          status.state === "STARTED" && !allDescendantsStarted(status.childStatuses)
            ? "STARTING"
            : undefined;
        return (
          <TableCell key={col.key} align={effectiveDensity !== "comfortable" ? "center" : "left"}>
            {status.state ? (
              <StatusBadge
                status={status.state}
                colorStatus={colorStatus}
                variant="channel"
                density={effectiveDensity}
              />
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </TableCell>
        );
      }
      case "name":
        return (
          <TableCell key={col.key}>
            <div
              className="flex items-center gap-1.5 min-w-0"
              style={{ paddingLeft: `${(inGroup ? 6 : 0) + depth * 20}px` }}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(key);
                  }}
                  className="text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              {isChannel && <Cable className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
              <span
                className={`truncate shrink-0 ${isConnector || isChain ? "text-gray-500 dark:text-gray-400 text-xs" : `${cellFont} font-medium text-gray-900 dark:text-gray-100`}`}
                style={{ maxWidth: "70%" }}
              >
                {status.name}
              </span>
              {tagDisplayMode !== "hidden" && tags.length > 0 && (
                <span className="flex items-center gap-1 min-w-0 overflow-hidden shrink">
                  {tags.map((t) => (
                    <TagChip
                      key={t.id}
                      name={t.name}
                      backgroundColor={t.backgroundColor}
                      mode={tagDisplayMode}
                    />
                  ))}
                </span>
              )}
            </div>
          </TableCell>
        );
      case "channelId":
        return (
          <TableCell
            key={col.key}
            mono
            className={`group/idcell ${isChannel ? "text-gray-500 dark:text-gray-400" : "text-gray-300 dark:text-gray-600"}`}
          >
            {isChannel ? (
              <div className="relative min-w-0">
                <span className="truncate block">{status.channelId}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(status.channelId).then(() => {
                      toast.success("Channel ID copied");
                    });
                  }}
                  title="Copy channel ID"
                  className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/idcell:opacity-100 transition-opacity p-0.5 rounded hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ) : (
              "—"
            )}
          </TableCell>
        );
      case "revDelta": {
        const highlighted =
          isChannel &&
          ((status.deployedRevisionDelta != null && status.deployedRevisionDelta > 0) ||
            status.codeTemplatesChanged === true);
        return (
          <TableCell
            key={col.key}
            mono
            align="center"
            title={highlighted ? "Unsaved changes since last deploy" : undefined}
            className={`${cellFont} font-medium ${highlighted ? "bg-[#ffcc00] text-black" : "text-gray-500 dark:text-gray-400"}`}
          >
            {isChannel && status.deployedRevisionDelta != null
              ? status.deployedRevisionDelta
              : "--"}
          </TableCell>
        );
      }
      case "lastDeployed": {
        const recentDeploy =
          mounted &&
          isChannel &&
          // eslint-disable-next-line react-hooks/purity -- Date.now() is intentional; the row re-renders on each dashboard refresh so "now" stays current
          isRecentlyDeployed(status.deployedDate, Date.now());
        return (
          <TableCell
            key={col.key}
            mono
            suppressHydrationWarning
            title={recentDeploy ? "Deployed within the last 2 minutes" : undefined}
            className={recentDeploy ? RECENT_DEPLOY_CELL_CLASS : "text-gray-500 dark:text-gray-400"}
          >
            {mounted && isChannel && status.deployedDate
              ? format(new Date(status.deployedDate), "yyyy-MM-dd HH:mm")
              : "—"}
          </TableCell>
        );
      }
      case "port": {
        if (!isChannel)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        const conn = portMap?.get(status.channelId);
        if (!conn)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} text-gray-700 dark:text-gray-300`}
          >
            {conn}
          </TableCell>
        );
      }
      case "connection": {
        const metaDataId = isChannel ? 0 : (status.metaDataId ?? 0);
        const stateKey = `${status.channelId}_${metaDataId}`;
        const entry = connectorStates?.[stateKey];
        if (!entry)
          return (
            <TableCell key={col.key} className={`${cellFont} text-gray-400 dark:text-gray-500`}>
              —
            </TableCell>
          );
        const [color, rawLabel] = entry;
        const cleanLabel = rawLabel.replace(/<[^>]+>/g, "").trim();
        const { red, green, blue } = color;
        const dotClass =
          green === 255 && red === 0 && blue === 0
            ? "bg-green-500"
            : red === 255 && green === 255 && blue === 0
              ? "bg-yellow-400"
              : red === 255 && green === 0 && blue === 0
                ? "bg-red-500"
                : red === 0 && green === 0 && blue === 255
                  ? "bg-blue-500"
                  : "bg-gray-400";
        return (
          <TableCell key={col.key} className={cellFont}>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
              <span className="text-gray-700 dark:text-gray-300 truncate">{cleanLabel}</span>
            </span>
          </TableCell>
        );
      }
      case "received":
        return <StatCell key={col.key} value={stat(effectiveStats, "RECEIVED")} density={gd} />;
      case "filtered":
        return <StatCell key={col.key} value={stat(effectiveStats, "FILTERED")} density={gd} />;
      case "queued":
        return (
          <StatCell
            key={col.key}
            value={status.queued ?? 0}
            bgHighlight={(status.queued ?? 0) > 0}
            density={gd}
          />
        );
      case "sent":
        return <StatCell key={col.key} value={stat(effectiveStats, "SENT")} density={gd} />;
      case "errored":
        return (
          <StatCell key={col.key} value={stat(effectiveStats, "ERROR")} highlight density={gd} />
        );
      case "rcvPerHr": {
        if (!isChannel)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        if (trendLoading)
          return (
            <TableCell
              key={col.key}
              mono
              align="right"
              className="text-xs text-gray-400 dark:text-gray-500"
            >
              …
            </TableCell>
          );
        const e = trendSummary?.get(status.channelId);
        if (!e)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} text-gray-700 dark:text-gray-300`}
          >
            {e.receivedPerHour.toLocaleString()}
          </TableCell>
        );
      }
      case "errPerHr": {
        if (!isChannel)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        if (trendLoading)
          return (
            <TableCell
              key={col.key}
              mono
              align="right"
              className="text-xs text-gray-400 dark:text-gray-500"
            >
              …
            </TableCell>
          );
        const e = trendSummary?.get(status.channelId);
        if (!e)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} ${e.errPerHour > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-700 dark:text-gray-300"}`}
          >
            {e.errPerHour.toLocaleString()}
          </TableCell>
        );
      }
      case "queueDelta": {
        if (!isChannel)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        if (trendLoading)
          return (
            <TableCell
              key={col.key}
              mono
              align="right"
              className="text-xs text-gray-400 dark:text-gray-500"
            >
              …
            </TableCell>
          );
        const e = trendSummary?.get(status.channelId);
        if (!e)
          return (
            <TableCell
              key={col.key}
              align="right"
              className={`${cellFont} text-gray-400 dark:text-gray-500`}
            >
              —
            </TableCell>
          );
        const d = e.queueDelta;
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} ${d > 0 ? "text-yellow-700 dark:text-yellow-400" : d < 0 ? "text-green-700 dark:text-green-400" : "text-gray-500 dark:text-gray-400"}`}
          >
            {d > 0 ? `+${d.toLocaleString()}` : d.toLocaleString()}
          </TableCell>
        );
      }
      default:
        return null;
    }
  }

  const isSelected =
    (isChannel && (selectedIds?.has(status.channelId) ?? false)) ||
    (isConnector &&
      selectedConnector?.channelId === status.channelId &&
      selectedConnector?.metaDataId === status.metaDataId);

  function handleRowClick(e: MouseEvent) {
    if (onRowClick) {
      if (isChannel) {
        onRowClick(status.channelId, undefined, e);
      } else if (isConnector && status.metaDataId !== undefined) {
        onRowClick(status.channelId, String(status.metaDataId), e);
      }
    }
  }

  const state = status.state ?? "";
  const canStart = isChannel && (state === "STOPPED" || state === "PAUSED");
  const canStop = isChannel && (state === "STARTED" || state === "PAUSED");
  const canPause = isChannel && state === "STARTED";
  const HALTABLE_STATES = [
    "DEPLOYING",
    "UNDEPLOYING",
    "STARTING",
    "STOPPING",
    "PAUSING",
    "SYNCING",
    "UNKNOWN",
  ];
  const canHalt = isChannel && HALTABLE_STATES.includes(state);

  // Match the toolbar's state gating (dashboard/page.tsx removableIds/undeployableIds/
  // interactableIds) on the context menu so both invocation paths agree — Java hides these
  // tasks in transitional states (DashboardPanel.java:522-543)..
  const MID_DEPLOY_STATES = ["DEPLOYING", "UNDEPLOYING"];
  const isHaltableState = HALTABLE_STATES.includes(state);
  // View / Send / Clear Statistics hidden only mid-deploy (Java :526 hides tasks 1-8).
  const canInteract = !MID_DEPLOY_STATES.includes(state);
  // Remove All Messages hidden for any haltable state (Java :528).
  const canRemoveAll = !isHaltableState;
  // Undeploy hidden for haltable non-SYNCING states (Java :532-535); SYNCING stays allowed.
  const canUndeploy = !isHaltableState || state === "SYNCING";

  // Connector Start/Stop tasks are only offered when the parent channel is STARTED
  // or PAUSED — mirrors Java DashboardPanel.java:547-550 (tasks 10-11 hidden
  // otherwise). Matches the toolbar path in use-connector-toolbar.ts.
  const parentIsActive = parentChannelState === "STARTED" || parentChannelState === "PAUSED";

  function triggerAction(action: ChannelAction) {
    if (onGroupAction && selectedIds && selectedIds.has(status.channelId) && selectedIds.size > 1) {
      onGroupAction([...selectedIds], action);
    } else {
      onChannelAction?.(status.channelId, action);
    }
  }

  // True when this row is part of a multi-selection — context-menu actions should
  // then apply to every selected channel, not just the right-clicked one (matches
  // the toolbar and the Java client). Mirrors the triggerAction gate above.
  const rightClickTargetsSelection = !!(
    selectedIds &&
    selectedIds.has(status.channelId) &&
    selectedIds.size > 1
  );

  const subRowTint =
    !isChannel && !isSelected && effectiveDensity !== "comfortable"
      ? "bg-gray-50/30 dark:bg-gray-800/30"
      : "";

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TableRow
            variant={isSelected ? "selected" : "default"}
            className={`cursor-pointer ${subRowTint}`}
            onClick={(e) => handleRowClick(e)}
            onDoubleClick={() =>
              onViewMessages?.(status.channelId, isConnector ? status.metaDataId : undefined)
            }
          >
            {visibleCols.map((c) => cell(c))}
          </TableRow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {/* ── Channel menu ── */}
          {isChannel && (
            <>
              <ContextMenuItem
                onSelect={() => onViewMessages?.(status.channelId)}
                disabled={!canInteract}
              >
                View Messages
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onSendMessage?.(status.channelId, status.name)}
                disabled={!canInteract}
              >
                Send Message
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => triggerAction("start")} disabled={!canStart}>
                Start
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => triggerAction("stop")} disabled={!canStop}>
                Stop
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => triggerAction("pause")} disabled={!canPause}>
                Pause
              </ContextMenuItem>
              {/* Java force-gates Halt to a single channel (DashboardPanel.java:537-542), so
                  Halt always targets this one channel — never the multi-selection. */}
              <ContextMenuItem
                onSelect={() => onChannelAction?.(status.channelId, "halt")}
                disabled={!canHalt}
              >
                Halt
              </ContextMenuItem>
              <ContextMenuSeparator />
              {statsMode !== "lifetime" && (
                <ContextMenuItem
                  onSelect={() => {
                    if (rightClickTargetsSelection && onGroupClearStats) {
                      onGroupClearStats([...selectedIds!]);
                    } else {
                      onClearStats?.(status.channelId, null, status.name);
                    }
                  }}
                  disabled={!canInteract}
                >
                  Clear Statistics
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onSelect={() => {
                  if (rightClickTargetsSelection && onGroupRemoveAllMessages) {
                    onGroupRemoveAllMessages([...selectedIds!]);
                  } else {
                    onRemoveAllMessages?.([
                      {
                        channelId: status.channelId,
                        channelName: status.name,
                        channelState: state,
                      },
                    ]);
                  }
                }}
                disabled={!canRemoveAll}
              >
                Remove All Messages
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => triggerAction("undeploy")}
                disabled={!canUndeploy}
                className="text-orange-600 focus:text-orange-600"
              >
                Undeploy
              </ContextMenuItem>
            </>
          )}
          {/* ── Connector menu ── */}
          {isConnector && (
            <>
              <ContextMenuItem
                onSelect={() => onViewMessages?.(status.channelId, status.metaDataId)}
              >
                View Messages
              </ContextMenuItem>
              {/* Start/Stop Connector are hidden unless the parent channel is
                  STARTED or PAUSED (Java DashboardPanel.java:547-550). The
                  separator lives inside the guard so an inactive parent doesn't
                  leave an orphan double-separator before Clear Statistics. */}
              {parentIsActive && (
                <>
                  <ContextMenuSeparator />
                  {status.metaDataId === 0 && status.state === "STOPPED" && (
                    <ContextMenuItem
                      onSelect={() => {
                        if (status.metaDataId !== undefined)
                          onStartConnector?.(status.channelId, status.metaDataId);
                      }}
                    >
                      Start Connector
                    </ContextMenuItem>
                  )}
                  {status.metaDataId === 0 && status.state === "STARTED" && (
                    <ContextMenuItem
                      onSelect={() => {
                        if (status.metaDataId !== undefined)
                          onStopConnector?.(status.channelId, status.metaDataId);
                      }}
                    >
                      Stop Connector
                    </ContextMenuItem>
                  )}
                  {/* Java shows Start Connector for a STOPPED destination regardless of queueing
                      (DashboardPanel.java:552-562 — case STOPPED, no queueEnabled check) —.
                      The stop-side queue-disabled warning below is a deliberate enhancement. */}
                  {status.metaDataId !== 0 && status.state === "STOPPED" && (
                    <ContextMenuItem
                      onSelect={() => {
                        if (status.metaDataId !== undefined)
                          onStartConnector?.(status.channelId, status.metaDataId);
                      }}
                    >
                      Start Connector
                    </ContextMenuItem>
                  )}
                  {status.metaDataId !== 0 && status.state === "STARTED" && (
                    <ContextMenuItem
                      onSelect={() => {
                        if (status.metaDataId === undefined) return;
                        if (!status.queueEnabled) {
                          onStopConnectorQueueDisabled?.();
                        } else {
                          onStopConnector?.(status.channelId, status.metaDataId);
                        }
                      }}
                    >
                      Stop Connector
                    </ContextMenuItem>
                  )}
                </>
              )}
              {statsMode !== "lifetime" && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => {
                      if (status.metaDataId !== undefined)
                        onClearStats?.(status.channelId, status.metaDataId, status.name);
                    }}
                  >
                    Clear Statistics
                  </ContextMenuItem>
                </>
              )}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {hasChildren &&
        isExpanded &&
        status.childStatuses!.map((child) => (
          <DashboardRow
            key={rowKey(child)}
            status={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            tagMap={tagMap}
            visibleCols={visibleCols}
            mounted={mounted}
            selectedIds={selectedIds}
            selectedConnector={selectedConnector}
            onRowClick={onRowClick}
            statsMode={statsMode}
            portMap={portMap}
            connectorStates={connectorStates}
            trendSummary={trendSummary}
            trendLoading={trendLoading}
            onChannelAction={onChannelAction}
            onGroupAction={onGroupAction}
            onViewMessages={onViewMessages}
            onSendMessage={onSendMessage}
            onClearStats={onClearStats}
            onRemoveAllMessages={onRemoveAllMessages}
            onStopConnector={onStopConnector}
            onStopConnectorQueueDisabled={onStopConnectorQueueDisabled}
            onStartConnector={onStartConnector}
            tagDisplayMode={tagDisplayMode}
            globalDensity={globalDensity}
            // Propagate the channel's state to connector rows (through any CHAIN
            // intermediate) so their Start/Stop gating can see the parent state.
            parentChannelState={isChannel ? status.state : parentChannelState}
          />
        ))}
    </>
  );
}

/**
 * Memoized so an idle dashboard poll that returns unchanged data re-renders zero
 * rows. Relies on stable `status` references from the cache store's
 * structural sharing and a memoized `sharedRowProps` from the page.
 */
export const DashboardRow = memo(DashboardRowImpl);
