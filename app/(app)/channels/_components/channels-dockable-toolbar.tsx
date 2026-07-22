"use client";

import React from "react";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { ChannelsActionPanel } from "./channels-action-panel";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import type { ChannelGroup } from "@/lib/types";

interface ChannelsDockableToolbarProps {
  /** Only renders when toolbarPos is in this set. */
  positions: ToolbarPosition[];
  toolbarPos: ToolbarPosition;
  setToolbarPosition: (v: ToolbarPosition) => void;
  // ChannelsActionPanel props
  opLoading: boolean;
  someSelected: boolean;
  selectedIds: Set<string>;
  selectedGroupId: string | null;
  anySelectedEnabled: boolean;
  anySelectedDisabled: boolean;
  allSelectedDisabled: boolean;
  allChannelsSelected: boolean;
  allGroupsSelected: boolean;
  filterEnabled: boolean;
  groupMode: boolean;
  allGroups: ChannelGroup[];
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

export function ChannelsDockableToolbar({
  positions,
  toolbarPos,
  setToolbarPosition,
  ...panelProps
}: ChannelsDockableToolbarProps) {
  if (!positions.includes(toolbarPos)) return null;
  return (
    <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
      <ChannelsActionPanel position={toolbarPos} {...panelProps} />
    </DockableToolbar>
  );
}
