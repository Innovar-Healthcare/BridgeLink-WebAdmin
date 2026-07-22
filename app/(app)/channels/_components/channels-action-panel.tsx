"use client";

import React from "react";
import {
  Play,
  Upload,
  Download,
  Copy,
  Trash2,
  Pencil,
  Plus,
  ToggleLeft,
  ToggleRight,
  Layers,
  FolderPlus,
  FolderInput,
  ChevronDown,
  Rocket,
  Inbox,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ChannelGroup } from "@/lib/types";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { DEFAULT_GROUP_ID } from "../_lib/channel-columns";
import { getSlot } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";

interface ChannelsActionPanelProps {
  position: ToolbarPosition;
  opLoading: boolean;
  someSelected: boolean;
  selectedIds: Set<string>;
  selectedGroupId: string | null;
  anySelectedEnabled: boolean;
  anySelectedDisabled: boolean;
  allSelectedDisabled: boolean;
  /** True when only channel rows are selected (no group node). */
  allChannelsSelected: boolean;
  /** True when only a non-default group node is selected (no channels). */
  allGroupsSelected: boolean;
  /** True when the tag filter is active. */
  filterEnabled: boolean;
  groupMode: boolean;
  allGroups: ChannelGroup[];
  /** When true, all write actions are disabled (View-only RBAC). */
  viewOnly?: boolean;
  onDeploy: () => void;
  onDeployAll: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onEdit: () => void;
  onViewMessages: () => void;
  onNew: () => void;
  onImport: () => void;
  onImportFromRepo?: () => void;
  onExport: () => void;
  onClone: () => void;
  onDelete: () => void;
  onNewGroup: () => void;
  onAssignGroup: () => void;
  onEditGroup: () => void;
  onImportGroups: () => void;
  onExportGroup: () => void;
  onExportAllGroups: () => void;
  selectedGroupHasEnabledChannels: boolean;
  onDeployAllInGroup: () => void;
  onEnableAllInGroup: () => void;
  onDisableAllInGroup: () => void;
  onDeleteGroup: () => void;
}

/** Dropdown menu side based on toolbar position */
const DROPDOWN_SIDE: Record<ToolbarPosition, "top" | "bottom" | "left" | "right"> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

export function ChannelsActionPanel({
  position,
  opLoading,
  someSelected,
  selectedIds,
  selectedGroupId,
  anySelectedEnabled,
  anySelectedDisabled,
  allSelectedDisabled,
  allChannelsSelected,
  allGroupsSelected,
  filterEnabled,
  groupMode,
  allGroups,
  onDeploy,
  onDeployAll,
  onEnable,
  onDisable,
  onEdit,
  onViewMessages,
  onNew,
  onImport,
  onImportFromRepo,
  onExport,
  onClone,
  onDelete,
  onNewGroup,
  onAssignGroup,
  onEditGroup,
  onImportGroups,
  onExportGroup,
  onExportAllGroups,
  selectedGroupHasEnabledChannels,
  onDeployAllInGroup,
  onEnableAllInGroup,
  onDisableAllInGroup,
  onDeleteGroup,
  viewOnly = false,
}: ChannelsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const namedGroupCount = allGroups.filter((g) => g.id !== DEFAULT_GROUP_ID).length;
  const dropdownSide = DROPDOWN_SIDE[position];
  const ro = viewOnly || opLoading;
  // Gate the Import-from-Repo dropdown on the plugin that fills the slot being
  // enabled. For version-history this layers its "Enable" setting on
  // top of extension-enablement, matching the prior useVersionHistoryEnabled().
  const importRepoEnabled = useSlotEnabled("channels.import-repo-dialog");

  return (
    <>
      {/* Deploy group */}
      <AdaptiveBtn
        orientation={orientation}
        variant="primary"
        onClick={onDeploy}
        disabled={allSelectedDisabled || ro}
        icon={<Play className="w-4 h-4" />}
        label="Deploy"
        title="Deploy selected channels"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onDeployAll}
        disabled={ro}
        icon={<Play className="w-4 h-4" />}
        label="Deploy All"
        title="Redeploy all channels"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Enable / Disable */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onEnable}
        disabled={!anySelectedDisabled || ro}
        icon={<ToggleRight className="w-4 h-4" />}
        label="Enable"
        title="Enable selected channels"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onDisable}
        disabled={!anySelectedEnabled || ro}
        icon={<ToggleLeft className="w-4 h-4" />}
        label="Disable"
        title="Disable selected channels"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Edit / New / Import / Export / Clone */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onEdit}
        disabled={!allChannelsSelected || selectedIds.size !== 1 || ro}
        icon={<Pencil className="w-4 h-4" />}
        label="Edit"
        title="Edit selected channel"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onViewMessages}
        disabled={!allChannelsSelected || selectedIds.size !== 1}
        icon={<Inbox className="w-4 h-4" />}
        label="Messages"
        title="View messages for selected channel"
      />
      <AdaptiveBtn
        orientation={orientation}
        variant="accent"
        onClick={onNew}
        disabled={ro}
        icon={<Plus className="w-4 h-4" />}
        label="New"
        title="Create a new channel"
      />
      {getSlot("channels.import-repo-dialog") && importRepoEnabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={ro}
              className={
                orientation === "vertical"
                  ? "flex flex-col items-center gap-0.5 w-full px-1 py-1.5 text-[10px] leading-tight rounded disabled:opacity-40 disabled:cursor-not-allowed bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                  : "flex items-center gap-1 px-2.5 py-1.5 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap bg-white dark:bg-gray-800 border border-border hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              }
            >
              <Upload className="w-4 h-4" />
              <span>Import</span>
              <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={dropdownSide} align="start">
            <DropdownMenuItem onClick={onImport} disabled={ro}>
              <Upload className="w-3.5 h-3.5 mr-2" />
              Import from XML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImportFromRepo} disabled={ro}>
              <Upload className="w-3.5 h-3.5 mr-2" />
              Import from Repo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <AdaptiveBtn
          orientation={orientation}
          onClick={onImport}
          disabled={ro}
          icon={<Upload className="w-4 h-4" />}
          label="Import"
          title="Import channel from XML"
        />
      )}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExport}
        disabled={!someSelected || opLoading}
        icon={<Download className="w-4 h-4" />}
        label="Export"
        title="Export selected channel(s) as XML"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onClone}
        disabled={!allChannelsSelected || selectedIds.size !== 1 || ro}
        icon={<Copy className="w-4 h-4" />}
        label="Clone"
        title="Clone selected channel"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Delete */}
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onDelete}
        disabled={!someSelected || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Delete"
        title="Delete selected channels"
      />
      {/* Group Actions dropdown (group mode only) */}
      {groupMode && (
        <>
          <AdaptiveSeparator orientation={orientation} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={ro}
                className={
                  orientation === "vertical"
                    ? "flex flex-col items-center gap-0.5 w-full px-1 py-1.5 text-[10px] leading-tight rounded disabled:opacity-40 disabled:cursor-not-allowed bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                    : "flex items-center gap-1 px-2.5 py-1.5 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap bg-white dark:bg-gray-800 border border-border hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                }
              >
                <Layers className="w-4 h-4" />
                <span>Groups</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side={dropdownSide} align="start">
              <DropdownMenuItem onClick={onNewGroup} disabled={filterEnabled}>
                <FolderPlus className="w-3.5 h-3.5 mr-2" />
                New Group
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onAssignGroup}
                disabled={!allChannelsSelected || filterEnabled}
              >
                <FolderInput className="w-3.5 h-3.5 mr-2" />
                Assign to Group
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onEditGroup}
                disabled={!allGroupsSelected || filterEnabled}
              >
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Edit Group
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDeployAllInGroup}
                disabled={!selectedGroupId || !selectedGroupHasEnabledChannels || ro}
              >
                <Rocket className="w-3.5 h-3.5 mr-2" />
                Deploy All Channels
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEnableAllInGroup} disabled={!selectedGroupId || ro}>
                <ToggleLeft className="w-3.5 h-3.5 mr-2" />
                Enable All Channels
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDisableAllInGroup} disabled={!selectedGroupId || ro}>
                <ToggleRight className="w-3.5 h-3.5 mr-2" />
                Disable All Channels
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onImportGroups} disabled={ro}>
                <Upload className="w-3.5 h-3.5 mr-2" />
                Import Groups
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportGroup} disabled={namedGroupCount === 0}>
                <Download className="w-3.5 h-3.5 mr-2" />
                Export Group
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportAllGroups} disabled={namedGroupCount === 0}>
                <Download className="w-3.5 h-3.5 mr-2" />
                Export All Groups
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDeleteGroup}
                disabled={!allGroupsSelected || filterEnabled || ro}
                className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Delete Group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </>
  );
}
