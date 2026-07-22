"use client";

import type { ChannelGroup } from "@/lib/types";
import type { ChannelMetadata } from "@/lib/cache-store";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ChanCol } from "../_lib/channel-columns";
import type { EnrichedChannel } from "../_lib/channel-helpers";
import { DEFAULT_GROUP_ID } from "../_lib/channel-columns";
import { isChannelEnabled } from "../_lib/channel-helpers";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import { TableRow, TableCell } from "@/components/data-table";
import {
  FolderOpen,
  FolderClosed,
  Pencil,
  Rocket,
  ToggleLeft,
  ToggleRight,
  Download,
  Trash2,
  Copy,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { toast } from "sonner";

function GroupEnabledBadge({
  channels,
  metadataMap,
}: {
  channels: EnrichedChannel[];
  metadataMap: Record<string, ChannelMetadata>;
}) {
  if (channels.length === 0)
    return <span className="text-xs text-gray-400 dark:text-gray-500">N/A</span>;
  const allEnabled = channels.every((c) => isChannelEnabled(c, metadataMap));
  const allDisabled = channels.every((c) => !isChannelEnabled(c, metadataMap));
  if (allEnabled)
    return (
      <span className="text-xs font-medium text-green-700 dark:text-green-400 whitespace-nowrap">
        Enabled
      </span>
    );
  if (allDisabled)
    return (
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
        Disabled
      </span>
    );
  return (
    <span className="text-xs font-medium text-orange-600 dark:text-orange-400 whitespace-nowrap">
      Mixed
    </span>
  );
}

export function GroupRow({
  group,
  displayChannels,
  allChannels,
  expanded,
  onToggle,
  onSelect,
  selected = false,
  visibleCols,
  metadataMap,
  onEdit,
  onDelete,
  onExport,
  onDeployAll,
  onEnableAll,
  onDisableAll,
  density = "default",
}: {
  group: ChannelGroup;
  displayChannels: EnrichedChannel[];
  allChannels: EnrichedChannel[];
  expanded: boolean;
  onToggle: () => void;
  onSelect?: () => void;
  selected?: boolean;
  visibleCols: ColDef<ChanCol>[];
  metadataMap: Record<string, ChannelMetadata>;
  onEdit?: (group: ChannelGroup) => void;
  onDelete?: (group: ChannelGroup) => void;
  onExport?: (group: ChannelGroup) => void;
  onDeployAll?: (group: ChannelGroup) => void;
  onEnableAll?: (group: ChannelGroup) => void;
  onDisableAll?: (group: ChannelGroup) => void;
  density?: ViewDensity;
}) {
  const groupFont = density === "compact" ? "text-xs" : "text-sm";

  const started = allChannels.filter((c) => c.deployedState === "STARTED").length;
  const stopped = allChannels.filter((c) => c.deployedState === "STOPPED").length;
  const paused = allChannels.filter((c) => c.deployedState === "PAUSED").length;
  const undeployed = allChannels.filter((c) => !c.deployedState).length;

  // Cells before "name" get individual cells. From "name" onward we span, but
  // when the ID column is visible and sits to the right of Name (the normal
  // layout) we break the span so the group's ID can render in the ID column,
  // aligned under the channel IDs below it (mirrors the Java client).
  const nameIdx = visibleCols.findIndex((c) => c.key === "name");
  const idIdx = visibleCols.findIndex((c) => c.key === "id");
  const beforeName = nameIdx > 0 ? visibleCols.slice(0, nameIdx) : [];
  const idInOwnCell = idIdx > nameIdx;
  const headerSpan = idInOwnCell ? idIdx - nameIdx : visibleCols.length - beforeName.length;
  const trailingSpan = idInOwnCell ? visibleCols.length - idIdx - 1 : 0;
  // Deployment-status dots go in the empty space to the right of the ID. When
  // the ID is the last visible column (no trailing room), keep them inline.
  const dotsInTrailing = idInOwnCell && trailingSpan > 0;

  const headerInner = (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title={expanded ? "Collapse group" : "Expand group"}
        className="shrink-0 text-amber-500 hover:text-amber-600 focus:outline-none"
      >
        {expanded ? (
          <FolderOpen className="w-3.5 h-3.5" />
        ) : (
          <FolderClosed className="w-3.5 h-3.5" />
        )}
      </button>
      <span className={`${groupFont} font-semibold text-gray-700 dark:text-gray-300 truncate`}>
        {group.name}
      </span>
      <span className="text-xs text-gray-400 dark:text-gray-500 font-normal shrink-0">
        ({displayChannels.length})
      </span>
      {onEdit && group.id !== DEFAULT_GROUP_ID && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(group);
          }}
          title="Edit group"
          className="shrink-0 p-0.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </>
  );

  const statusDots = (
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
      {undeployed > 0 && (
        <span
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
          title={`${undeployed} not deployed`}
        >
          <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 shrink-0" />
          {undeployed}
        </span>
      )}
    </div>
  );

  const rowEl = (
    <TableRow
      variant={selected ? "selected" : "group"}
      className="cursor-pointer"
      onClick={onSelect ?? onToggle}
    >
      {beforeName.map((c) => (
        <TableCell key={c.key}>
          {c.key === "status" ? (
            <GroupEnabledBadge channels={allChannels} metadataMap={metadataMap} />
          ) : null}
        </TableCell>
      ))}
      <TableCell colSpan={headerSpan}>
        <div className="flex items-center gap-2 min-w-0">
          {headerInner}
          {!dotsInTrailing && statusDots}
        </div>
      </TableCell>
      {idInOwnCell && (
        <TableCell mono className="text-gray-400 dark:text-gray-500 group/idcell">
          <div className="relative min-w-0">
            <span className="truncate block">{group.id}</span>
            {group.id !== DEFAULT_GROUP_ID && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(group.id).then(() => {
                    toast.success("Group ID copied");
                  });
                }}
                title="Copy group ID"
                className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/idcell:opacity-100 transition-opacity p-0.5 rounded hover:text-gray-700 dark:hover:text-gray-300"
              >
                <Copy className="w-3 h-3" />
              </button>
            )}
          </div>
        </TableCell>
      )}
      {dotsInTrailing && <TableCell colSpan={trailingSpan}>{statusDots}</TableCell>}
    </TableRow>
  );

  const hasEnabledChannels = allChannels.some((c) => isChannelEnabled(c, metadataMap));

  if (!onExport) return rowEl;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowEl}</ContextMenuTrigger>
      <ContextMenuContent>
        {onDeployAll && (
          <>
            <ContextMenuItem onClick={() => onDeployAll(group)} disabled={!hasEnabledChannels}>
              <Rocket className="w-4 h-4" />
              Deploy All Channels
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {onEnableAll && (
          <ContextMenuItem onClick={() => onEnableAll(group)}>
            <ToggleLeft className="w-4 h-4" />
            Enable All Channels
          </ContextMenuItem>
        )}
        {onDisableAll && (
          <ContextMenuItem onClick={() => onDisableAll(group)}>
            <ToggleRight className="w-4 h-4" />
            Disable All Channels
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onExport(group)}>
          <Download className="w-4 h-4" />
          Export Group
        </ContextMenuItem>
        {onEdit && group.id !== DEFAULT_GROUP_ID && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onEdit(group)}>
              <Pencil className="w-4 h-4" />
              Edit Group
            </ContextMenuItem>
          </>
        )}
        {onDelete && group.id !== DEFAULT_GROUP_ID && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onDelete(group)}
              className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
              Delete Group
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
