"use client";

import {
  Play,
  Square,
  Pause,
  OctagonX,
  Unplug,
  BarChart3,
  Trash2,
  MessageSquare,
  Send,
} from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface DashboardActionPanelProps {
  position: ToolbarPosition;
  /**
   * Count of selected rows that are not in a mid-deploy state (DEPLOYING/UNDEPLOYING).
   * Used to gate single-channel actions (View Messages, Send Message) so they remain
   * disabled when the only selection is mid-deploy.
   */
  interactableCount: number;
  startableIds: string[];
  stoppableIds: string[];
  pausableIds: string[];
  haltableIds: string[];
  removableIds: string[];
  undeployableIds: string[];
  clearableIds: string[];
  /**
   * When true, the Clear Statistics action is hidden entirely. Java hides it while Lifetime
   * stats are shown (DashboardPanel.java:566-568) — clearing only affects current stats.
   */
  clearStatsHidden?: boolean;
  /** When true, all write actions are disabled (View-only RBAC). */
  viewOnly?: boolean;
  onViewMessages: () => void;
  onSendMessage: () => void;
  onStart: (ids: string[]) => void;
  onStop: (ids: string[]) => void;
  onPause: (ids: string[]) => void;
  onHalt: (ids: string[]) => void;
  onClearStats: (ids: string[]) => void;
  onRemoveAllMessages: (ids: string[]) => void;
  onUndeploy: (ids: string[]) => void;
}

export function DashboardActionPanel({
  position,
  interactableCount,
  startableIds,
  stoppableIds,
  pausableIds,
  haltableIds,
  removableIds,
  undeployableIds,
  clearableIds,
  clearStatsHidden = false,
  onViewMessages,
  onSendMessage,
  onStart,
  onStop,
  onPause,
  onHalt,
  onClearStats,
  onRemoveAllMessages,
  onUndeploy,
  viewOnly = false,
}: DashboardActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const exactlyOneInteractable = interactableCount === 1;
  const ro = viewOnly;

  return (
    <>
      {/* View / Send */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onViewMessages}
        disabled={!exactlyOneInteractable}
        icon={<MessageSquare className="w-4 h-4" />}
        label="Messages"
        title="View messages for selected channel"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onSendMessage}
        disabled={!exactlyOneInteractable || ro}
        icon={<Send className="w-4 h-4" />}
        label="Send Msg"
        title="Send message to selected channel"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Start / Stop / Pause / Halt */}
      <AdaptiveBtn
        orientation={orientation}
        variant="primary"
        onClick={() => onStart(startableIds)}
        disabled={startableIds.length === 0 || ro}
        icon={<Play className="w-4 h-4" />}
        label="Start"
        title="Start selected channels"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={() => onStop(stoppableIds)}
        disabled={stoppableIds.length === 0 || ro}
        icon={<Square className="w-4 h-4" />}
        label="Stop"
        title="Stop selected channels"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={() => onPause(pausableIds)}
        disabled={pausableIds.length === 0 || ro}
        icon={<Pause className="w-4 h-4" />}
        label="Pause"
        title="Pause selected channels"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={() => onHalt(haltableIds)}
        disabled={haltableIds.length === 0 || ro}
        icon={<OctagonX className="w-4 h-4" />}
        label="Halt"
        title="Halt selected channels"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Stats / Messages */}
      {!clearStatsHidden && (
        <AdaptiveBtn
          orientation={orientation}
          onClick={() => onClearStats(clearableIds)}
          disabled={clearableIds.length === 0 || ro}
          icon={<BarChart3 className="w-4 h-4" />}
          label="Clear Stats"
          title="Clear statistics for selected channels"
        />
      )}
      <AdaptiveBtn
        orientation={orientation}
        onClick={() => onRemoveAllMessages(removableIds)}
        disabled={removableIds.length === 0 || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Remove Msgs"
        title="Remove all messages for selected channels"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Undeploy */}
      <AdaptiveBtn
        orientation={orientation}
        variant="orange"
        onClick={() => onUndeploy(undeployableIds)}
        disabled={undeployableIds.length === 0 || ro}
        icon={<Unplug className="w-4 h-4" />}
        label="Undeploy"
        title="Undeploy selected channels"
      />
    </>
  );
}
