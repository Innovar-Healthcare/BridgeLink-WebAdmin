"use client";

import { memo } from "react";
import type { ChannelTag } from "@/lib/types";
import type { ChannelMetadata } from "@/lib/cache-store";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ChanCol } from "../_lib/channel-columns";
import type { EnrichedChannel } from "../_lib/channel-helpers";
import type { TagDisplayMode } from "@/lib/hooks/use-tag-display-mode";
import { isChannelEnabled, channelLastModified, channelDataType } from "../_lib/channel-helpers";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import { TagChip } from "@/components/tag-chip";
import { TableRow, TableCell } from "@/components/data-table";
import { isRecentlyDeployed, RECENT_DEPLOY_CELL_CLASS } from "@/lib/recent-deploy";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Cable,
  Pencil,
  Copy,
  Download,
  Trash2,
  Rocket,
  ToggleLeft,
  ToggleRight,
  Inbox,
  FolderInput,
  GitCommit,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

function EnabledBadge({ enabled, density }: { enabled: boolean; density?: ViewDensity }) {
  if (density !== "comfortable") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${enabled ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"}`}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{enabled ? "Enabled" : "Disabled"}</TooltipContent>
      </Tooltip>
    );
  }
  return enabled ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded px-1.5 py-0.5 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border border-border rounded px-1.5 py-0.5 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 shrink-0" />
      Disabled
    </span>
  );
}

export interface ChannelRowActions {
  onDeploy: (id: string) => void;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onExport: (id: string) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onViewMessages: (id: string) => void;
  onAssignGroup: (id: string) => void;
}

function ChannelRowImpl({
  channel,
  indent,
  tagMap,
  visibleCols,
  mounted,
  metadataMap,
  revisionDeltas,
  codeTemplatesChanged,
  localIds,
  repoChangedIds,
  selected,
  onRowClick,
  actions,
  portMap,
  tagDisplayMode,
  density,
  groupMode,
  namedGroupsExist,
}: {
  channel: EnrichedChannel;
  indent?: boolean;
  tagMap: Map<string, ChannelTag[]>;
  visibleCols: ColDef<ChanCol>[];
  mounted: boolean;
  metadataMap: Record<string, ChannelMetadata>;
  revisionDeltas: Map<string, number>;
  codeTemplatesChanged: Map<string, boolean>;
  localIds: Map<string, number>;
  repoChangedIds?: Set<string> | null;
  selected: boolean;
  onRowClick: (id: string, e: React.MouseEvent) => void;
  actions: ChannelRowActions;
  portMap?: Map<string, string>;
  tagDisplayMode?: TagDisplayMode;
  density?: ViewDensity;
  groupMode?: boolean;
  namedGroupsExist?: boolean;
}) {
  const cellFont = density === "compact" ? "text-xs" : "text-sm";
  const enabled = isChannelEnabled(channel, metadataMap);
  const lastMod = channelLastModified(channel, metadataMap);
  const dataType = channelDataType(channel);
  const tags = tagMap.get(channel.id) ?? [];

  function cell(col: ColDef<ChanCol>) {
    switch (col.key) {
      case "status":
        return (
          <TableCell key={col.key} align={density !== "comfortable" ? "center" : "left"}>
            <EnabledBadge enabled={enabled} density={density} />
          </TableCell>
        );
      case "name":
        return (
          <TableCell key={col.key}>
            <div
              className="flex items-center gap-1.5 min-w-0"
              style={{ paddingLeft: indent ? "24px" : 0 }}
            >
              <Cable className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              {repoChangedIds?.has(channel.id) && (
                <span className="shrink-0" title="Uncommitted changes in version history">
                  <GitCommit className="w-3 h-3 text-amber-500" />
                </span>
              )}
              <span
                className={`truncate shrink-0 ${cellFont} font-medium ${enabled ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"}`}
                style={{ maxWidth: "70%" }}
              >
                {channel.name}
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
      case "id":
        return (
          <TableCell key={col.key} mono className="text-gray-400 dark:text-gray-500 group/idcell">
            <div className="relative min-w-0">
              <span className="truncate block">{channel.id}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(channel.id).then(() => {
                    toast.success("Channel ID copied");
                  });
                }}
                title="Copy channel ID"
                className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/idcell:opacity-100 transition-opacity p-0.5 rounded hover:text-gray-700 dark:hover:text-gray-300"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </TableCell>
        );
      case "localChannelId": {
        const lid = localIds.get(channel.id);
        return (
          <TableCell
            key={col.key}
            mono
            align="center"
            className={`${cellFont} text-gray-500 dark:text-gray-400`}
          >
            {lid != null ? lid : <span className="text-gray-400 dark:text-gray-500">{"—"}</span>}
          </TableCell>
        );
      }
      case "description":
        return (
          <TableCell key={col.key} className="text-gray-500 dark:text-gray-400">
            {channel.description ? (
              <span className="truncate block">{channel.description}</span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">{"—"}</span>
            )}
          </TableCell>
        );
      case "sourceType":
        return (
          <TableCell key={col.key} className="text-gray-500 dark:text-gray-400">
            {channel.sourceConnector?.transportName ?? "—"}
          </TableCell>
        );
      case "dataType":
        return (
          <TableCell key={col.key} className="text-gray-500 dark:text-gray-400">
            {dataType}
          </TableCell>
        );
      case "dests":
        return (
          <TableCell key={col.key} align="center" className="text-gray-500 dark:text-gray-400">
            {channel.destinationConnectors?.length ?? "—"}
          </TableCell>
        );
      case "lastModified":
        return (
          <TableCell
            key={col.key}
            mono
            className="text-gray-500 dark:text-gray-400"
            suppressHydrationWarning
          >
            {mounted && lastMod ? format(new Date(lastMod), "yyyy-MM-dd HH:mm") : "—"}
          </TableCell>
        );
      case "revDelta": {
        const delta = revisionDeltas.get(channel.id);
        const ctc = codeTemplatesChanged.get(channel.id);
        const highlighted = (delta != null && delta > 0) || ctc === true;
        return (
          <TableCell
            key={col.key}
            mono
            align="center"
            title={highlighted ? "Unsaved changes since last deploy" : undefined}
            className={`${cellFont} font-medium ${highlighted ? "bg-[#ffcc00] text-black" : "text-gray-500"}`}
          >
            {delta != null ? delta : "--"}
          </TableCell>
        );
      }
      case "lastDeployed": {
        const recentDeploy =
          mounted &&
          // eslint-disable-next-line react-hooks/purity -- Date.now() is intentional; the row re-renders on each channels refresh so "now" stays current
          isRecentlyDeployed(channel.deployedDate, Date.now());
        return (
          <TableCell
            key={col.key}
            mono
            suppressHydrationWarning
            title={recentDeploy ? "Deployed within the last 2 minutes" : undefined}
            className={recentDeploy ? RECENT_DEPLOY_CELL_CLASS : "text-gray-500 dark:text-gray-400"}
          >
            {mounted && channel.deployedDate
              ? format(new Date(channel.deployedDate), "yyyy-MM-dd HH:mm")
              : "—"}
          </TableCell>
        );
      }
      case "port": {
        const port = portMap?.get(channel.id);
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} text-gray-500 dark:text-gray-400`}
          >
            {port != null ? port : <span className="text-gray-300 dark:text-gray-600">{"—"}</span>}
          </TableCell>
        );
      }
      case "received":
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} text-gray-700 dark:text-gray-300`}
          >
            {channel.received !== undefined ? channel.received.toLocaleString() : "—"}
          </TableCell>
        );
      case "errored":
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} ${(channel.errored ?? 0) > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-700 dark:text-gray-300"}`}
          >
            {channel.errored !== undefined ? channel.errored.toLocaleString() : "—"}
          </TableCell>
        );
      case "pruneMetaData": {
        const days = metadataMap[channel.id]?.pruningSettings?.pruneMetaDataDays;
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} text-gray-700 dark:text-gray-300`}
          >
            {days != null ? (
              `${days}d`
            ) : (
              <span className="text-gray-400 dark:text-gray-500">{"—"}</span>
            )}
          </TableCell>
        );
      }
      case "pruneContent": {
        const days = metadataMap[channel.id]?.pruningSettings?.pruneContentDays;
        return (
          <TableCell
            key={col.key}
            mono
            align="right"
            className={`${cellFont} text-gray-700 dark:text-gray-300`}
          >
            {days != null ? (
              `${days}d`
            ) : (
              <span className="text-gray-400 dark:text-gray-500">{"—"}</span>
            )}
          </TableCell>
        );
      }
      case "archive": {
        const ps = metadataMap[channel.id]?.pruningSettings;
        return (
          <TableCell key={col.key} align="center" className={cellFont}>
            {ps == null ? (
              <span className="text-gray-400 dark:text-gray-500">{"—"}</span>
            ) : ps.archiveEnabled ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                ✓
              </span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">✕</span>
            )}
          </TableCell>
        );
      }
      default:
        return null;
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          variant={selected ? "selected" : "default"}
          className="cursor-pointer"
          onClick={(e) => onRowClick(channel.id, e)}
          onDoubleClick={() => actions.onEdit(channel.id)}
        >
          {visibleCols.map((c) => cell(c))}
        </TableRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {enabled && (
          <>
            <ContextMenuItem onClick={() => actions.onDeploy(channel.id)}>
              <Rocket className="w-4 h-4" />
              Deploy Channel
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {enabled ? (
          <ContextMenuItem onClick={() => actions.onDisable(channel.id)}>
            <ToggleRight className="w-4 h-4" />
            Disable Channel
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => actions.onEnable(channel.id)}>
            <ToggleLeft className="w-4 h-4" />
            Enable Channel
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.onViewMessages(channel.id)}>
          <Inbox className="w-4 h-4" />
          View Messages
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.onEdit(channel.id)}>
          <Pencil className="w-4 h-4" />
          Edit Channel
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onClone(channel.id)}>
          <Copy className="w-4 h-4" />
          Clone Channel
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onExport(channel.id)}>
          <Download className="w-4 h-4" />
          Export Channel
        </ContextMenuItem>
        {groupMode && namedGroupsExist && (
          <ContextMenuItem onClick={() => actions.onAssignGroup(channel.id)}>
            <FolderInput className="w-4 h-4" />
            Assign to Group
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(channel.id)}>
          <Trash2 className="w-4 h-4" />
          Delete Channel
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Memoized so an idle channels poll that returns unchanged data re-renders zero
 * rows. Relies on stable `channel`/metadata references from the cache
 * store's structural sharing and stable per-row handlers from the page.
 */
export const ChannelRow = memo(ChannelRowImpl);
