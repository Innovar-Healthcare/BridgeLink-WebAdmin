import { useMemo } from "react";
import type { DashboardStatus } from "@/lib/types";
import type { StatsMode } from "@/lib/hooks/use-dashboard-stats";
import type { ChannelAction } from "../_components/dashboard-row";

// Mirror of the constants in dashboard/page.tsx — kept in sync intentionally.
const MID_DEPLOY_STATES = ["DEPLOYING", "UNDEPLOYING"];
const HALTABLE_STATES = [
  "DEPLOYING",
  "UNDEPLOYING",
  "STARTING",
  "STOPPING",
  "PAUSING",
  "SYNCING",
  "UNKNOWN",
];

interface Opts {
  selectedConnector: { channelId: string; metaDataId: number } | null;
  statuses: DashboardStatus[];
  effectiveSelectedIds: Set<string>;
  selectedIds: Set<string>;
  selectedStatuses: DashboardStatus[];
  startableIds: string[];
  stoppableIds: string[];
  pausableIds: string[];
  haltableIds: string[];
  removableIds: string[];
  undeployableIds: string[];
  interactableIds: string[];
  allSelectedIds: string[];
  statsMode: StatsMode;
  dashboardViewOnly: boolean;
  handleViewMessages: (channelId: string, metaDataId?: number) => void;
  handleStartConnector: (channelId: string, metaDataId: number) => Promise<void>;
  handleStopConnector: (channelId: string, metaDataId: number) => Promise<void>;
  handleGroupAction: (channelIds: string[], action: ChannelAction) => Promise<void>;
  handleClearStats: (channelId: string, metaDataId: number | null, channelName: string) => void;
  handleGroupClearStats: (channelIds: string[], label: string) => void;
  handleOpenSendMessage: (channelId: string, channelName: string) => void;
  handleRemoveAllMessages: (
    channels: { channelId: string; channelName: string; channelState: string }[]
  ) => void;
  setShowQueueDisabledWarning: (v: boolean) => void;
}

export function useConnectorToolbar({
  selectedConnector,
  statuses,
  effectiveSelectedIds,
  selectedIds,
  selectedStatuses,
  startableIds,
  stoppableIds,
  pausableIds,
  haltableIds,
  removableIds,
  undeployableIds,
  interactableIds,
  allSelectedIds,
  statsMode,
  dashboardViewOnly,
  handleViewMessages,
  handleStartConnector,
  handleStopConnector,
  handleGroupAction,
  handleClearStats,
  handleGroupClearStats,
  handleOpenSendMessage,
  handleRemoveAllMessages,
  setShowQueueDisabledWarning,
}: Opts) {
  const parentChannelStatus = useMemo(() => {
    if (!selectedConnector) return null;
    return (
      statuses.find(
        (s) =>
          (s.statusType === "CHANNEL" || !s.statusType) &&
          s.channelId === selectedConnector.channelId
      ) ?? null
    );
  }, [selectedConnector, statuses]);

  const selectedConnectorStatus = useMemo(() => {
    if (!selectedConnector) return null;
    return (
      parentChannelStatus?.childStatuses?.find(
        (c) => c.metaDataId === selectedConnector.metaDataId
      ) ?? null
    );
  }, [selectedConnector, parentChannelStatus]);

  // Connector actions require the parent channel to be STARTED or PAUSED.
  // Java reference: DashboardPanel.java:547-550.
  const parentState = parentChannelStatus?.state ?? "";
  const parentIsActive = parentState === "STARTED" || parentState === "PAUSED";
  const parentMidDeploy = MID_DEPLOY_STATES.includes(parentState);
  const parentHaltable = HALTABLE_STATES.includes(parentState);
  const parentHaltableNonSync = parentHaltable && parentState !== "SYNCING";

  const connQueueEnabled = selectedConnectorStatus?.queueEnabled ?? false;
  // Java shows Start Connector for a STOPPED connector on an active channel regardless of queueing
  // (DashboardPanel.java:552-562 — case STOPPED, no queueEnabled check) —. connQueueEnabled
  // is still consulted by the stop-side warning path (onStop) below.
  const connStartable =
    !!selectedConnector && parentIsActive && selectedConnectorStatus?.state === "STOPPED";
  const connStoppable =
    !!selectedConnector && parentIsActive && selectedConnectorStatus?.state === "STARTED";

  const toolbarStartableIds = selectedConnector
    ? connStartable
      ? [selectedConnector.channelId]
      : []
    : startableIds;
  const toolbarStoppableIds = selectedConnector
    ? connStoppable
      ? [selectedConnector.channelId]
      : []
    : stoppableIds;

  // When a connector is selected, fall back to parent-channel state guards for the
  // channel-scoped actions (Clear Stats, Remove All, Undeploy, View Messages, Send Message).
  const toolbarRemovableIds = selectedConnector
    ? parentHaltable
      ? []
      : [selectedConnector.channelId]
    : removableIds;
  const toolbarUndeployableIds = selectedConnector
    ? parentHaltableNonSync
      ? []
      : [selectedConnector.channelId]
    : undeployableIds;
  const toolbarInteractableIds = selectedConnector
    ? parentMidDeploy
      ? []
      : [selectedConnector.channelId]
    : interactableIds;

  const actionPanelProps = {
    interactableCount: toolbarInteractableIds.length,
    startableIds: toolbarStartableIds,
    stoppableIds: toolbarStoppableIds,
    pausableIds: selectedConnector ? [] : pausableIds,
    // Java force-gates Halt to a single channel (DashboardPanel.java:537-542): the Halt
    // task is shown only when exactly one channel is selected. Mirror that here — gate on
    // selection count, not haltableIds.length (2 selected with 1 haltable must still block).
    haltableIds: selectedConnector ? [] : effectiveSelectedIds.size === 1 ? haltableIds : [],
    removableIds: toolbarRemovableIds,
    undeployableIds: toolbarUndeployableIds,
    clearableIds: toolbarInteractableIds,
    // Java hides Clear Statistics in Lifetime stats mode (DashboardPanel.java:566-568) —
    // _clearStatistics only clears current stats, so it is misleading over lifetime numbers.
    clearStatsHidden: statsMode === "lifetime",
    allSelectedIds: selectedConnector ? [selectedConnector.channelId] : allSelectedIds,
    viewOnly: dashboardViewOnly,
    onViewMessages: () => {
      if (selectedConnector) {
        handleViewMessages(selectedConnector.channelId, selectedConnector.metaDataId);
      } else {
        const id = [...selectedIds][0];
        if (id) handleViewMessages(id);
      }
    },
    onSendMessage: () => {
      const s = selectedStatuses[0];
      if (s) handleOpenSendMessage(s.channelId, s.name);
    },
    onStart: () => {
      if (selectedConnector) {
        handleStartConnector(selectedConnector.channelId, selectedConnector.metaDataId);
      } else {
        handleGroupAction(toolbarStartableIds, "start");
      }
    },
    onStop: () => {
      if (selectedConnector) {
        if (selectedConnector.metaDataId !== 0 && !connQueueEnabled) {
          setShowQueueDisabledWarning(true);
        } else {
          handleStopConnector(selectedConnector.channelId, selectedConnector.metaDataId);
        }
      } else {
        handleGroupAction(toolbarStoppableIds, "stop");
      }
    },
    onPause: (ids: string[]) => handleGroupAction(ids, "pause"),
    onHalt: (ids: string[]) => handleGroupAction(ids, "halt"),
    onClearStats: (ids: string[]) => {
      if (selectedConnector) {
        handleClearStats(
          selectedConnector.channelId,
          selectedConnector.metaDataId,
          selectedConnectorStatus?.name ?? ""
        );
      } else {
        handleGroupClearStats(
          ids,
          `${effectiveSelectedIds.size} channel${effectiveSelectedIds.size !== 1 ? "s" : ""}`
        );
      }
    },
    onRemoveAllMessages: (ids: string[]) => {
      // Collect EVERY selected channel (not just the first) so Remove-All purges all of them —
      // mirrors Java Frame.doRemoveAllMessages collecting all selected into a Set<String>.
      const chans = statuses
        .filter(
          (st) => (st.statusType === "CHANNEL" || !st.statusType) && ids.includes(st.channelId)
        )
        .map((st) => ({
          channelId: st.channelId,
          channelName: st.name,
          channelState: st.state ?? "",
        }));
      if (chans.length) handleRemoveAllMessages(chans);
    },
    onUndeploy: (ids: string[]) => handleGroupAction(ids, "undeploy"),
  };

  return { actionPanelProps, selectedConnectorStatus };
}
